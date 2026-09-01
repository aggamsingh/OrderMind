/**
 * agent-trust.ts — protects the merchant from badly-behaved buyer agents.
 *
 * Mandates answer "is this buyer allowed to spend this much?". They do not
 * answer "should I still be talking to this buyer at all?" — and those are
 * different questions once the customer is a program.
 *
 * A human who gets refused reads the message and stops. Software does not: a
 * buggy retry loop will resubmit a refused order as fast as the network
 * allows, forever. Every one of those attempts costs this merchant a Razorpay
 * call, a database write, and an audit row. A merchant that advertises itself
 * as agent-transactable and has no answer to that is advertising a
 * denial-of-service surface.
 *
 * So standing is derived from behaviour, not identity claims. A buyer agent
 * asserts its own id in its mandate and could invent a new one at will — but
 * the mandate is signed by a *principal*, and minting fresh principals is not
 * free. Both are tracked, so churning agent ids does not reset the clock on
 * the human who authorised them.
 *
 * State lives in audit_log rather than in memory, deliberately: this runs on
 * serverless, where in-process counters are per-instance and reset on every
 * cold start — a limit that resets under load is not a limit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Requests one agent may make in the window before it is throttled. */
const MAX_REQUESTS_PER_WINDOW = 12;
const WINDOW_SECONDS = 60;

/**
 * Refusals that trigger a cool-down. Set above 1 on purpose: a single refusal
 * is useful feedback that a well-behaved agent should be free to act on and
 * correct. Repeated refusals mean it is not correcting.
 */
const MAX_REFUSALS_PER_WINDOW = 4;

export type AgentStanding =
  | { allowed: true; recentRequests: number; recentRefusals: number }
  | {
      allowed: false;
      code: "rate_limited" | "cooling_down";
      reason: string;
      retryAfterSeconds: number;
      recentRequests: number;
      recentRefusals: number;
    };

export async function checkAgentStanding(
  supabase: SupabaseClient,
  buyerAgentId: string,
  principal: string | null
): Promise<AgentStanding> {
  const since = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();

  const { data } = await supabase
    .from("audit_log")
    .select("action, detail")
    .gte("created_at", since)
    .in("action", ["agent_order_requested", "agent_order_refused", "mandate_rejected"]);

  const rows = (data ?? []) as { action: string; detail: Record<string, unknown> }[];

  // Match on either identifier: a misbehaving agent that rotates its id still
  // carries the same principal, and vice versa.
  const mine = rows.filter((r) => {
    const d = r.detail ?? {};
    return (
      d.buyer_agent_id === buyerAgentId || (principal !== null && d.principal === principal)
    );
  });

  const recentRequests = mine.filter((r) => r.action === "agent_order_requested").length;
  const recentRefusals = mine.filter(
    (r) => r.action === "agent_order_refused" || r.action === "mandate_rejected"
  ).length;

  if (recentRefusals >= MAX_REFUSALS_PER_WINDOW) {
    return {
      allowed: false,
      code: "cooling_down",
      reason: `This buyer has been refused ${recentRefusals} times in the last ${WINDOW_SECONDS}s and is in a cool-down. Repeatedly resubmitting a refused order will not change the answer — fix the basket or obtain a new mandate first.`,
      retryAfterSeconds: WINDOW_SECONDS,
      recentRequests,
      recentRefusals,
    };
  }

  if (recentRequests >= MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      code: "rate_limited",
      reason: `This buyer has made ${recentRequests} order attempts in the last ${WINDOW_SECONDS}s, above this merchant's limit of ${MAX_REQUESTS_PER_WINDOW}.`,
      retryAfterSeconds: WINDOW_SECONDS,
      recentRequests,
      recentRefusals,
    };
  }

  return { allowed: true, recentRequests, recentRefusals };
}

export const AGENT_LIMITS = {
  max_order_attempts_per_minute: MAX_REQUESTS_PER_WINDOW,
  max_refusals_before_cooldown: MAX_REFUSALS_PER_WINDOW,
  window_seconds: WINDOW_SECONDS,
};
