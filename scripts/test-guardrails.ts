/**
 * Standalone unit tests for lib/guardrails.ts — the spend-cap and retry gate
 * logic. These run with zero external dependencies (no Claude/Supabase/
 * Razorpay credentials needed) because guardrails.ts is deliberately pure:
 * it only takes data in and returns a decision, never calls out to anything.
 *
 * Run: npx tsx scripts/test-guardrails.ts
 *
 * This does NOT replace the full test matrix in 05_TEST_CASES.md — it only
 * proves the gating decision logic itself is correct in isolation. The full
 * cases (actually blocking a Razorpay call, actually writing audit_log rows)
 * need live credentials and are run manually once those exist.
 */

import { evaluateSpendCap, evaluateRetry, computeCartTotalPaise } from "../lib/guardrails";
import type { CartItem, Order, Session } from "../lib/types";

let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    created_at: new Date().toISOString(),
    cart: [],
    messages: [],
    status: "browsing",
    confirmed_at: null,
    confirmed_total_paise: null,
    ...overrides,
  };
}

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    catalog_id: "chai-1",
    name: "Masala Chai",
    qty: 1,
    unit_price_paise: 4000,
    reason: "test item",
    ...overrides,
  };
}

console.log("--- computeCartTotalPaise ---");
assertEqual(
  computeCartTotalPaise([makeCartItem({ qty: 2, unit_price_paise: 4000 }), makeCartItem({ qty: 1, unit_price_paise: 3000 })]),
  11000,
  "sums qty * unit_price across multiple items"
);
assertEqual(computeCartTotalPaise([]), 0, "empty cart totals to 0");

console.log("--- evaluateSpendCap: under cap (test case #4) ---");
{
  const cart = [makeCartItem({ qty: 1, unit_price_paise: 40000 })]; // ₹400
  const decision = evaluateSpendCap(cart, makeSession());
  assertEqual(decision.outcome, "auto_approved", "₹400 order auto-approves with no confirmation");
}

console.log("--- evaluateSpendCap: exactly at cap boundary ---");
{
  const cart = [makeCartItem({ qty: 1, unit_price_paise: 50000 })]; // exactly ₹500
  const decision = evaluateSpendCap(cart, makeSession());
  assertEqual(decision.outcome, "auto_approved", "exactly ₹500 (the cap) still auto-approves — cap is inclusive");
}

console.log("--- evaluateSpendCap: over cap, chat 'yes' alone cannot bypass (test case #5) ---");
{
  const cart = [makeCartItem({ qty: 1, unit_price_paise: 65000 })]; // ₹650
  // Simulates a session where the customer only said "yes" in chat — no UI
  // confirmation fields were ever set. This is the exact scenario the whole
  // "gated" claim in CLAUDE.md rests on.
  const session = makeSession({ confirmed_at: null, confirmed_total_paise: null });
  const decision = evaluateSpendCap(cart, session);
  assertEqual(
    decision.outcome,
    "blocked_needs_confirmation",
    "₹650 order with no UI confirmation is blocked, regardless of chat content"
  );
}

console.log("--- evaluateSpendCap: UI confirmation for exact total unblocks (test case #6) ---");
{
  const cart = [makeCartItem({ qty: 1, unit_price_paise: 65000 })];
  const session = makeSession({
    confirmed_at: new Date().toISOString(),
    confirmed_total_paise: 65000,
  });
  const decision = evaluateSpendCap(cart, session);
  assertEqual(
    decision.outcome,
    "confirmed_override",
    "₹650 order proceeds once confirmed_total_paise matches the recomputed total exactly"
  );
}

console.log("--- evaluateSpendCap: stale confirmation for a DIFFERENT total is rejected (confirm-then-swap exploit) ---");
{
  // Customer confirmed ₹650, then the cart changed (e.g. another propose_cart
  // call added something) to ₹900 before create_order ran. The old
  // confirmation must NOT silently cover the new, higher total.
  const cart = [makeCartItem({ qty: 1, unit_price_paise: 90000 })];
  const session = makeSession({
    confirmed_at: new Date().toISOString(),
    confirmed_total_paise: 65000, // stale — doesn't match the ₹900 cart below
  });
  const decision = evaluateSpendCap(cart, session);
  assertEqual(
    decision.outcome,
    "blocked_needs_confirmation",
    "a confirmation for an old, different total does not cover a new total — must re-block"
  );
}

console.log("--- evaluateRetry: first retry allowed (test case #11) ---");
{
  const order: Order = {
    id: "order-1",
    session_id: "session-1",
    razorpay_order_id: "order_x",
    razorpay_payment_link_id: "plink_x",
    total_paise: 4000,
    status: "failed",
    retry_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const decision = evaluateRetry(order);
  assertEqual(decision.outcome, "retry_allowed", "retry_count 0 → retry is allowed");
}

console.log("--- evaluateRetry: second retry blocked (test case #12) ---");
{
  const order: Order = {
    id: "order-1",
    session_id: "session-1",
    razorpay_order_id: "order_x",
    razorpay_payment_link_id: "plink_x",
    total_paise: 4000,
    status: "retried",
    retry_count: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const decision = evaluateRetry(order);
  assertEqual(
    decision.outcome,
    "retry_blocked_max_reached",
    "retry_count 1 (already used the one allowed retry) → second retry is blocked"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
