/**
 * One-off connectivity check — confirms .env.local's Supabase URL + service
 * role key actually reach the project, before assuming schema.sql needs to
 * be applied. Not part of the app; safe to delete after use.
 *
 * Run: npx tsx scripts/check-supabase-connection.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true }); // dotenv/config defaults to .env, not .env.local — Next.js's own loader handles this for the app itself, but standalone scripts need it spelled out
import { getSupabaseAdmin } from "../lib/supabase";

async function main() {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("catalog").select("id").limit(1);

  if (error) {
    if (
      error.message.includes("does not exist") ||
      error.message.includes("Could not find the table") ||
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      console.log("CONNECTED to Supabase successfully.");
      console.log("catalog table does not exist yet — schema.sql has not been applied.");
      return;
    }
    console.error("CONNECTION FAILED:", error.message);
    process.exit(1);
  }

  console.log("CONNECTED to Supabase successfully. catalog table already exists.");
}

main();
