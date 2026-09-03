"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AuditTimeline from "@/components/AuditTimeline";
import AuditSessionPicker from "@/components/AuditSessionPicker";

function AuditPageInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId") ?? undefined;

  // Without a session, show a list of stories to follow rather than every
  // event ever logged. A decision only means something in sequence — a
  // refusal is unreadable without the request that provoked it.
  if (!sessionId) {
    return (
      <AppShell
        active="/audit"
        title="Audit trail"
        subtitle="Every decision this merchant made, grouped by the transaction it belonged to — including the ones where it said no. Pick a session to follow it end to end."
      >
        <AuditSessionPicker />
      </AppShell>
    );
  }

  return (
    <AppShell
      active="/audit"
      title="Audit trail"
      subtitle="Every decision taken in this session, in order — including the ones where the system said no."
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="rounded-lg border border-edge bg-surface-2 px-3 py-2 font-mono text-[11px] text-ink-faint">
          session {sessionId}
        </p>
        <Link
          href="/audit"
          className="text-xs font-medium text-ink-muted underline transition hover:text-accent"
        >
          ← all sessions
        </Link>
      </div>
      <AuditTimeline sessionId={sessionId} />
    </AppShell>
  );
}

export default function AuditPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-64 items-center justify-center text-sm text-ink-faint">Loading…</div>
      }
    >
      <AuditPageInner />
    </Suspense>
  );
}
