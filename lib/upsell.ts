/**
 * upsell.ts — picks the add-on to offer, using what has actually sold.
 *
 * The original upsell read a single hardcoded `pairs_well_with` column: one
 * fixed suggestion per item, forever, regardless of whether anyone ever took
 * it. That is a feature, not a growth engine — it cannot get better, and it
 * cannot tell you which pairings are carrying the revenue.
 *
 * This ranks candidates by their measured conversion instead. Every signal it
 * needs was already being written to audit_log; nothing new is collected.
 *
 * Conversion is defined conservatively: an upsell counts as converted only if
 * the item was still in the cart when the order was actually created. An
 * item that was suggested and then dropped is a miss, which is the honest
 * reading — suggesting something is not the same as selling it.
 *
 * Cold-start behaviour matters more than the ranking here. With almost no
 * history every candidate looks equally good (or equally bad), so a pure
 * "highest rate wins" rule would lock onto whichever pairing happened to
 * convert first and never try the others again. Candidates below a minimum
 * sample size are therefore treated as unproven and explored rather than
 * ranked, so the merchant keeps learning instead of freezing on one lucky
 * early result.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartItem, CatalogItem } from "./types";

/** Below this many suggestions, a pairing's rate is not yet meaningful. */
const MIN_SAMPLES_TO_TRUST = 4;

export type UpsellStat = {
  catalog_id: string;
  suggested: number;
  converted: number;
  /** null while the sample is too small to mean anything. */
  conversion_rate: number | null;
};

/**
 * Per-item upsell performance, derived from audit_log + the carts that were
 * actually ordered.
 */
export async function getUpsellStats(supabase: SupabaseClient): Promise<Map<string, UpsellStat>> {
  const stats = new Map<string, UpsellStat>();

  const [{ data: suggestions }, { data: orderedSessions }] = await Promise.all([
    supabase.from("audit_log").select("session_id, detail").eq("action", "upsell_suggested"),
    // Only sessions that reached a real order count as an opportunity to convert.
    supabase.from("audit_log").select("session_id").eq("action", "create_order"),
  ]);

  const orderedSessionIds = new Set(
    ((orderedSessions ?? []) as { session_id: string }[]).map((r) => r.session_id)
  );
  if (orderedSessionIds.size === 0) return stats;

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, cart")
    .in("id", [...orderedSessionIds]);

  // What actually made it into each ordered cart.
  const orderedUpsellsBySession = new Map<string, Set<string>>();
  for (const s of (sessions ?? []) as { id: string; cart: CartItem[] }[]) {
    orderedUpsellsBySession.set(
      s.id,
      new Set((s.cart ?? []).filter((i) => i.is_upsell).map((i) => i.catalog_id))
    );
  }

  for (const row of (suggestions ?? []) as {
    session_id: string;
    detail: { item?: { catalog_id?: string } };
  }[]) {
    const catalogId = row.detail?.item?.catalog_id;
    if (!catalogId) continue;
    // Only sessions that got as far as an order could have converted.
    if (!orderedSessionIds.has(row.session_id)) continue;

    const stat = stats.get(catalogId) ?? {
      catalog_id: catalogId,
      suggested: 0,
      converted: 0,
      conversion_rate: null,
    };
    stat.suggested += 1;
    if (orderedUpsellsBySession.get(row.session_id)?.has(catalogId)) stat.converted += 1;
    stats.set(catalogId, stat);
  }

  for (const stat of stats.values()) {
    stat.conversion_rate =
      stat.suggested >= MIN_SAMPLES_TO_TRUST ? stat.converted / stat.suggested : null;
  }

  return stats;
}

export type UpsellChoice = {
  item: CatalogItem;
  /** The cart item this pairing came from — the upsell must stay relevant. */
  pairedWith: CatalogItem;
  reason: string;
  /** Why this candidate won, in plain language, for the audit trail. */
  basis: "measured_conversion" | "exploring_unproven" | "catalog_default";
  stat: UpsellStat | null;
};

/**
 * Chooses at most one upsell for a cart.
 *
 * Candidates are still constrained to genuine `pairs_well_with` relationships
 * — learning changes which relevant add-on is offered, never whether the
 * suggestion is relevant at all. An upsell that converts brilliantly but has
 * nothing to do with the order is not a win worth having.
 */
export async function chooseUpsell(
  supabase: SupabaseClient,
  cart: CartItem[],
  catalogById: Map<string, CatalogItem>
): Promise<UpsellChoice | null> {
  const inCart = new Set(cart.map((c) => c.catalog_id));

  // Build the candidate set: every pairing reachable from the current cart.
  const candidateIds = new Map<string, CatalogItem>(); // upsell id -> source item
  for (const line of cart) {
    const source = catalogById.get(line.catalog_id);
    if (!source?.pairs_well_with) continue;
    if (inCart.has(source.pairs_well_with)) continue; // already buying it
    candidateIds.set(source.pairs_well_with, source);
  }
  if (candidateIds.size === 0) return null;

  const { data: candidateRows } = await supabase
    .from("catalog")
    .select("*")
    .in("id", [...candidateIds.keys()])
    .eq("is_available", true);

  const candidates = (candidateRows ?? []) as CatalogItem[];
  if (candidates.length === 0) return null;

  const stats = await getUpsellStats(supabase);

  const scored = candidates.map((item) => {
    const stat = stats.get(item.id) ?? null;
    return { item, stat, rate: stat?.conversion_rate ?? null };
  });

  // Prefer a candidate with no track record yet, so thin data keeps getting
  // filled in rather than the first lucky winner monopolising every offer.
  const unproven = scored.filter((s) => s.rate === null);
  const proven = scored
    .filter((s) => s.rate !== null)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  let picked: (typeof scored)[number];
  let basis: UpsellChoice["basis"];

  if (proven.length > 0 && unproven.length === 0) {
    picked = proven[0];
    basis = "measured_conversion";
  } else if (unproven.length > 0) {
    picked = unproven[0];
    basis = proven.length > 0 ? "exploring_unproven" : "catalog_default";
  } else {
    picked = scored[0];
    basis = "catalog_default";
  }

  const source = candidateIds.get(picked.item.id)!;

  return {
    item: picked.item,
    pairedWith: source,
    basis,
    stat: picked.stat,
    reason:
      basis === "measured_conversion" && picked.rate !== null
        ? `Pairs well with ${source.name} — ${Math.round(picked.rate * 100)}% of customers offered this took it`
        : `Pairs well with ${source.name}`,
  };
}
