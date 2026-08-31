"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import AuditTimeline from "@/components/AuditTimeline";

function AuditPageInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId") ?? undefined;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Audit trail</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back to chat
        </Link>
      </header>
      <p className="text-sm text-zinc-500">
        {sessionId
          ? `Showing events for session ${sessionId}. Refreshes every 3s.`
          : "Showing the most recent events across all sessions. Refreshes every 3s."}
      </p>
      <AuditTimeline sessionId={sessionId} />
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading…</div>}>
      <AuditPageInner />
    </Suspense>
  );
}
