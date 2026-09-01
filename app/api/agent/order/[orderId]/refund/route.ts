import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { evaluateRefund } from "@/lib/guardrails";
import { verifyMandate, mandateForAudit, signReceipt } from "@/lib/mandate";
import { getRazorpayClient } from "@/lib/razorpay";
import type { Order } from "@/lib/types";

/**
 * Lets a buyer agent reverse its own mistake — bounded, gated, audited.
 *
 * Real commerce has reversals; demos rarely do, which is how you end up with
 * an agent that can spend but can never un-spend. An autonomous buyer that
 * ordered the wrong thing has no hands and no support line: if the merchant
 * offers no machine-readable way to undo, its only options are to keep the
 * order or escalate to the human it was supposed to be saving.
 *
 * A refund is treated as a money movement like any other, not waved through
 * because the money happens to flow outwards. An agent able to refund without
 * bounds can drain a merchant as effectively as one able to charge without
 * bounds, and a buggy loop does not care about direction. So:
 *
 *   - a mandate is still required, and must verify
 *   - the mandate's principal must match the one that placed the order,
 *     so one buyer cannot refund another's purchase
 *   - lib/guardrails.ts evaluateRefund() re-derives everything from the DB
 *   - exactly one refund per order, mirroring the single-retry rule
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const mandateHeader = req.headers.get("x-agent-mandate");
  if (!mandateHeader) {
    return NextResponse.json(
      { error: "missing_mandate", message: "A signed mandate is required to request a refund." },
      { status: 401 }
    );
  }
  const verification = verifyMandate(mandateHeader);
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.code, message: verification.reason },
      { status: 403 }
    );
  }
  const mandate = verification.mandate;

  const { data: orderRow, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (error || !orderRow) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const order = orderRow as Order;

  let body: { amount_paise?: number; reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body means "refund the whole thing", which is the common case.
  }

  // Only the principal who paid may reverse it. Without this, any valid
  // mandate holder could refund a stranger's order to an account they don't own.
  const { data: originRows } = await supabase
    .from("audit_log")
    .select("detail")
    .eq("session_id", order.session_id)
    .eq("action", "mandate_accepted")
    .limit(1);
  const originPrincipal = (originRows?.[0]?.detail as { principal?: string } | undefined)?.principal;

  if (originPrincipal && originPrincipal !== mandate.principal) {
    await logAudit({
      sessionId: order.session_id,
      orderId: order.id,
      actor: "orchestrator",
      action: "refund_blocked",
      detail: {
        code: "principal_mismatch",
        reason: "Refund requested by a principal that did not place this order.",
        requested_by: mandate.principal,
      },
    });
    return NextResponse.json(
      {
        error: "principal_mismatch",
        message: "This order was placed under a different principal's authority. Refused.",
      },
      { status: 403 }
    );
  }

  await logAudit({
    sessionId: order.session_id,
    orderId: order.id,
    actor: "buyer_agent",
    action: "refund_requested",
    detail: {
      requested_amount_paise: body.amount_paise ?? null,
      reason: body.reason ?? null,
      ...mandateForAudit(mandate),
    },
  });

  // Has this order already been refunded? Re-derived from the audit trail
  // rather than trusted from the request.
  const { data: priorRefunds } = await supabase
    .from("audit_log")
    .select("id")
    .eq("order_id", order.id)
    .eq("action", "refund_issued")
    .limit(1);

  const decision = evaluateRefund(order, (priorRefunds?.length ?? 0) > 0, body.amount_paise ?? null);

  if (decision.outcome === "refund_blocked") {
    await logAudit({
      sessionId: order.session_id,
      orderId: order.id,
      actor: "orchestrator",
      action: "refund_blocked",
      detail: { code: decision.code, reason: decision.reason },
    });
    return NextResponse.json(
      { refunded: false, error: decision.code, message: decision.reason },
      { status: 409 }
    );
  }

  // The payment id lives in the webhook's own audit row — the only place this
  // app learns it, since Razorpay assigns it at capture time.
  const { data: captureRows } = await supabase
    .from("audit_log")
    .select("detail")
    .eq("order_id", order.id)
    .eq("action", "payment_captured")
    .order("created_at", { ascending: false })
    .limit(1);

  const paymentId = (captureRows?.[0]?.detail as { payment_id?: string } | undefined)?.payment_id;
  if (!paymentId) {
    await logAudit({
      sessionId: order.session_id,
      orderId: order.id,
      actor: "orchestrator",
      action: "refund_blocked",
      detail: {
        code: "no_payment_id",
        reason: "Order is marked paid but no captured payment id was recorded, so there is nothing to reverse against.",
      },
    });
    return NextResponse.json(
      {
        refunded: false,
        error: "no_payment_id",
        message: "No captured payment id on record for this order.",
      },
      { status: 409 }
    );
  }

  try {
    const razorpay = getRazorpayClient();
    const refund = await razorpay.payments.refund(paymentId, {
      amount: decision.amountPaise,
      speed: "normal",
      notes: { reason: body.reason ?? "Requested by autonomous buyer agent" },
    });

    await supabase
      .from("orders")
      .update({ status: "refunded", updated_at: new Date().toISOString() })
      .eq("id", order.id);

    await logAudit({
      sessionId: order.session_id,
      orderId: order.id,
      actor: "orchestrator",
      action: "refund_issued",
      detail: {
        refund_id: refund.id,
        amount_paise: decision.amountPaise,
        payment_id: paymentId,
        reason: decision.reason,
      },
    });

    const receipt = {
      merchant: "chai-point-express",
      order_id: order.id,
      refund_id: refund.id,
      amount_paise: decision.amountPaise,
      currency: "INR",
      principal: mandate.principal,
      issued_at: new Date().toISOString(),
    };

    return NextResponse.json({
      refunded: true,
      refund_id: refund.id,
      amount_paise: decision.amountPaise,
      reason: decision.reason,
      signed_receipt: signReceipt(receipt),
      receipt,
    });
  } catch (err) {
    const detail =
      typeof err === "object" && err !== null ? (err as Record<string, unknown>) : { raw: String(err) };
    await logAudit({
      sessionId: order.session_id,
      orderId: order.id,
      actor: "orchestrator",
      action: "refund_failed",
      detail: { error: detail, payment_id: paymentId },
    });
    return NextResponse.json(
      { refunded: false, error: "refund_failed", message: "Razorpay rejected the refund." },
      { status: 502 }
    );
  }
}
