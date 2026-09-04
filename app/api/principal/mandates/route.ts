import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { issueMandate } from "@/lib/mandate";
import { readPrincipalSession, PRINCIPAL_COOKIE } from "@/lib/principal-auth";

/**
 * The signed-in principal, or null. Identity comes from a server-issued
 * cookie — never from a query param or request body, which is what let
 * anyone previously read or revoke a stranger's mandates just by naming
 * them. See lib/principal-auth.ts.
 */
async function currentPrincipal(): Promise<string | null> {
  const jar = await cookies();
  return readPrincipalSession(jar.get(PRINCIPAL_COOKIE)?.value);
}

const UNAUTHORISED = NextResponse.json(
  { error: "not_signed_in", message: "Sign in to the principal console first." },
  { status: 401 }
);

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
 * Every route here is scoped to the signed-in principal (lib/principal-auth.ts).
 * A shared console password stands in for a real identity provider, but the
 * part that carries the guarantee is real: authority is derived server-side
 * from a signed session, never asserted by the caller.
 */

export async function GET() {
  const principal = await currentPrincipal();
  if (!principal) return UNAUTHORISED;

  const supabase = getSupabaseAdmin();

  // Always scoped to the signed-in principal. A console that could be
  // pointed at someone else's mandates by changing a query string would
  // make every control on it a control over their money.
  const query = supabase
    .from("mandates")
    .select("*")
    .eq("principal", principal)
    .order("issued_at", { ascending: false })
    .limit(50);

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
    .eq("principal", principal)
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

  // Authority is granted BY the signed-in principal, so it is taken from the
  // session — a caller cannot mint a mandate in someone else's name.
  const principal = await currentPrincipal();
  if (!principal) return UNAUTHORISED;

  const buyerAgentId = body.buyer_agent_id?.trim();
  const max = body.max_amount_paise;

  if (!buyerAgentId || typeof max !== "number" || !Number.isInteger(max) || max <= 0) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "buyer_agent_id and a positive whole max_amount_paise are required.",
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
