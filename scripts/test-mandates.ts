/**
 * Unit tests for the agent-to-agent gate: lib/mandate.ts (signing, verifying,
 * expiry, tampering) and lib/guardrails.ts evaluateMandate (stricter-of
 * enforcement).
 *
 * This is now the most security-relevant code in the repo — it is the only
 * thing standing between a forged or inflated mandate and a real Razorpay
 * charge. It was shipped untested, which for gating logic is indefensible;
 * this closes that.
 *
 * Dependency-free by design, exactly like scripts/test-guardrails.ts: both
 * modules are pure, so their correctness can be proven without credentials.
 *
 * Run: npx tsx scripts/test-mandates.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// Guarantee a signing secret even if .env.local lacks one — these tests must
// never depend on a real deployment's key.
process.env.MANDATE_SIGNING_SECRET ||= "test-only-signing-secret-not-a-real-key";

import { issueMandate, verifyMandate, signReceipt, verifyReceipt } from "../lib/mandate";
import { evaluateMandate, evaluateRefund } from "../lib/guardrails";
import { toAP2PaymentMandate, signAP2, verifyAP2, ap2ToSpendMandate } from "../lib/ap2";
import { SPEND_CAP_PAISE, type Order } from "../lib/types";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (extra !== undefined) console.log(`        ${JSON.stringify(extra)}`);
  }
}

function mandate(overrides: { max?: number; ttl?: number } = {}) {
  return issueMandate({
    buyer_agent_id: "buyer-agent://test/v1",
    principal: "principal@example.com",
    max_amount_paise: overrides.max ?? 20000,
    purpose: "test purchase",
    ttlSeconds: overrides.ttl ?? 900,
  });
}

console.log("--- verifyMandate: a well-formed mandate ---");
{
  const { token, mandate: issued } = mandate();
  const result = verifyMandate(token);
  check("a freshly issued mandate verifies", result.valid === true);
  if (result.valid) {
    check("the verified payload round-trips unchanged", result.mandate.nonce === issued.nonce, {
      expected: issued.nonce,
      got: result.mandate.nonce,
    });
    check("the ceiling survives the round trip", result.mandate.max_amount_paise === 20000);
  }
}

console.log("--- verifyMandate: tampering must not survive ---");
{
  // The attack that matters: a buyer rewriting its OWN ceiling upward and
  // hoping the merchant reads the payload without checking the signature.
  const { token } = mandate({ max: 5000 });
  const [payload, sig] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.max_amount_paise = 9_999_900;
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;

  const result = verifyMandate(forged);
  check("an inflated ceiling is rejected", result.valid === false);
  check(
    "and is rejected specifically as a bad signature",
    result.valid === false && result.code === "bad_signature",
    result
  );
}

{
  const { token } = mandate();
  const [payload] = token.split(".");
  const result = verifyMandate(`${payload}.deadbeef`);
  check("a garbage signature is rejected", result.valid === false && result.code === "bad_signature");
}

{
  check("a token with no signature segment is rejected", verifyMandate("just-a-payload").valid === false);
  check("an empty token is rejected", verifyMandate("").valid === false);
  // Must not throw on hostile input — a crash here is a denial of service.
  check("nonsense input is rejected without throwing", verifyMandate("...").valid === false);
}

console.log("--- verifyMandate: time bounds ---");
{
  const { token } = mandate({ ttl: -60 }); // already expired
  const result = verifyMandate(token);
  check("an expired mandate is rejected", result.valid === false && result.code === "expired", result);
}

console.log("--- verifyMandate: value sanity ---");
{
  const { token } = mandate({ max: -100 });
  const result = verifyMandate(token);
  check(
    "a negative ceiling is rejected",
    result.valid === false && result.code === "invalid_amount",
    result
  );
}

console.log("--- evaluateMandate: the stricter limit binds ---");
{
  // Buyer's mandate is tighter than the merchant cap.
  const d = evaluateMandate(15000, 20000);
  check("within both limits → satisfied", d.outcome === "mandate_satisfied", d);
  check("buyer's mandate is named as the binding limit", d.bindingLimit === "buyer_mandate", d);
}
{
  // Merchant cap is tighter than the buyer's mandate.
  const d = evaluateMandate(15000, 100000);
  check("merchant cap is named when it is the tighter one", d.bindingLimit === "merchant_cap", d);
}
{
  const d = evaluateMandate(25000, 20000);
  check(
    "over the buyer's mandate → refused",
    d.outcome === "blocked_exceeds_buyer_mandate",
    d
  );
}
{
  // Inside a generous mandate, but over what this merchant will do unattended.
  const d = evaluateMandate(SPEND_CAP_PAISE + 1, 10_000_00);
  check(
    "within mandate but over the merchant cap → refused",
    d.outcome === "blocked_exceeds_merchant_cap",
    d
  );
}
{
  const d = evaluateMandate(SPEND_CAP_PAISE, SPEND_CAP_PAISE);
  check("exactly at both limits is allowed (limits are inclusive)", d.outcome === "mandate_satisfied", d);
}
{
  // A mandate cannot raise the merchant's own ceiling, however large it is.
  const d = evaluateMandate(90000, 100_000_00);
  check(
    "an enormous mandate still cannot exceed the merchant cap",
    d.outcome === "blocked_exceeds_merchant_cap",
    d
  );
}

console.log("--- evaluateRefund: reversals are gated like any other money movement ---");
{
  const base = {
    id: "order-1",
    session_id: "s1",
    razorpay_order_id: "order_x",
    razorpay_payment_link_id: "plink_x",
    total_paise: 10000,
    retry_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const paid = { ...base, status: "paid" } as Order;
  const pending = { ...base, status: "payment_pending" } as Order;

  check(
    "a paid order can be refunded in full",
    evaluateRefund(paid, false, null).outcome === "refund_allowed"
  );
  check(
    "refunding null means the whole amount",
    (() => {
      const d = evaluateRefund(paid, false, null);
      return d.outcome === "refund_allowed" && d.amountPaise === 10000;
    })()
  );
  check(
    "an unpaid order cannot be refunded",
    (() => {
      const d = evaluateRefund(pending, false, null);
      return d.outcome === "refund_blocked" && d.code === "order_not_paid";
    })()
  );
  check(
    "a second refund is refused",
    (() => {
      const d = evaluateRefund(paid, true, null);
      return d.outcome === "refund_blocked" && d.code === "already_refunded";
    })()
  );
  check(
    "refunding more than was paid is refused",
    (() => {
      const d = evaluateRefund(paid, false, 20000);
      return d.outcome === "refund_blocked" && d.code === "amount_exceeds_payment";
    })()
  );
  check(
    "a partial refund within the amount paid is allowed",
    (() => {
      const d = evaluateRefund(paid, false, 4000);
      return d.outcome === "refund_allowed" && d.amountPaise === 4000;
    })()
  );
  check(
    "a negative refund amount is refused",
    (() => {
      const d = evaluateRefund(paid, false, -500);
      return d.outcome === "refund_blocked" && d.code === "invalid_amount";
    })()
  );
}

console.log("--- receipts ---");
{
  const receipt = { order_id: "abc", total_paise: 12345 };
  const signed = signReceipt(receipt);
  const result = verifyReceipt(signed);
  check("a signed receipt verifies", result.valid === true);
  check(
    "the receipt's amount round-trips",
    result.valid === true && (result.receipt as { total_paise: number }).total_paise === 12345
  );

  const [payload, sig] = signed.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.total_paise = 1;
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
  check("a receipt edited to understate the amount is rejected", verifyReceipt(forged).valid === false);
}

console.log("--- AP2 interop: ES256 mandates from a buyer with no shared secret ---");
{
  const native = mandate({ max: 25000 }).mandate;
  const claims = toAP2PaymentMandate(native, { id: "chai-point-express", name: "Chai Point Express" });
  const jwt = signAP2(claims);

  check("an AP2 mandate this merchant signed verifies", verifyAP2(jwt).valid === true);
  check("it carries AP2's own vct value", claims.vct === "mandate.payment.open.1");
  check(
    "the ceiling survives the mapping into AP2 and back",
    ap2ToSpendMandate(claims).max_amount_paise === 25000
  );
  check(
    "the amount lands in AP2's payment_amount shape",
    claims.payment_amount.amount === 25000 && claims.payment_amount.currency === "INR"
  );

  // The attack that matters for an asymmetric token: rewrite the amount and
  // keep the original signature.
  const [h, p2, sig] = jwt.split(".");
  const decoded = JSON.parse(Buffer.from(p2, "base64url").toString("utf8"));
  decoded.payment_amount.amount = 9_999_900;
  const forged = h + "." + Buffer.from(JSON.stringify(decoded)).toString("base64url") + "." + sig;
  check("an AP2 mandate with a rewritten amount is rejected", verifyAP2(forged).valid === false);

  // Algorithm confusion: a token declaring it needs no signature at all.
  const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  check("alg=none is refused rather than trusted", verifyAP2(noneHeader + "." + p2 + ".").valid === false);

  check("garbage is rejected without throwing", verifyAP2("not-a-jwt").valid === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
