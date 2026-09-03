"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SessionSummary = {
  session_id: string;
  channel: "agent" | "human";
  outcome: "paid" | "ordered" | "refused" | "browsing" | "failed" | "error";
  refusal_count: number;
  headline_refusal: string | null;
  total_paise: number | null;
  event_count: number;
  label: string;
  started_at: string | null;
};

/**
 * Lets someone opening /audit cold pick a story to follow, instead of being
 * handed 200 interleaved rows from every session of the last four days.
 *
 * Each decision this project makes is only meaningful in sequence — a
 * refusal means nothing without the request that provoked it. Grouping by
 * session is what turns a log into a trail.
 *
 * Sessions that ended in a refusal are surfaced, not buried: they are the
 * ones that prove the limits are real.
 */

const OUTCOME_STYLE: Record<SessionSummary["outcome"], { label: string; cls: string }> = {
  paid: { label: "paid", cls: "border-allow-edge bg-allow-soft text-allow" },
  ordered: { label: "ordered", cls: "border-allow-edge bg-allow-soft text-allow" },
  refused: { label: "refused", cls: "border-refuse-edge bg-refuse-soft text-refuse" },
  failed: { label: "payment failed", cls: "border-refuse-edge bg-refuse-soft text-refuse" },
  browsing: { label: "browsing", cls: "border-edge bg-surface-2 text-ink-muted" },
  error: { label: "infra error", cls: "border-gate-edge bg-gate-soft text-gate" },
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function AuditSessionPicker() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "agent" | "human" | "refused">("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/audit/sessions");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setSessions(data.sessions ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const shown = sessions.filter((s) => {
    if (filter === "agent") return s.channel === "agent";
    if (filter === "human") return s.channel === "human";
    if (filter === "refused") return s.refusal_count > 0;
    return true;
  });

  const agentCount = sessions.filter((s) => s.channel === "agent").length;
  const refusedCount = sessions.filter((s) => s.refusal_count > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `All ${sessions.length}`],
            ["agent", `AI buyer ${agentCount}`],
            ["human", `Human ${sessions.length - agentCount}`],
            ["refused", `Refused ${refusedCount}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              filter === key
                ? key === "refused"
                  ? "border-refuse-edge bg-refuse-soft text-refuse"
                  : "border-accent-edge bg-accent-soft text-accent"
                : "border-edge bg-surface-2 text-ink-muted hover:border-edge-strong"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="rounded-xl border border-edge bg-surface px-4 py-10 text-center text-sm text-ink-faint">
          Loading sessions…
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-edge bg-surface px-4 py-10 text-center text-sm text-ink-faint">
          No sessions match that filter yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((s) => {
            const outcome = OUTCOME_STYLE[s.outcome];
            return (
              <li key={s.session_id}>
                <Link
                  href={`/audit?sessionId=${s.session_id}`}
                  className="flex animate-rise flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface px-4 py-3 transition hover:border-edge-strong"
                >
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      s.channel === "agent"
                        ? "border-machine-edge bg-machine-soft text-machine"
                        : "border-edge bg-surface-2 text-ink-muted"
                    }`}
                  >
                    {s.channel === "agent" ? "AI buyer" : "human"}
                  </span>

                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${outcome.cls}`}>
                    {outcome.label}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.label}</span>

                  {s.total_paise !== null && (
                    <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                      {rupees(s.total_paise)}
                    </span>
                  )}

                  {s.refusal_count > 0 && (
                    <span className="shrink-0 font-mono text-[10px] text-refuse">
                      {s.headline_refusal}
                    </span>
                  )}

                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {s.event_count} events
                    {s.started_at ? ` · ${new Date(s.started_at).toLocaleTimeString()}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
