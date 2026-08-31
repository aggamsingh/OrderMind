/**
 * Frames the demo before it runs. A judge watching two agents exchange
 * messages needs to know, in one glance, what makes this different from a
 * chatbot with extra steps: both sides are bounded, and the merchant is the
 * one enforcing it.
 */
const CARDS = [
  {
    step: "1",
    title: "Discovery",
    body: "The buyer reads /.well-known/agent-commerce.json and learns what this merchant sells and what it will refuse — before spending a request.",
    mono: "GET /.well-known/agent-commerce.json",
  },
  {
    step: "2",
    title: "Mandate",
    body: "The buyer presents a signed mandate: how much its human authorised, for what, until when, once. The merchant verifies the signature itself.",
    mono: "X-Agent-Mandate: <signed>",
  },
  {
    step: "3",
    title: "Stricter limit binds",
    body: "The order must satisfy the buyer's mandate AND the merchant's own autonomous cap. Whichever is tighter wins, enforced server-side.",
    mono: "stricter_of(mandate, merchant_cap)",
  },
  {
    step: "4",
    title: "Refusal is the feature",
    body: "Overreach, a tampered ceiling, or a reused mandate are refused and written to the audit trail. Nothing is charged, and the reason survives.",
    mono: "402 · 403 · 409",
  },
];

export default function MandateExplainer() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((card) => (
        <div key={card.step} className="rounded-xl border border-edge bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-soft text-[11px] font-bold text-accent">
              {card.step}
            </span>
            <h3 className="text-sm font-semibold text-ink">{card.title}</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">{card.body}</p>
          <code className="mt-2.5 block truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-[10px] text-ink-faint">
            {card.mono}
          </code>
        </div>
      ))}
    </div>
  );
}
