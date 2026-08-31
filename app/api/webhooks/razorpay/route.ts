import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { verifyWebhookSignature, fetchRazorpayOrderReceipt } from "@/lib/razorpay";
import { logAudit } from "@/lib/audit";
import type { Order } from "@/lib/types";

// Matches only the leading UUID of a receipt string — a retry's payment link
// uses `${order.id}-1` as its reference_id (see lib/orchestrator.ts
// execRetryPayment), so the receipt isn't always a bare UUID.
const LEADING_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Handles payment.captured / payment.failed from Razorpay test-mode webhooks.
// Signature verification happens BEFORE any DB write — see 05_TEST_CASES.md #13.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    payload: { payment: { entity: { order_id?: string; id: string; error_description?: string } } };
  };

  const razorpayOrderId = event.payload?.payment?.entity?.order_id;
  if (!razorpayOrderId) {
    return NextResponse.json({ error: "No order_id in webhook payload" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Fast path: this exact razorpay_order_id was already resolved by an
  // earlier event (Razorpay can redeliver, or a payment can fire more than
  // one event against the same order_id).
  let order: Order | null = null;
  {
    const { data } = await supabase.from("orders").select("*").eq("razorpay_order_id", razorpayOrderId).single();
    order = (data as Order | null) ?? null;
  }

  if (!order) {
    // BUG FOUND LIVE, FIXED (see BUILD_LOG.md Day 6 / DECISIONS.md D-7):
    // this app never pre-populates razorpay_order_id at order-creation time
    // — Razorpay only assigns a Payment Link's order id lazily, once
    // checkout actually starts — so the direct lookup above almost never
    // hits on a webhook's first arrival for a given order. Resolve it here
    // instead, via the auto-generated order's `receipt` field, which
    // Razorpay copies verbatim from the `reference_id` this app passed at
    // payment-link creation (always our own orders.id, optionally with a
    // short retry suffix — see lib/orchestrator.ts) — confirmed live by
    // fetching a real paid order back and finding our order.id in `receipt`.
    const receipt = await fetchRazorpayOrderReceipt(razorpayOrderId);
    const resolvedOrderId = receipt?.match(LEADING_UUID_RE)?.[0];
    if (resolvedOrderId) {
      const { data } = await supabase.from("orders").select("*").eq("id", resolvedOrderId).single();
      order = (data as Order | null) ?? null;
      if (order) {
        // Record the now-known real order_id so a future event for this
        // same order_id hits the fast path above, and so /audit shows the
        // real Razorpay order id instead of staying blank.
        await supabase.from("orders").update({ razorpay_order_id: razorpayOrderId }).eq("id", order.id);
      }
    }
  }

  if (!order) {
    return NextResponse.json({ error: "Order not found for razorpay_order_id" }, { status: 404 });
  }

  if (event.event === "payment.captured") {
    await supabase
      .from("orders")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    await supabase.from("sessions").update({ status: "paid" }).eq("id", order.session_id);
    await logAudit({
      sessionId: order.session_id,
      orderId: order.id,
      actor: "razorpay_webhook",
      action: "payment_captured",
      detail: { payment_id: event.payload.payment.entity.id },
    });
  } else if (event.event === "payment.failed") {
    await supabase
      .from("orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    await supabase.from("sessions").update({ status: "failed" }).eq("id", order.session_id);
    await logAudit({
      sessionId: order.session_id,
      orderId: order.id,
      actor: "razorpay_webhook",
      action: "payment_failed",
      detail: {
        payment_id: event.payload.payment.entity.id,
        reason: event.payload.payment.entity.error_description ?? "unknown",
      },
    });
  }

  return NextResponse.json({ received: true });
}
