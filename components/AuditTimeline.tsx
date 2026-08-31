"use client";

import { useEffect, useState } from "react";

type AuditRow = {
  id: string;
  session_id: string;
  order_id: string | null;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};

const ACTOR_COLORS: Record<string, string> = {
  customer: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  agent: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  orchestrator: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  razorpay_webhook: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const BLOCKED_ACTIONS = new Set([
  "cap_check_blocked",
  "retry_blocked_max_reached",
  "razorpay_call_failed",
  "payment_failed",
]);

export default function AuditTimeline({ sessionId }: { sessionId?: string }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRows() {
      try {
        const url = sessionId ? `/api/audit?sessionId=${sessionId}` : "/api/audit";
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setRows(data.rows ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load audit log");
      }
    }

    fetchRows();
    const interval = setInterval(fetchRows, 3000); // live-ish view for the demo
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  if (error) {
    return <p className="text-red-600">Failed to load audit trail: {error}</p>;
  }

  if (rows.length === 0) {
    return <p className="text-zinc-500">No audit events yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className={`rounded-md border p-3 text-sm ${
            BLOCKED_ACTIONS.has(row.action)
              ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  ACTOR_COLORS[row.actor] ?? "bg-zinc-100 text-zinc-800"
                }`}
              >
                {row.actor}
              </span>
              <span className="font-mono text-xs">{row.action}</span>
            </div>
            <span className="text-xs text-zinc-500">
              {new Date(row.created_at).toLocaleTimeString()}
            </span>
          </div>
          {Object.keys(row.detail ?? {}).length > 0 && (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-500">
              {JSON.stringify(row.detail, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}
