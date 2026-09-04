import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { readPrincipalSession, PRINCIPAL_COOKIE } from "@/lib/principal-auth";

/**
 * Withdraws authority the principal previously granted.
 *
 * Two scopes, because there are two real situations:
 *
 *   scope: "mandate"  — cancel one specific grant. The precise, everyday case.
 *
 *   scope: "kill"     — cancel everything granted before now. The case where
 *                       you do NOT know what your agent is holding, which is
 *                       exactly when you most need the control. Time-based
 *                       rather than a list, so it also kills mandates this
 *                       merchant has never seen. It does not lock the
 *                       principal out: anything they grant afterwards is
 *                       still honoured.
 *
 * Revocation takes effect on the next order attempt — the merchant checks it
 * server-side before any money moves (lib/revocation.ts), so an agent holding
 * a revoked token cannot spend it no matter what it believes.
 */
export async function POST(req: NextRequest) {
  let body: {
    scope?: "mandate" | "kill";
    nonce?: string;
    buyer_agent_id?: string | null;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Identity from the signed session, never the body. Before this, anyone
  // who knew an email address could fire that principal's kill switch and
  // stop their agent mid-purchase.
  const jar = await cookies();
  const principal = readPrincipalSession(jar.get(PRINCIPAL_COOKIE)?.value);
  if (!principal) {
    return NextResponse.json(
      { error: "not_signed_in", message: "Sign in to the principal console first." },
      { status: 401 }
    );
  }

  const supabase = getSupabaseAdmin();
  const reason = body.reason?.trim() || null;

  if (body.scope === "mandate") {
    if (!body.nonce) {
      return NextResponse.json(
        { error: "invalid_request", message: "nonce is required to revoke a single mandate." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("mandates")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_reason: reason ?? "Revoked by principal.",
      })
      .eq("nonce", body.nonce)
      // Only your own mandates. Without this, a valid session could revoke
      // any mandate in the system by guessing its nonce.
      .eq("principal", principal)
      .is("revoked_at", null) // don't overwrite an earlier revocation's timestamp
      .select("nonce, revoked_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "revoke_failed", message: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        {
          error: "not_found_or_already_revoked",
          message: "No live mandate with that nonce — it may already be revoked.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ revoked: true, scope: "mandate", ...data });
  }

  if (body.scope === "kill") {
    const { data, error } = await supabase
      .from("principal_kill_switches")
      .insert({
        principal,
        // Null means every agent acting for this principal.
        buyer_agent_id: body.buyer_agent_id?.trim() || null,
        effective_at: new Date().toISOString(),
        reason: reason ?? "Principal revoked all outstanding authority.",
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "revoke_failed", message: error.message }, { status: 500 });
    }

    return NextResponse.json({
      revoked: true,
      scope: "kill",
      kill_switch: data,
      note: "Every mandate issued before this instant is now refused. Mandates granted after it remain valid.",
    });
  }

  return NextResponse.json(
    { error: "invalid_scope", message: 'scope must be "mandate" or "kill".' },
    { status: 400 }
  );
}
