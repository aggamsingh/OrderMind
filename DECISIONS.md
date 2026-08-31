# Decisions Log (ADR-lite)

Use this for choices with real alternatives — a library, a schema change, a deviation from `02_ARCHITECTURE.md` or `03_LLM_CONTEXT.md`, a scope cut. Don't log routine work here — that goes in `BUILD_LOG.md`.

**Template — copy this for every new decision:**

```
## D-N: (short title)

**Date:** YYYY-MM-DD
**Context:** (what problem or question prompted this decision)
**Options considered:**
  1. ...
  2. ...
**Decision:** (what was chosen)
**Reasoning:** (why, including trade-offs accepted)
**Affects:** (which locked decision in CLAUDE.md §1, if any, this touches)
```

---

## D-0: Example — spend cap value (delete once real entries start)

**Date:** 2026-08-30
**Context:** Needed a concrete auto-approval spend cap for the guardrail logic.
**Options considered:**
  1. ₹200 — very conservative, but makes most realistic café orders require manual confirmation, which weakens the "agent actually completes purchases" demo
  2. ₹500 — covers a typical multi-item café order, still low enough that a "family combo" style order clearly trips the gate for the demo
  3. ₹1000 — too permissive for a first demo, harder to reliably trigger the gated-confirmation path
**Decision:** ₹500
**Reasoning:** Best balance between showing the agent actually completing real orders (bounded autonomy) and reliably demonstrating the gate (bounded-ness) within a single scripted demo.
**Affects:** CLAUDE.md §1 spend cap value; `lib/guardrails.ts`

---

*(Real entries start below this line)*

---

## D-1: Add `messages` jsonb column to `sessions`

**Date:** 2026-08-30
**Context:** Writing `app/api/chat/route.ts`, the orchestrator needs to replay conversation history to Claude on every turn (Anthropic's API is stateless per-request — it has no memory of earlier turns unless you resend them). The schema in `02_ARCHITECTURE.md` §3 as originally written only stored `cart`, not the underlying chat transcript, so a second HTTP request from the same browser session would have no way to continue the same Claude conversation or multi-step tool-use loop.
**Options considered:**
  1. Store messages in a separate `messages` table (one row per message) — more "properly relational," but adds a join and extra writes for something that's only ever read/written as one whole array per turn.
  2. Store messages as a `jsonb` column directly on `sessions` — simpler, matches how `cart` is already stored, and the whole array is always read/written together anyway (never queried by individual message).
  3. Keep conversation history in-memory only (no persistence) — rejected immediately: would break on serverless cold starts and make the audit story worse, not better.
**Decision:** Option 2 — added `messages jsonb not null default '[]'::jsonb` to `sessions`.
**Reasoning:** Matches the existing pattern for `cart`, avoids a join for data that's always accessed as a unit, and keeps the schema small — appropriate for a 7-day hackathon build, not a production chat platform.
**Affects:** `supabase/schema.sql`, `02_ARCHITECTURE.md` §3 sessions table, `lib/types.ts` `Session` type.

---

## D-2: Enable Row Level Security on all four tables, with no anon/authenticated policies

**Date:** 2026-08-30
**Context:** Applying `supabase/schema.sql` via the dashboard SQL Editor, Supabase's own linter blocked the query with "This query creates tables without enabling Row Level Security. Clients using anon or authenticated keys may be able to access these tables," offering "Run without RLS" or "Run and enable RLS."
**Options considered:**
  1. Run without RLS — fastest, and technically harmless *today* since nothing in the app currently uses the anon key to query these tables directly.
  2. Enable RLS with no policies for anon/authenticated — slightly more setup, but closes off direct REST API access via the public anon key entirely.
**Decision:** Option 2 — added `alter table ... enable row level security;` for all four tables directly in `schema.sql`, with deliberately zero policies for anon/authenticated.
**Reasoning:** The anon key is meant to be public/embeddable by Supabase's own design, and Supabase auto-exposes every table as a REST endpoint. If RLS were left off, anyone holding that key could call the Supabase API directly and create orders, edit `sessions.confirmed_at`, or write fake `audit_log` rows — completely bypassing `lib/guardrails.ts` and the orchestrator. That would undermine the core locked rule in `CLAUDE.md` §1 that the orchestrator is the *only* path to the database, which is the whole basis for "bounded and gated" being true in code, not just asserted. Since this app only ever accesses Supabase via the `service_role` key server-side — which bypasses RLS regardless of policies — enabling RLS with no policies costs nothing functionally and closes a real gap.
**Affects:** `CLAUDE.md` §1 (reinforces it, doesn't change it); `supabase/schema.sql`.

---

## D-3: Default to a local Ollama model (qwen2:7b) instead of the Claude API, with an explicit path back

**Date:** 2026-08-30
**Context:** Anthropic Console enforces a $5 minimum credit purchase. Rather than spend it immediately, we ran a genuinely empirical investigation — not a guess — testing six local Ollama models against this project's real tool schema and, for the finalists, a full multi-turn order flow against the real Supabase catalog (see `BUILD_LOG.md`'s Day 1 Ollama entries for full detail). Result: `llama3.2:3b` and `llama3.1:8b` both fabricate catalog IDs from item names and crash on a real DB lookup; `qwen2.5:14b` fails to load (OOM); `qwen2:1.5b` doesn't support tool-calling at all; `qwen2.5:7b` gets item/catalog handling right but fails to recognize an explicit "yes, pay" and never calls `create_order`; `qwen2:7b` is the only model that completed a full, correct order — real catalog UUIDs, correct JSON types, correct step order, reached `create_order`. Its only gap is missing an available upsell (a quality miss, not a broken transaction). Confirmed inference runs 100% on CPU (RTX 3050's 4GB dedicated VRAM isn't used by Ollama at all, verified three independent ways) — meaning per-turn latency is 15-60+ seconds, a real live-demo risk `qwen2:7b` doesn't remove.
**Options considered:**
  1. Pay the $5 minimum now and use Claude Sonnet 5 as originally locked in — fastest, zero known correctness bugs, but real money before it's proven necessary.
  2. Use `qwen2:7b` via Ollama, free, with a confirmed-working (if slow) correctness profile.
  3. Keep testing other local models — diminishing returns; six models across two methodologies is already a thorough search of what's practical on this hardware.
**Decision:** Option 2 for now — build the app against `qwen2:7b`, but architect the Claude call site as a swappable provider (`lib/llm/`) rather than hard-wiring Ollama in Claude's place, so switching to the Claude API later (if `qwen2:7b`'s speed or the missed-upsell gap proves unacceptable during real use) is a config change (`LLM_PROVIDER=anthropic` + a valid `ANTHROPIC_API_KEY`), not a rewrite.
**Reasoning:** The empirical evidence supports `qwen2:7b` being genuinely correct, not just "good enough to gamble on" — this isn't skipping validation to save money. But the CPU-only latency risk is real and unresolved, so preserving a cheap path back to Claude protects the actual demo outcome without forcing a decision neither side is fully confident in yet.
**Affects:** `CLAUDE.md` §1 (stack line now provider-configurable, not hard-locked to Claude — see amendment there), `lib/claude.ts`, `lib/orchestrator.ts`, new `lib/llm/` directory, `.env.local`/`.env.example` (`LLM_PROVIDER`, `OLLAMA_MODEL`).

---

## D-4: Switch default provider from `qwen2:7b` (Ollama) to Gemini (`gemini-3.6-flash`)

**Date:** 2026-08-30
**Context:** Founder asked whether Gemini would be a better default than Ollama, given the same cost constraint (no Anthropic credit purchased) but without CPU-only local inference's latency ceiling. Added `lib/llm/gemini-provider.ts` to the existing provider abstraction and ran the same empirical probes used on the six Ollama models — a full multi-item order with explicit payment intent, an open-ended natural-language query with no payment intent, and a hallucination-resistance probe for a nonexistent item — all against the real Supabase catalog through the actual `lib/llm/` code path (not a reimplementation).
**Options considered:**
  1. Keep `qwen2:7b` — free, already the default, but has a confirmed upsell-miss and a residual "sometimes skips search_catalog entirely" risk (see Day 2 log), plus a hard 4GB-VRAM/CPU-only latency ceiling (15-90s per turn).
  2. Switch to Gemini (`gemini-3.6-flash`) — also free (real free tier, no minimum purchase), hosted (no local hardware ceiling).
  3. Switch to the Claude API — would need the $5 minimum purchase, sidestepped throughout this investigation.
**Decision:** Option 2. All three Gemini test prompts passed cleanly — zero hallucinations, zero fabricated catalog IDs, zero type errors, correctly caught an available upsell with a proper reason, and correctly withheld `create_order` when the customer hadn't actually asked to pay. That's a clean sweep across every correctness dimension tested on every model in this entire investigation, Ollama or otherwise.
**Reasoning:** Free, and empirically the most correct option tested — not an assumption that "hosted must be better," a measured one. The one real caveat: latency is inconsistent (1.6s-64s for a single call, most likely free-tier rate-limiting variance) rather than Ollama's consistent-but-slow CPU bottleneck — a different risk profile (occasional pause vs. reliably slow), noted honestly rather than glossed over. `qwen2:7b` remains available via `LLM_PROVIDER=ollama` if Gemini's variance proves worse in further live use; Claude remains available via `LLM_PROVIDER=anthropic` if credit is ever purchased. Nothing about the provider abstraction changes — this is a config flip, exactly what D-3 was built to make cheap.
**Affects:** `.env.local`/`.env.example` (`LLM_PROVIDER=gemini`, `GEMINI_API_KEY`), `lib/llm/gemini-provider.ts` (new).

---

## D-5: Correction — `gemini-flash-lite-latest` does NOT have a confirmed "much larger" quota pool than `gemini-3.6-flash`

**Date:** 2026-08-31
**Context:** D-4 and a comment in `lib/llm/gemini-provider.ts` claimed flash-lite has "a separate, much larger quota pool" than 3.6-flash and "stayed available when 3.6-flash was already exhausted." Founder shared a screenshot of the actual AI Studio rate-limit dashboard ("Requests per model" chart, `aistudio.google.com/rate-limit`) to check this. It shows **Gemini 3.5 Flash Lite and Gemini 3.6 Flash both spiking to the same ~20-22 requests around the same day, then both dropping to 0 together** — not flash-lite continuing on after 3.6-flash flatlined. That directly contradicts the "much larger pool" claim.
**Options considered:**
  1. Leave the comment/decision as-is — rejected, it's now known to be inaccurate and CLAUDE.md §9 requires flagging conflicts like this rather than leaving silently-wrong reasoning in the repo.
  2. Correct the record (this entry + inline comment fix) but keep `gemini-flash-lite-latest` as the default, since it's still free and a live connectivity check (`scripts/check-gemini-connection.ts`) confirmed it still works right now.
  3. Switch providers again (e.g. back to `qwen2:7b` or to Claude) — no evidence yet that current quota is actually a blocker; premature without more data.
**Decision:** Option 2. Corrected the inline comment in `lib/llm/gemini-provider.ts`. Provider default unchanged for now.
**Reasoning:** The chart shows historical request *volume*, not the account's actual RPD/RPM limit numbers (those live elsewhere on the same dashboard) — it's real evidence the previous "much larger pool" claim was wrong, but not by itself proof of what the real per-model caps are. Cheapest correct move is: fix the false claim now, keep using the model since it demonstrably still works, and treat quota headroom as unconfirmed rather than generous going into Day 6/7 demo prep — re-check the dashboard's actual limit figures (not just this usage chart) before relying on it live.
**Reasoning gap flagged for founder:** the dashboard likely has a separate limits table (RPM/TPM/RPD per model) beyond this usage chart — worth screenshotting that too so the real ceiling is documented, not inferred from usage history.
**Affects:** `lib/llm/gemini-provider.ts` (comment corrected), D-4 (reasoning partially superseded by this entry).
**Update (2026-08-31, same day):** the real number showed up on its own during Day 5 live testing — a real `429 RESOURCE_EXHAUSTED` hit while running `scripts/test-happy-path-live.ts`, with the exact quota in the error body: `gemini-flash-lite-latest` (Google's own error labels it `gemini-3.5-flash-lite`) is capped at **15 requests per MINUTE** on the free tier (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, `quotaValue: "15"`), not just an unspecified daily pool. A single customer chat turn can burn 2-4 Gemini calls (search → propose_cart → create_order, sometimes more), so this caps a live demo to roughly 4-7 customer messages per minute across ALL concurrent sessions before every further request fails for ~55s (the error's own `retryDelay`). This is a real live-demo risk, not just a testing inconvenience — flagged clearly to the founder in the same turn this was found, per CLAUDE.md §9. No code change made in response beyond the graceful-degradation fix already landed in D-6 (`llm_call_failed` handling) — pacing the demo script (not sending messages faster than ~1 every 10-15s) is the mitigation for now; switching to `LLM_PROVIDER=anthropic` (needs the $5 minimum credit, still unpurchased) remains the escape hatch if this proves too tight during dry runs.

---

## D-6: Bridge webhook-driven order-failure state back into the chat conversation

**Date:** 2026-08-31
**Context:** Ran the Day 5 failure-handling tests (#10-12) live for the first time via a new `scripts/test-failure-flow-live.ts` harness (real `/api/chat`, real webhook POSTs with a valid HMAC signature against the real handler). Found that asking the agent "please retry the payment" after a real `payment.failed` webhook produced a generic reply with no `retry_payment` tool call — `retry_count` stayed 0. Root cause: `app/api/webhooks/razorpay/route.ts` updates `orders`/`sessions`/`audit_log` directly from Razorpay's server-side callback, entirely outside any chat turn. `lib/orchestrator.ts`'s `runAgentTurn` only ever sends `session.messages` + the new user message to the model — nothing ever told the model a payment had failed, despite system-prompt rule 5 already assuming it would be "given" a failure reason.
**Options considered:**
  1. Have the frontend fetch order status separately and prepend it to the user's chat message client-side — puts trust-sensitive framing in the browser, and duplicates DB access outside the orchestrator's single path to Supabase (`CLAUDE.md` §1).
  2. Add a new `check_order_status` tool the model can choose to call — matches the existing "model investigates" pattern (`search_catalog`) but relies on the model deciding to call it, which is exactly the kind of reliability gap this bug already demonstrated.
  3. Server-side: before each turn, `runAgentTurn` looks up the session's latest order; if `status === 'failed'`, inject a synthetic `role: 'user'` context message (order id, amount, decline reason from `audit_log`) ahead of the real user message, then let the model's own rules 4/5 decide what to do next.
**Decision:** Option 3 — added `loadPendingFailureContext()` in `lib/orchestrator.ts`. Kept it a synthetic message rather than folding the note into the real user message so the persisted, audited record of what the customer actually typed stays untouched.
**Reasoning:** Grounding the model in a backend-verified fact automatically is more reliable than hoping the model calls a lookup tool at the right moment (option 2's failure mode is what actually happened here), and keeps Supabase access inside the orchestrator rather than the browser (option 1). This is read-only context injection, not a money action, so it doesn't need its own guardrails.ts gate — the actual retry decision is still independently re-verified by `evaluateRetry()` regardless of what this context says.
**A second, related bug found in the same test run:** `execRetryPayment`'s Razorpay `reference_id` was `${order.id}-retry1}` — 43 characters, over Razorpay's real 40-char cap ("the length must be no more than 40", hit live). Every retry attempt was incrementing `retry_count` and logging `retry_attempted` correctly, while the actual Razorpay payment-link call silently failed underneath it — the customer would never have received a working retry link. Fixed by stripping dashes from the UUID before appending the suffix (32 + 3 = 35 chars) — **later superseded by D-7's `${order.id}-1` (38 chars), which keeps the UUID intact instead of mangling it, once D-7 needed to recover it from `receipt`.**
**A third, related gap:** even after the context fix, a second "please retry" on an already-once-retried order got a text-only reply with no tool call — the model reasoned from its own conversation memory that the retry was used up instead of calling `retry_payment` and trusting the backend's answer. Hardened system-prompt rule 5 (`lib/claude.ts` + `03_LLM_CONTEXT.md`, kept in sync) to explicitly forbid the model from deciding retry eligibility itself and require calling the tool every time the customer asks to retry.
**Result:** all three fixes together — verified live, `scripts/test-failure-flow-live.ts` now passes 18/18, covering test cases #10, #11, #12, #13, #14 end-to-end for the first time.
**Affects:** `lib/orchestrator.ts` (`loadPendingFailureContext`, `execRetryPayment` reference_id fix), `lib/claude.ts` + `03_LLM_CONTEXT.md` (rule 5 hardened), `scripts/test-failure-flow-live.ts` (new), `.env.local`/`.env.example` (`RAZORPAY_WEBHOOK_SECRET` now set — was empty, which made the webhook route throw a 500 on every request instead of a clean rejection).

---

## D-7: Fix a webhook order-matching bug that would have silently broken EVERY real payment — Payment Links auto-generate their own disconnected order

**Date:** 2026-08-31
**Context:** After registering a real Razorpay webhook (via a cloudflared tunnel to the local dev server — the first time this project tested real Razorpay-triggered delivery, not a signed simulated payload) and completing a real test-mode payment, `orders.status` stayed `payment_pending` forever and no `payment_captured`/`payment_failed` audit row ever appeared, despite Razorpay's own dashboard showing the payment as genuinely `Captured`/`Paid`. Investigated by fetching the actual paid payment link back via the Razorpay API: its `order_id` (`order_TWJgKDcgIETM62`) did not match what this app had stored as `orders.razorpay_order_id` (`order_TWJXQw1CcxfH2m`) — a completely different value.
**Root cause, confirmed empirically (not from docs — WebFetch against Razorpay's own documentation pages repeatedly failed to surface the relevant details, so this was resolved by directly querying the real API instead):** `createRazorpayOrderAndLog()` was calling BOTH `razorpay.orders.create()` (a standalone Order) AND `razorpay.paymentLink.create()` (a Payment Link) for every order. Creating a Payment Link makes Razorpay auto-generate its OWN separate internal order under the hood — completely disconnected from the standalone Order this app created and stored. The webhook's `payload.payment.entity.order_id` is always the Payment Link's auto-generated order, never the standalone one — so the DB lookup by `razorpay_order_id` was guaranteed to 404 on every single real webhook, for every payment, forever. This had zero chance of being caught by `scripts/test-failure-flow-live.ts` (same day, but earlier) because that script POSTs a hand-crafted signed payload using the DB's own stored `razorpay_order_id` — it validates the handler's *logic* assuming a correct id, but structurally cannot catch a wrong-id-stored bug, since it never goes through Razorpay's real order-assignment behavior at all.
**A second wrinkle, also confirmed empirically:** the Payment Link's auto-generated order id is assigned *lazily* — `paymentLink.order_id` is `undefined` immediately after creation, confirmed by fetching a freshly-created (unpaid) link back and finding no `order_id` yet. It only exists once the customer actually starts checkout. So there was never a valid moment to capture and store it at order-creation time in the first place.
**The reliable fix, found by fetching the real paid order back and inspecting every field rather than guessing:** the auto-generated order's `receipt` field is always the exact `reference_id` this app passed when creating the Payment Link (confirmed live) — and `reference_id` was already being set to this app's own `orders.id` UUID. So the webhook handler can always recover the real internal order, regardless of when Razorpay assigns the order id, by: fetching the Razorpay order named in the webhook payload, reading its `receipt`, and matching the leading UUID against `orders.id`.
**One more empirical check before trusting this design:** confirmed live that Razorpay's `reference_id` must be unique per Payment Link (reusing the same value on a second link is rejected with `"payment link with given reference_id ... already exists"`) — so a retry's payment link cannot reuse the original's `reference_id` unchanged, the way a naive fix might assume. Fixed the retry path (D-6's `-r1` fix) to use `${order.id}-1` instead of a dash-stripped, mangled id — 38 chars, under the 40-char cap, AND keeps `order.id` intact and extractable as a clean leading-UUID match.
**Decision:** Removed `createRazorpayOrder()` entirely — a standalone Order was dead weight that actively broke webhook matching, not just redundant. Added `fetchRazorpayOrderReceipt()` to `lib/razorpay.ts`. Rewrote `app/api/webhooks/razorpay/route.ts`'s order lookup: try a direct `razorpay_order_id` match first (fast path for redelivered/repeat events), then fall back to resolving via `fetchRazorpayOrderReceipt()` + a leading-UUID regex match against `orders.id`, backfilling `razorpay_order_id` once resolved so future events for the same order id hit the fast path.
**Verified live, twice, with genuine Razorpay-delivered webhooks (not simulated) through a real cloudflared tunnel + a real Razorpay Dashboard webhook registration:** (1) a real scripted decline on a fresh order — `payment_failed` landed with `actor: "razorpay_webhook"`, order correctly marked `failed`, `razorpay_order_id` correctly backfilled; (2) the agent explained the decline and called `retry_payment` on its own (proving D-6's context-bridge fix and this fix compose correctly), a real retry payment completed successfully, and its *own*, *different* auto-generated order id was correctly resolved and the order marked `paid`. This is the first and only time this project has proven the full real-world payment path — Razorpay's actual servers delivering a real webhook to this app — rather than a handler-logic simulation.
**Reasoning:** This bug would have silently broken 100% of real payments in production or in front of judges, despite every earlier "live" test (Day 3-5) reporting success — because those tests either never exercised the money-in-motion webhook path at all, or exercised it via a simulated payload that structurally could not surface a wrong-stored-id bug. It's a direct, humbling illustration of why `CLAUDE.md`'s "show the audit trail" bar matters: the audit trail would have shown a permanently-stuck `payment_pending` order with zero webhook rows for every real transaction, and nothing in the code would have said why, until someone actually looked.
**Affects:** `lib/razorpay.ts` (`createRazorpayOrder` removed, `fetchRazorpayOrderReceipt` added), `lib/orchestrator.ts` (`createRazorpayOrderAndLog`, `execRetryPayment` reference_id), `app/api/webhooks/razorpay/route.ts` (order resolution rewritten), `02_ARCHITECTURE.md` (should be updated to drop any reference to a standalone Orders API call — flagging for founder review since this touches the documented architecture, per `CLAUDE.md` §9).

---

## D-8: Make the merchant transactable by an AI buyer, with mandates enforced on both sides

**Date:** 2026-09-01
**Context:** An honest re-read of the Track 1 brief against what had actually been built. The brief offers two routes — "grows revenue for a merchant" **or** "makes a merchant **transactable by an AI buyer end to end**" — and frames the whole track around agent-to-agent commerce (NPCI UAP, ACP, AP2, x402). What existed was a human-facing chatbot with unusually good guardrails: no AI buyer, no machine-readable surface, no protocol. It answered the revenue half weakly (one hardcoded upsell, zero measurement) and the agentic half not at all. Well-built, but likely off-brief — worth confronting before polishing further.
**Options considered:**
  1. Lean harder into the human chat experience (better UI, more upsell logic). Improves a submission that is answering a question the track didn't quite ask.
  2. Build a *buyer* agent that shops across merchants. On-brief, but discards the guardrail/audit work that is this project's genuine strength, and competes on a crowded idea.
  3. Make **this merchant** transactable by any autonomous buyer, and make the trust problem symmetric: the buyer presents a signed spend mandate, and the merchant enforces the stricter of that mandate and its own cap.
**Decision:** Option 3.
**Reasoning:** It converts the existing strength into the differentiator rather than abandoning it. Most Track 1 entries will build *an agent*; the unanswered problem is that when an AI buyer meets an AI seller, **neither can trust the other** — a runaway buyer loop drains its principal, and a merchant that simply takes the money is exactly the merchant no one should let an agent transact with. Mandates are the concept the cited protocols are converging on, so implementing them engages the track's actual subject instead of gesturing at it. It also reframes the guardrails from a safety feature into the product: the memorable demo beat is not a declined card, it is a merchant **refusing** a buyer agent that exceeded the authority its human granted, with both sides logged.
**What was built:** `/.well-known/agent-commerce.json` (discovery — a buyer learns the limits before spending a request, rather than by being refused); `lib/mandate.ts` (HMAC-signed mandates carrying ceiling, purpose, expiry and a single-use nonce, plus signed receipts a buyer can reconcile against); `evaluateMandate()` (stricter-of enforcement); `/api/agent/{catalog,quote,order}`; and `scripts/buyer-agent.ts`, a real LLM buyer that reaches the merchant **only over public HTTP**, never through shared code.
**A deliberate asymmetry:** a human can lift an over-cap order by clicking the confirmation control; an autonomous buyer cannot, because no human is present to click it. Exceeding the mandate is refused outright rather than queued. That is the honest answer, and stating it in the manifest's `disclosures` block is better than pretending the case is handled.
**Verified live, all four paths, against the deployed production merchant:** a successful order (including the merchant upselling the *machine*, which accepted only after checking the extra item still fit its mandate), an over-mandate refusal (402), a tampered-signature refusal (403), and a replayed-nonce refusal (409) — every one written to `audit_log` under a distinct `buyer_agent` actor, which is what migration 001 exists for.
**Also addressed the revenue half:** `/api/metrics` computes upsell attach rate and basket uplift from real orders instead of asserting growth, and reports guardrail refusals beside it — growth obtained by ignoring the limits would not be a result worth showing.
**Affects:** `CLAUDE.md` §1 (extends the locked architecture with an agent-to-agent channel — flagged for founder review per §9, since it is an addition to the original scope rather than a deviation from it), `supabase/schema.sql` + `supabase/migrations/001` (new `buyer_agent` audit actor), `lib/guardrails.ts`, `02_ARCHITECTURE.md` (should gain the agent channel).
