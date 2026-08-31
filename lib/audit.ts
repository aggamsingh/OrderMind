import { getSupabaseAdmin } from "./supabase";
import type { AuditActor } from "./types";

// The single write path for audit_log. Called from every decision point —
// successful AND blocked — per CLAUDE.md §1/§8. Never write to audit_log
// through any other code path; that guarantee is what makes the trail complete.
export async function logAudit(params: {
  sessionId: string;
  orderId?: string | null;
  actor: AuditActor;
  action: string;
  detail?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("audit_log").insert({
    session_id: params.sessionId,
    order_id: params.orderId ?? null,
    actor: params.actor,
    action: params.action,
    detail: params.detail ?? {},
  });

  if (error) {
    // Deliberately loud: a failed audit write must never be swallowed silently,
    // since a missing row would undermine the "complete trail" guarantee this
    // whole project is judged on.
    console.error("audit_log write failed", { params, error });
    throw new Error(`Failed to write audit_log row: ${error.message}`);
  }
}
