"use client";

import { useEffect, useRef, useState } from "react";

type Step = {
  side?: "buyer" | "merchant";
  kind: string;
  title?: string;
  detail?: string;
  data?: Record<string, unknown>;
};

type Scenario = { id: string; label: string; blurb: string };

const SCENARIOS: Scenario[] = [
  { id: "normal", label: "Successful order", blurb: "Buyer discovers, negotiates, is upsold, and pays" },
  { id: "over-mandate", label: "Over-mandate", blurb: "Buyer exceeds the authority its principal granted" },
  { id: "tampered", label: "Tampered mandate", blurb: "Buyer rewrites its own spending ceiling" },
  { id: "replay", label: "Replayed mandate", blurb: "Buyer reuses a mandate it already spent" },
];

/** Visual weight per event kind — the outcome should be readable at a glance. */
const KIND_STYLE: Record<string, { tone: string; icon: string }> = {
  boot: { tone: "machine", icon: "◆" },
  request: { tone: "neutral", icon: "→" },
  response: { tone: "neutral", icon: "←" },
  think: { tone: "machine", icon: "◇" },
  decision: { tone: "machine", icon: "✦" },
  upsell: { tone: "accent", icon: "＋" },
  accept: { tone: "allow", icon: "✓" },
  decline: { tone: "gate", icon: "–" },
  check: { tone: "gate", icon: "⛨" },
  accepted: { tone: "allow", icon: "✓" },
  refused: { tone: "refuse", icon: "✕" },
  verified: { tone: "allow", icon: "✓" },
  halt: { tone: "refuse", icon: "■" },
  warn: { tone: "gate", icon: "!" },
  error: { tone: "refuse", icon: "!" },
};

const TONE_CLASS: Record<string, string> = {
  neutral: "border-edge bg-surface-2 text-ink-muted",
  machine: "border-machine-edge bg-machine-soft text-machine",
  accent: "border-accent-edge bg-accent-soft text-accent",
  allow: "border-allow-edge bg-allow-soft text-allow",
  gate: "border-gate-edge bg-gate-soft text-gate",
  refuse: "border-refuse-edge bg-refuse-soft text-refuse",
};

export default function AgentTheatre() {
  const [scenario, setScenario] = useState("normal");
  const [goal, setGoal] = useState("a warm afternoon pick-me-up, nothing too sweet");
  const [budget, setBudget] = useState(250);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [steps]);

  useEffect(() => () => esRef.current?.close(), []);

  function run() {
    esRef.current?.close();
    setSteps([]);
    setRunning(true);

    const url = `/api/agent-demo/run?scenario=${scenario}&goal=${encodeURIComponent(goal)}&budget=${budget * 100}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      const step: Step = JSON.parse(e.data);
      if (step.kind === "done") {
        setRunning(false);
        es.close();
        return;
      }
      setSteps((s) => [...s, step]);
    };
    es.onerror = () => {
      setRunning(false);
      es.close();
    };
  }

  const outcome = steps.find((s) => s.kind === "refused" || s.kind === "verified");
  const paymentLink = steps.find((s) => s.data?.payment_url)?.data?.payment_url as string | undefined;
  const sessionId = steps.find((s) => s.data?.session_id)?.data?.session_id as string | undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* ---- controls ---- */}
      <div className="rounded-xl border border-edge bg-surface p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              What the buyer was asked to get
            </span>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={running}
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-edge disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Spend authority its human granted (₹)
            </span>
            <input
              type="number"
              value={budget}
              min={10}
              onChange={(e) => setBudget(Number(e.target.value))}
              disabled={running}
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-edge disabled:opacity-60"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScenario(s.id)}
              disabled={running}
              title={s.blurb}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                scenario === s.id
                  ? "border-accent-edge bg-accent-soft text-accent"
                  : "border-edge bg-surface-2 text-ink-muted hover:border-edge-strong"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          {SCENARIOS.find((s) => s.id === scenario)?.blurb}
        </p>

        <button
          onClick={run}
          disabled={running}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Agents transacting…" : "Run agent-to-agent transaction"}
        </button>
      </div>

      {/* ---- the two columns ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Column title="Buyer agent" subtitle="Autonomous, acting under a delegated mandate" tone="machine" />
        <Column title="Merchant" subtitle="Chai Point Express — verifies before it sells" tone="accent" />
      </div>

      <div
        ref={scrollRef}
        className="max-h-[26rem] overflow-y-auto rounded-xl border border-edge bg-surface p-3 shadow-sm"
      >
        {steps.length === 0 && (
          <p className="px-2 py-10 text-center text-sm text-ink-faint">
            {running ? "Starting…" : "Run a scenario to watch a machine buy from a machine."}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const style = KIND_STYLE[step.kind] ?? { tone: "neutral", icon: "·" };
            const isBuyer = step.side === "buyer";
            return (
              <div
                key={i}
                className={`flex animate-rise ${isBuyer ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl border px-3 py-2 ${TONE_CLASS[style.tone]} lg:max-w-[52%]`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm leading-none">{style.icon}</span>
                    <span className="text-sm font-semibold">{step.title}</span>
                  </div>
                  {step.detail && (
                    <p className="mt-1 text-xs leading-relaxed opacity-90">{step.detail}</p>
                  )}
                  {typeof step.data?.remedy === "string" && (
                    <p className="mt-1.5 rounded-md bg-black/5 px-2 py-1 font-mono text-[11px] dark:bg-white/5">
                      remedy: {step.data.remedy}
                    </p>
                  )}
                  <span className="mt-1.5 block text-[10px] uppercase tracking-wider opacity-60">
                    {isBuyer ? "buyer agent" : "merchant"}
                  </span>
                </div>
              </div>
            );
          })}
          {running && (
            <div className="flex justify-center py-2">
              <span className="animate-pulse-soft text-xs text-ink-faint">working…</span>
            </div>
          )}
        </div>
      </div>

      {/* ---- outcome ---- */}
      {outcome && !running && (
        <div
          className={`rounded-xl border p-4 ${
            outcome.kind === "refused" ? TONE_CLASS.refuse : TONE_CLASS.allow
          }`}
        >
          <p className="text-sm font-semibold">
            {outcome.kind === "refused" ? "Transaction refused — nothing charged" : "Transaction completed"}
          </p>
          <p className="mt-1 text-xs opacity-90">{outcome.detail}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            {paymentLink && (
              <a href={paymentLink} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                Open the checkout page →
              </a>
            )}
            {sessionId && (
              <a href={`/audit?sessionId=${sessionId}`} className="font-medium underline">
                Inspect the audit trail →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Column({ title, subtitle, tone }: { title: string; subtitle: string; tone: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${TONE_CLASS[tone]}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs opacity-80">{subtitle}</p>
    </div>
  );
}
