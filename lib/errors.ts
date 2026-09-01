/**
 * serializeError — turn whatever was thrown into something an audit row can
 * actually be read from.
 *
 * Razorpay's Node SDK throws plain objects shaped like
 * { statusCode, error: { code, description, ... } }, not Error instances.
 * `err.message` on those is undefined and `String(err)` produces the useless
 * "[object Object]" — which this project has now been bitten by twice: once
 * on the human order path (BUILD_LOG.md Day 3), and again on the agent order
 * path, where the fix had been reimplemented by hand and lost the lesson.
 *
 * It lives in its own module precisely so the next code path that catches a
 * Razorpay failure reuses it rather than rewriting a worse version. An audit
 * trail that records "[object Object]" for a failed money movement is, for
 * debugging purposes, no audit trail at all.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { message: err.message, name: err.name };
  if (typeof err === "object" && err !== null) return err as Record<string, unknown>;
  return { raw: String(err) };
}

/**
 * Recognises the one Razorpay failure that looks like a bug but isn't.
 *
 * Test mode allows only 30 payment links per account, EVER — cancelling
 * unpaid ones does not free the slots (verified). Every order this project
 * places consumes one, so a few days of testing exhausts the account
 * permanently and every subsequent order fails.
 *
 * It deserves its own detection because the generic message ("the payment
 * link could not be created") sends you hunting for a code fault, when the
 * actual fix is a fresh test account. Losing minutes to that mid-demo is
 * exactly the situation worth spending ten lines to avoid.
 */
export function isPaymentLinkQuotaExhausted(err: unknown): boolean {
  const serialised = JSON.stringify(serializeError(err)).toLowerCase();
  return serialised.includes("limit of 30") || (serialised.includes("rate_limit_exceeded") && serialised.includes("payment_link"));
}

export const PAYMENT_LINK_QUOTA_MESSAGE =
  "This Razorpay TEST account has hit its lifetime cap of 30 payment links. This is an account limit, not a fault in the order logic — the order itself was accepted and every guardrail passed. Use a fresh test account (see scripts/cleanup-payment-links.ts, which reports current usage).";
