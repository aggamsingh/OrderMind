# 07 — Pitch Deck Outline

**10 slides, ~5 minutes.** Lead with the trust problem, not the chatbot.

The single most common failure in this track will be pitching "we built a shopping agent". Do not be that. The claim is narrower and stronger: **we built the side that verifies.**

---

### 1. Title

**OrderMind — a merchant an AI buyer can safely transact with**
Razorpay AI Buildathon · Track 1
Live: ordermind-gamma.vercel.app

---

### 2. The problem (the whole pitch is here)

> Everyone is building agents that **buy**.
> Almost nobody is building the merchant that can safely **sell** to them.

When an AI buyer meets an AI seller, **neither can trust the other.**

- A runaway buyer loop drains its owner's account.
- A merchant that just takes the money is exactly the merchant nobody should let an agent loose on.
- The human behind the agent usually has no way to see what it is doing, and no way to stop it.

*Say this slowly. Everything after it is evidence.*

---

### 3. Why now

NPCI's UAP, and the protocol race — ACP, AP2, x402 — are all converging on the same primitive: a **mandate**, a bounded grant of spending authority from a human to an agent.

The protocols specify the buyer's side. Somebody has to build the merchant that **checks** it.

---

### 4. What we built

A café that sells to humans *and* to machines, through one set of rules.

|  | Human | AI buyer |
|---|---|---|
| Finds us via | a web page | `/.well-known/agent-commerce.json` |
| Proves authority | assumed, capped | **signed mandate** |
| Over the limit | clicks to approve | **refused** — nobody is there to click |
| Logged as | `customer` | `buyer_agent` |

---

### 5. Demo — a machine buys from a machine *(live, ~60s)*

Open `/agent`, run the successful scenario.

The beat to land: **the merchant upsells the machine, and the machine accepts** — but only after checking the extra item still fits inside the budget its human authorised.

Ends with a real Razorpay payment link and a **signed receipt the buyer verified** rather than taking our word for.

---

### 6. Demo — the refusal *(live, ~45s)* ← **the slide they remember**

Switch to **Tampered mandate**. The buyer rewrites its own ceiling to ₹99,999.

**Refused. Nothing charged. Reason logged.**

> "A human who gets refused reads the message and stops. Software doesn't."

Mention, don't demo, the rest: over-mandate, replayed mandate, revoked mandate, and a runaway retry loop that gets put into cool-down.

---

### 7. The human is still in charge

`/principal` — grant authority, watch what is spent against it, **take it back**.

A signed mandate is a bearer token. Without revocation you cannot withdraw authority you have granted — and **you cannot meaningfully delegate what you cannot withdraw.** Per-mandate revocation, plus a kill switch that voids everything granted before this instant, including mandates the merchant has never seen.

---

### 8. It's a market, and it makes money

Two merchants, each with its own manifest and its own limits. The agent prices the same goal at both, discards the one that would refuse it, and buys from the cheaper. When no single merchant can fulfil an order it **splits the basket**, drawing a separate mandate per merchant, all inside one approved budget.

Then the numbers, from real orders:

- **Upsell attach rate** — measured, not asserted
- **Average basket lift**
- **Refusals**, shown right beside the revenue

> "Growth you got by ignoring your own limits isn't a result worth showing."

---

### 9. Built honestly

The slide that separates you from a demo that only works once.

- **Capture is not autonomous** — Razorpay's S2S APIs are gated behind merchant approval; we called them and they 404. Our manifest **declares** the boundary so a buyer knows before committing.
- Bugs we found by testing against reality, not against our own assumptions: real webhooks revealed that Payment Links generate their own order id, which meant **every real payment would have silently failed to reconcile**.
- 28 unit assertions on the mandate and refund gates. Every decision, including refusals, in the audit trail.

> Volunteering a limit reads as confidence. Being caught by one does the opposite.

---

### 10. Close

> Every money action is explainable, bounded and gated — **on both sides.**
> The merchant checks the buyer. The buyer checks the merchant. The human can revoke either.
> And whichever way it goes, there is a receipt.

---

## Delivery notes

- **Time budget:** slides 2 and 6 deserve the most air. Slides 3, 4 and 7 can be 15 seconds each.
- **Run the pre-flight in `06_DEMO_SCRIPT.md` first** — especially the LLM chain check and the payment-link budget. Both have killed a run before.
- If the live demo dies, play the backup video and then show `/audit`. It is real data and carries the argument alone.
- Do not read slide 9 apologetically. It is a strength slide.
