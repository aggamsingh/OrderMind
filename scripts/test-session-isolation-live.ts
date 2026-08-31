/**
 * Isolated live run of 05_TEST_CASES.md #9 (session isolation) only — split
 * out of test-happy-path-live.ts because that script's earlier tests (#1,
 * #2, #7, #8) already consume most of gemini-flash-lite-latest's real
 * 15-requests/minute free-tier cap (confirmed live — see DECISIONS.md D-5),
 * leaving no headroom for #9's two concurrent calls in the same script run.
 *
 * Run: npx tsx scripts/test-session-isolation-live.ts
 * Requires: npm run dev already running, AND a clean ~60s gap since the last
 * Gemini call so this doesn't itself trip the rate limit.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { getSupabaseAdmin } from "../lib/supabase";
import type { CartItem, Session } from "../lib/types";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    if (extra !== undefined) console.log(`        detail: ${JSON.stringify(extra)}`);
  }
}

async function chat(message: string) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`/api/chat returned non-JSON, status ${res.status}: ${raw.slice(0, 500)}`);
  }
  if (!res.ok) throw new Error(`/api/chat failed: ${res.status} ${JSON.stringify(body)}`);
  return body as { sessionId: string; cart: CartItem[] };
}

async function getSession(supabase: ReturnType<typeof getSupabaseAdmin>, sessionId: string): Promise<Session> {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
  if (error || !data) throw new Error(`session ${sessionId} not found: ${error?.message}`);
  return data as Session;
}

async function getAudit(supabase: ReturnType<typeof getSupabaseAdmin>, sessionId: string) {
  const { data, error } = await supabase
    .from("audit_log")
    .select("action")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as { action: string }[]).map((r) => r.action);
}

async function main() {
  const supabase = getSupabaseAdmin();

  console.log("--- Test #9: session isolation ---");
  const [a, b] = await Promise.all([chat("I'd like a filter coffee."), chat("I'd like a cold coffee.")]);
  console.log(`  session A: ${a.sessionId}, session B: ${b.sessionId}`);

  check("two distinct session ids were created", a.sessionId !== b.sessionId, [a.sessionId, b.sessionId]);
  check(
    "session A's own response cart only has filter coffee",
    a.cart.some((i) => i.name.toLowerCase().includes("filter")) &&
      !a.cart.some((i) => i.name.toLowerCase().includes("cold")),
    a.cart
  );
  check(
    "session B's own response cart only has cold coffee",
    b.cart.some((i) => i.name.toLowerCase().includes("cold")) &&
      !b.cart.some((i) => i.name.toLowerCase().includes("filter")),
    b.cart
  );

  // Compares by value, key order aside (the API response and the DB row
  // don't necessarily serialize object keys in the same order).
  function cartsMatch(x: CartItem[], y: CartItem[]): boolean {
    if (x.length !== y.length) return false;
    const norm = (items: CartItem[]) =>
      [...items]
        .map((i) => JSON.stringify(i, Object.keys(i).sort()))
        .sort();
    const nx = norm(x);
    const ny = norm(y);
    return nx.every((v, idx) => v === ny[idx]);
  }

  const [sessA, sessB] = await Promise.all([getSession(supabase, a.sessionId), getSession(supabase, b.sessionId)]);
  check(
    "session A's PERSISTED cart matches its own response (no cross-write)",
    cartsMatch(sessA.cart, a.cart),
    { persisted: sessA.cart, responded: a.cart }
  );
  check(
    "session B's PERSISTED cart matches its own response (no cross-write)",
    cartsMatch(sessB.cart, b.cart),
    { persisted: sessB.cart, responded: b.cart }
  );

  const [auditA, auditB] = await Promise.all([getAudit(supabase, a.sessionId), getAudit(supabase, b.sessionId)]);
  console.log(`  session A actions: ${auditA.join(", ")}`);
  console.log(`  session B actions: ${auditB.join(", ")}`);
  check("session A has its own complete audit trail", auditA.includes("propose_cart"), auditA);
  check("session B has its own complete audit trail", auditB.includes("propose_cart"), auditB);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
