"use client";

import { useState } from "react";

/**
 * The ONLY control that can unblock an over-cap order. A chat message saying
 * "yes" must never do what this button does — the server re-checks that this
 * specific action set confirmed_at for this exact total before any money
 * moves. See lib/guardrails.ts and 05_TEST_CASES.md #5.
 *
 * Deliberately styled as an interruption rather than a nudge: it should read
 * as a decision the customer is making, not a step the agent is walking them
 * through.
 */
export default function ConfirmationGate({
  totalPaise,
  onConfirm,
}: {
  totalPaise: number;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const amount = `₹${(totalPaise / 100).toFixed(2)}`;

  return (
    <div className="animate-rise rounded-xl border-2 border-gate-edge bg-gate-soft p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gate text-sm font-bold text-white">
          ⛨
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gate">Your approval is required</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            This order is <span className="font-semibold text-ink">{amount}</span>, above the ₹500
            limit the agent may approve on its own. Nothing has been charged. Saying
            &ldquo;yes&rdquo; in the chat will not release this payment — only this button will.
          </p>

          <button
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await onConfirm();
              } finally {
                setLoading(false);
              }
            }}
            className="mt-3 w-full rounded-lg bg-gate px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50 sm:w-auto"
          >
            {loading ? "Confirming…" : `Confirm ${amount} payment`}
          </button>
        </div>
      </div>
    </div>
  );
}
