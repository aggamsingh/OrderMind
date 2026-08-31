import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCatalogByIds } from "@/lib/catalog";
import { computeCartTotalPaise, evaluateMandate } from "@/lib/guardrails";
import { verifyMandate } from "@/lib/mandate";
import { SPEND_CAP_PAISE, type CartItem } from "@/lib/types";

/**
 * Prices a basket for a buyer agent, and — if the buyer presents its mandate
 * — tells it up front whether that basket would actually be accepted.
 *
 * This is a read-only preflight: nothing is stored, no money moves, no
 * session is created. A quote is deliberately NOT a promise. /api/agent/order
 * re-derives every price and re-runs every check from scratch, because a
 * quote that the order path trusted would just be a slower way of trusting
 * the buyer's numbers (lib/guardrails.ts header).
 *
 * The preflight matters for agent-to-agent commerce specifically: a buyer
 * agent that can ask "would you accept this?" before committing doesn't have
 * to learn the merchant's limits by being refused, and doesn't have to burn
 * a single-use mandate nonce to find out.
 */
export async function POST(req: NextRequest) {
  let body: { items?: { catalog_id: string; qty: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requested = body.items;
  if (!Array.isArray(requested) || requested.length === 0) {
    return NextResponse.json(
      { error: "items must be a non-empty array of { catalog_id, qty }" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const catalogMap = await getCatalogByIds(
    supabase,
    requested.map((i) => i.catalog_id)
  );

  const lineItems: CartItem[] = [];
  const rejected: { catalog_id: string; reason: string }[] = [];

  for (const item of requested) {
    const catalogItem = catalogMap.get(item.catalog_id);
    if (!catalogItem || !catalogItem.is_available) {
      rejected.push({ catalog_id: item.catalog_id, reason: "not found or unavailable" });
      continue;
    }
    const qty = Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 1;
    lineItems.push({
      catalog_id: catalogItem.id,
      name: catalogItem.name,
      qty,
      // Price comes from the catalog row, never from the request body.
      unit_price_paise: catalogItem.price_paise,
      reason: "Requested by buyer agent",
    });
  }

  if (lineItems.length === 0) {
    return NextResponse.json(
      { error: "None of the requested catalog_ids resolved to an available item.", rejected },
      { status: 400 }
    );
  }

  // Exactly one upsell, sourced only from pairs_well_with — the same rule the
  // human chat path follows. Offered, never silently added: the buyer agent
  // decides whether to include it in the order it actually submits.
  let upsellOffer: {
    catalog_id: string;
    name: string;
    unit_price_paise: number;
    reason: string;
  } | null = null;

  for (const line of lineItems) {
    const source = catalogMap.get(line.catalog_id);
    if (!source?.pairs_well_with) continue;
    const pairMap = await getCatalogByIds(supabase, [source.pairs_well_with]);
    const pairing = pairMap.get(source.pairs_well_with);
    if (pairing && pairing.is_available && !lineItems.some((l) => l.catalog_id === pairing.id)) {
      upsellOffer = {
        catalog_id: pairing.id,
        name: pairing.name,
        unit_price_paise: pairing.price_paise,
        reason: `Pairs well with ${source.name}`,
      };
      break;
    }
  }

  const subtotalPaise = computeCartTotalPaise(lineItems);
  const totalWithUpsellPaise = subtotalPaise + (upsellOffer?.unit_price_paise ?? 0);

  // Optional mandate preflight.
  const mandateHeader = req.headers.get("x-agent-mandate");
  let acceptance: Record<string, unknown> | null = null;

  if (mandateHeader) {
    const verification = verifyMandate(mandateHeader);
    if (!verification.valid) {
      acceptance = {
        would_accept: false,
        stage: "mandate_verification",
        code: verification.code,
        reason: verification.reason,
      };
    } else {
      const withoutUpsell = evaluateMandate(subtotalPaise, verification.mandate.max_amount_paise);
      const withUpsell = evaluateMandate(totalWithUpsellPaise, verification.mandate.max_amount_paise);
      acceptance = {
        would_accept: withoutUpsell.outcome === "mandate_satisfied",
        binding_limit: withoutUpsell.bindingLimit,
        binding_limit_paise: withoutUpsell.bindingLimitPaise,
        reason: withoutUpsell.reason,
        // Whether the buyer can afford the upsell under its own mandate is
        // the buyer's call to make, but it shouldn't have to guess.
        upsell_affordable: upsellOffer ? withUpsell.outcome === "mandate_satisfied" : null,
      };
    }
  }

  return NextResponse.json({
    currency: "INR",
    line_items: lineItems.map((l) => ({
      catalog_id: l.catalog_id,
      name: l.name,
      qty: l.qty,
      unit_price_paise: l.unit_price_paise,
      line_total_paise: l.unit_price_paise * l.qty,
    })),
    rejected,
    subtotal_paise: subtotalPaise,
    upsell_offer: upsellOffer,
    total_with_upsell_paise: totalWithUpsellPaise,
    merchant_autonomous_cap_paise: SPEND_CAP_PAISE,
    acceptance,
    note: "This quote is indicative. /api/agent/order independently re-derives every price and re-runs every check before any payment is created.",
  });
}
