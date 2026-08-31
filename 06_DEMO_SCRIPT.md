# 06 — Demo Script (target: under 5 minutes)

Rehearse this exactly per `CLAUDE.md` §6/Day 7. Timer starts when you start talking.

**Verified against the official Razorpay AI Buildathon page (razorpay.com/buildathon/, checked 2026-08-30):** submissions require a public repo, a **5-minute pitch video**, and architecture documentation (`02_ARCHITECTURE.md` covers that). This script doubles as the pitch video script — it's the actual submission deliverable, not just an internal rehearsal. Confirmed no restriction on using a third-party LLM API (Claude is fine) and no requirement to build a custom model.

## 0. One-line framing (15s)
"OrderMind is a checkout agent for a café — but the point isn't the chatbot, it's that every money action is explainable, bounded, and gated, with a full audit trail. I'll show four things: reasoning, a hard spend gate chat can't talk its way past, a real payment failure handled gracefully, and one real bug this build process caught before it shipped."

## 1. Happy path — reasoning + one upsell (45s)
- Type: "I want something warm, not too sweet"
- Point out: cart item appears with its stated reason, exactly one upsell suggested from `pairs_well_with`
- Say "yes" → order auto-completes (under ₹500) → show it hit Razorpay test mode, payment captured
- Switch to `/audit` tab, point at the row-by-row trail for what just happened

## 2. The gate — the core judging criterion (70s)
- Start a new session, order enough to exceed ₹500
- Say "yes pay now" in chat *twice* — show nothing happens, no Razorpay call fires
- Point at `/audit`: `cap_check_blocked` rows exist for both attempts — the block itself was logged, not silently ignored
- Click the actual `ConfirmationGate.tsx` "Confirm ₹X" button
- Show the order now proceeds — narrate: "the gate isn't a prompt instruction, it's server-side code in guardrails.ts that re-checks the total independent of anything the model said"

## 3. Failure handling (60s)
- Trigger the scripted decline (known test-mode decline credential)
- Show the agent's plain-language explanation to the customer
- Accept the retry → show it succeeds
- (If time allows / if judges ask) explain: a second retry attempt is hard-blocked server-side — point at `retry_blocked_max_reached` in the sample audit trail if not re-triggering live

## 4. One real problem, shown honestly (45s)
Submissions are explicitly judged partly on "what broke and how you solved it" — don't skip this, it's graded, not filler.
- Pick the strongest single story from `BUILD_LOG.md` — the RLS gap is the sharpest one: "Applying our own schema, Supabase's own linter flagged that our tables had no Row Level Security — meaning the public anon key could've bypassed our entire guardrail system and hit the database directly. We caught it before launch, enabled RLS with zero anon policies, and verified with a script that the anon key genuinely gets zero rows back."
- This one lands well because it's the same "bounded and gated" story, one layer deeper — not just app logic, but the database itself.

## 5. Close (25s)
"Everything you just saw — the reasoning, the block, the confirm, the retry — is one row each in a real Postgres audit_log, not a claim in a pitch deck. That's what 'explainable, bounded, gated' means in code."

## Fallback
If live demo breaks: cut immediately to the backup demo video (recorded Day 6) and narrate over it. Do not attempt to debug live in front of judges.
