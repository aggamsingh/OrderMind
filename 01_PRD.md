# 01 — Product Requirements Document

## 1. Problem
Razorpay Track 1 asks for an agent that either grows a merchant's revenue or makes the merchant transactable by an AI buyer, end-to-end, on Razorpay test-mode APIs — and the explicit judging bar is that every money action must be explainable, bounded, and gated, with a visible audit trail and one gracefully handled failure.

Most "AI checkout" demos either (a) never touch real payment APIs, or (b) let the LLM call payment APIs directly with no independent server-side check — which fails the "bounded and gated" bar the moment a judge asks "what stops the model from just paying whatever it wants?"

## 2. Solution
OrderMind: a chat-based ordering agent for a single café merchant. The customer describes what they want in natural language. The agent:
1. Searches a real catalog (Supabase-backed) and proposes a cart with a stated reason per item.
2. Suggests exactly one upsell, sourced only from that item's `pairs_well_with` field.
3. Requests payment via Razorpay test-mode Orders + Payment Links APIs — but only after the **backend orchestrator**, not the model, independently checks the order total against a ₹500 spend cap.
4. Under the cap: auto-completes. Over the cap: blocks until the customer explicitly confirms in a dedicated UI control (not chat text).
5. Logs every decision — proposed, blocked, confirmed, paid, failed, retried — to an `audit_log` table, viewable live in an `/audit` page.
6. Handles one scripted payment decline with a plain-language explanation and exactly one bounded retry.

## 3. Users
- **Primary (demo persona):** a customer ordering chai/snacks from Chai Point Express via chat.
- **Real audience:** Razorpay Buildathon judges evaluating explainability, boundedness, gating, and failure handling — not conversation quality or menu breadth.

## 4. Scope

### In scope (Track 1, 7-day build)
- Single merchant, single catalog, chat-only ordering
- Cart proposal with visible reasoning
- Exactly one upsell per order
- ₹500 spend cap, server-enforced
- Razorpay test-mode Orders API + Payment Links API + webhook handling
- Audit trail (DB table + viewer page)
- One scripted decline → explanation → one bounded retry → success

### Explicitly out of scope for this submission
- Multi-merchant support
- Voice interface
- Full autonomous agent operation with no human in the loop for any order size
- Real KYC / production Razorpay account / live-mode payments
- Persistent user accounts / login (session-based only, per `02_ARCHITECTURE.md`)
- Inventory management, order fulfillment/kitchen workflow
- Loyalty programs, coupons, multi-currency

Do not build any of the above until every item in `CLAUDE.md` §8 ("Definition of winning") is checked off and there is spare time — see `CLAUDE.md` §8.

## 5. Success criteria (maps directly to the judging bar)
- A judge can ask "why is this item in the cart?" and get a plain-language answer, not just a price.
- A judge can try to talk the agent into an over-cap payment via chat alone and watch it get blocked, then see it succeed only once the UI confirmation is used.
- A judge can open `/audit` and see a complete, timestamped trail — including the blocked attempt.
- A judge can watch a payment decline happen, get explained, get retried once, and either succeed or stop (never a silent second retry).
