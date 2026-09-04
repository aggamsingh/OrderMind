import { NextRequest, NextResponse } from "next/server";
import { MAX_RETRIES } from "@/lib/types";
import { AGENT_LIMITS } from "@/lib/agent-trust";
import { MERCHANTS, getMerchant } from "@/lib/merchants";

/**
 * Machine-readable merchant manifest — the discovery entry point that makes
 * this merchant *transactable by an AI buyer* rather than only by a human
 * with a browser.
 *
 * A buyer agent fetches this one well-known URL and learns, with no human
 * and no UI: what this merchant sells, where to price a basket, how to place
 * an order, what it will and will not do autonomously, and what proof it
 * requires before moving money. Everything a human would otherwise have to
 * read off a website.
 *
 * The `terms` block is the part that matters most: publishing the limits up
 * front means a well-behaved buyer agent can decide *before* spending a
 * request whether this merchant can serve it at all — rather than discovering
 * the cap by being refused. The refusal still happens server-side regardless
 * (lib/guardrails.ts); this block is a courtesy, never the enforcement.
 *
 * `?merchant=` selects a storefront. Each publishes its OWN terms, and they
 * differ on purpose — see lib/merchants.ts.
 */
export async function GET(req: NextRequest) {
  const merchant = getMerchant(req.nextUrl.searchParams.get("merchant"));

  const body = {
    protocol_version: "0.1",
    merchant: {
      id: merchant.id,
      name: merchant.name,
      tagline: merchant.tagline,
      category: merchant.category,
      currency: "INR",
      country: "IN",
    },
    /**
     * Other merchants this buyer could also transact with. Linked rather than
     * summarised: one authoritative statement of any merchant's terms, in its
     * own manifest, so a directory can never drift out of sync with reality.
     */
    directory: {
      endpoint: "/api/agent/merchants",
      siblings: MERCHANTS.filter((m) => m.id !== merchant.id).map((m) => ({
        id: m.id,
        name: m.name,
        manifest: `/.well-known/agent-commerce.json?merchant=${m.id}`,
      })),
    },
    payments: {
      processor: "razorpay",
      mode: "test",
      methods: ["card", "upi", "netbanking", "wallet"],
      settlement: "razorpay_order",
      /**
       * How far a buyer agent can get WITHOUT a human, stated honestly.
       *
       * Everything commercial is autonomous: discovery, pricing, the upsell
       * decision, mandate verification, order creation, and a signed receipt.
       *
       * Capture is `merchant_hosted`: the payment is completed through
       * Razorpay Checkout on a page THIS merchant serves (/pay/{order_id}),
       * not on a redirect to Razorpay's own hosted page. That distinction
       * matters to a buyer agent, because a merchant-hosted checkout is
       * instrumentable and delegable in ways a third-party redirect is not.
       *
       * What is still NOT autonomous, stated plainly: completing a card
       * payment without any human present needs Razorpay's
       * server-to-server payment APIs, and those are gated behind merchant
       * approval — payments.createPaymentJson and payments.createUpi both
       * return "requested URL was not found" on a standard test account.
       * Verified by calling both, not assumed. With S2S enabled, the same
       * order created here would be payable end to end with no page at all.
       */
      autonomy: {
        negotiation: "autonomous",
        authorization: "autonomous",
        capture: "merchant_hosted",
        capture_endpoint: "/pay/{order_id}",
        full_autonomy_blocked_by: "razorpay_s2s_not_enabled_on_test_account",
        note: "Poll GET /api/agent/order/{order_id} to observe settlement once it completes.",
      },
    },
    endpoints: {
      catalog: `/api/agent/catalog?merchant=${merchant.id}`,
      quote: `/api/agent/quote?merchant=${merchant.id}`,
      order: `/api/agent/order?merchant=${merchant.id}`,
      order_status: "/api/agent/order/{order_id}",
      audit: "/api/audit",
    },
    /**
     * The rules of engagement, stated before a buyer commits to anything.
     */
    terms: {
      /**
       * Autonomous orders above this are refused outright — no human is
       * present to approve them. This value differs per merchant: a buyer
       * that assumes one merchant's ceiling applies to another will be
       * refused, which is exactly the assumption worth breaking early.
       */
      autonomous_order_cap_paise: merchant.autonomousCapPaise,
      /**
       * A signed spend mandate is mandatory. The merchant verifies the
       * signature itself and enforces the buyer's own ceiling — a buyer
       * agent cannot spend beyond what its principal delegated, even if this
       * merchant's own cap would have allowed it.
       */
      mandate: {
        required: true,
        header: "X-Agent-Mandate",
        enforced_limits: ["max_amount_paise", "expires_at", "currency", "single_use_nonce"],
        binding_rule: "stricter_of(buyer_mandate, merchant_cap)",
        /**
         * Two accepted formats. The AP2-aligned one exists so a buyer this
         * merchant has never exchanged a secret with can still prove
         * authority — verifiable against the published JWKS alone.
         */
        accepted_formats: [
          {
            id: "ordermind.hmac.v1",
            signing: "HMAC-SHA256",
            note: "Native format. Requires a shared secret agreed out of band.",
          },
          {
            id: "ap2.payment.open.1",
            signing: "ES256",
            jwks: "/.well-known/jwks.json",
            spec: "https://ap2-protocol.org/ap2/payment_mandate/",
            /**
             * Stated precisely rather than claiming blanket compliance: the
             * field vocabulary and ES256 signing follow the AP2 spec, but
             * SD-JWT selective disclosure is not implemented, so a strict
             * AP2 verifier expecting hashed disclosures will not accept
             * tokens this merchant issues.
             */
            conformance: "ap2-aligned; SD-JWT selective disclosure not implemented",
          },
        ],
      },
      /** Exactly one bounded retry per failed payment. A buyer agent that retries harder is refused. */
      max_payment_retries: MAX_RETRIES,
      /**
       * Published so a well-behaved agent can pace itself rather than
       * discovering the limit by being throttled. Repeated refusals trigger a
       * cool-down: resubmitting a refused order unchanged will not change the
       * answer, and a merchant open to agents needs an answer to retry loops.
       */
      rate_limits: AGENT_LIMITS,
      /** Every decision, including refusals, is written to an auditable trail. */
      audit: {
        available: true,
        includes_refusals: true,
        endpoint: "/api/audit",
      },
    },
    /**
     * Stated plainly so a buyer agent (or the human reviewing it) knows the
     * shape of what it is dealing with, rather than inferring it.
     */
    disclosures: {
      autonomous_orders_accepted: true,
      human_confirmation_available: false,
      note: "Orders above the autonomous cap require a human confirmation control that an autonomous buyer cannot operate. Such orders are refused rather than queued.",
    },
  };

  return NextResponse.json(body, {
    headers: {
      // Discovery documents should be cacheable by buyer agents, but not so
      // long that a price or limit change takes hours to propagate.
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json",
    },
  });
}
