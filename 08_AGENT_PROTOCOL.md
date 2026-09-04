# 08 — Agent Commerce Protocol (v0.1)

How an autonomous buyer transacts with an OrderMind merchant.

This is written as a specification rather than a description because the point of the exercise is that **any** agent should be able to implement against it — `scripts/buyer-agent.ts` is one client, not the client. Everything below is implemented and live; nothing here is aspirational.

It borrows the *mandate* concept from the agent-payment protocols currently converging on this problem (AP2, UAP, ACP) rather than inventing new vocabulary — the point is to be one implementation of an emerging idea, not a private dialect.

---

## 1. Discovery

```http
GET /.well-known/agent-commerce.json[?merchant={id}]
```

Returns the merchant's identity, endpoints, and — the part that matters — its **terms**: the autonomous order cap, whether a mandate is required, rate limits, retry policy, and how far autonomy actually reaches.

Publishing limits up front means a well-behaved buyer can decide *before* spending a request whether this merchant can serve it. The limits are still enforced server-side regardless; the manifest is a courtesy, never the enforcement.

`GET /api/agent/merchants` lists every merchant, each linking to its own manifest. **Terms are not restated in the directory** — one authoritative statement per merchant, so a directory can never drift out of sync with the merchants it lists.

> Caps differ between merchants on purpose. A buyer that assumes one merchant's ceiling generalises will be refused by the next.

## 2. The mandate

A mandate is the buyer's proof that a human delegated bounded authority to it. Presented on every order:

```http
X-Agent-Mandate: <base64url(payload)>.<base64url(hmac-sha256)>
```

```jsonc
{
  "buyer_agent_id": "buyer-agent://procurement-bot/v1",
  "principal":      "someone@example.com",   // the human who delegated
  "max_amount_paise": 25000,                  // hard ceiling for the whole order
  "currency":       "INR",
  "purpose":        "afternoon coffee run",   // carried into the audit trail
  "issued_at":      "2026-09-01T10:00:00Z",
  "expires_at":     "2026-09-01T10:15:00Z",
  "nonce":          "uuid"                    // single use
}
```

**HMAC-SHA256 with a shared secret** is the right shape for test mode: the buyer's issuer and the merchant share a secret out of band. Production would use asymmetric signatures — the principal's wallet signs, the merchant verifies against a public key. The verify/enforce split in `lib/mandate.ts` is written so that swap is a change inside one file.

### What the merchant checks, in this order

The order is deliberate and load-bearing:

| # | Check | Failure |
|---|---|---|
| 1 | **Signature** | `403 bad_signature` |
| 2 | Revocation (per-mandate, then principal kill switch) | `403 mandate_revoked` |
| 3 | Agent standing (rate limit / cool-down) | `429 rate_limited` · `429 cooling_down` |
| 4 | Nonce not already spent | `409 replayed_nonce` |
| 5 | Prices re-derived from the merchant's own catalog | — |
| 6 | `stricter_of(buyer_mandate, merchant_cap)` | `402 blocked_exceeds_buyer_mandate` · `402 blocked_exceeds_merchant_cap` |
| 7 | Payment created | — |

**Signature first, always.** Until the HMAC verifies, every field in that payload is attacker-controlled — including the principal and nonce, which is why revocation is checked *after* it rather than before. Reading them earlier would let an unauthenticated caller probe another principal's revocation state.

**Quantities are honoured; prices are discarded.** The buyer says what it wants, never what it costs.

## 3. Ordering

```http
POST /api/agent/quote[?merchant={id}]      # preflight — nothing stored, no nonce burned
POST /api/agent/order[?merchant={id}]      # the real thing — mandate required
GET  /api/agent/order/{order_id}           # poll until terminal, signed
POST /api/agent/order/{order_id}/refund    # bounded reversal, mandate required
```

`quote` accepts an optional mandate and answers *"would you accept this?"* without consuming the mandate's single-use nonce — so a buyer never has to learn a merchant's limits by being refused.

A successful order returns a **signed receipt**. A buyer that cannot verify what it was charged cannot reconcile its spending against the authority it was granted, so the merchant's word alone is not enough.

## 4. Multi-merchant purchases

Mandates are single-use, so an order spanning *n* merchants requires *n* mandates. The binding rule:

> Each leg's mandate is capped at **exactly that leg's subtotal**, and the sum of those ceilings must not exceed the single budget the principal approved.

The agent therefore cannot inflate any one leg without that merchant refusing it, nor inflate the total without exceeding its grant. **Splitting a purchase must never become a way to spend more than was approved.**

Quote every leg before ordering any. There is no two-phase commit across independent merchants — but because authorisation and capture are separate, an abandoned leg moves no money at all. Nothing needs unwinding precisely because nothing was taken.

## 5. Revocation

A signature proves a mandate *was* issued. It says nothing about whether the human still stands behind it.

```http
POST /api/principal/revoke   { "scope": "mandate", "nonce": "..." }
POST /api/principal/revoke   { "scope": "kill", "principal": "..." }
```

- **Per-mandate** — cancel one grant. The everyday case.
- **Kill switch** — void everything granted before this instant. Time-based rather than a list, because the moment you most need it is the one where you do *not* know what your agent is holding, and a list can only revoke what the merchant has already seen. It does not lock the principal out: grants issued afterwards remain valid.

Any mandate an agent presents is recorded on first sight, so mandates minted outside the console still become individually revocable.

## 6. Autonomy boundary

Stated in the manifest under `payments.autonomy`, because a buyer deserves to know before it commits:

| Stage | Status |
|---|---|
| Discovery, negotiation, upsell decision | autonomous |
| Mandate verification, authorisation, receipt | autonomous |
| **Capture** | **`hosted_redirect`** |

Capture is not autonomous here, and the manifest says so rather than implying otherwise. Razorpay's S2S payment APIs (`payments.createPaymentJson`, `payments.createUpi`) were called directly against this test account and both return *"The requested URL was not found on the server"* — S2S is gated behind merchant approval. This is a rail limitation, not a design choice, and a buyer can poll `GET /api/agent/order/{id}` to observe settlement whenever it completes.

## 7. Auditability

Every decision — acceptances and refusals alike — is written to `audit_log` under a distinct `buyer_agent` actor and exposed at `/api/audit`.

A merchant that silently drops a refused agent order leaves the buyer's principal with no way to discover what their agent attempted. Refusals are the rows that prove the limits are real, so they are logged with at least as much care as successes.

---

**Version 0.1.** Implemented in `lib/mandate.ts`, `lib/revocation.ts`, `lib/agent-trust.ts`, `lib/guardrails.ts`, and `app/api/agent/*`. Verified by `scripts/test-mandates.ts` (28 assertions) and exercised end-to-end by `scripts/buyer-agent.ts`.

---

## 8. AP2 interoperability

The native mandate above is HMAC-signed with a shared secret. That works when the buyer's issuer and this merchant agreed one out of band, and is useless the moment a buyer this merchant has never met wants to pay — there is no secret to share.

So a second credential format is accepted, aligned with Google's [Agent Payments Protocol](https://ap2-protocol.org/ap2/payment_mandate/) Payment Mandate:

```http
X-Agent-Mandate: <compact JWS, alg=ES256>
```

```jsonc
{
  "vct": "mandate.payment.open.1",
  "transaction_id": "<single-use nonce>",
  "payee":  { "id": "chai-point-express", "name": "Chai Point Express" },
  "payment_amount": { "amount": 25000, "currency": "INR" },
  "payment_instrument": { "id": "razorpay-checkout", "type": "psp_hosted_checkout" },
  "constraints": [ { "max_amount": { "amount": 25000, "currency": "INR" }, "purpose": "..." } ],
  "sub": "principal@example.com",
  "agent_id": "buyer-agent://…",
  "iat": 1757000000,
  "exp": 1757000900
}
```

Verify it against **`/.well-known/jwks.json`** — the merchant's public P-256 key. No shared secret is required, which is the entire point.

### What is and is not implemented

Stated precisely, because a vague interop claim is worse than none:

| | |
|---|---|
| ✅ | AP2 Payment Mandate field vocabulary and `vct` values |
| ✅ | **ES256** (ECDSA P-256 + SHA-256) asymmetric signing, verifiable via published JWKS |
| ✅ | `constraints` carrying the ceiling this merchant actually enforces |
| ❌ | **SD-JWT selective disclosure.** AP2 wraps these claims in an SD-JWT with hashed disclosures so a payer can reveal some fields and withhold others. This emits a plain compact JWS with the same claims, so a strict AP2 verifier expecting `~`-separated disclosures will not accept it. |

The honest description is **"AP2-aligned, ES256-signed, selective disclosure not implemented"** — not "AP2 compliant".

### Both formats land in the same guardrails

An AP2 mandate is converted to the native `SpendMandate` shape immediately after its signature verifies, so **every** downstream check — revocation, agent standing, nonce replay, stricter-of, price re-derivation — is byte-for-byte the same code. A second credential format must never become a second, weaker path to the money.

`alg` is pinned to ES256 and never read from the token to choose a verifier — that is the classic JWT algorithm-confusion attack, and `alg: "none"` is refused outright.

Verified in `scripts/test-mandates.ts` and end to end against a live order: a valid AP2 mandate is accepted, an under-authorised one is refused `402` on amount, and one whose amount was rewritten after signing is refused `403 bad_signature`.
