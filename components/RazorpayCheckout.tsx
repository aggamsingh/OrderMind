"use client";

import { useState } from "react";

type Props = {
  keyId: string;
  razorpayOrderId: string;
  orderId: string;
  amountPaise: number;
  merchantName: string;
  channel: "human" | "agent";
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

/** Loads Razorpay Checkout on demand, resolving once it is usable. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay-checkout]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load"));
    document.body.appendChild(script);
  });
}

/**
 * Razorpay Checkout on a page this merchant controls, rather than a hosted
 * payment link.
 *
 * This is what closes the autonomy caveat. A Payment Link can only ever be
 * paid on Razorpay's own page, so settlement always required a human with a
 * browser on someone else's domain. An Order can be paid through Checkout
 * anywhere the merchant puts it — the merchant owns the last step.
 *
 * The key id is public by design (it appears in every Razorpay checkout on
 * the web). The secret never leaves the server, and nothing the browser
 * reports back is trusted: the order is marked paid only when the
 * server-to-server webhook arrives and its signature verifies. What happens
 * on this page is a convenience for the payer, not evidence of payment.
 *
 * Checkout is loaded on click rather than on mount — it keeps the page fast,
 * and it means a script that fails to load surfaces as a visible error the
 * payer can act on instead of a button that silently never works.
 */
export default function RazorpayCheckout({
  keyId,
  razorpayOrderId,
  orderId,
  amountPaise,
  merchantName,
  channel,
}: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "open" | "submitted" | "dismissed" | "error">(
    "idle"
  );

  async function pay() {
    setStatus("loading");
    try {
      await loadCheckout();
    } catch {
      setStatus("error");
      return;
    }
    if (!window.Razorpay) {
      setStatus("error");
      return;
    }

    setStatus("open");
    const rzp = new window.Razorpay({
      key: keyId,
      order_id: razorpayOrderId,
      amount: amountPaise,
      currency: "INR",
      name: merchantName,
      description: `Order ${orderId.slice(0, 8)}`,
      // The browser's word is never the source of truth — the webhook is.
      // This only moves the UI on; the database waits for the signed event.
      handler: () => setStatus("submitted"),
      modal: { ondismiss: () => setStatus("dismissed") },
      theme: { color: "#b45309" },
    });
    rzp.open();
  }

  const busy = status === "loading" || status === "open" || status === "submitted";

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={pay}
        disabled={busy}
        className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {status === "loading"
          ? "Opening checkout…"
          : status === "submitted"
            ? "Payment submitted"
            : `Pay ₹${(amountPaise / 100).toFixed(2)}`}
      </button>

      {status === "submitted" && (
        <div className="rounded-xl border border-allow-edge bg-allow-soft p-3 text-xs text-allow">
          Payment submitted. This order is marked paid only once Razorpay&apos;s signed webhook
          reaches the merchant — the browser is never trusted for that.
          {channel === "agent" && (
            <>
              {" "}
              The buyer agent will see it on its next <code>GET /api/agent/order/{orderId}</code>{" "}
              poll.
            </>
          )}
        </div>
      )}

      {status === "dismissed" && (
        <p className="text-xs text-ink-muted">
          Checkout closed without paying. Nothing was charged — the order is still open.
        </p>
      )}

      {status === "error" && (
        <p className="text-xs text-refuse">
          Could not load Razorpay Checkout. Check your connection and try again — nothing was
          charged.
        </p>
      )}
    </div>
  );
}
