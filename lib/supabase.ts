import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Service-role client — server-side only, never imported into client components.
// Used by the orchestrator because it needs to read/write catalog, sessions,
// orders, and audit_log without going through row-level-security policies
// meant for a browser-facing anon key.
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    // We never use Supabase Realtime (no live subscriptions in this app), but
    // supabase-js still eagerly constructs a RealtimeClient on createClient(),
    // which needs a WebSocket constructor. Node <22 has no native `WebSocket`
    // global, so without this the orchestrator would crash on Vercel's
    // Node 20 runtime, not just in local scripts.
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
}
