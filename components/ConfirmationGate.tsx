"use client";

import { useState } from "react";

// The ONLY UI control that can unblock an over-cap order. A chat message
// like "yes" must never do what this button does — see 05_TEST_CASES.md #5
// and lib/guardrails.ts.
export default function ConfirmationGate({
  totalPaise,
  onConfirm,
}: {
  totalPaise: number;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950">
      <p className="mb-3 text-sm text-amber-900 dark:text-amber-100">
        This order total (₹{(totalPaise / 100).toFixed(2)}) is over the ₹500 auto-approve cap.
        Saying &ldquo;yes&rdquo; in chat is not enough — confirm explicitly below to proceed.
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
        className="rounded-md bg-amber-600 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
      >
        {loading ? "Confirming…" : `Confirm ₹${(totalPaise / 100).toFixed(2)} payment`}
      </button>
    </div>
  );
}
