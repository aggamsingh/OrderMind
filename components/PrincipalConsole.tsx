"use client";

import { useCallback, useEffect, useState } from "react";

type MandateRow = {
  nonce: string;
  buyer_agent_id: string;
  principal: string;
  purpose: string | null;
  max_amount_paise: number;
  spent_paise: number;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  source: string;
  state: "live" | "spent" | "expired" | "revoked";
};

type KillSwitch = {
  id: string;
  principal: string;
  buyer_agent_id: string | null;
  effective_at: string;
  reason: string | null;
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

const STATE_STYLE: Record<MandateRow["state"], string> = {
  live: "border-allow-edge bg-allow-soft text-allow",
  spent: "border-edge bg-surface-2 text-ink-muted",
  expired: "border-edge bg-surface-2 text-ink-faint",
  revoked: "border-refuse-edge bg-refuse-soft text-refuse",
};

const DEFAULT_PRINCIPAL = "aggam@example.com";
const DEFAULT_AGENT = "buyer-agent://demo-procurement-bot/v1";

/**
 * The human's side of delegated spending: grant authority, watch it being
 * used, and take it back.
 *
 * The revoke controls are the reason this page exists. A signed mandate is a
 * bearer token, and before this there was no way to withdraw one — the
 * principal could only wait for it to expire while it stayed spendable.
 */
export default function PrincipalConsole() {
  const [principal, setPrincipal] = useState(DEFAULT_PRINCIPAL);
  const [signedInAs, setSignedInAs] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState(DEFAULT_AGENT);
  const [amount, setAmount] = useState(250);
  const [purpose, setPurpose] = useState("afternoon coffee run");
  const [rows, setRows] = useState<MandateRow[]>([]);
  const [kills, setKills] = useState<KillSwitch[]>([]);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/principal/mandates");
    if (!res.ok) return;
    const data = await res.json();
    setRows(data.mandates ?? []);
    setKills(data.kill_switches ?? []);
  }, []);

  // Who the server says we are. Asked once on mount; the console renders a
  // sign-in form until it answers, so no control is ever shown to someone who
  // could not actually use it.
  useEffect(() => {
    let cancelled = false;
    async function whoami() {
      const res = await fetch("/api/principal/session");
      if (cancelled) return;
      const data = await res.json();
      if (cancelled) return;
      setSignedInAs(data.principal ?? null);
      if (data.principal) setPrincipal(data.principal);
    }
    whoami();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn() {
    setAuthError(null);
    const res = await fetch("/api/principal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principal, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAuthError(data.message ?? "Could not sign in.");
      return;
    }
    setPassword("");
    setSignedInAs(data.principal);
  }

  async function signOut() {
    await fetch("/api/principal/session", { method: "DELETE" });
    setSignedInAs(null);
    setRows([]);
    setKills([]);
    setIssued(null);
  }

  useEffect(() => {
    let cancelled = false;

    // Polls rather than renders once: an agent can spend against a mandate
    // seconds after it is granted, and a stale page is the one thing a
    // revocation control must never be.
    if (!signedInAs) return;

    async function poll() {
      // No principal in the URL: the server scopes this to the session.
      const res = await fetch("/api/principal/mandates");
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (cancelled) return;
      setRows(data.mandates ?? []);
      setKills(data.kill_switches ?? []);
    }

    poll();
    const t = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [signedInAs]);

  async function grant() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/principal/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_agent_id: agentId,
          max_amount_paise: Math.round(amount * 100),
          purpose,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "could not grant");
      setIssued(data.token);
      setNote("Mandate granted. Give this token to your agent — it is the only copy.");
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function revokeOne(nonce: string) {
    setBusy(true);
    try {
      await fetch("/api/principal/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "mandate", nonce, reason: "Revoked from the principal console." }),
      });
      setNote("Mandate revoked. The next order attempted with it will be refused.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function killAll() {
    setBusy(true);
    try {
      const res = await fetch("/api/principal/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "kill",
          reason: "Principal revoked all outstanding authority.",
        }),
      });
      const data = await res.json();
      setNote(data.note ?? "All outstanding authority revoked.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const live = rows.filter((r) => r.state === "live").length;
  const committed = rows.filter((r) => r.state === "live").reduce((s, r) => s + r.max_amount_paise, 0);
  const spent = rows.reduce((s, r) => s + r.spent_paise, 0);

  if (signedInAs === undefined) {
    return (
      <p className="rounded-xl border border-edge bg-surface px-4 py-10 text-center text-sm text-ink-faint">
        Checking your session…
      </p>
    );
  }

  if (!signedInAs) {
    return (
      <div className="mx-auto w-full max-w-md rounded-xl border border-edge bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">Sign in to your console</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          These controls can stop an agent mid-purchase, so they are not open to whoever knows an
          email address. Everything below is scoped server-side to whoever signs in here.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Field label="You (principal)" value={principal} onChange={setPrincipal} />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Console password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent-edge"
            />
          </label>
          <button
            onClick={signIn}
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Sign in
          </button>
          {authError && <p className="text-xs text-refuse">{authError}</p>}
          <p className="text-[11px] leading-relaxed text-ink-faint">
            A shared password stands in for a real identity provider here. What is not a stand-in:
            the signed session it issues is the only thing the server will accept as proof of which
            principal you are.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge bg-surface px-4 py-2.5">
        <p className="text-xs text-ink-muted">
          Signed in as <span className="font-medium text-ink">{signedInAs}</span>
        </p>
        <button
          onClick={signOut}
          className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:border-edge-strong hover:text-ink"
        >
          Sign out
        </button>
      </div>

      {/* exposure at a glance */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Live mandates", value: String(live), tone: "text-allow" },
          { label: "Authority outstanding", value: rupees(committed), tone: "text-gate" },
          { label: "Actually spent", value: rupees(spent), tone: "text-ink" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-edge bg-surface px-3 py-2.5">
            <p className={`text-lg font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
            <p className="text-[11px] text-ink-muted">{s.label}</p>
          </div>
        ))}
      </div>

      {/* grant */}
      <div className="rounded-xl border border-edge bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">Grant spending authority</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          What your agent may spend, on what, and for how long. It cannot exceed this, and the
          merchant enforces it rather than trusting the agent.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Your agent" value={agentId} onChange={setAgentId} disabled={busy} />
          <Field label="Purpose" value={purpose} onChange={setPurpose} disabled={busy} />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Ceiling (₹)
            </span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              disabled={busy}
              className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent-edge disabled:opacity-60"
            />
          </label>
        </div>

        <button
          onClick={grant}
          disabled={busy}
          className="mt-4 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Grant mandate
        </button>

        {issued && (
          <div className="mt-3 rounded-lg border border-edge bg-surface-2 p-3">
            <p className="text-[11px] font-medium text-ink-muted">Mandate token</p>
            <code className="mt-1 block break-all font-mono text-[10px] leading-relaxed text-ink-faint">
              {issued}
            </code>
          </div>
        )}
        {note && <p className="mt-2 text-xs text-ink-muted">{note}</p>}
      </div>

      {/* the panic button */}
      <div className="rounded-xl border-2 border-refuse-edge bg-refuse-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-refuse">Revoke everything</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Kills every mandate granted before now — including ones this merchant has never seen.
              Anything you grant afterwards still works.
            </p>
          </div>
          <button
            onClick={killAll}
            disabled={busy}
            className="shrink-0 rounded-lg bg-refuse px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Revoke all authority
          </button>
        </div>
        {kills.length > 0 && (
          <p className="mt-2 text-[11px] text-ink-faint">
            Last kill switch: {new Date(kills[0].effective_at).toLocaleString()}
          </p>
        )}
      </div>

      {/* the mandates themselves */}
      <div className="rounded-xl border border-edge bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Authority you have granted
          </h2>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-allow" />
            live
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-faint">
            No mandates yet. Grant one above, or run the buyer agent — mandates it presents show up
            here automatically.
          </p>
        ) : (
          <ul className="divide-y divide-edge">
            {rows.map((r) => (
              <li key={r.nonce} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATE_STYLE[r.state]}`}
                    >
                      {r.state}
                    </span>
                    <span className="text-sm font-medium text-ink">
                      {rupees(r.max_amount_paise)} ceiling
                    </span>
                    {r.spent_paise > 0 && (
                      <span className="text-xs text-ink-muted">· {rupees(r.spent_paise)} spent</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {r.purpose} · {r.buyer_agent_id}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                    {r.nonce.slice(0, 18)}… · expires {new Date(r.expires_at).toLocaleTimeString()}
                  </p>
                  {r.revoked_reason && (
                    <p className="mt-1 text-[11px] text-refuse">{r.revoked_reason}</p>
                  )}
                </div>

                {r.state === "live" && (
                  <button
                    onClick={() => revokeOne(r.nonce)}
                    disabled={busy}
                    className="shrink-0 rounded-lg border border-refuse-edge px-3 py-1.5 text-xs font-medium text-refuse transition hover:bg-refuse-soft disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent-edge disabled:opacity-60"
      />
    </label>
  );
}
