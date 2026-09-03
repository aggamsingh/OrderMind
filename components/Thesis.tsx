import Link from "next/link";

/**
 * States the point of the project above the fold.
 *
 * Without this, someone landing on `/` sees a café chat window and concludes
 * "a shopping chatbot" — while the thing that actually distinguishes this
 * work sits one unprompted click away on /agent. A visitor who never clicks
 * never learns what was built, and that is a failure of the page, not of
 * their curiosity.
 */
export default function Thesis() {
  return (
    <div className="rounded-xl border border-edge bg-surface p-5 shadow-sm">
      <p className="text-base font-semibold leading-snug text-ink">
        Everyone is building agents that <span className="text-accent">buy</span>. Almost nobody is
        building the merchant that can safely <span className="text-accent">sell</span> to them.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        When an AI buyer meets an AI seller, neither can trust the other. A runaway buyer drains its
        owner&apos;s account; a merchant that just takes the money is exactly the one nobody should
        let an agent loose on. OrderMind is the side that verifies — and the guardrails are the
        product, not a safety feature bolted onto a chatbot.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/agent"
          className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:opacity-90"
        >
          Watch a machine buy from a machine →
        </Link>
        <Link
          href="/audit"
          className="rounded-lg border border-edge bg-surface-2 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink"
        >
          See every decision, including refusals
        </Link>
        <Link
          href="/principal"
          className="rounded-lg border border-edge bg-surface-2 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink"
        >
          Revoke an agent&apos;s authority
        </Link>
      </div>

      <p className="mt-3 text-[11px] text-ink-faint">
        Below is the same merchant serving a human. Both paths obey the same limits, re-derive every
        price server-side, and log every refusal.
      </p>
    </div>
  );
}
