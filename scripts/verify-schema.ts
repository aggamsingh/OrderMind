/**
 * One-off verification after applying supabase/schema.sql — checks the
 * catalog seeded correctly, pairs_well_with is wired, and (importantly)
 * that RLS actually blocks the anon key from reading data directly, which
 * is the whole point of D-2 in DECISIONS.md.
 *
 * Run: npx tsx scripts/verify-schema.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { getSupabaseAdmin } from "../lib/supabase";

async function main() {
  const admin = getSupabaseAdmin();

  const { data: catalog, error: catalogErr } = await admin.from("catalog").select("*");
  if (catalogErr) {
    console.error("FAIL: could not read catalog with service_role:", catalogErr.message);
    process.exit(1);
  }
  console.log(`catalog rows: ${catalog?.length} (expected 15)`);

  const withPairing = (catalog ?? []).filter((c) => c.pairs_well_with !== null);
  console.log(`items with pairs_well_with set: ${withPairing.length} (expected 6)`);

  for (const table of ["sessions", "orders", "audit_log"]) {
    const { error } = await admin.from(table).select("*").limit(1);
    console.log(`${table} table reachable via service_role: ${error ? "FAIL - " + error.message : "OK"}`);
  }

  // Now the important negative check: the anon key should NOT be able to
  // read catalog, because RLS is enabled with no policies for anon.
  const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonUrl || !anonKey) {
    console.log("Skipping anon-key RLS check: NEXT_PUBLIC_SUPABASE_ANON_KEY not set.");
    return;
  }
  const anonClient = createClient(anonUrl, anonKey, {
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
  const { data: anonData, error: anonErr } = await anonClient.from("catalog").select("*");

  if (anonErr || !anonData || anonData.length === 0) {
    console.log(
      `RLS check: PASS — anon key cannot read catalog (${anonErr ? anonErr.message : "0 rows returned"})`
    );
  } else {
    console.log(
      `RLS check: FAIL — anon key returned ${anonData.length} catalog rows. RLS is not actually blocking access!`
    );
  }
}

main();
