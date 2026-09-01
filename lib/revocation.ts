/**
 * revocation.ts — lets a principal withdraw authority it already granted.
 *
 * THE HOLE THIS CLOSES:
 * A signed mandate is a bearer token. Signature, expiry and single-use nonce
 * all answer "was this validly issued?" — none of them answer "does the human
 * who issued it still stand behind it?". Until this existed, a principal who
 * changed their mind, or realised their agent was misbehaving, could do
 * nothing but wait for the mandate to expire while it remained spendable.
 *
 * You cannot meaningfully delegate authority you have no way to withdraw. So
 * revocation is not a nice-to-have on top of the mandate design; it is the
 * half that makes the delegation real.
 *
 * TWO KINDS, because there are genuinely two situations:
 *
 *   Per-mandate  — "cancel that one grant." Precise, for the normal case.
 *
 *   Kill switch  — "cancel everything I granted before now." Time-based
 *                  rather than a list, because the situation where you most
 *                  need it is the one where you do NOT know what your agent
 *                  is holding. A list can only revoke what the merchant has
 *                  already seen; a timestamp also kills mandates it has
 *                  never seen. Crucially it does not lock the principal out
 *                  — mandates issued after the switch remain valid, so
 *                  stopping the bleeding is not the same as burning the
 *                  account down.
 *
 * Checked server-side on every order, exactly like every other limit here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SpendMandate } from "./mandate";

export type RevocationCheck =
  | { revoked: false }
  | { revoked: true; reason: string; scope: "mandate" | "kill_switch"; revokedAt: string };

/**
 * Records a mandate the merchant has seen, so a principal can find and revoke
 * it later. Best-effort on purpose: a buyer agent that mints mandates outside
 * the console is still a legitimate buyer, and failing to bookkeep must never
 * block a valid order. What it costs is that such a mandate cannot be revoked
 * individually until first use — the kill switch still covers it either way.
 */
export async function recordObservedMandate(
  supabase: SupabaseClient,
  mandate: SpendMandate
): Promise<void> {
  try {
    await supabase.from("mandates").upsert(
      {
        nonce: mandate.nonce,
        buyer_agent_id: mandate.buyer_agent_id,
        principal: mandate.principal,
        max_amount_paise: mandate.max_amount_paise,
        purpose: mandate.purpose,
        issued_at: mandate.issued_at,
        expires_at: mandate.expires_at,
        source: "observed",
      },
      { onConflict: "nonce", ignoreDuplicates: true }
    );
  } catch {
    // Bookkeeping only — never fail an otherwise valid order over it.
  }
}

/**
 * Is this mandate still backed by its principal?
 *
 * Runs AFTER signature verification, deliberately: until the HMAC checks out,
 * the principal and nonce in the payload are attacker-controlled, and looking
 * them up would let an unauthenticated caller probe another principal's
 * revocation state.
 */
export async function checkRevocation(
  supabase: SupabaseClient,
  mandate: SpendMandate
): Promise<RevocationCheck> {
  // 1. This specific mandate, revoked by nonce.
  const { data: row } = await supabase
    .from("mandates")
    .select("revoked_at, revoked_reason")
    .eq("nonce", mandate.nonce)
    .maybeSingle();

  if (row?.revoked_at) {
    return {
      revoked: true,
      scope: "mandate",
      revokedAt: row.revoked_at as string,
      reason:
        (row.revoked_reason as string | null) ??
        "This mandate was revoked by its principal after it was issued.",
    };
  }

  // 2. A kill switch covering this principal (and optionally this agent),
  //    effective at or after the moment this mandate was issued.
  const { data: switches } = await supabase
    .from("principal_kill_switches")
    .select("effective_at, reason, buyer_agent_id")
    .eq("principal", mandate.principal)
    .gte("effective_at", mandate.issued_at)
    .order("effective_at", { ascending: false })
    .limit(5);

  const applicable = (switches ?? []).find(
    (s) => s.buyer_agent_id === null || s.buyer_agent_id === mandate.buyer_agent_id
  );

  if (applicable) {
    return {
      revoked: true,
      scope: "kill_switch",
      revokedAt: applicable.effective_at as string,
      reason:
        (applicable.reason as string | null) ??
        "The principal revoked all authority granted before this point. Obtain a fresh mandate.",
    };
  }

  return { revoked: false };
}
