import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogItem } from "./types";

async function runSearch(
  supabase: SupabaseClient,
  orClause: string,
  category?: string
): Promise<CatalogItem[]> {
  let q = supabase.from("catalog").select("*").eq("is_available", true).or(orClause).limit(8);
  if (category) q = q.eq("category", category);

  const { data, error } = await q;
  if (error) throw new Error(`search_catalog query failed: ${error.message}`);
  return (data ?? []) as CatalogItem[];
}

/**
 * Real customers describe what they want in natural, abstract terms
 * ("something warm," "not too sweet") that rarely appear verbatim in a
 * catalog item's name/description — a naive exact-phrase substring match
 * returns zero results for almost any real query, which then pressures the
 * model into hallucinating an item to fill the gap (confirmed happening in
 * practice — see BUILD_LOG.md). This does three widening passes instead of
 * one brittle exact match, closest match first:
 *   1. exact phrase, with category filter if given
 *   2. any individual word from the query, with category filter if given
 *   3. any individual word from the query, category filter dropped
 */
export async function searchCatalog(
  supabase: SupabaseClient,
  query: string,
  category?: string
): Promise<CatalogItem[]> {
  const exactClause = `name.ilike.%${query}%,description.ilike.%${query}%,category.ilike.%${query}%`;
  const exact = await runSearch(supabase, exactClause, category);
  if (exact.length > 0) return exact;

  const words = query.split(/\s+/).filter((w) => w.length > 2); // skip "a", "to", etc.
  if (words.length === 0) return [];

  const wordClause = words
    .flatMap((w) => [`name.ilike.%${w}%`, `description.ilike.%${w}%`, `category.ilike.%${w}%`])
    .join(",");

  const byWord = await runSearch(supabase, wordClause, category);
  if (byWord.length > 0 || !category) return byWord;

  return runSearch(supabase, wordClause, undefined);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getCatalogByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, CatalogItem>> {
  // Defensive against a model fabricating a catalog_id from an item's plain
  // name instead of calling search_catalog first (confirmed to happen with
  // real models in practice, not just a hypothetical — see BUILD_LOG.md).
  // A malformed id must be treated as "not found," never crash the whole
  // request — Postgres throws on a non-UUID value in a uuid column `.in()`
  // filter, which would otherwise take down propose_cart entirely.
  const validIds = ids.filter((id) => UUID_RE.test(id));
  if (validIds.length === 0) return new Map();

  const { data, error } = await supabase.from("catalog").select("*").in("id", validIds);
  if (error) throw new Error(`catalog lookup failed: ${error.message}`);

  const map = new Map<string, CatalogItem>();
  for (const row of (data ?? []) as CatalogItem[]) {
    map.set(row.id, row);
  }
  return map;
}
