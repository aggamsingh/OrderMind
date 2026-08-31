import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared chrome. The nav order is the demo order on purpose: a human buying
 * from the agent, then a machine buying from the same merchant, then the
 * trail that proves what happened in both.
 */
const NAV = [
  { href: "/", label: "Chat", hint: "Human customer" },
  { href: "/agent", label: "Agent-to-agent", hint: "Machine customer" },
  { href: "/audit", label: "Audit trail", hint: "Every decision" },
];

export default function AppShell({
  children,
  active,
  title,
  subtitle,
  wide,
}: {
  children: ReactNode;
  active: string;
  title: string;
  subtitle: string;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-edge bg-bg/85 backdrop-blur">
        <div className={`mx-auto flex w-full ${wide ? "max-w-6xl" : "max-w-3xl"} items-center justify-between gap-4 px-4 py-3`}>
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
              ॐ
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-ink">OrderMind</span>
              <span className="block text-[11px] text-ink-faint">Chai Point Express</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active === item.href
                    ? "bg-accent-soft text-accent"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className={`mx-auto flex w-full flex-1 ${wide ? "max-w-6xl" : "max-w-3xl"} flex-col gap-5 px-4 py-6`}>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        </div>
        {children}
      </main>

      <footer className="border-t border-edge px-4 py-4">
        <p className="mx-auto max-w-6xl text-center text-[11px] text-ink-faint">
          Razorpay test mode · every money action is re-verified server-side before it happens
        </p>
      </footer>
    </div>
  );
}
