# 06 — Demo Script

**Target: under 5 minutes** (the buildathon's stated pitch-video limit).

Live: **https://ordermind-gamma.vercel.app**

---

## The one-line thesis

> Everyone is building agents that *buy*. Nobody is building the merchant that can safely *sell* to them. When an AI buyer meets an AI seller, neither can trust the other — and OrderMind is the side that verifies.

Lead with this. The guardrails are not a safety feature bolted onto a chatbot; they are the product.

---

## Before you start (2 minutes, do it every time)

```bash
npx tsx scripts/check-gemini-chain.ts                 # all three models healthy?
npx tsx scripts/cleanup-payment-links.ts --dry-run    # how many links left?
curl -s -o /dev/null -w "%{http_code}\n" https://ordermind-gamma.vercel.app/agent
```

- If a model shows **DEAD**, fix the chain before demoing.
- If **every** model is rate-limited, wait ~60s.
- **If the link count is near 30, stop.** Razorpay test mode allows 30 payment links per account *ever* — cancelling unpaid ones does not free slots. Past the cap, every successful order fails at the last step. Switch to a fresh test account before you present; a demo plus a couple of dry runs can burn ten.
- Have `/audit` open in a second tab, already loaded.

**Refusal scenarios cost nothing.** Over-mandate, tampered, replayed, revoked and rate-limited all stop *before* Razorpay is called, so rehearse those freely. Only successful orders consume a link — budget those.

---

## Act 1 — A machine buys from a machine (~110s) ← *lead with this*

Open **`/agent`**. Don't explain the architecture first; run it and narrate.

1. Leave the scenario on **Successful order**. Click **Run agent-to-agent transaction**.
2. Narrate as the stream lands:
   - *"This buyer isn't a person. It found this merchant from one well-known URL — no browser, no chat window."*
   - *"It read the catalog as data and decided what to buy from a plain-language goal."*
   - **When the upsell appears:** *"Watch this — the merchant just upsold a machine. And the buyer accepted, but only after checking the extra item still fit inside the budget its human authorised."*
   - *"It presents a signed mandate: how much its human allowed, for what, until when, once only."*
3. Land the point: **real Razorpay payment link, and a signed receipt the buyer verified** rather than taking the merchant's word.

## Act 2 — The refusal (~80s) ← *the moment they remember*

Same page. Switch to **Over-mandate**. Run it.

> *"Now the buyer tries to spend more than its human authorised. Any merchant that just takes the money is exactly the merchant you should never let an agent loose on."*

Point at the red card: **refused, 402, nothing charged, reason logged.**

If you have time, hit **Tampered mandate** — the buyer rewrites its own spending ceiling to ₹99,999 and the signature check kills it. That is the one that gets an audible reaction.

> *"A human who gets refused reads the message and stops. Software doesn't. So repeated refusals put a buyer into cool-down — a merchant open to agents needs an answer to a retry loop."*

## Act 3 — The audit trail (~60s)

Click **Inspect the audit trail** from the outcome card.

- *"Every decision, colour-coded by outcome. Green allowed, amber gated, red refused."*
- Hit **Show refusals only**. *"This is the part that matters. Most systems log what worked. The refusals are the evidence the limits are real."*
- Expand one row: *"Plain language on top, the raw signed record underneath. Nothing hidden."*
- Point out the **buyer agent** actor chip: *"The trail knows the customer was a program, not a person."*

## Act 4 — It's a market, and it makes money (~50s)

Terminal:

```bash
npx tsx scripts/buyer-agent.ts --scenario compare --goal "something sweet to finish a meal" --budget 20000
```

> *"Two merchants, each with its own manifest and its own limits. The agent prices the same goal at both, throws out the one that would refuse it, and buys from the cheaper. That's a market, not a storefront."*

Then back to the home page, point at the metrics strip:

> *"65% of orders take the agent's suggestion. Average basket up 41%. And the refusals sit right next to the revenue — growth you got by ignoring your own limits isn't a result worth showing."*

## Close (~20s)

> *"Every money action is explainable, bounded, and gated — on both sides. The merchant checks the buyer. The buyer checks the merchant. And whichever way it goes, there's a receipt."*

---

## Honesty notes — say these before a judge finds them

Volunteering these reads as confidence. Being caught by them does the opposite.

- **Capture isn't autonomous.** The agent does discovery, negotiation, mandate, order and receipt with no human — settlement happens on Razorpay's hosted page. Razorpay's S2S payment APIs are gated behind merchant approval; both were called against this account and returned "not found". **The manifest declares this** (`payments.autonomy.capture: "hosted_redirect"`), so a buyer knows before it commits.
- **Two merchants share one deployment**, one catalog table, and one test Razorpay account. Production would be separate hosts and accounts. The manifests, caps, ranges and the buyer treating them as independent counterparties are genuinely separate.
- **Free-tier LLM.** Gemini allows 15 req/min per model, so the provider rotates a verified 3-model chain on quota exhaustion. Measured under 9 concurrent turns: 7 of 9 still completed.

## If it breaks live

- **Agent page stalls** → the SSE stream fell over. Reload and re-run; scenarios are idempotent.
- **"Trouble reaching the assistant"** → all three models are rate-limited. Wait 60s, or run the terminal buyer agent instead, which is more resilient.
- **Total failure** → play the backup video, then show `/audit` live. The audit trail is real data and carries the argument on its own.
