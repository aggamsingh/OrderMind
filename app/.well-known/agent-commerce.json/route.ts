import { NextResponse } from "next/server";
import { SPEND_CAP_PAISE, MAX_RETRIES } from "@/lib/types";
import { AGENT_LIMITS } from "@/lib/agent-trust";

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
 */
export async function GET() {
  const body = {
    protocol_version: "0.1",
    merchant: {
      id: "chai-point-express",
      name: "Chai Point Express",
      category: "food_and_beverage.cafe",
      currency: "INR",
      country: "IN",
    },
    payments: {
      processor: "razorpay",
      mode: "test",
      methods: ["card", "upi", "netbanking", "wallet"],
      settlement: "payment_link",
      /**
       * How far a buyer agent can get WITHOUT a human, stated honestly.
       *
       * Everything commercial is autonomous: discovery, pricing, the upsell
       * decision, mandate verification, order creation, and a signed receipt.
       * Settlement is not: capture happens on Razorpay's hosted payment page.
       *
       * This is a rail limitation, not a design choice. Razorpay's
       * server-to-server payment APIs (payments.createPaymentJson and
       * payments.createUpi) both return "requested URL was not found" on a
       * standard test account — S2S is gated behind merchant approval.
       * Verified by calling both against this account, not assumed.
       *
       * Declared here so a buyer agent can decide up front whether this
       * merchant can complete its workflow unattended, rather than
       * discovering a human-shaped gap after it has already committed.
       */
      autonomy: {
        negotiation: "autonomous",
        authorization: "autonomous",
        capture: "hosted_redirect",
        capture_blocked_by: "razorpay_s2s_not_enabled_on_test_account",
        note: "Poll GET /api/agent/order/{order_id} to observe settlement once it completes.",
      },
    },
    endpoints: {
      catalog: "/api/agent/catalog",
      quote: "/api/agent/quote",
      order: "/api/agent/order",
      order_status: "/api/agent/order/{order_id}",
      audit: "/api/audit",
    },
    /**
     * The rules of engagement, stated before a buyer commits to anything.
     */
    terms: {
      /** Autonomous orders above this are refused outright — no human is present to approve them. */
      autonomous_order_cap_paise: SPEND_CAP_PAISE,
      /**
       * A signed spend mandate is mandatory. The merchant verifies the
       * signature itself and enforces the buyer's own ceiling — a buyer
       * agent cannot spend beyond what its principal delegated, even if this
       * merchant's own cap would have allowed it.
       */
      mandate: {
        required: true,
        format: "hmac-sha256-jws-compact",
        header: "X-Agent-Mandate",
        enforced_limits: ["max_amount_paise", "expires_at", "currency", "single_use_nonce"],
        binding_rule: "stricter_of(buyer_mandate, merchant_cap)",
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
