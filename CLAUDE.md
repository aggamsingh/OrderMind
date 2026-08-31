# CLAUDE.md — Project Instructions for Claude Code

Read this file fully before writing any code. This is the project's source of truth for scope, decisions, and working process. Also read `01_PRD.md` through `09_README.md` and `00_CONTEXT_HANDOFF.md` in the repo before starting — they contain the full spec, schema, and prompt text this file summarizes.

---

## 0. What we are building and why (read this carefully — this is the actual judging criteria)

**Event:** Razorpay AI Buildathon
**Track:** Track 1 — AI Growth & Agentic Commerce
**Track brief (verbatim):** "Grow the merchant's revenue, and make them sellable to AI buyers. Build an agent that grows revenue for a merchant on Razorpay test-mode APIs, or that makes a merchant transactable by an AI buyer end to end."
**Why this track exists now:** NPCI's UAP and the global protocol race (ACP, AP2, x402) make agent-to-agent commerce the open problem of the year, and Razorpay's in-app pilots are already live.
**The bar we are graded against (verbatim):** "Every money action explainable, bounded and gated. Show the audit trail and one failure handled gracefully."

Every feature decision in this project should be checked against that bar. If a feature doesn't make the agent more explainable, more bounded, more gated, or the audit trail more complete, it's lower priority than one that does.

**What we are building:** OrderMind — a conversational checkout agent for a café merchant ("Chai Point Express"). Customer describes what they want in chat → agent proposes a cart from a real catalog with stated reasoning → suggests exactly one relevant upsell → auto-completes payment via Razorpay test-mode APIs if under a spend cap, or gates behind explicit human confirmation if over it → logs every decision to an audit trail → handles one scripted payment failure gracefully with exactly one bounded retry.

---

## 1. Locked-in decisions — do not deviate without asking

- **Merchant type: café/restaurant.** Chosen deliberately — reuses a session-based ordering data model from a prior project and matches Razorpay's own live pilots (Zomato, Swiggy). Do not suggest switching merchant type.
- **Domain overlap with the founder's own café-ordering startup (Servesta) is explicitly fine** for this project. Don't flag or avoid it.
- **Stack:** Next.js (App Router, TypeScript) + Supabase (Postgres) + an LLM provider behind a swappable interface (`lib/llm/`) — currently Gemini (`gemini-3.6-flash`, free tier), with local Ollama (`qwen2:7b`) and the Claude API both kept as config-switch fallbacks — + Razorpay Test-Mode APIs (Orders, Payment Links, Webhooks) + Vercel. **Amended 2026-08-30, see `DECISIONS.md` D-3 and D-4** — the original lock here was Claude API only; empirical testing plus the $5 Anthropic minimum led first to a free local model, then to Gemini after it outperformed every Ollama model tested on correctness with no local-hardware ceiling. Deliberately architected so switching provider is a config change, not a rewrite.
- **Spend cap:** ₹500 (50000 paise). At or under → auto-approve. Over → must show explicit UI confirmation before any Razorpay order is created. A chat-text "yes" alone is never sufficient for an over-cap order.
- **Retry policy:** exactly one bounded retry per failed payment. Never auto-retry more than once.
- **Upsell policy:** exactly one upsell suggestion per order, sourced only from the catalog's `pairs_well_with` field. Never stack multiple upsells.
- **THE core architectural rule, non-negotiable:** Claude only ever *proposes* tool calls. It never talks to Razorpay directly, and its own claim that something is "confirmed" is never trusted as the sole gate. The backend orchestrator independently re-verifies the spend cap and confirmation state server-side before every money-moving action. This single rule is what makes "explainable, bounded, gated" true in code rather than just asserted in a prompt — preserve it everywhere, including in refactors.

---

## 2. Architecture (full detail in `02_ARCHITECTURE.md`)

```
Customer (chat UI, Next.js)
   → Agent Orchestrator (Next.js API route)
      → Claude API (system prompt + tool defs from 03_LLM_CONTEXT.md)
         proposes: search_catalog / propose_cart / create_order / retry_payment
      → Orchestrator independently re-checks cap + confirmation, THEN:
         → Supabase (catalog, sessions, orders, audit_log tables)
         → Razorpay Test-Mode (Orders API, Payment Links API, Webhooks)
```

Full Postgres schema (catalog, sessions, orders, audit_log tables) is in `02_ARCHITECTURE.md` §3 — use it exactly as specified, don't redesign it.
Exact Claude system prompt and tool JSON schema is in `03_LLM_CONTEXT.md` — use it as the starting point; if you need to modify it, log why in `DECISIONS.md` (see §5 below).

---

## 3. File structure to create

```
/app
  /api
    /chat            → orchestrator route: receives user message, calls Claude, executes tool calls
    /webhooks/razorpay → handles payment.captured / payment.failed
  /(chat)             → main chat UI page
  /audit              → audit trail viewer page (for the demo)
/lib
  claude.ts           → Claude API client + tool definitions from 03_LLM_CONTEXT.md
  razorpay.ts         → Razorpay client wrapper
  supabase.ts         → Supabase client
  guardrails.ts       → the cap-check / confirmation-check logic — keep this isolated and heavily commented, it's the most judge-scrutinized code in the repo
  audit.ts            → logAudit() helper, called from every decision point
/components
  ChatWindow.tsx
  CartCard.tsx
  ConfirmationGate.tsx  → the "Confirm ₹X?" UI for over-cap orders
  AuditTimeline.tsx
/supabase
  schema.sql          → exact schema from 02_ARCHITECTURE.md §3
BUILD_LOG.md           → see §4 below — update continuously
DECISIONS.md           → see §5 below — update on every non-trivial choice
PROGRESS_CHECKLIST.md  → see §6 below — check off as you go
```

---

## 4. BUILD_LOG.md — update this after every work session, no exceptions

This is not optional documentation — it's what turns "I built something" into a systematic, presentable build the judges and any future Claude Code session can follow. After any meaningful chunk of work (a feature, a bug fix, a blocked path), append an entry using the template already in `BUILD_LOG.md`. Do this before moving to the next task, not at the end of the day from memory.

---

## 5. DECISIONS.md — log every non-trivial choice here, separate from the build log

Reserve this for decisions with real alternatives (a library choice, a schema change, a deviation from `02_ARCHITECTURE.md` or `03_LLM_CONTEXT.md`, a scope cut). Use the template already in `DECISIONS.md`. Routine work (styling a button, fixing a typo) goes in `BUILD_LOG.md`, not here.

---

## 6. PROGRESS_CHECKLIST.md — the 7-day plan as checkboxes

Check items off as completed. If a day's work slips, note it in `BUILD_LOG.md` with the reason, don't just silently move the checkbox to the next day.

---

## 7. Testing

Run every scenario in `05_TEST_CASES.md` before considering a feature done, not just at the end of the week. Log pass/fail and the resulting `audit_log` rows as evidence. The gating tests (#4-6) and failure-handling tests (#10-12) matter more than the happy-path tests for judging — prioritize getting those rock-solid.

---

## 8. Definition of "winning" for this submission

Before calling this done, verify against the actual track bar, not just "does it run":

- [ ] Every cart item and every tool call has a visible, plain-language reason
- [ ] The ₹500 cap is enforced in `lib/guardrails.ts` server-side, verified by test #5 (chat-text "yes" alone must NOT bypass it)
- [ ] No `create_order` or `create_payment_link` call exists anywhere in the codebase that skips the guardrail check
- [ ] `audit_log` has a row for every action, including blocked ones (test #14) — not just successful ones
- [ ] The scripted decline → explanation → one retry → success flow works reliably, repeatably, live
- [ ] A backup demo video exists by day 6 in case live demo fails
- [ ] `04_AUDIT_TRAIL_SAMPLE.md` has been replaced with a real export before submission
- [ ] The pitch deck (`07_PITCH_DECK_OUTLINE.md`) leads with the guardrail/audit story, not just "we built a chatbot"

Do not consider scope additions (multi-merchant, voice, full autonomy) until every box above is checked and there is spare time left — see `01_PRD.md` §4 non-goals.

---

## 9. When you hit a wall

If something in the locked decisions (§1) or the existing docs genuinely doesn't work once you're in the code, don't silently work around it — log the conflict in `DECISIONS.md`, propose the alternative, and flag it clearly in your response so the founder can confirm before you proceed. Silent deviation from the locked architecture is the one thing to actively avoid, since it's what the judging bar is built around.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
