"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import AuditTimeline from "@/components/AuditTimeline";

function AuditPageInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId") ?? undefined;

  return (
    <AppShell
      active="/audit"
      title="Audit trail"
      subtitle={
        sessionId
          ? "Every decision taken in this session, in order — including the ones where the system said no."
          : "Every decision across all sessions, newest first — including the ones where the system said no."
      }
    >
      {sessionId && (
        <p className="rounded-lg border border-edge bg-surface-2 px-3 py-2 font-mono text-[11px] text-ink-faint">
          session {sessionId}
        </p>
      )}
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
