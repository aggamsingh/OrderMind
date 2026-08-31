/**
 * Live, end-to-end run of the failure-handling test matrix — 05_TEST_CASES.md
 * #10, #11, #12, #13, #14 — through the REAL running app (app/api/chat,
 * app/api/webhooks/razorpay), real Supabase, real Razorpay test-mode order
 * creation. Not a unit test — scripts/test-guardrails.ts already covers the
 * pure decision logic in isolation; this proves the actual wired-up code
 * path behaves the same way live.
 *
 * IMPORTANT — what this does and does NOT prove:
 * Getting Razorpay's own servers to deliver a real payment.failed webhook
 * requires actually completing a decline on their hosted checkout page,
 * which needs a public URL (ngrok / Vercel) registered in the Razorpay
 * Dashboard — neither exists yet for this project (see BUILD_LOG.md).
 * Instead, this script POSTs a correctly-HMAC-signed payload shaped exactly
 * like Razorpay's real payment.failed event straight at the local webhook
 * route, using the same RAZORPAY_WEBHOOK_SECRET the route itself reads. This
 * proves the webhook handler's own logic (signature check, DB writes, audit
 * logging) end-to-end. It does NOT prove Razorpay's real delivery infra
 * reaches this endpoint — that still needs an ngrok tunnel + a webhook
 * registered in the Dashboard, tracked as a separate Day 6 task.
 *
 * Run: npx tsx scripts/test-failure-flow-live.ts
 * Requires: npm run dev already running on http://localhost:3000
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import crypto from "crypto";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Order, Session } from "../lib/types";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (extra !== undefined) console.log(`        detail: ${JSON.stringify(extra)}`);
  }
}

async function chat(sessionId: string | undefined, message: string) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`/api/chat failed: ${res.status} ${JSON.stringify(body)}`);
  return body as {
    sessionId: string;
    reply: string;
    order: { id: string; status: string; retryCount: number } | null;
  };
}

function signPayload(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function paymentFailedPayload(razorpayOrderId: string) {
  // Shaped per Razorpay's documented payment.failed webhook payload.
  return JSON.stringify({
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: `pay_sim_${Date.now()}`,
          order_id: razorpayOrderId,
          error_description: "The card was declined by the issuing bank (simulated test-mode decline).",
        },
      },
    },
  });
}

async function postWebhook(rawBody: string, signature: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["x-razorpay-signature"] = signature;
  const res = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  return { status: res.status, body: await res.json() };
}

async function getOrder(supabase: ReturnType<typeof getSupabaseAdmin>, orderId: string): Promise<Order> {
  const { data, error } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (error || !data) throw new Error(`order ${orderId} not found: ${error?.message}`);
  return data as Order;
}

async function getSession(supabase: ReturnType<typeof getSupabaseAdmin>, sessionId: string): Promise<Session> {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
  if (error || !data) throw new Error(`session ${sessionId} not found: ${error?.message}`);
  return data as Session;
}

async function getAuditActions(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string
): Promise<{ action: string; detail: unknown }[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("action, detail")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data as { action: string; detail: unknown }[];
}

async function main() {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Missing RAZORPAY_WEBHOOK_SECRET in .env.local — set it before running this script.");
    process.exit(1);
  }
  const supabase = getSupabaseAdmin();

  console.log("--- Step 1: create a real under-cap order via /api/chat ---");
  const turn1 = await chat(undefined, "One masala chai please, and yes go ahead and pay for it.");
  const sessionId = turn1.sessionId;
  check("order created with a real order id", !!turn1.order?.id, turn1);
  if (!turn1.order?.id) {
    console.log("\nAborting — no order was created, nothing further to test.");
    process.exit(1);
  }
  const orderId = turn1.order.id;

  const orderAfterCreate = await getOrder(supabase, orderId);
  check(
    "order has a real razorpay_order_id after create_order",
    !!orderAfterCreate.razorpay_order_id,
    orderAfterCreate
  );
  const razorpayOrderId = orderAfterCreate.razorpay_order_id!;

  console.log("\n--- Test #13: forged webhook signature is rejected, no DB/audit change ---");
  const failedPayload = paymentFailedPayload(razorpayOrderId);
  const forged = await postWebhook(failedPayload, "0000000000000000000000000000000000000000000000000000000000000000");
  check("forged signature returns 400", forged.status === 400, forged);
  const orderAfterForged = await getOrder(supabase, orderId);
  check(
    "order status unchanged after forged webhook",
    orderAfterForged.status === orderAfterCreate.status,
    { before: orderAfterCreate.status, after: orderAfterForged.status }
  );
  const auditAfterForged = await getAuditActions(supabase, sessionId);
  check(
    "no payment_failed audit row written from the forged webhook",
    !auditAfterForged.some((r) => r.action === "payment_failed"),
    auditAfterForged.map((r) => r.action)
  );

  console.log("\n--- Test #10: scripted decline — valid payment.failed webhook ---");
  const validSig = signPayload(failedPayload, secret);
  const real = await postWebhook(failedPayload, validSig);
  check("correctly-signed payment.failed webhook returns 200", real.status === 200, real);
  const orderAfterFailed = await getOrder(supabase, orderId);
  check("order.status becomes 'failed'", orderAfterFailed.status === "failed", orderAfterFailed);
  const sessionAfterFailed = await getSession(supabase, sessionId);
  check("session.status becomes 'failed'", sessionAfterFailed.status === "failed", sessionAfterFailed);
  const auditAfterFailed = await getAuditActions(supabase, sessionId);
  const paymentFailedRow = auditAfterFailed.find((r) => r.action === "payment_failed");
  check("payment_failed audit row exists with the decline reason", !!paymentFailedRow, paymentFailedRow);

  console.log("\n--- Test #11: bounded retry — first retry succeeds ---");
  const linkBeforeRetry = orderAfterFailed.razorpay_payment_link_id;
  const turn2 = await chat(sessionId, "That failed — please retry the payment.");
  check("retry_count goes 0 -> 1", turn2.order?.retryCount === 1, turn2.order);
  const orderAfterRetry1 = await getOrder(supabase, orderId);
  check(
    "a genuinely NEW payment link was issued for the retry (not the original one)",
    !!orderAfterRetry1.razorpay_payment_link_id && orderAfterRetry1.razorpay_payment_link_id !== linkBeforeRetry,
    { before: linkBeforeRetry, after: orderAfterRetry1.razorpay_payment_link_id }
  );
  const auditAfterRetry1 = await getAuditActions(supabase, sessionId);
  check(
    "retry_attempted audit row logged",
    auditAfterRetry1.some((r) => r.action === "retry_attempted"),
    auditAfterRetry1.map((r) => r.action)
  );

  console.log("\n--- Force a second decline on the same order (so we can test the second-retry block) ---");
  const failedPayload2 = paymentFailedPayload(razorpayOrderId);
  const validSig2 = signPayload(failedPayload2, secret);
  const real2 = await postWebhook(failedPayload2, validSig2);
  check("second scripted decline webhook returns 200", real2.status === 200, real2);
  const orderAfterFailed2 = await getOrder(supabase, orderId);
  check("order.status becomes 'failed' again, retry_count stays 1", orderAfterFailed2.status === "failed" && orderAfterFailed2.retry_count === 1, orderAfterFailed2);

  console.log("\n--- Test #12: bounded retry — second retry attempt is blocked ---");
  const turn3 = await chat(sessionId, "Please retry the payment again.");
  const orderAfterRetry2Attempt = await getOrder(supabase, orderId);
  check(
    "retry_count stays at 1 (max reached, not incremented further)",
    orderAfterRetry2Attempt.retry_count === 1,
    orderAfterRetry2Attempt
  );
  check(
    "order status still 'failed', not silently marked payment_pending again",
    orderAfterRetry2Attempt.status === "failed",
    orderAfterRetry2Attempt
  );
  const auditFinal = await getAuditActions(supabase, sessionId);
  check(
    "retry_blocked_max_reached audit row logged (test #14 — blocked actions are audited)",
    auditFinal.some((r) => r.action === "retry_blocked_max_reached"),
    auditFinal.map((r) => r.action)
  );
  check(
    "agent's reply explains no further auto-retry, doesn't silently succeed",
    /no further|max|already|cannot|can't/i.test(turn3.reply),
    turn3.reply
  );

  console.log(`\nsessionId for manual /audit inspection: ${sessionId}`);
  console.log(`orderId: ${orderId}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
