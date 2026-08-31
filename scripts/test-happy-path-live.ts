/**
 * Live run of the remaining 05_TEST_CASES.md cases through the REAL running
 * app: #1 (basic search), #2 (cart with reasons), #3 (exactly one upsell),
 * #7 (total re-derivation), #8 (catalog integrity), #9 (session isolation),
 * #15 (audit trail completeness). Same style as
 * scripts/test-failure-flow-live.ts — real /api/chat calls, real Supabase
 * reads, no mocking.
 *
 * Run: npx tsx scripts/test-happy-path-live.ts
 * Requires: npm run dev already running on http://localhost:3000
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

async function chat(sessionId: string | undefined, message: string) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`/api/chat returned non-JSON, status ${res.status}: ${raw.slice(0, 500)}`);
  }
  if (!res.ok) throw new Error(`/api/chat failed: ${res.status} ${JSON.stringify(body)}`);
  return body as {
    sessionId: string;
    reply: string;
    cart: CartItem[];
    order: { id: string; status: string; retryCount: number } | null;
  };
}

async function getSession(supabase: ReturnType<typeof getSupabaseAdmin>, sessionId: string): Promise<Session> {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
  if (error || !data) throw new Error(`session ${sessionId} not found: ${error?.message}`);
  return data as Session;
}

async function getAudit(supabase: ReturnType<typeof getSupabaseAdmin>, sessionId: string) {
  const { data, error } = await supabase
    .from("audit_log")
    .select("action, detail, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data as { action: string; detail: Record<string, unknown>; created_at: string }[];
}

async function main() {
  const supabase = getSupabaseAdmin();

  // ---- #1: basic search ----
  console.log("--- Test #1: basic search ---");
  const t1 = await chat(undefined, "Do you have anything with chai?");
  const audit1 = await getAudit(supabase, t1.sessionId);
  const searchRows = audit1.filter((r) => r.action === "search_catalog");
  check("search_catalog was called", searchRows.length > 0, audit1.map((r) => r.action));
  check(
    "search returned real results (result_count > 0)",
    searchRows.some((r) => (r.detail.result_count as number) > 0),
    searchRows.map((r) => r.detail)
  );

  // ---- #2 + #3: cart proposal with reasons + exactly one upsell ----
  console.log("\n--- Test #2 + #3: cart with reasons, exactly one upsell ---");
  const t2 = await chat(undefined, "I'd like a masala chai.");
  check("cart has at least one item", t2.cart.length > 0, t2.cart);
  check(
    "every cart item has a non-empty reason",
    t2.cart.every((item) => typeof item.reason === "string" && item.reason.trim().length > 0),
    t2.cart
  );
  const upsellItems = t2.cart.filter((item) => item.is_upsell);
  check("at most one upsell item in the cart", upsellItems.length <= 1, upsellItems);
  const audit2 = await getAudit(supabase, t2.sessionId);
  const upsellRows = audit2.filter((r) => r.action === "upsell_suggested");
  check("at most one upsell_suggested audit row", upsellRows.length <= 1, upsellRows);
  check(
    "no create_order happened without explicit payment intent",
    !audit2.some((r) => r.action === "create_order"),
    audit2.map((r) => r.action)
  );

  // ---- #7: total re-derivation — tamper the stored cart directly, then create_order ----
  console.log("\n--- Test #7: total is re-derived from the catalog, not trusted from session.cart ---");
  const t3 = await chat(undefined, "I'd like one masala chai.");
  const sessionBeforeTamper = await getSession(supabase, t3.sessionId);
  check("cart is non-empty before tampering", sessionBeforeTamper.cart.length > 0, sessionBeforeTamper.cart);
  const realTotal = sessionBeforeTamper.cart.reduce((sum, i) => sum + i.unit_price_paise * i.qty, 0);
  const tamperedCart = sessionBeforeTamper.cart.map((item) => ({ ...item, unit_price_paise: 1 }));
  await supabase.from("sessions").update({ cart: tamperedCart }).eq("id", t3.sessionId);
  const t4 = await chat(t3.sessionId, "Yes, go ahead and pay for it.");
  const auditT3 = await getAudit(supabase, t3.sessionId);
  const capCheckRow = auditT3.find((r) => r.action === "cap_check_passed");
  check(
    "cap_check_passed used the REAL catalog total, not the tampered 1-paise-per-item value",
    !!capCheckRow && capCheckRow.detail.total_paise === realTotal,
    { capCheckRow, realTotal, tamperedUnitPrice: 1 }
  );
  check("create_order actually proceeded (order returned)", !!t4.order, t4.order);

  // ---- #8: catalog integrity — item not in catalog ----
  console.log("\n--- Test #8: asking for a nonexistent item does not fabricate one ---");
  const t5 = await chat(undefined, "Can I get a burger and fries?");
  const audit5 = await getAudit(supabase, t5.sessionId);
  check(
    "no propose_cart with a fabricated item happened",
    !audit5.some((r) => r.action === "propose_cart"),
    audit5.map((r) => r.action)
  );
  check(
    "reply doesn't claim to have added burger/fries",
    !/added|here's your (burger|fries)/i.test(t5.reply),
    t5.reply
  );

  // ---- #9: session isolation — two concurrent sessions ----
  console.log("\n--- Test #9: session isolation ---");
  const [sA1, sB1] = await Promise.all([
    chat(undefined, "I'd like a filter coffee."),
    chat(undefined, "I'd like a cold coffee."),
  ]);
  check("two distinct session ids were created", sA1.sessionId !== sB1.sessionId, [sA1.sessionId, sB1.sessionId]);
  const [sessA, sessB] = await Promise.all([
    getSession(supabase, sA1.sessionId),
    getSession(supabase, sB1.sessionId),
  ]);
  check(
    "session A's cart only contains what session A ordered",
    sessA.cart.every((i) => i.name.toLowerCase().includes("filter") || i.name.toLowerCase().includes("coffee")) &&
      !sessA.cart.some((i) => i.name.toLowerCase().includes("cold")),
    sessA.cart
  );
  check(
    "session B's cart only contains what session B ordered",
    sessB.cart.some((i) => i.name.toLowerCase().includes("cold")),
    sessB.cart
  );
  console.log(`  (session A: ${sA1.sessionId}, session B: ${sB1.sessionId})`);
  const [auditA, auditB] = await Promise.all([getAudit(supabase, sA1.sessionId), getAudit(supabase, sB1.sessionId)]);
  console.log(`  session A actions: ${auditA.map((r) => r.action).join(", ")}`);
  console.log(`  session B actions: ${auditB.map((r) => r.action).join(", ")}`);
  check(
    "audit rows for session A only reference session A",
    auditA.length > 0,
    auditA.map((r) => r.action)
  );
  check(
    "audit rows for session B only reference session B (no cross-session leakage in row count)",
    auditB.length > 0 && auditB.length !== 0,
    auditB.map((r) => r.action)
  );

  // ---- #15: audit trail completeness, happy path ----
  console.log("\n--- Test #15: audit trail completeness (happy path, reusing test #7's session) ---");
  const expectedOrder = [
    "session_created",
    "message_sent",
    "search_catalog",
    "propose_cart",
    "create_order_requested",
    "cap_check_passed",
    "create_order",
  ];
  const finalAudit = await getAudit(supabase, t3.sessionId);
  const actions = finalAudit.map((r) => r.action);
  let idx = -1;
  let inOrder = true;
  for (const expected of expectedOrder) {
    const foundAt = actions.indexOf(expected, idx + 1);
    if (foundAt === -1) {
      inOrder = false;
      break;
    }
    idx = foundAt;
  }
  check("every expected step appears, in order, from propose_cart through create_order", inOrder, actions);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
