import Razorpay from "razorpay";
import crypto from "crypto";

// Thin wrapper around the Razorpay SDK, test-mode only. This module is the
// ONLY place Razorpay's Orders/Payment Links APIs are called from — every
// caller must go through lib/guardrails.ts first. See guardrails.ts header.
export function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      "Missing Razorpay env vars. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.local (test mode keys)."
    );
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// BUG FOUND LIVE, FIXED (see BUILD_LOG.md Day 6 / DECISIONS.md D-7): this
// project used to also call razorpay.orders.create() directly and store
// *that* order's id as orders.razorpay_order_id. That was wrong — creating a
// Payment Link makes Razorpay auto-generate its OWN separate internal order
// under the hood, and it's THAT order id — not one we create ourselves —
// that shows up in every payment.captured/payment.failed webhook. Storing
// the wrong one meant every real webhook's order lookup 404'd silently, even
// though the payment itself succeeded. createRazorpayOrder() has been
// removed entirely — a standalone Order was dead weight AND actively
// harmful for webhook matching.
//
// A second wrinkle, also confirmed live: that auto-generated order's id is
// assigned LAZILY — it does not exist yet when the Payment Link is created,
// only once the customer actually starts checkout. So there is nothing to
// capture at creation time; app/api/webhooks/razorpay/route.ts resolves the
// order id at webhook-arrival time instead, via the auto-generated order's
// `receipt` field, which Razorpay copies from this call's `reference_id` —
// see fetchRazorpayOrderReceipt() below.
export async function createRazorpayPaymentLink(
  totalPaise: number,
  referenceId: string,
  description: string
) {
  const razorpay = getRazorpayClient();
  const payload = {
    amount: totalPaise,
    currency: "INR",
    reference_id: referenceId,
    description,
    notify: { sms: false, email: false },
  };
  // The SDK's TS type marks `customer` as required, which is what led to
  // sending `customer: {}` originally — but the REAL Razorpay API rejects
  // that outright: "incorrect JSON object received - faulty key: customer"
  // (confirmed by hitting this live, not assumed). We don't collect
  // name/email/phone in chat, so the correct fix is to omit the key
  // entirely, not send an empty placeholder. The cast below is the honest
  // fix for a type that's stricter than the real API, not a safety hole.
  return razorpay.paymentLink.create(payload as Parameters<typeof razorpay.paymentLink.create>[0]);
}

// Given the order_id from an incoming payment.captured/payment.failed
// webhook, returns that Razorpay order's `receipt` field — which, for every
// order this app's Payment Links auto-generate, always starts with the exact
// UUID we originally passed as `reference_id` (confirmed live). This is how
// the webhook handler maps Razorpay's own, lazily-assigned order id back to
// our internal orders.id, without ever needing to guess or pre-populate it.
// Returns null if the order can't be fetched (never throws into the caller —
// a webhook that can't be resolved must still get a clean response, not a
// crash).
export async function fetchRazorpayOrderReceipt(razorpayOrderId: string): Promise<string | null> {
  try {
    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.fetch(razorpayOrderId);
    return typeof order.receipt === "string" ? order.receipt : null;
  } catch {
    return null;
  }
}

// Verifies X-Razorpay-Signature per Razorpay's documented HMAC-SHA256 scheme.
// Webhook events with an invalid signature must be rejected before any DB
// write — see 05_TEST_CASES.md #13.
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing RAZORPAY_WEBHOOK_SECRET in .env.local.");
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    // Buffer length mismatch etc. — treat as invalid, never throw here.
    return false;
  }
}

/**
 * Creates a Razorpay Order directly — the settlement path this project now
 * uses, replacing Payment Links.
 *
 * THIS IS NOT A REVERSAL OF D-7, IT IS ITS RESOLUTION.
 *
 * D-7 removed a standalone `orders.create()` call because, at the time, it
 * ran *alongside* `paymentLink.create()`. That produced two unrelated orders:
 * the one we made and stored, and the one the Payment Link silently generated
 * for itself — and only the latter ever appeared in a webhook. Storing the
 * wrong one broke reconciliation for every real payment.
 *
 * Removing Payment Links entirely removes the ambiguity. There is now exactly
 * one order, we create it, and we know its id before the customer pays. The
 * webhook's `order_id` matches `orders.razorpay_order_id` by direct lookup,
 * with no receipt-chasing indirection at all.
 *
 * Two other things this buys, both real:
 *   - **Capture becomes autonomous-capable.** Payment Links can only be paid
 *     on Razorpay's hosted page. An Order can be paid through Checkout on a
 *     page we control, which is what closes the "hosted_redirect" caveat.
 *   - **It removes the 30-payment-link lifetime ceiling** that had made this
 *     test account unable to place any order at all (D-10). Orders are not
 *     capped that way — verified by calling both against the exhausted
 *     account: `paymentLink.create` fails, `orders.create` succeeds.
 *
 * `receipt` carries our own orders.id so a human reading the Razorpay
 * dashboard can trace any payment back to a row in this database.
 */
export async function createRazorpayOrder(totalPaise: number, receipt: string, notes?: Record<string, string>) {
  const razorpay = getRazorpayClient();
  return razorpay.orders.create({
    amount: totalPaise,
    currency: "INR",
    receipt,
    notes,
  });
}

/** The public key id, safe to hand to the browser — Razorpay Checkout needs it. */
export function getRazorpayKeyId(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) throw new Error("Missing RAZORPAY_KEY_ID in .env.local.");
  return keyId;
}
