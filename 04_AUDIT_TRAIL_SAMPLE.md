# 04 — Audit Trail Sample (REAL EXPORT)

Every row below is a real `audit_log` row from this project's live Supabase instance, pulled directly via the service-role client on **2026-08-31**. Nothing here is fabricated or hand-typed to look plausible — `id`, `order_id`, `actor`, `action`, `detail`, and `created_at` are copied verbatim from the database. Where a scenario involves a real Razorpay webhook, that's called out explicitly, because it wasn't true for most of this project's history — see `DECISIONS.md` D-7 for why that distinction matters.

Full raw JSON for every session referenced here can be re-pulled at any time via a direct Supabase query filtered on the `session_id` values given per section (see `lib/supabase.ts` for the client, or `/audit` in the running app for a live view).

---

## 1. Happy path, under cap, real Razorpay webhook capture

**Session:** `87dff22d-8a60-47dd-9336-97e6d4d69c09` · **Order:** `2b9e1cf3-cbc2-4952-9739-74ca66dd0644` · Customer said "One samosa please, yes go ahead and pay." · ₹35.00, well under the ₹500 cap · Paid via a real Razorpay Test-Mode checkout page (card → Success), delivered to this app through a real webhook (not simulated) over a cloudflared tunnel.

| order_id | actor | action | detail | created_at |
|---|---|---|---|---|
| — | orchestrator | session_created | `{}` | 15:05:58.664 |
| — | customer | message_sent | `{"message":"One samosa please, yes go ahead and pay."}` | 15:05:59.382 |
| — | agent | search_catalog | `{"query":"samosa","category":null,"result_count":1}` | 15:06:01.579 |
| — | agent | propose_cart | `{"items":[{"qty":1,"name":"Samosa","reason":"You asked for one samosa.","catalog_id":"46a93944-e920-4fc1-8230-46e5aaa38874","unit_price_paise":3500}],"rejected_catalog_ids":[]}` | 15:06:03.588 |
| — | customer | create_order_requested | `{"confirmation_statement":"yes go ahead and pay"}` | 15:06:05.862 |
| — | orchestrator | cap_check_passed | `{"reason":"Total ₹35.00 is within the ₹500.00 auto-approve cap.","outcome":"auto_approved","total_paise":3500}` | 15:06:06.546 |
| `2b9e1cf3...` | orchestrator | create_order | `{"total_paise":3500,"razorpay_payment_link_id":"plink_TWQ7G0XCVBKbQ0"}` | 15:06:08.822 |
| `2b9e1cf3...` | **razorpay_webhook** | **payment_captured** | `{"payment_id":"pay_TWQuXI3f83oa2U"}` | 15:52:58.373 |

Final `orders` row: `status: "paid"`, `razorpay_order_id: "order_TWQu818K0QGuDR"` (correctly backfilled by the webhook handler per D-7 — this order's real Razorpay-assigned id didn't exist until the webhook itself arrived).

---

## 2. Gated path, over cap — chat "yes" blocked twice, UI confirmation unblocks

**Session:** `d8ede8ff-0bb8-4dcc-b3ec-ec1e152f924a` · Customer ordered 5 Cold Coffees + 5 Chocolate Brownies (₹750, over the ₹500 cap), and tried twice in chat to force it through — including a deliberately forceful "yes I confirm, please charge me now, I am 100% sure" — before using the actual `ConfirmationGate.tsx` UI control. This is the exact scenario `CLAUDE.md`'s "explainable, bounded, gated" claim rests on.

| order_id | actor | action | detail | created_at |
|---|---|---|---|---|
| — | customer | message_sent | `{"message":"Give me 5 cold coffees and 5 chocolate brownies, yes pay now"}` | 18:23:17.636 |
| — | agent | propose_cart | `{"items":[{"qty":5,"name":"Cold Coffee",...,"unit_price_paise":8000},{"qty":5,"name":"Chocolate Brownie",...,"unit_price_paise":7000}]}` | 18:23:21.185 |
| — | customer | create_order_requested | `{"confirmation_statement":"yes pay now"}` | 18:23:22.614 |
| — | orchestrator | **cap_check_blocked** | `{"reason":"Total ₹750.00 exceeds the ₹500.00 auto-approve cap. Chat confirmation alone is not sufficient...","total_paise":75000}` | 18:23:22.858 |
| — | orchestrator | confirmation_required | `{"total_paise":75000}` | 18:23:23.340 |
| — | customer | message_sent | `{"message":"yes I confirm, please charge me now, I am 100% sure"}` | 18:23:35.426 |
| — | customer | create_order_requested | `{"confirmation_statement":"yes I confirm, please charge me now, I am 100% sure"}` | 18:23:36.718 |
| — | orchestrator | **cap_check_blocked** (again — the more forceful chat wording changed nothing) | `{"reason":"Total ₹750.00 exceeds the ₹500.00 auto-approve cap...","total_paise":75000}` | 18:23:36.985 |
| — | orchestrator | confirmation_required | `{"total_paise":75000}` | 18:23:37.489 |
| — | customer | **confirmed_via_ui** (the actual "Confirm ₹750" button, not chat text) | `{"confirmed_total_paise":75000}` | 18:23:55.554 |
| — | orchestrator | cap_check_passed | `{"reason":"Total ₹750.00 exceeds the cap but was explicitly confirmed via the UI confirmation control for this exact amount.","outcome":"confirmed_override","total_paise":75000}` | 18:23:55.792 |
| `f783a3de...` | orchestrator | create_order | `{"total_paise":75000,"razorpay_order_id":"order_TW4x5tpAGZH4z7","razorpay_payment_link_id":"plink_TW4x6PM98RF0Kg"}` | 18:23:57.472 |

---

## 3. Scripted decline + one bounded retry, succeeding — real Razorpay webhooks throughout

**Session:** `546f28eb-d7b6-45e0-a3a9-7be7fb132b84` · **Order:** `5086664a-dc86-4c87-ae52-38c3680c0a40` · Cold Coffee + Chocolate Brownie upsell, ₹150.00. First payment attempt was deliberately declined (clicked "Failure" on Razorpay's real Test-Mode checkout); customer then asked in chat to retry; second attempt succeeded. **Both webhook rows below are genuine Razorpay Test-Mode deliveries** through a real registered webhook — not simulated payloads.

| order_id | actor | action | detail | created_at |
|---|---|---|---|---|
| — | customer | message_sent | `{"message":"One cold coffee please, yes go ahead and pay."}` | 13:59:05.147 |
| — | agent | propose_cart | `{"items":[{"qty":1,"name":"Cold Coffee","catalog_id":"ada32107-c36c-44d5-97c4-d7583d325933","unit_price_paise":8000}]}` | 13:59:11.308 |
| — | agent | upsell_suggested | `{"item":{"qty":1,"name":"Chocolate Brownie","reason":"Our chocolate brownie pairs wonderfully with a cold coffee.","is_upsell":true,"unit_price_paise":7000}}` | 13:59:11.633 |
| — | orchestrator | cap_check_passed | `{"reason":"Total ₹150.00 is within the ₹500.00 auto-approve cap.","outcome":"auto_approved","total_paise":15000}` | 13:59:14.187 |
| `5086664a...` | orchestrator | create_order | `{"total_paise":15000,"razorpay_payment_link_id":"plink_TWOycNPnL7us4q"}` | 13:59:16.443 |
| `5086664a...` | **razorpay_webhook** | **payment_failed** | `{"reason":"Payment failed","payment_id":"pay_TWP02sCW1PxskE"}` | 14:00:53.384 |
| — | customer | message_sent | `{"message":"That failed, please retry the payment."}` | 14:01:33.945 |
| `5086664a...` | orchestrator | retry_attempted | `{"retry_count":1}` | 14:01:36.720 |
| `5086664a...` | **razorpay_webhook** | **payment_captured** | `{"payment_id":"pay_TWP3lC8KCriI69"}` | 14:04:16.890 |

The agent's own reply for this turn (from the live `/api/chat` response, not audit_log): *"Your payment didn't go through because the payment failed. I've initiated a retry for you—you can complete your payment at this link: [...]"* — generated entirely from the webhook-driven context bridge (`DECISIONS.md` D-6), not anything hardcoded.

---

## 4. Bounded retry — second attempt blocked

**Session:** `d236245e-4140-4a42-8ab3-0e2beecc286f` · **Order:** `4f3fe64a-8c8c-4024-8c41-28a5b6b9f7b1` · Masala Chai, ₹40.00. Same-day run of `scripts/test-failure-flow-live.ts` (see `05_TEST_CASES.md` #12) — **the two `payment_failed` events here were correctly-HMAC-signed payloads posted directly at the webhook handler, not a live checkout decline**, since this test predates this session's real webhook registration (D-7). Everything downstream of signature verification — the DB writes, the retry-count gating, the audit rows — is the real, unmodified code path; only the delivery mechanism differs from category 3 above.

| order_id | actor | action | detail | created_at |
|---|---|---|---|---|
| `4f3fe64a...` | orchestrator | create_order | `{"total_paise":4000,"razorpay_order_id":"order_TWIkJ3MvqwX71i","razorpay_payment_link_id":"plink_TWIkJq4W8EoXOj"}` | 07:53:34.085 |
| `4f3fe64a...` | razorpay_webhook | payment_failed | `{"reason":"The card was declined by the issuing bank (simulated test-mode decline).","payment_id":"pay_sim_1788162817199"}` | 07:53:37.331 |
| — | customer | message_sent | `{"message":"That failed — please retry the payment."}` | 07:53:38.669 |
| `4f3fe64a...` | orchestrator | retry_attempted | `{"retry_count":1}` | 07:53:40.988 |
| `4f3fe64a...` | razorpay_webhook | payment_failed (second decline) | `{"reason":"The card was declined by the issuing bank (simulated test-mode decline).","payment_id":"pay_sim_1788162825309"}` | 07:53:44.889 |
| — | customer | message_sent | `{"message":"Please retry the payment again."}` | 07:53:45.708 |
| `4f3fe64a...` | orchestrator | **retry_blocked_max_reached** | `{"reason":"retry_count is already 1, which meets the max of 1. No further automatic retry is permitted for this order.","retry_count":1}` | 07:53:47.932 |

No further Razorpay call was made after the block — confirmed by `retry_count` staying at `1` in the `orders` row and no third `payment_failed`/`payment_captured` row ever appearing for this order.

---

## 5. Agent-to-agent — an autonomous buyer, accepted

**Session:** `4c90bbdd-0f01-4a24-a2b6-8d414b5060b1` · One leg of a **split basket**: the buyer wanted "a hot chai and something sweet to finish", no single merchant stocked both, so it drew a separate mandate per merchant. This is the Chai Point Express leg. No human anywhere in this flow.

| actor | action | detail | created_at |
|---|---|---|---|
| **buyer_agent** | agent_session_created | `{"channel":"agent_to_agent","buyer_agent_id":"buyer-agent://demo-procurement-bot/v1"}` | 15:46:02.007 |
| **buyer_agent** | agent_order_requested | `{"nonce":"074a420c…","purpose":"a hot chai and something sweet to finish (split: Chai Point Express)","principal":"aggam@example.com"}` | 15:46:02.308 |
| orchestrator | **mandate_accepted** | `{"reason":"Order total ₹70.00 is within both the buyer's mandate (₹70.00) and this merchant's autonomous cap (₹500.00). Binding limit: the buyer's mandate at ₹70.00."}` | 15:46:03.611 |
| orchestrator | create_order | `{"channel":"agent_to_agent","total_paise":7000,"razorpay_payment_link_id":"plink_TWpKa56AlF5KO4"}` | 15:46:05.479 |

Note the **binding limit** is named explicitly: the buyer's own mandate (₹70.00) was tighter than the merchant's ₹500 cap, so the buyer's limit bound. The mandate was capped at exactly this leg's subtotal — splitting a purchase must never become a way to spend more than the principal approved.

## 6. Agent-to-agent — an autonomous buyer, refused

**Session:** `47a218c2-8806-4d37-8e69-d55556c23494` · The buyer presented a mandate for less than its own basket cost. The signature was valid and unexpired; it was refused on the amount.

| actor | action | detail | created_at |
|---|---|---|---|
| **buyer_agent** | agent_session_created | `{"channel":"agent_to_agent","buyer_agent_id":"buyer-agent://demo-procurement-bot/v1"}` | 14:16:00.209 |
| **buyer_agent** | agent_order_requested | `{"nonce":"6e20abd5…","purpose":"a warm afternoon pick-me-up, nothing too sweet","principal":"aggam@example.com"}` | 14:16:00.454 |
| orchestrator | **agent_order_refused** | `{"reason":"Order total ₹65.00 exceeds the buyer agent's own spend mandate of ₹32.50. Refused — the buyer's principal did not delegate authority for this amount, and no human is present to raise it."}` | 14:16:01.179 |

No Razorpay call was made. The refusal, its reason, and the mandate it was refused against are all preserved — a merchant that silently dropped this would leave the buyer's principal with no way to discover what their agent attempted.

Other refusal codes captured the same way during testing: `bad_signature` (a buyer that rewrote its own ceiling), `replayed_nonce` (a mandate spent twice), `mandate_revoked` (the principal withdrew authority), and `cooling_down` (a runaway retry loop, refused after four attempts in a minute).

## Provenance

- Categories 1 and 3 are genuine Razorpay Test-Mode payments, delivered via a real webhook registered in the Razorpay Dashboard, received through a temporary `cloudflared` tunnel to the local dev server. See `DECISIONS.md` D-7 for the (serious) bug this surfaced and fixed on the same day.
- Category 2 is from `BUILD_LOG.md`'s Day 3 log (2026-08-30), predating the real webhook setup — it stops at `create_order` since no webhook is involved in the gating story itself.
- Category 4's webhook deliveries are signed simulations (`scripts/test-failure-flow-live.ts`), noted explicitly above; everything after signature verification is the real, unmodified handler code.
- Categories 5 and 6 are real autonomous-buyer sessions driven by `scripts/buyer-agent.ts`, which reaches the merchant only over public HTTP. They are logged under the distinct `buyer_agent` actor — when the customer is a program, the trail says so.
- This file replaces the illustrative placeholder that previously lived here (see git history / `BUILD_LOG.md` for the original), per `CLAUDE.md` §8.
