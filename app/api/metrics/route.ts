import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { CartItem, Order, Session } from "@/lib/types";

/**
 * Merchant-facing revenue metrics, computed from real orders rather than
 * asserted.
 *
 * "This agent grows revenue" is a claim, and a claim about money should come
 * with a number attached. This endpoint derives that number the only honest
 * way available: from the actual carts that actually got ordered, counting
 * what the upsell genuinely added versus what the customer originally asked
 * for.
 *
 * Method, stated plainly so the number can be argued with:
 *  - An order's cart is read from its session. Items flagged is_upsell were
 *    proposed by the agent, not requested by the customer.
 *  - "Base" is the cart without those items; "uplift" is what they added.
 *  - Attach rate counts orders containing at least one upsell line.
 *  - Guardrail activity is included because refusals are part of the story:
 *    an agent that grows revenue by ignoring its limits is not the pitch.
 */
export async function GET() {
  const supabase = getSupabaseAdmin();

  const [{ data: orderRows }, { data: sessionRows }, { data: auditRows }] = await Promise.all([
    supabase.from("orders").select("*").order("created_at", { ascending: false }),
    supabase.from("sessions").select("id, cart, status"),
    supabase.from("audit_log").select("actor, action, detail"),
  ]);

  const orders = (orderRows ?? []) as Order[];
  const sessions = (sessionRows ?? []) as Pick<Session, "id" | "cart" | "status">[];
  const audit = (auditRows ?? []) as { actor: string; action: string; detail: Record<string, unknown> }[];

  const cartBySession = new Map<string, CartItem[]>();
  for (const s of sessions) cartBySession.set(s.id, (s.cart ?? []) as CartItem[]);

  // Which sessions were driven by an autonomous buyer rather than a human.
  const agentSessions = new Set<string>();
  const { data: agentSessionRows } = await supabase
    .from("audit_log")
    .select("session_id")
    .eq("actor", "buyer_agent");
  for (const r of (agentSessionRows ?? []) as { session_id: string }[]) agentSessions.add(r.session_id);

  let ordersWithUpsell = 0;
  let upsellRevenuePaise = 0;
  let baseRevenuePaise = 0;
  let paidRevenuePaise = 0;
  let paidOrders = 0;
  let agentOrders = 0;
  let humanOrders = 0;

  for (const order of orders) {
    const cart = cartBySession.get(order.session_id) ?? [];
    const upsellLines = cart.filter((i) => i.is_upsell);
    const upsellValue = upsellLines.reduce((sum, i) => sum + i.unit_price_paise * i.qty, 0);
    const baseValue = cart
      .filter((i) => !i.is_upsell)
      .reduce((sum, i) => sum + i.unit_price_paise * i.qty, 0);

    if (upsellLines.length > 0) {
      ordersWithUpsell += 1;
      upsellRevenuePaise += upsellValue;
    }
    baseRevenuePaise += baseValue;

    if (order.status === "paid") {
      paidOrders += 1;
      paidRevenuePaise += order.total_paise;
    }
    if (agentSessions.has(order.session_id)) agentOrders += 1;
    else humanOrders += 1;
  }

  const totalOrders = orders.length;
  const attachRate = totalOrders > 0 ? ordersWithUpsell / totalOrders : 0;
  const avgBasketPaise =
    totalOrders > 0 ? Math.round(orders.reduce((s, o) => s + o.total_paise, 0) / totalOrders) : 0;
  // What the average basket would have been with no upsell at all.
  const avgBaseBasketPaise = totalOrders > 0 ? Math.round(baseRevenuePaise / totalOrders) : 0;
  const upliftPct = avgBaseBasketPaise > 0 ? (avgBasketPaise - avgBaseBasketPaise) / avgBaseBasketPaise : 0;

  // Guardrail activity — the refusals that prove the limits are load-bearing.
  const count = (action: string) => audit.filter((a) => a.action === action).length;
  const guardrails = {
    over_cap_blocked: count("cap_check_blocked"),
    confirmed_via_ui: count("confirmed_via_ui"),
    retries_blocked_at_max: count("retry_blocked_max_reached"),
    agent_orders_refused: count("agent_order_refused"),
    mandates_rejected: count("mandate_rejected"),
    mandates_accepted: count("mandate_accepted"),
  };

  return NextResponse.json({
    currency: "INR",
    orders: {
      total: totalOrders,
      paid: paidOrders,
      by_channel: { human_chat: humanOrders, autonomous_agent: agentOrders },
    },
    revenue: {
      paid_revenue_paise: paidRevenuePaise,
      /** Revenue attributable to the agent's upsell, across all orders. */
      upsell_revenue_paise: upsellRevenuePaise,
      avg_basket_paise: avgBasketPaise,
      avg_basket_without_upsell_paise: avgBaseBasketPaise,
      /** Average basket lift attributable to the upsell. */
      basket_uplift_pct: Number((upliftPct * 100).toFixed(1)),
    },
    upsell: {
      attach_rate_pct: Number((attachRate * 100).toFixed(1)),
      orders_with_upsell: ordersWithUpsell,
    },
    guardrails,
    method:
      "Upsell attribution reads is_upsell line items from each order's session cart. Uplift compares the average basket against the same baskets with agent-proposed upsell lines removed.",
  });
}
