import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { signReceipt } from "@/lib/mandate";
import type { Order } from "@/lib/types";

/**
 * Lets a buyer agent find out what actually happened to its order.
 *
 * Without this the agent channel had a real hole: an autonomous buyer could
 * place an order and then never learn whether it was paid, declined, or
 * retried. The human chat path has an equivalent (the webhook-driven context
 * bridge, DECISIONS.md D-6) — the machine path had nothing, which meant a
 * buyer agent could not reconcile its own spending against its mandate.
 *
 * Poll this until `terminal` is true. Every response is signed, so the buyer
 * can prove after the fact what the merchant told it and when.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (error || !data) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const order = data as Order;

  // The buyer is entitled to the reasoning behind its own order, not just a
  // status word — same principle as the human-facing audit trail.
  const { data: events } = await supabase
    .from("audit_log")
    .select("actor, action, detail, created_at")
    .eq("session_id", order.session_id)
    .order("created_at", { ascending: true });

  const TERMINAL: Order["status"][] = ["paid", "failed", "retry_failed"];
  const terminal = TERMINAL.includes(order.status);

  const body = {
    order_id: order.id,
    status: order.status,
    terminal,
    total_paise: order.total_paise,
    currency: "INR",
    retry_count: order.retry_count,
    max_retries: 1,
    razorpay_order_id: order.razorpay_order_id,
    updated_at: order.updated_at,
    events: (events ?? []).map((e) => ({
      at: e.created_at,
      actor: e.actor,
      action: e.action,
      detail: e.detail,
    })),
  };

  return NextResponse.json({
    ...body,
    signed_status: signReceipt({
      order_id: body.order_id,
      status: body.status,
      total_paise: body.total_paise,
      observed_at: new Date().toISOString(),
    }),
  });
}
