import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Recent sessions, each summarised into one readable line.
 *
 * WHY THIS EXISTS: /audit previously opened as 200 interleaved rows drawn
 * from every session across several days. Each row was individually
 * meaningful and the whole was unreadable — a firehose is not an audit
 * trail, it is raw material for one. The trail's job is to let someone
 * follow a decision from beginning to end, and that requires knowing where
 * one story starts and the next begins.
 *
 * Every summary field here is DERIVED from the logged events, never stored
 * separately. A summary that could drift from the rows it describes would be
 * worse than none at all.
 */
export async function GET() {
  const supabase = getSupabaseAdmin();

  // Enough rows to summarise a meaningful window without pulling the table.
  const { data, error } = await supabase
    .from("audit_log")
    .select("session_id, actor, action, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(1200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    session_id: string;
    actor: string;
    action: string;
    detail: Record<string, unknown>;
    created_at: string;
  };

  const bySession = new Map<string, Row[]>();
  for (const row of (data ?? []) as Row[]) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  const REFUSALS = new Set([
    "cap_check_blocked",
    "retry_blocked_max_reached",
    "agent_order_refused",
    "mandate_rejected",
    "refund_blocked",
    "payment_failed",
  ]);

  const sessions = [...bySession.entries()].map(([sessionId, rowsDesc]) => {
    const rows = [...rowsDesc].reverse(); // chronological
    const actions = new Set(rows.map((r) => r.action));

    const isAgent = rows.some((r) => r.actor === "buyer_agent");
    const refusals = rows.filter((r) => REFUSALS.has(r.action));

    // The headline: what actually happened to the money, in one phrase.
    // "error" is kept distinct from "refused" on purpose — a guardrail
    // declining an order and Razorpay itself failing are different events,
    // and collapsing them would make a refusal look like a malfunction (or
    // worse, a malfunction look like a working guardrail).
    let outcome: "paid" | "ordered" | "refused" | "browsing" | "failed" | "error";
    if (actions.has("payment_captured")) outcome = "paid";
    else if (actions.has("payment_failed")) outcome = "failed";
    else if (refusals.length > 0 && !actions.has("create_order")) outcome = "refused";
    else if (actions.has("create_order")) outcome = "ordered";
    else if (actions.has("razorpay_call_failed") || actions.has("llm_call_failed")) outcome = "error";
    else outcome = "browsing";

    // Prefer the customer's own words; fall back to what the agent was asked
    // for; finally, to why it was turned away — a session that never got as
    // far as stating a purpose is still worth being able to identify.
    const firstMessage = rows.find((r) => r.action === "message_sent")?.detail?.message as
      | string
      | undefined;
    const purpose = rows.find((r) => r.action === "agent_order_requested")?.detail?.purpose as
      | string
      | undefined;
    const rejectionCode = rows.find((r) => r.action === "mandate_rejected")?.detail?.code as
      | string
      | undefined;
    const fallbackLabel = rejectionCode
      ? `buyer agent turned away — ${rejectionCode.replace(/_/g, " ")}`
      : "session";

    const totalPaise =
      (rows.find((r) => r.action === "create_order")?.detail?.total_paise as number | undefined) ??
      (rows.find((r) => r.action === "cap_check_passed")?.detail?.total_paise as number | undefined) ??
      (rows.find((r) => r.action === "agent_order_refused")?.detail?.total_paise as number | undefined) ??
      null;

    const headlineRefusal = refusals[0]?.action ?? null;

    return {
      session_id: sessionId,
      channel: isAgent ? ("agent" as const) : ("human" as const),
      outcome,
      refusal_count: refusals.length,
      headline_refusal: headlineRefusal,
      total_paise: totalPaise,
      event_count: rows.length,
      label: (firstMessage ?? purpose ?? fallbackLabel).slice(0, 90),
      started_at: rows[0]?.created_at ?? null,
      ended_at: rows[rows.length - 1]?.created_at ?? null,
    };
  });

  // Newest first, and drop the near-empty sessions that are noise rather than
  // story (a session created then abandoned before anything was decided).
  sessions.sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""));

  return NextResponse.json({
    sessions: sessions.filter((s) => s.event_count > 1).slice(0, 40),
  });
}
