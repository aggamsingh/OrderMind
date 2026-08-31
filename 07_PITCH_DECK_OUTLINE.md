# 07 — Pitch Deck Outline

Lead with the guardrail/audit story, not "we built a chatbot" (`CLAUDE.md` §8).

1. **Title** — OrderMind: a checkout agent that's explainable, bounded, and gated by design.
2. **The problem with agentic commerce demos** — most either avoid real payment APIs, or trust the LLM's own claim that a payment was "confirmed." Neither survives a judge asking "what stops it from paying whatever it wants?"
3. **The one rule everything else follows** — Claude proposes, it never executes. The backend independently re-verifies the spend cap and confirmation state before any money moves. (Show the guardrails.ts check, not just describe it.)
4. **Live: reasoning** — cart items with stated reasons, one upsell from real catalog relationships, not a hallucinated recommendation.
5. **Live: the gate** — chat-text "yes" cannot bypass the ₹500 cap; only an explicit UI confirmation can. Show the blocked attempts logged in `/audit`.
6. **Live: failure handling** — scripted decline, plain-language explanation, exactly one bounded retry — never a silent second attempt.
7. **The audit trail** — every decision, successful or blocked, is a row in Postgres. Show `/audit` live, not a screenshot.
8. **Architecture** — one slide, the diagram from `02_ARCHITECTURE.md` §1, emphasize the arrow that does NOT exist: Claude → Razorpay directly.
9. **What's deliberately out of scope** — multi-merchant, voice, full autonomy — and why leaving them out made the guardrail story stronger, not weaker.
10. **Why this matters for Razorpay's real pilots** — the same pattern (propose/verify/gate/audit) generalizes to any agent-to-agent commerce flow, which is the actual open problem the track brief names (NPCI UAP, ACP, AP2, x402).
11. **Close** — repeat the judging bar verbatim, then: "that's not our claim about the demo, that's what the audit_log shows."
