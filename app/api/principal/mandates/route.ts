import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { issueMandate } from "@/lib/mandate";

/**
 * The principal's side of the relationship: grant authority, and see what has
 * been done with it.
 *
 * Everything else in this project is about the merchant deciding whether to
 * trust a buyer. This is the other question, and the one an actual person
 * cares about first: "I let a program spend my money — what is it doing?"
 * Without an answer to that, delegated authority is something you hand over
 * and hope about.
 *
 * DEMO SCOPE, stated plainly: there is no authentication here. A real
 * deployment would sit this behind the principal's login and scope every
 * query to their identity — the console is doing exactly what a signed-in
 * user's session would do, minus the sign-in. It is left out because
 * authentication is well-understood plumbing that would add nothing to what
 * this project is trying to demonstrate, not because it was overlooked.
 */

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const principal = req.nextUrl.searchParams.get("principal");

  let query = supabase
    .from("mandates")
    .select("*")
    .order("issued_at", { ascending: false })
    .limit(50);
  if (principal) query = query.eq("principal", principal);

  const { data: mandates, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "mandates_unavailable", message: error.message },
      { status: 500 }
    );
  }

  // What was actually spent under each mandate. Read from audit_log rather
  // than trusted from anywhere else: the mandate says what was ALLOWED, the
  // audit trail says what HAPPENED, and a principal needs both to see whether
  // their agent stayed inside the line.
  const { data: spendRows } = await supabase
    .from("audit_log")
    .select("detail")
    .eq("action", "mandate_accepted");

  const spentByNonce = new Map<string, number>();
  for (const row of (spendRows ?? []) as { detail: Record<string, unknown> }[]) {
    const nonce = row.detail?.nonce as string | undefined;
    const total = row.detail?.total_paise as number | undefined;
    if (nonce && typeof total === "number") {
      spentByNonce.set(nonce, (spentByNonce.get(nonce) ?? 0) + total);
    }
  }

  const now = Date.now();
  const rows = (mandates ?? []).map((m) => {
    const spent = spentByNonce.get(m.nonce as string) ?? 0;
    const expired = Date.parse(m.expires_at as string) < now;
    const revoked = !!m.revoked_at;
    return {
      nonce: m.nonce,
      buyer_agent_id: m.buyer_agent_id,
      principal: m.principal,
      purpose: m.purpose,
      max_amount_paise: m.max_amount_paise,
      spent_paise: spent,
      issued_at: m.issued_at,
      expires_at: m.expires_at,
      revoked_at: m.revoked_at,
      revoked_reason: m.revoked_reason,
      source: m.source,
      // One word a human can act on, rather than three fields to reconcile.
      state: revoked ? "revoked" : spent > 0 ? "spent" : expired ? "expired" : "live",
    };
  });

  const { data: killSwitches } = await supabase
    .from("principal_kill_switches")
    .select("*")
    .order("effective_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    currency: "INR",
    mandates: rows,
    kill_switches: killSwitches ?? [],
  });
}

/**
 * Grants a new mandate. This is the human act of delegation — in production
 * it would happen in the principal's own wallet or banking app, signed with
 * their key; here the merchant-side secret stands in for that.
 */
export async function POST(req: NextRequest) {
  let body: {
    principal?: string;
    buyer_agent_id?: string;
    max_amount_paise?: number;
    purpose?: string;
    ttl_seconds?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const principal = body.principal?.trim();
  const buyerAgentId = body.buyer_agent_id?.trim();
  const max = body.max_amount_paise;

  if (!principal || !buyerAgentId || typeof max !== "number" || !Number.isInteger(max) || max <= 0) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "principal, buyer_agent_id and a positive whole max_amount_paise are required.",
      },
      { status: 400 }
    );
  }

  const { token, mandate } = issueMandate({
    principal,
    buyer_agent_id: buyerAgentId,
    max_amount_paise: max,
    purpose: body.purpose?.trim() || "unspecified",
    ttlSeconds: body.ttl_seconds ?? 900,
  });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("mandates").insert({
    nonce: mandate.nonce,
    buyer_agent_id: mandate.buyer_agent_id,
    principal: mandate.principal,
    max_amount_paise: mandate.max_amount_paise,
    purpose: mandate.purpose,
    issued_at: mandate.issued_at,
    expires_at: mandate.expires_at,
    source: "issued",
  });

  if (error) {
    return NextResponse.json(
      { error: "could_not_record_mandate", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ token, mandate });
}
