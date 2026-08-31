"use client";

import type { CartItem } from "@/lib/types";

function formatRupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

export default function CartCard({ cart }: { cart: CartItem[] }) {
  if (cart.length === 0) return null;

  const total = cart.reduce((sum, item) => sum + item.unit_price_paise * item.qty, 0);

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-2 text-sm font-semibold text-zinc-500">Your cart</h3>
      <ul className="flex flex-col gap-3">
        {cart.map((item, idx) => (
          <li key={`${item.catalog_id}-${idx}`} className="flex flex-col">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {item.qty}× {item.name}
                {item.is_upsell && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    suggested add-on
                  </span>
                )}
              </span>
              <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                {formatRupees(item.unit_price_paise * item.qty)}
              </span>
            </div>
            <span className="text-sm text-zinc-500">{item.reason}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-zinc-200 pt-3 font-semibold dark:border-zinc-800">
        <span>Total</span>
        <span className="tabular-nums">{formatRupees(total)}</span>
      </div>
    </div>
  );
}
