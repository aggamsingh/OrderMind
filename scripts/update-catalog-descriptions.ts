/**
 * One-off: applies the enriched catalog descriptions (added to
 * supabase/schema.sql after discovering natural-language search failures —
 * see BUILD_LOG.md) to the already-seeded live Supabase catalog, by name.
 * Not part of the app; safe to delete after use.
 *
 * Run: npx tsx scripts/update-catalog-descriptions.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { getSupabaseAdmin } from "../lib/supabase";

const UPDATES: Record<string, string> = {
  "Masala Chai": "Classic spiced milk tea — warm, comforting, and mildly sweet",
  "Ginger Chai": "Chai with a strong ginger kick — warm and invigorating, not too sweet",
  "Cardamom Chai": "Chai brewed with whole cardamom — warm, aromatic, and lightly sweet",
  "Filter Coffee": "South Indian style filter coffee — warm, rich, and strong",
  "Cold Coffee": "Iced blended coffee — cool, creamy, and sweet",
  "Lemon Iced Tea": "Chilled black tea with lemon — cool, light, and refreshing",
  "Cardamom Cookie": "Buttery cookie with cardamom — a light, not-too-sweet snack",
  "Khari Biscuit": "Flaky salted puff pastry biscuit — light and savory",
  "Vada Pav": "Spiced potato fritter in a bun — warm, filling, and savory",
  Samosa: "Fried pastry with spiced potato filling — warm, crispy, and savory",
  "Bun Maska": "Soft bun with butter — warm and mildly sweet",
  "Masala Sandwich": "Grilled sandwich with spiced vegetables — warm and filling",
  "Gulab Jamun (2 pc)": "Warm milk-solid dumplings in sugar syrup — rich and very sweet",
  "Chocolate Brownie": "Dense fudgy brownie — rich and sweet",
  "Rasgulla (2 pc)": "Soft spongy cheese balls in syrup — light and sweet",
};

async function main() {
  const supabase = getSupabaseAdmin();
  let updated = 0;

  for (const [name, description] of Object.entries(UPDATES)) {
    const { error, data } = await supabase
      .from("catalog")
      .update({ description })
      .eq("name", name)
      .select("id");

    if (error) {
      console.error(`FAILED "${name}": ${error.message}`);
      continue;
    }
    console.log(`updated "${name}" (${data?.length ?? 0} row)`);
    updated++;
  }

  console.log(`\n${updated}/${Object.keys(UPDATES).length} items updated.`);
}

main();
