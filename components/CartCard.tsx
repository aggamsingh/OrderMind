"use client";

import type { CartItem } from "@/lib/types";
import { SPEND_CAP_PAISE } from "@/lib/types";

function rupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

/**
 * Every line carries the agent's stated reason for it. That is the point,
 * not decoration: a cart an agent assembled should be auditable by the person
 * paying for it, item by item, without asking.
 */
export default function CartCard({ cart }: { cart: CartItem[] }) {
  if (cart.length === 0) return null;

  const total = cart.reduce((sum, item) => sum + item.unit_price_paise * item.qty, 0);
  const overCap = total > SPEND_CAP_PAISE;
  const capPct = Math.min(100, (total / SPEND_CAP_PAISE) * 100);

  return (
    <div className="animate-rise rounded-xl border border-edge bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Your cart</h3>
        <span className="text-xs text-ink-faint">
          {cart.length} {cart.length === 1 ? "item" : "items"}
        </span>
      </div>

      <ul className="divide-y divide-edge">
        {cart.map((item, idx) => (
          <li key={`${item.catalog_id}-${idx}`} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-ink">
                <span className="text-ink-faint">{item.qty}×</span> {item.name}
                {item.is_upsell && (
                  <span className="ml-2 rounded-md border border-accent-edge bg-accent-soft px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-accent">
                    suggested
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                {rupees(item.unit_price_paise * item.qty)}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.reason}</p>
          </li>
        ))}
      </ul>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-ink">Total</span>
          <span className="text-base font-semibold tabular-nums text-ink">{rupees(total)}</span>
        </div>

        {/* Shows how close this basket is to the point where a human must approve it. */}
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                overCap ? "bg-gate" : "bg-allow"
              }`}
              style={{ width: `${capPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            {overCap
              ? `Over the ${rupees(SPEND_CAP_PAISE)} auto-approve cap — needs your explicit confirmation`
              : `Within the ${rupees(SPEND_CAP_PAISE)} auto-approve cap`}
          </p>
        </div>
      </div>
    </div>
  );
}
