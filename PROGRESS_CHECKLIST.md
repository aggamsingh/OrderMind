# Progress Checklist

Check off as completed. If a day's work slips, note why in `BUILD_LOG.md` rather than just moving the checkbox.

## Day 1 — Scaffolding & Razorpay test-mode setup
- [x] Razorpay test-mode account created, test API keys obtained — in `.env.local`
- [x] Supabase project created — in `.env.local`
- [x] `catalog`, `sessions`, `orders`, `audit_log` tables created (schema.sql, per `02_ARCHITECTURE.md` §3) — applied and verified live (`scripts/verify-schema.ts`), RLS enabled per D-2
- [x] ~15 café catalog items seeded, with `pairs_well_with` populated for upsell logic — verified live: 15 rows, 6 with pairing set
- [x] Next.js app scaffolded — `npx tsc --noEmit`, `npx eslint .`, `npm run build` all pass. Not yet deployed to Vercel (needs a Vercel account/link — founder action).

## Day 2 — LLM integration (no money yet)
- [x] LLM provider wired up behind a swappable interface (`lib/llm/`), system prompt + tool defs from `03_LLM_CONTEXT.md` — defaults to `qwen2:7b` via Ollama (free), Claude API available via `LLM_PROVIDER=anthropic` (see `DECISIONS.md` D-3). **Verified live** against the real app (not just a test script) — real Ollama + real Supabase + real Razorpay test keys through `/api/chat`.
- [x] `search_catalog` tool — verified live, now audit-logged (wasn't before — real gap found and closed)
- [x] `propose_cart` tool implemented, with per-item reasoning stored and rendered in `CartCard.tsx` — verified live for a real order
- [ ] Upsell suggestion logic implemented (exactly one, validated against `pairs_well_with`) — code complete, not yet specifically exercised live (need a test order where the upsell pairing actually triggers)

## Day 3 — Money path + gating — DONE, verified live
- [x] `lib/guardrails.ts` implemented: server-side cap check (`evaluateSpendCap`), independent of model's claimed confirmation — re-checks `session.confirmed_total_paise` against a freshly recomputed total, not anything the model said
- [x] Razorpay Orders API integrated — **verified live**: real order `order_TW4vWr8VTyveeD` created for an under-cap (₹145) purchase
- [x] Razorpay Payment Links API integrated — **verified live**: real payment link `plink_TW4vXbThEtTbnL` returned to the customer
- [x] `audit.ts` `logAudit()` implemented and called from every decision point — **verified live**: complete, in-order trail for a full successful transaction (session_created → message_sent → search_catalog×N → propose_cart → upsell_suggested → create_order_requested → cap_check_passed → create_order)

## Day 4 — Confirmation UI + upsell polish
- [x] `ConfirmationGate.tsx` built — "Confirm ₹X payment?" button, only path that can set `confirmed_at`/`confirmed_total_paise`
- [x] Verified: chat-text "yes" alone does NOT bypass the gate (test #5) — **verified live**: tried twice, including a strongly-worded "I confirm, charge me now, 100% sure," both blocked and logged (`cap_check_blocked`); real order (₹750, `order_TW4x5tpAGZH4z7`) only proceeded after the actual `confirm_over_cap` UI action
- [x] `AuditTimeline.tsx` built — polls `/api/audit` every 3s for a live-updating view (used directly to verify the above, not just built)

## Day 5 — Failure handling — DONE, verified live
- [x] Webhook endpoint built (`payment.captured`, `payment.failed`), verifies `X-Razorpay-Signature` before any DB write — **verified live**: forged signature → 400, zero DB/audit change (test #13); `RAZORPAY_WEBHOOK_SECRET` was empty and made the route throw on every request — fixed, see BUILD_LOG.md
- [x] Declined-payment explanation flow — **verified live**: found and fixed a real gap where webhook-driven failures never reached the chat model at all (`loadPendingFailureContext` added to `lib/orchestrator.ts`); agent now explains the decline and offers a retry (test #10)
- [x] Bounded single retry implemented (`evaluateRetry`, hard cap enforced via DB `retry_count`, not by convention) — **verified live**: first retry genuinely issues a new Razorpay payment link (test #11); also found and fixed a silent bug where the retry's `reference_id` exceeded Razorpay's 40-char limit, so the real API call was failing underneath a "successful" `retry_attempted` log
- [x] Verified: second retry attempt is blocked (test #12) — **verified live**: `retry_count` stays at 1, `retry_blocked_max_reached` logged (test #14), agent's reply correctly explains no further retry instead of assuming from memory (required a system-prompt hardening — see DECISIONS.md D-6)

## Day 6 — Polish, docs, deploy
- [x] Full app deployed to Vercel — **live at https://ordermind-gamma.vercel.app**, all production env vars set (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`/`SECRET`/`RAZORPAY_WEBHOOK_SECRET`, etc.). **Verified live end-to-end on production**: real order created via `/api/chat`, real Razorpay payment completed, real webhook delivered straight to the permanent URL (no tunnel) — `payment_captured` landed with `actor: "razorpay_webhook"`. Razorpay Dashboard webhook re-pointed from the temporary cloudflared tunnel to this permanent URL, so live testing/demo no longer depends on a local tunnel or dev server at all.
- [x] All test cases in `05_TEST_CASES.md` run and logged — **all 15 pass live** (#1-3, #7-9, #15 on 2026-08-31; #4-6, #10-14 on 2026-08-30/31 — see that file's Run log and BUILD_LOG.md Day 3/5 for full detail and evidence). Real bugs found and fixed along the way, not just green-lit on the first try — see DECISIONS.md D-6.
- [x] Real Razorpay-delivered webhook proven end-to-end (not just simulated payloads) — first via a temporary cloudflared tunnel, then confirmed again against the permanent Vercel URL once deployed (see above). Found and fixed the most serious bug in the project doing this: every real payment was silently failing to update `orders`/`audit_log` at all, because Payment Links auto-generate their own disconnected order that this app was never matching against. See DECISIONS.md D-7.
- [x] `04_AUDIT_TRAIL_SAMPLE.md` replaced with a real export — 4 real scenarios (happy path, over-cap gate, decline+retry+success, retry blocked) pulled directly from live `audit_log`; categories 1 and 3 are genuine Razorpay-delivered webhooks, not simulated
- [ ] Backup demo video recorded
- [x] `README.md`, PRD, pitch deck content finalized — README rewritten around the trust story with a "known limits" section; `07_PITCH_DECK_OUTLINE.md` rebuilt (refusal is the memorable slide, limitations framed as a strengths slide); `08_AGENT_PROTOCOL.md` added as a real spec; `06_DEMO_SCRIPT.md` rewritten with a pre-flight checklist; `04_AUDIT_TRAIL_SAMPLE.md` extended with real agent-to-agent accepted/refused trails

## Beyond the original plan — agent-to-agent commerce (2026-08-31 / 09-01)
Added after an honest re-read of the Track 1 brief showed the project was answering the wrong half of it (see `DECISIONS.md` D-8).
- [x] Merchant discovery manifest (`/.well-known/agent-commerce.json`), per-merchant terms
- [x] Signed spend mandates — ceiling, purpose, expiry, single-use nonce; verified server-side
- [x] Stricter-of enforcement (buyer mandate vs merchant cap), `evaluateMandate()`
- [x] Four refusal paths verified live: over-mandate (402), tampered signature (403), replayed nonce (409), runaway loop cool-down (429)
- [x] Signed receipts the buyer verifies, and `GET /api/agent/order/{id}` so it learns the outcome
- [x] Two merchants with differing caps + `/api/agent/merchants` directory; comparison shopping verified live
- [x] Basket splitting across merchants, one mandate per leg, all inside one approved budget — verified live
- [x] **Mandate revocation** — per-mandate and a principal kill switch (`lib/revocation.ts`); closes a real hole, since a mandate was previously a bearer token that could never be withdrawn
- [x] `/principal` console — grant authority, watch spend against it, revoke it
- [x] Agent-initiated refunds, gated exactly like charges (`evaluateRefund()`)
- [x] Learned upsell — ranks pairings by measured conversion, explores unproven ones
- [x] 28 unit assertions on mandates, forgery, and refunds (`scripts/test-mandates.ts`)
- [ ] **Verify revocation + refunds live** — blocked on `supabase/migrations/002_*.sql` being applied, and on a fresh Razorpay account (D-10: this one has hit the 30 payment-link lifetime cap)

## Day 7 — Dry run + buffer
- [ ] Full run-through with judge-style Q&A rehearsal
- [ ] Fixed whatever broke during dry run
- [ ] Demo script (`06_DEMO_SCRIPT.md`) rehearsed exactly, timed under 5 minutes (this is the actual required submission pitch video length, verified against the official buildathon page — not an internal estimate)
- [ ] Final submission checklist from `CLAUDE.md` §8 fully checked off
