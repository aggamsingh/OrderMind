# OrderMind

**A merchant that an AI buyer can safely transact with.**

Built for Razorpay's AI Buildathon, Track 1 — AI Growth & Agentic Commerce.
Live: **https://ordermind-gamma.vercel.app**

---

## The problem

Everyone is building agents that *buy*. Almost nobody is building the merchant that can safely *sell* to them.

When an AI buyer meets an AI seller, **neither can trust the other**. A runaway buyer loop drains its owner's account. A merchant that simply takes the money is exactly the merchant nobody should let an agent loose on. And a human sitting behind that agent has, in most designs, no way to see what it is doing or to stop it.

OrderMind is the side that verifies — and the guardrails are the product, not a safety feature bolted onto a chatbot.

## What it does

Two kinds of customer, one set of rules:

| | Human customer | Autonomous buyer agent |
|---|---|---|
| Entry point | chat UI → `/api/chat` | `/.well-known/agent-commerce.json` → `/api/agent/*` |
| Authority to spend | assumed, capped at ₹500 | **proven**, via a signed spend mandate |
| Over the limit | can approve it by clicking a confirmation control | **refused** — no human is present to click anything |
| Audited as | `customer` | `buyer_agent` |

Both paths re-derive every price from the database, gate every money movement server-side, and write every decision — **including refusals** — to the same audit trail.

### For an AI buyer

1. **Discovery** — one well-known URL publishes what the merchant sells and what it will refuse, so a buyer learns the limits before spending a request rather than by being rejected.
2. **Mandate** — the buyer presents a signed statement of what its human authorised: a ceiling, a purpose, an expiry, single use. The merchant verifies the signature itself; what a buyer *claims* about its own authority counts for nothing.
3. **The stricter limit binds** — an order must satisfy both the buyer's mandate and the merchant's own autonomous cap.
4. **Refusal is a feature** — overreach, a tampered ceiling, a reused mandate, a revoked mandate, or a runaway retry loop are each refused with a reason, and the reason survives in the audit trail.
5. **Reversal** — an agent can refund its own mistake, bounded by the same discipline as a charge.

### For the human behind the agent

`/principal` is the missing half of most agent-payment designs. Grant authority, watch what is spent against it, and **take it back** — per mandate, or with a kill switch that voids everything granted before this moment, including mandates the merchant has never seen. You cannot meaningfully delegate authority you have no way to withdraw.

## Try it

```bash
npx tsx scripts/buyer-agent.ts                          # a real order, end to end
npx tsx scripts/buyer-agent.ts --scenario over-mandate  # refused: exceeds its authority
npx tsx scripts/buyer-agent.ts --scenario tampered      # refused: rewrote its own ceiling
npx tsx scripts/buyer-agent.ts --scenario replay        # refused: mandate already spent
npx tsx scripts/buyer-agent.ts --scenario revoked       # refused: principal took it back
npx tsx scripts/buyer-agent.ts --scenario compare       # shops across merchants, buys cheapest
npx tsx scripts/buyer-agent.ts --scenario split         # one budget, orders at several merchants
```

The buyer agent reaches the merchant **only over public HTTP** — never the database, never a shared function. Anything it can do, any third-party agent could do.

Or open **`/agent`** to watch the same transaction stream live, and **`/audit`** to read every decision behind it.

## Stack

Next.js (App Router, TypeScript) · Supabase (Postgres, RLS) · Razorpay Test-Mode · Vercel · swappable LLM layer (Gemini by default, Ollama and Claude one env var away)

## Setup

```bash
cp .env.example .env.local     # every variable is documented in that file
npm install
# apply supabase/schema.sql, then supabase/migrations/*.sql in order
npm run dev
```

Verification, all dependency-free:

```bash
npx tsx scripts/test-guardrails.ts      # spend cap + retry logic
npx tsx scripts/test-mandates.ts        # mandates, forgery, refunds  (28 assertions)
npx tsx scripts/check-gemini-chain.ts   # LLM fallback chain healthy?
npx tsx scripts/cleanup-payment-links.ts --dry-run   # Razorpay link budget
```

## Known limits, stated plainly

Volunteered rather than buried — each one is disclosed in the code or the manifest too.

- **Capture is not autonomous.** The agent completes discovery, negotiation, mandate verification, ordering and receipting with no human; settlement happens on Razorpay's hosted page. Razorpay's S2S payment APIs were called directly against this account and both return "not found" — S2S is gated behind merchant approval. The manifest declares this as `payments.autonomy.capture: "hosted_redirect"` so a buyer knows before committing.
- **Razorpay test mode allows 30 payment links per account, ever.** Cancelling unpaid ones does not free slots. Long testing exhausts an account; `scripts/cleanup-payment-links.ts` reports usage, and the API names this case explicitly rather than reporting a generic failure.
- **Two merchants share one deployment**, one catalog table and one Razorpay account. Production would be separate hosts and accounts. Their manifests, caps, ranges, and the buyer treating them as independent counterparties are genuinely separate.
- **The principal console has no authentication.** A real deployment would put it behind the principal's login; it is omitted because it is well-understood plumbing that would demonstrate nothing new here.
- **Free-tier LLM.** 15 requests/minute per model, so the provider rotates a verified three-model chain on quota exhaustion.

## Documentation

| File | What it is |
|---|---|
| `01_PRD.md` | scope and non-goals |
| `02_ARCHITECTURE.md` | both request flows, schema, the order checks run in |
| `04_AUDIT_TRAIL_SAMPLE.md` | real exported audit rows, not illustrative ones |
| `05_TEST_CASES.md` | the test matrix and its run log |
| `06_DEMO_SCRIPT.md` | the 5-minute demo, with a pre-flight checklist |
| `BUILD_LOG.md` | day-by-day, including the bugs and what caused them |
| `DECISIONS.md` | every non-trivial choice, with the alternatives and the corrections |
