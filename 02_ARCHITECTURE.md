# 02 — Architecture

## 1. System diagram

```
Customer (chat UI, Next.js App Router page)
   │
   ▼
Agent Orchestrator  — app/api/chat/route.ts
   │  1. loads session + cart state from Supabase
   │  2. calls Claude API with system prompt + tool defs (03_LLM_CONTEXT.md)
   │  3. Claude proposes a tool call (search_catalog / propose_cart / create_order / retry_payment)
   │  4. orchestrator EXECUTES the tool server-side — Claude never calls Razorpay or Supabase directly
   │  5. for any money-moving tool call, orchestrator calls lib/guardrails.ts FIRST,
   │     independent of anything Claude claims about confirmation state
   │  6. every step, success or blocked, is written via lib/audit.ts
   ▼
Supabase (Postgres): catalog, sessions, orders, audit_log
   │
   ▼
Razorpay Test-Mode: Payment Links API only (see DECISIONS.md D-7 — a
standalone Orders API call was removed: Payment Links auto-generate their
own internal order, and calling Orders API separately created a second,
disconnected order that broke webhook matching for every real payment)
  →  Webhook → app/api/webhooks/razorpay/route.ts
                                                              │
                                                              ▼
                                                     updates orders + audit_log,
                                                     session polls / re-renders
```

## 2. Core rule this architecture exists to enforce
Claude is a **proposer**, never an **executor**. The tool-call JSON Claude returns is treated as untrusted input to the orchestrator, the same way a request body from a browser would be. The orchestrator:
- re-derives the cart total itself from the DB, never trusts a total Claude states in prose
- re-checks the ₹500 cap itself before calling Razorpay
- re-checks that an explicit UI confirmation record exists in `sessions` (not a chat message) before an over-cap order proceeds
- writes an audit_log row for every attempt, including ones it blocks

This logic lives in `lib/guardrails.ts` and is called from exactly one place: immediately before any Razorpay order/payment-link creation in `app/api/chat/route.ts`. No other code path is allowed to call Razorpay's order-creation endpoints.

## 3. Database schema (Supabase / Postgres)

See `supabase/schema.sql` for the authoritative, executable version. Summary:

### `catalog`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | e.g. "Masala Chai" |
| description | text | |
| price_paise | integer | price in paise (₹1 = 100 paise), avoids float rounding |
| category | text | e.g. "beverage", "snack" |
| pairs_well_with | uuid | fk → catalog.id, nullable — the ONLY source for upsell suggestions |
| is_available | boolean | default true |

### `sessions`
| column | type | notes |
|---|---|---|
| id | uuid pk | one per chat conversation |
| created_at | timestamptz | |
| cart | jsonb | array of `{catalog_id, qty, unit_price_paise, reason}` |
| messages | jsonb | full Claude conversation history (role + content blocks) for this session, so the multi-turn tool-use loop has context across HTTP requests — added Day 2, see `DECISIONS.md` D-1 |
| status | text | `browsing` \| `awaiting_confirmation` \| `confirmed` \| `paid` \| `failed` |
| confirmed_at | timestamptz | nullable — set ONLY by the explicit UI confirmation action, never by chat text |
| confirmed_total_paise | integer | nullable — the exact total the customer confirmed, re-checked against cart total before payment |

### `orders`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| session_id | uuid | fk → sessions.id |
| razorpay_order_id | text | nullable until created |
| razorpay_payment_link_id | text | nullable |
| total_paise | integer | |
| status | text | `created` \| `payment_pending` \| `paid` \| `failed` \| `retried` \| `retry_failed` |
| retry_count | integer | default 0, hard max 1 — enforced in guardrails.ts, not just by convention |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `audit_log`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| session_id | uuid | fk → sessions.id |
| order_id | uuid | fk → orders.id, nullable |
| actor | text | `customer` \| `agent` \| `orchestrator` \| `razorpay_webhook` |
| action | text | e.g. `propose_cart`, `cap_check_passed`, `cap_check_blocked`, `confirmation_required`, `confirmed_via_ui`, `create_order`, `payment_captured`, `payment_failed`, `retry_attempted`, `retry_blocked_max_reached` |
| detail | jsonb | plain-language reason + structured data, e.g. `{"reason": "Total ₹650 exceeds ₹500 auto-approve cap", "total_paise": 65000}` |
| created_at | timestamptz | |

This table is the single most judge-scrutinized artifact in the project. Every action above — successful or blocked — must produce a row. No exceptions.

## 4. Request flow: happy path (under cap)
1. Customer sends chat message → `POST /api/chat`
2. Orchestrator loads session, calls Claude with tools
3. Claude proposes `propose_cart` → orchestrator executes against `catalog`, writes cart to `sessions.cart`, logs `propose_cart`
4. Claude proposes upsell (still part of `propose_cart` response) → logged
5. Customer says "yes, order it" → Claude proposes `create_order`
6. Orchestrator: recompute total from DB → `lib/guardrails.ts` checks total ≤ ₹500 → **passes** → logs `cap_check_passed` → calls Razorpay Payment Links API (see D-7 — no separate Orders API call) → logs `create_order` → returns payment link to customer
7. Razorpay webhook fires `payment.captured` → `app/api/webhooks/razorpay/route.ts` verifies signature, updates `orders.status = paid`, logs `payment_captured`

## 5. Request flow: gated path (over cap)
Same as above through step 5, except at step 6: `lib/guardrails.ts` finds total > ₹500 → logs `cap_check_blocked` with the reason → orchestrator returns a response telling the UI to render `ConfirmationGate.tsx` → **no Razorpay call is made**. Only after the customer clicks the explicit "Confirm ₹X" button (a real UI action, `POST /api/chat` with a distinct `action: "confirm_over_cap"` payload, not a chat message) does the orchestrator set `sessions.confirmed_at` / `confirmed_total_paise`, log `confirmed_via_ui`, re-run the cap check (now passing because confirmation is present), and proceed to Razorpay.

## 6. Request flow: scripted failure + bounded retry
1. Demo uses a Razorpay test-mode card/UPI credential known to simulate a decline
2. Webhook fires `payment.failed` → orchestrator updates `orders.status = failed`, logs `payment_failed` with the reason from the webhook payload
3. Agent explains the failure in plain language to the customer, offers retry
4. Customer accepts → orchestrator checks `orders.retry_count < 1` → **passes** → increments `retry_count`, logs `retry_attempted`, creates a new payment link
5. If that also fails, or customer asks to retry again: `orders.retry_count` is already 1 → guardrails blocks it → logs `retry_blocked_max_reached` → agent tells customer to try a different payment method / contact support. No second automatic retry, ever.

## 7. Environment variables (`.env.local`, never committed)
```
ANTHROPIC_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```
