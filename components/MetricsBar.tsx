"use client";

import { useEffect, useState } from "react";

type Metrics = {
  orders: { total: number; paid: number; by_channel: { human_chat: number; autonomous_agent: number } };
  revenue: { avg_basket_paise: number; basket_uplift_pct: number; upsell_revenue_paise: number };
  upsell: { attach_rate_pct: number };
  guardrails: {
    over_cap_blocked: number;
    retries_blocked_at_max: number;
    agent_orders_refused: number;
    mandates_rejected: number;
  };
};

/**
 * "This agent grows revenue" is a claim about money, so it gets a number.
 * These are computed from real orders (see /api/metrics), not illustrative.
 *
 * Refusals sit alongside revenue on purpose: growth that came from ignoring
 * the limits would not be a result worth showing.
 */
export default function MetricsBar() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/metrics")
      .then((r) => r.json())
      .then((data) => !cancelled && setM(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!m) return null;

  const refusals =
    m.guardrails.over_cap_blocked +
    m.guardrails.retries_blocked_at_max +
    m.guardrails.agent_orders_refused +
    m.guardrails.mandates_rejected;

  const stats = [
    {
      label: "Upsell attach rate",
      value: `${m.upsell.attach_rate_pct}%`,
      hint: "orders including the agent's one suggestion",
      tone: "text-accent",
    },
    {
      label: "Basket lift",
      value: `+${m.revenue.basket_uplift_pct}%`,
      hint: `vs. the same baskets without it`,
      tone: "text-allow",
    },
    {
      label: "Orders",
      value: String(m.orders.total),
      hint: `${m.orders.by_channel.autonomous_agent} from AI buyers`,
      tone: "text-ink",
    },
    {
      label: "Refused by guardrails",
      value: String(refusals),
      hint: "blocked, logged, never charged",
      tone: "text-refuse",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border border-edge bg-surface px-3 py-2.5">
          <p className={`text-lg font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
          <p className="text-[11px] font-medium text-ink">{s.label}</p>
          <p className="mt-0.5 text-[10px] leading-tight text-ink-faint">{s.hint}</p>
        </div>
      ))}
    </div>
  );
}
