import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getRazorpayKeyId } from "@/lib/razorpay";
import RazorpayCheckout from "@/components/RazorpayCheckout";
import type { CartItem, Order, Session } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The merchant's own checkout page.
 *
 * Replaces the hosted Razorpay payment link the buyer used to be redirected
 * to. That redirect was the reason this merchant had to declare capture as
 * `hosted_redirect` rather than autonomous: settlement happened somewhere the
 * merchant did not control and could not instrument.
 *
 * Everything shown here is re-read from the database at request time. The URL
 * carries an order id and nothing else — no amount, no item list — because a
 * checkout page that trusted its own query string would be a checkout page
 * anyone could rewrite.
 */
export default async function PayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = getSupabaseAdmin();

  const { data: orderRow } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (!orderRow) notFound();
  const order = orderRow as Order;

  const { data: sessionRow } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", order.session_id)
    .single();
  const cart = ((sessionRow as Session | null)?.cart ?? []) as CartItem[];

  const { data: agentRows } = await supabase
    .from("audit_log")
    .select("id")
    .eq("session_id", order.session_id)
    .eq("actor", "buyer_agent")
    .limit(1);
  const channel: "human" | "agent" = (agentRows?.length ?? 0) > 0 ? "agent" : "human";

  const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;
  const settled = order.status === "paid" || order.status === "refunded";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center gap-4 px-4 py-10">
      <div className="rounded-2xl border border-edge bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
            ॐ
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Chai Point Express</p>
            <p className="text-[11px] text-ink-faint">Razorpay test mode · no real money moves</p>
          </div>
        </div>

        <ul className="mt-5 divide-y divide-edge border-y border-edge">
          {cart.map((item, i) => (
            <li key={`${item.catalog_id}-${i}`} className="flex items-baseline justify-between gap-3 py-2.5">
              <span className="text-sm text-ink">
                <span className="text-ink-faint">{item.qty}×</span> {item.name}
                {item.is_upsell && (
                  <span className="ml-2 rounded border border-accent-edge bg-accent-soft px-1 py-0.5 text-[9px] font-semibold uppercase text-accent">
                    suggested
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                {rupees(item.unit_price_paise * item.qty)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between py-3">
          <span className="text-sm font-semibold text-ink">Total</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{rupees(order.total_paise)}</span>
        </div>

        {settled ? (
          <div className="rounded-xl border border-allow-edge bg-allow-soft p-3 text-sm text-allow">
            This order is already {order.status}. Nothing further to pay.
          </div>
        ) : !order.razorpay_order_id ? (
          <div className="rounded-xl border border-refuse-edge bg-refuse-soft p-3 text-sm text-refuse">
            This order has no Razorpay order attached, so it cannot be paid. Nothing was charged.
          </div>
        ) : (
          <RazorpayCheckout
            keyId={getRazorpayKeyId()}
            razorpayOrderId={order.razorpay_order_id}
            orderId={order.id}
            amountPaise={order.total_paise}
            merchantName="Chai Point Express"
            channel={channel}
          />
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
          Every limit on this order was checked server-side before this page existed. Test cards are
          on{" "}
          <a
            className="underline"
            href="https://razorpay.com/docs/payments/payments/test-card-upi-details/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Razorpay&apos;s test card page
          </a>
          .
        </p>
      </div>

      <a href={`/audit?sessionId=${order.session_id}`} className="text-center text-xs text-ink-muted underline">
        See every decision behind this order →
      </a>
    </div>
  );
}
