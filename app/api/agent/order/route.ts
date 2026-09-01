import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCatalogByIds } from "@/lib/catalog";
import { logAudit } from "@/lib/audit";
import { computeCartTotalPaise, evaluateMandate } from "@/lib/guardrails";
import { verifyMandate, mandateForAudit, signReceipt } from "@/lib/mandate";
import { createRazorpayPaymentLink } from "@/lib/razorpay";
import { checkAgentStanding } from "@/lib/agent-trust";
import { getMerchant } from "@/lib/merchants";
import type { CartItem, Order, Session } from "@/lib/types";

/**
 * The agent-to-agent money path: an autonomous buyer places a real order,
 * with no human and no UI anywhere in the flow.
 *
 * The order of operations here is the whole point, and it is deliberately
 * paranoid in the same way lib/guardrails.ts is:
 *
 *   1. Verify the mandate's SIGNATURE before reading a single number out of
 *      it. Until the HMAC checks out, every field in that payload is
 *      attacker-controlled.
 *   2. Reject a replayed nonce. A mandate is single-use; without this, one
 *      valid mandate could authorise unlimited orders.
 *   3. Re-derive every price from the catalog table. The buyer's requested
 *      quantities are honoured; the buyer's idea of the prices is discarded.
 *   4. Enforce the STRICTER of the buyer's mandate and this merchant's own
 *      autonomous cap — see evaluateMandate().
 *   5. Only then create a payment link.
 *
 * Refusals are logged as carefully as acceptances. A merchant that quietly
 * drops a refused agent order leaves the buyer's principal with no way to
 * find out what their agent tried to do.
 */
export async function POST(req: NextRequest) {
  let body: {
    items?: { catalog_id: string; qty: number }[];
    accept_upsell_catalog_id?: string;
    buyer_note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const merchant = getMerchant(req.nextUrl.searchParams.get("merchant"));

  // ---- 1. Mandate must exist and verify, before anything else happens ----
  const mandateHeader = req.headers.get("x-agent-mandate");
  if (!mandateHeader) {
    return NextResponse.json(
      {
        error: "missing_mandate",
        message:
          "This merchant does not accept autonomous orders without a signed spend mandate. See /.well-known/agent-commerce.json for the required format.",
      },
      { status: 401 }
    );
  }

  const verification = verifyMandate(mandateHeader);
  if (!verification.valid) {
    // Logged against a session so the refusal is visible in the same audit
    // trail as everything else — a refused agent must still leave a trace.
    const session = await createAgentSession(supabase, "unverified-buyer-agent");
    await logAudit({
      sessionId: session.id,
      actor: "buyer_agent",
      action: "mandate_rejected",
      detail: { code: verification.code, reason: verification.reason },
    });
    return NextResponse.json(
      { error: verification.code, message: verification.reason, accepted: false },
      { status: 403 }
    );
  }

  const mandate = verification.mandate;

  // ---- 1b. Standing: is this buyer behaving well enough to keep serving? ----
  // Checked after the signature (so an unauthenticated caller cannot consume
  // another agent's budget by claiming its id) but before any Razorpay or
  // order work, since the whole point is to stop a runaway loop cheaply.
  const standing = await checkAgentStanding(supabase, mandate.buyer_agent_id, mandate.principal);
  if (!standing.allowed) {
    const session = await createAgentSession(supabase, mandate.buyer_agent_id);
    await logAudit({
      sessionId: session.id,
      actor: "orchestrator",
      action: "agent_order_refused",
      detail: {
        outcome: standing.code,
        reason: standing.reason,
        recent_requests: standing.recentRequests,
        recent_refusals: standing.recentRefusals,
        ...mandateForAudit(mandate),
      },
    });
    return NextResponse.json(
      {
        accepted: false,
        error: standing.code,
        message: standing.reason,
        retry_after_seconds: standing.retryAfterSeconds,
        remedy: "Stop retrying, correct the problem the earlier refusals described, then try again.",
      },
      { status: 429, headers: { "Retry-After": String(standing.retryAfterSeconds) } }
    );
  }

  // ---- 2. Single-use: a mandate nonce may not be replayed ----
  const { data: priorUse } = await supabase
    .from("audit_log")
    .select("id")
    .eq("action", "mandate_accepted")
    .eq("detail->>nonce", mandate.nonce)
    .limit(1);

  if (priorUse && priorUse.length > 0) {
    const session = await createAgentSession(supabase, mandate.buyer_agent_id);
    await logAudit({
      sessionId: session.id,
      actor: "buyer_agent",
      action: "mandate_rejected",
      detail: {
        code: "replayed_nonce",
        reason: "This mandate has already been used for a previous order. Mandates are single-use.",
        ...mandateForAudit(mandate),
      },
    });
    return NextResponse.json(
      {
        error: "replayed_nonce",
        message: "This mandate has already been spent. Obtain a fresh mandate from your principal.",
        accepted: false,
      },
      { status: 409 }
    );
  }

  const session = await createAgentSession(supabase, mandate.buyer_agent_id);
  await logAudit({
    sessionId: session.id,
    actor: "buyer_agent",
    action: "agent_order_requested",
    detail: {
      ...mandateForAudit(mandate),
      requested_items: body.items ?? [],
      accept_upsell_catalog_id: body.accept_upsell_catalog_id ?? null,
      buyer_note: body.buyer_note ?? null,
    },
  });

  // ---- 3. Re-derive the cart and every price from the catalog ----
  const requested = body.items;
  if (!Array.isArray(requested) || requested.length === 0) {
    return NextResponse.json(
      { error: "invalid_items", message: "items must be a non-empty array of { catalog_id, qty }" },
      { status: 400 }
    );
  }

  const idsToLoad = [...requested.map((i) => i.catalog_id)];
  if (body.accept_upsell_catalog_id) idsToLoad.push(body.accept_upsell_catalog_id);
  const catalogMap = await getCatalogByIds(supabase, idsToLoad);

  const cart: CartItem[] = [];
  for (const item of requested) {
    const catalogItem = catalogMap.get(item.catalog_id);
    if (!catalogItem || !catalogItem.is_available) continue;
    cart.push({
      catalog_id: catalogItem.id,
      name: catalogItem.name,
      qty: Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 1,
      unit_price_paise: catalogItem.price_paise,
      reason: body.buyer_note?.slice(0, 200) ?? "Ordered autonomously by buyer agent",
    });
  }

  // The upsell is only honoured if it is genuinely reachable via
  // pairs_well_with from something already in the cart — the same validation
  // the human path applies, so a buyer agent can't smuggle in an arbitrary
  // item by labelling it an upsell.
  if (body.accept_upsell_catalog_id) {
    const upsellItem = catalogMap.get(body.accept_upsell_catalog_id);
    const validPairing = cart.some(
      (c) => catalogMap.get(c.catalog_id)?.pairs_well_with === body.accept_upsell_catalog_id
    );
    if (upsellItem?.is_available && validPairing) {
      cart.push({
        catalog_id: upsellItem.id,
        name: upsellItem.name,
        qty: 1,
        unit_price_paise: upsellItem.price_paise,
        reason: "Upsell accepted by buyer agent",
        is_upsell: true,
      });
    }
  }

  if (cart.length === 0) {
    return NextResponse.json(
      { error: "no_valid_items", message: "None of the requested catalog_ids are available." },
      { status: 400 }
    );
  }

  await supabase.from("sessions").update({ cart }).eq("id", session.id);
  const totalPaise = computeCartTotalPaise(cart);

  // ---- 4. The dual gate: stricter of buyer mandate and merchant cap ----
  const decision = evaluateMandate(totalPaise, mandate.max_amount_paise, merchant.autonomousCapPaise);

  if (decision.outcome !== "mandate_satisfied") {
    await logAudit({
      sessionId: session.id,
      actor: "orchestrator",
      action: "agent_order_refused",
      detail: {
        outcome: decision.outcome,
        reason: decision.reason,
        total_paise: decision.totalPaise,
        binding_limit: decision.bindingLimit,
        binding_limit_paise: decision.bindingLimitPaise,
        ...mandateForAudit(mandate),
      },
    });
    await supabase.from("sessions").update({ status: "failed" }).eq("id", session.id);

    return NextResponse.json(
      {
        accepted: false,
        error: decision.outcome,
        message: decision.reason,
        total_paise: decision.totalPaise,
        binding_limit: decision.bindingLimit,
        binding_limit_paise: decision.bindingLimitPaise,
        // Told plainly, so a well-behaved buyer agent can correct itself
        // instead of blindly retrying the same refused order.
        remedy:
          decision.bindingLimit === "buyer_mandate"
            ? "Reduce the basket, or obtain a mandate with a higher ceiling from your principal."
            : "Reduce the basket below this merchant's autonomous order cap.",
      },
      { status: 402 }
    );
  }

  // Recorded BEFORE the payment link is created, so the nonce is burned even
  // if the Razorpay call then fails — a mandate must not become reusable
  // just because the payment leg errored.
  await logAudit({
    sessionId: session.id,
    actor: "orchestrator",
    action: "mandate_accepted",
    detail: {
      reason: decision.reason,
      total_paise: decision.totalPaise,
      binding_limit: decision.bindingLimit,
      binding_limit_paise: decision.bindingLimitPaise,
      ...mandateForAudit(mandate),
    },
  });

  // ---- 5. Money ----
  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .insert({ session_id: session.id, total_paise: totalPaise, status: "created" })
    .select("*")
    .single();

  if (orderErr || !orderRow) {
    return NextResponse.json(
      { accepted: false, error: "order_create_failed", message: "Could not create the internal order record." },
      { status: 500 }
    );
  }
  const order = orderRow as Order;

  try {
    const paymentLink = await createRazorpayPaymentLink(
      totalPaise,
      order.id,
      `OrderMind — ${merchant.name} (autonomous agent order)`
    );

    await supabase
      .from("orders")
      .update({
        razorpay_payment_link_id: paymentLink.id,
        status: "payment_pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    await supabase.from("sessions").update({ status: "confirmed" }).eq("id", session.id);

    await logAudit({
      sessionId: session.id,
      orderId: order.id,
      actor: "orchestrator",
      action: "create_order",
      detail: {
        total_paise: totalPaise,
        razorpay_payment_link_id: paymentLink.id,
        channel: "agent_to_agent",
      },
    });

    const receiptBody = {
      merchant: "chai-point-express",
      order_id: order.id,
      total_paise: totalPaise,
      currency: "INR",
      buyer_agent_id: mandate.buyer_agent_id,
      principal: mandate.principal,
      mandate_nonce: mandate.nonce,
      issued_at: new Date().toISOString(),
    };

    return NextResponse.json({
      accepted: true,
      order_id: order.id,
      total_paise: totalPaise,
      currency: "INR",
      line_items: cart.map((c) => ({
        catalog_id: c.catalog_id,
        name: c.name,
        qty: c.qty,
        unit_price_paise: c.unit_price_paise,
        is_upsell: c.is_upsell ?? false,
      })),
      payment_link: paymentLink.short_url,
      binding_limit: decision.bindingLimit,
      binding_limit_paise: decision.bindingLimitPaise,
      /** Verifiable proof of what was agreed, for the buyer's own reconciliation. */
      signed_receipt: signReceipt(receiptBody),
      receipt: receiptBody,
      audit_url: `/api/audit?sessionId=${session.id}`,
      session_id: session.id,
    });
  } catch (err) {
    await logAudit({
      sessionId: session.id,
      orderId: order.id,
      actor: "orchestrator",
      action: "razorpay_call_failed",
      detail: { error: err instanceof Error ? err.message : String(err), channel: "agent_to_agent" },
    });
    return NextResponse.json(
      { accepted: false, error: "payment_link_failed", message: "Order accepted but the payment link could not be created." },
      { status: 502 }
    );
  }
}

async function createAgentSession(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  buyerAgentId: string
): Promise<Session> {
  const { data, error } = await supabase.from("sessions").insert({}).select("*").single();
  if (error || !data) throw new Error(`Failed to create agent session: ${error?.message}`);
  const session = data as Session;
  await logAudit({
    sessionId: session.id,
    actor: "buyer_agent",
    action: "agent_session_created",
    detail: { buyer_agent_id: buyerAgentId, channel: "agent_to_agent" },
  });
  return session;
}
