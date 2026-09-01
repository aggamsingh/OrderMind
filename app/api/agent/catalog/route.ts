import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { searchCatalog } from "@/lib/catalog";
import { getMerchant } from "@/lib/merchants";
import type { CatalogItem } from "@/lib/types";

/**
 * Agent-facing catalog. Same underlying data the chat agent searches, but
 * shaped for a machine reader: stable ids, integer paise (never a formatted
 * "₹40.00" string a buyer would have to parse), and the pairing relationship
 * exposed explicitly so a buyer agent can reason about complements itself
 * rather than being told about them conversationally.
 *
 * GET /api/agent/catalog          → everything available
 * GET /api/agent/catalog?q=chai   → filtered, same widening search the chat path uses
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  const q = req.nextUrl.searchParams.get("q");
  const category = req.nextUrl.searchParams.get("category") ?? undefined;
  const merchant = getMerchant(req.nextUrl.searchParams.get("merchant"));

  let items: CatalogItem[];
  if (q) {
    items = await searchCatalog(supabase, q, category);
  } else {
    let query = supabase.from("catalog").select("*").eq("is_available", true).order("category");
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `catalog query failed: ${error.message}` }, { status: 500 });
    }
    items = (data ?? []) as CatalogItem[];
  }

  // Each storefront sells its own range. Filtering here (rather than letting
  // a buyer request anything from the shared table) is what makes the two
  // merchants genuinely different counterparties to shop between.
  items = items.filter((i) => merchant.sells.includes(i.category));

  return NextResponse.json({
    merchant: { id: merchant.id, name: merchant.name },
    currency: "INR",
    count: items.length,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      unit_price_paise: item.price_paise,
      category: item.category,
      /** A buyer agent can follow this to reason about complements without asking. */
      pairs_well_with: item.pairs_well_with,
    })),
  });
}
