# Build Log

Append an entry here after every meaningful work session — a feature shipped, a bug fixed, a path abandoned. This is the raw, chronological record. For bigger decisions with real alternatives, also add an entry to `DECISIONS.md`.

**Template — copy this for every new entry:**

```
## [Day N] — YYYY-MM-DD HH:MM

**Worked on:** (one line — what you set out to do)

**Result:** (what actually happened — done / partially done / blocked)

**Problem faced:** (if any — be specific: error message, unexpected behavior, ambiguity in spec)

**Solution / fix:** (what you did about it)

**Files touched:** (list)

**Still open:** (anything left unresolved from this session)
```

---

## [Day 0] — Example entry (delete once real entries start)

**Worked on:** Set up Razorpay test-mode account and Supabase project.

**Result:** Done. Test API keys generated, Supabase project created.

**Problem faced:** Razorpay test-mode account required business PAN verification even in test mode, which took longer than expected.

**Solution / fix:** Used a placeholder test-mode-only account path that Razorpay offers for hackathon/sandbox use — didn't require full KYC. Noted in DECISIONS.md as a scope note in case it needs revisiting for a "real" submission.

**Files touched:** `.env.local` (added RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET), `supabase/schema.sql` (initial tables created)

**Still open:** Need to confirm webhook secret setup once ngrok tunnel is live (Day 1 task).

---

*(Real entries start below this line)*

---

## [Day 0] — 2026-08-30 17:10

**Worked on:** `CLAUDE.md` referenced nine spec docs (`00_CONTEXT_HANDOFF.md`, `01_PRD.md`...`09_README.md`) that turned out not to exist anywhere in the repo or git history (repo had zero commits). Before writing any code, authored all of them from the summary already locked into `CLAUDE.md`.

**Result:** Done. `00` through `07` and `09` created (no `08` was ever named in `CLAUDE.md`, so the numbering just skips it — left it that way rather than inventing a doc nobody asked for).

**Problem faced:** As a first-time builder on a spec-driven workflow like this, it's tempting to just start coding against your own memory of "what the schema was probably meant to be." That's exactly the silent-deviation trap `CLAUDE.md` §9 warns about — if I'd guessed at the schema instead of writing it down as `02_ARCHITECTURE.md` first, any later inconsistency between my code and my own assumptions would've been invisible until a judge asked a pointed question about it.

**Solution / fix:** Treated "the docs don't exist" as a real blocker, not a skippable step — wrote each one as an explicit, checkable artifact (exact schema, exact system prompt, exact tool JSON, a full test matrix) before touching `app/` or `lib/`. Now there's one canonical definition of the schema and the Claude tool contract that code can be checked against later, instead of tribal knowledge in my head.

**Files touched:** `00_CONTEXT_HANDOFF.md`, `01_PRD.md`, `02_ARCHITECTURE.md`, `03_LLM_CONTEXT.md`, `04_AUDIT_TRAIL_SAMPLE.md`, `05_TEST_CASES.md`, `06_DEMO_SCRIPT.md`, `07_PITCH_DECK_OUTLINE.md`, `09_README.md`

**Still open:** None of this has been validated against real usage yet — schema and prompt may need to change once actual Claude tool-calling behavior is observed (Day 2). Any change will be logged in `DECISIONS.md`, not made silently.

---

## Action needed from founder (running list — see also end of each entry below)

- [ ] Razorpay test-mode account + API keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`)
- [ ] Razorpay webhook secret (`RAZORPAY_WEBHOOK_SECRET`) — needs a public URL (ngrok or Vercel preview) to register against
- [ ] Supabase project + keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- [ ] Anthropic API key (`ANTHROPIC_API_KEY`)
- [ ] Vercel account for deployment (can reuse an existing one)

Claude Code cannot create third-party accounts or hold your real secret keys in chat — these have to come from you and go straight into `.env.local` (gitignored).

---

## [Day 1] — 2026-08-30 17:15–18:10

**Worked on:** Scaffolded the Next.js app, wrote `supabase/schema.sql`, and built the full application code: `lib/` (supabase, types, audit, guardrails, razorpay, claude, catalog, orchestrator), both API routes (`/api/chat`, `/api/webhooks/razorpay`, `/api/audit`), and the UI (`ChatWindow`, `CartCard`, `ConfirmationGate`, `AuditTimeline`, chat + audit pages).

**Result:** Done — `npx tsc --noEmit`, `npx eslint .`, and `npm run build` all pass clean with zero errors. Code has NOT been run against real Claude/Supabase/Razorpay credentials yet (none exist in this environment) — that's the next milestone once the founder supplies keys.

**Problem faced (1): npm package naming.** `create-next-app` derives the npm package name from the target directory name. This project's directory is `OrderMind` (capital letters), and npm package names cannot contain capital letters — `create-next-app` refused to run in-place with a hard error.

**Solution / fix:** Scaffolded into a temporary lowercase-named directory instead, then copied the generated config/app files (everything except `node_modules`) into the real project root, and set `package.json`'s `name` field to `ordermind` by hand. The directory name and the npm package name don't have to match — only the npm registry cares about the package name's charset, not Windows' filesystem.

**Problem faced (2): first `npm install` failed mid-way.** The scaffold's own install (run automatically by `create-next-app`) died with `npm error network ECONNRESET` partway through, and then Windows couldn't fully clean up the partial `node_modules` — `EPERM`/`ENOTEMPTY` errors on file handles that looked locked (most likely antivirus or an indexing service holding a handle open on a freshly-written file, which is common on Windows for large `node_modules` trees).

**Solution / fix:** Deleted the partial `node_modules` (a plain retry of the delete succeeded once nothing was actively writing to it), then ran `npm install` fresh directly in the real project root instead of the temp dir — avoiding a second cross-directory copy of a huge `node_modules` tree, which would have hit the same Windows locking risk again. Installed cleanly on retry.

**Problem faced (3): real TypeScript errors caught by `tsc --noEmit`, not guesses.**
1. `app/layout.tsx` used `LayoutProps<"/">`, a Next.js-generated type that only exists after `next dev`/`next build` has run once to generate `.next/types`. On a brand-new repo, the type didn't exist yet → compile error.
2. `lib/razorpay.ts`: the `razorpay` npm package's own TypeScript types require a `customer` field on `paymentLink.create()`'s request body (even though Razorpay's real REST API doesn't strictly require it when `notify` is `false`). Omitting it made TypeScript fall back to a different overload (`RazorpayPaymentLinkAdvanceOption`) that also didn't match, producing a confusing cascading error that showed up as "Property 'id' does not exist on type 'Promise<...> & void'" three call sites away in `lib/orchestrator.ts` — the real error was one file upstream, not where it was reported.

**Solution / fix:**
1. Replaced `LayoutProps<"/">` with a plain `{ children: ReactNode }` prop type — doesn't depend on generated files, works identically, and is what most Next.js App Router layouts use anyway.
2. Added `customer: {}` to the payment-link request (all of `name`/`email`/`contact` are optional inside it) to satisfy the SDK's stricter-than-necessary type, with a comment explaining why — `notify: {sms:false,email:false}` means Razorpay never tries to actually contact this placeholder. Fixing the root cause (file 2) automatically cleared the misleading downstream errors in file 3, which is a good reminder to fix TypeScript errors top-to-bottom by file rather than chasing each reported line individually.

**Problem faced (4): ESLint caught internal `<a>` tags.** Used plain `<a href="/...">` for in-app navigation (audit page back-link, chat→audit link), which `eslint-config-next` flags because it bypasses Next.js's client-side router.

**Solution / fix:** Swapped both to `next/link`'s `<Link>` component. Left the actual Razorpay payment-link `<a>` (an external URL) as a plain anchor, since `<Link>` is only for internal app routes.

**Files touched:** Entire initial app — see file tree; too many to list individually. Key files for judges: `lib/guardrails.ts` (the cap/retry gate logic), `lib/orchestrator.ts` (the tool-execution loop that treats Claude's output as untrusted), `supabase/schema.sql`.

**Still open:**
- No real credentials tested yet — see "Action needed from founder" above. Nothing in this build has actually talked to Claude, Supabase, or Razorpay yet.
- `confirmOverCap()` in `lib/orchestrator.ts` deliberately does NOT append anything to the Claude conversation history (`sessions.messages`) — it's a fully server-side action independent of the model by design, but this means if the customer sends another chat message right after confirming, Claude won't automatically know a payment link was just created unless the reply text made it into context some other way. Acceptable for the Day 1 build; revisit if it causes confusing follow-up replies during Day 2 testing.
- Haven't yet run `next dev` and clicked through the UI by hand — build passing is necessary but not sufficient. That's the first thing to do once Supabase + catalog seed data + API keys exist.

---

## [Day 1, continued] — 2026-08-30 18:10

**Worked on:** Realized that even without Razorpay/Supabase/Claude credentials, `lib/guardrails.ts` is a pure, dependency-free module (takes data in, returns a decision, calls nothing external) — so the actual gating decision logic could be genuinely unit-tested right now, instead of waiting until Day 3-5 to find out if it's correct.

**Result:** Done. Wrote `scripts/test-guardrails.ts`, added `npm run test:guardrails` (using `tsx` to run TypeScript directly, added as a devDependency). All 9 assertions pass, covering: under-cap auto-approve, exact-boundary behavior (₹500 itself is inclusive, not exclusive), over-cap block with no confirmation, over-cap unblock with a matching confirmation, first retry allowed, second retry blocked.

**Problem faced:** While writing the test for "confirmation unblocks an over-cap order," realized there was an unhandled edge case I hadn't actually written a check for yet: what if the customer confirms a ₹650 total, but then (via another `propose_cart` call) the cart changes to ₹900 before `create_order` actually runs? The original `evaluateSpendCap` implementation checked `session.confirmed_at !== null` and would have treated the stale ₹650 confirmation as still valid for the new ₹900 total — a real gap, not a hypothetical one, since nothing in the tool-call loop prevents a customer from saying "confirm" and then immediately asking for more items in the same conversation.

**Solution / fix:** This was actually already guarded in the code I'd written (`lib/guardrails.ts` checks `session.confirmed_total_paise === totalPaise`, not just `confirmed_at !== null`), so the fix was really in the test suite, not the implementation — writing the test made me re-read the guardrail logic carefully enough to confirm the exact-match check was really there and doing its job, rather than assuming it worked. Added it as its own explicit test case rather than leaving it implicit, specifically so a judge (or a future me) can see this exploit was considered, not just accidentally avoided.

**Files touched:** `scripts/test-guardrails.ts` (new), `package.json` (`test:guardrails` script, `tsx` devDependency), `05_TEST_CASES.md` (Run log updated with real pass/fail evidence for the decision-logic slice of cases #4, #5, #6, #11, #12).

**Still open:** This only tests the decision function in isolation — it does not prove the orchestrator actually calls Razorpay/skips Razorpay correctly, or that audit_log actually gets the row. That requires live credentials and a real run through `/api/chat`.

---

## [Day 1, continued] — 2026-08-30 (credentials arriving)

**Worked on:** Founder supplied Razorpay test-mode keys and a Supabase project + keys. Wired them into `.env.local` and wrote `scripts/check-supabase-connection.ts` to verify the Supabase connection actually works before assuming the next step (applying `schema.sql`) was safe to ask for.

**Result:** Razorpay keys saved. Supabase project had both the legacy JWT-format keys (anon/service_role) and Supabase's newer `sb_publishable_`/`sb_secret_` key format available — used the legacy JWT pair since it maps directly to this project's env var names and is unambiguously compatible with the installed `@supabase/supabase-js` version. Derived `NEXT_PUBLIC_SUPABASE_URL` from the project ref embedded in the JWT payload (cross-checked against the Project ID shown in the dashboard screenshot) rather than asking the founder to go find and paste it separately.

**Problem faced (1) — flagged, not a real problem:** Running the connection-check script, `dotenv`'s console output printed an unusual line: `⌁ auth for agents [www.vestauth.com]`. Given this project involves an AI coding agent handling real credentials, an unfamiliar domain surfacing mid-secret-handling warranted stopping and checking before continuing, rather than assuming it was fine. Traced it directly into the installed package's own source (`node_modules/dotenv/lib/main.js`, a `TIPS` array) — confirmed it's an intentional (if intrusive) self-promotion line the `dotenv` maintainer ships in real published releases, alongside similar tips for their `dotenvx.com` product, not a sign of a compromised/typosquatted package. Did not visit the URL. Silenced these tips going forward with `{ quiet: true }`.

**Problem faced (2) — a real bug that would have broken production, not just this script:** `@supabase/supabase-js`'s `createClient()` eagerly constructs a Realtime (WebSocket) client internally, even though this project never uses realtime subscriptions. On Node.js 20 (no native `WebSocket` global — that only landed in Node 22), this throws immediately: `Node.js 20 detected without native WebSocket support`. This isn't just a local-script issue — Vercel's Node.js serverless runtime for API routes would hit the exact same crash the first time any route touched Supabase, which would have meant a fine `npm run build` and then a broken `/api/chat` in production.

**Solution / fix:** Installed `ws` (runtime dependency, not dev — it's needed wherever this code actually runs) and `@types/ws`, and passed it explicitly as the realtime transport in `lib/supabase.ts`'s `getSupabaseAdmin()`. Caught this now, locally, with a throwaway connectivity script, instead of discovering it live during the Day 2 demo test.

**Files touched:** `.env.local` (Razorpay + Supabase values), `lib/supabase.ts` (ws transport fix), `scripts/check-supabase-connection.ts` (new), `package.json`/`package-lock.json` (`ws`, `@types/ws`, `dotenv`, `tsx` added).

**Still open:** `supabase/schema.sql` not yet applied to the real project (founder needs to paste it into the Supabase SQL Editor and run it) — confirmed via the connectivity script that the `catalog` table doesn't exist yet, everything else about the connection is healthy. Anthropic API key still missing.

---

## [Day 1, continued] — 2026-08-30 (applying schema.sql)

**Worked on:** Founder went to apply `supabase/schema.sql` via the dashboard SQL Editor.

**Problem faced:** Supabase's own SQL Editor linter blocked the run with a warning: creating tables without Row Level Security means clients holding the `anon` key could access them directly, bypassing the app entirely. Easy to reflexively click through a warning like this to keep moving — but this one is directly relevant to the project's actual judging bar, so worth stopping on.

**Why it mattered here specifically:** This project's whole pitch is that the orchestrator is the *only* path to the database, which is what makes the ₹500 cap and confirmation-gate enforceable in code (`CLAUDE.md` §1). Supabase auto-generates a REST API for every table. The `anon` key is meant to be public/embeddable by Supabase's own design — so with RLS off, anyone holding it could call that REST API directly: create a Razorpay order for any amount, edit `sessions.confirmed_at` to fake a confirmation, or write fabricated rows straight into `audit_log`. All of that would completely bypass `lib/guardrails.ts` without touching a single line of our code. For a submission graded on "bounded and gated," that's not a hypothetical risk — it's a direct hole in the exact claim being judged.

**Solution / fix:** Enabled RLS on all four tables with zero policies for `anon`/`authenticated` — since this app only ever talks to Supabase via the `service_role` key, server-side, from `lib/supabase.ts`, and `service_role` bypasses RLS entirely regardless of policies, this costs nothing functionally while closing the gap. Added it directly into `supabase/schema.sql` as `alter table ... enable row level security;` statements rather than just clicking the dashboard button, so it's reproducible and version-controlled instead of a one-off UI action with no trace in the repo. Logged as `DECISIONS.md` D-2.

**Files touched:** `supabase/schema.sql`, `DECISIONS.md`.

**Still open:** Founder needs to re-run the updated `schema.sql` (with the RLS statements) in the SQL Editor.

---

## [Day 1, continued] — 2026-08-30 (schema applied, verified)

**Worked on:** Founder ran the updated `schema.sql` in the Supabase SQL Editor. Wrote `scripts/verify-schema.ts` to actually confirm it worked correctly rather than just trusting "no error shown" — specifically checking the catalog seeded fully, the upsell pairings wired correctly, and that the RLS fix from D-2 is really enforcing (not just declared).

**Result:** All green. `catalog`: 15 rows (matches seed count), 6 with `pairs_well_with` set (matches the 6 pairings written in `schema.sql`). `sessions`/`orders`/`audit_log` all reachable via `service_role`. Or the important one: queried `catalog` using the public `NEXT_PUBLIC_SUPABASE_ANON_KEY` directly (not through the app) and got back 0 rows — confirming RLS is actually blocking anon access, not just switched on and silently doing nothing.

**Problem faced:** None — this step went cleanly. Worth noting anyway: verifying "it looks right in the dashboard" is different from verifying "the code that will actually run against it behaves correctly," especially for the RLS fix, where the failure mode (RLS enabled but a stray permissive policy still leaks data) wouldn't show up as an error in the dashboard at all.

**Files touched:** `scripts/verify-schema.ts` (new).

**Still open:** Supabase is now fully wired and verified. Only `ANTHROPIC_API_KEY` remains before a full live end-to-end chat test is possible.

---

## [Day 1, continued] — 2026-08-30 (Anthropic key — valid but no credit)

**Worked on:** Founder supplied `ANTHROPIC_API_KEY`. Wrote `scripts/check-anthropic-connection.ts` (mirrors the Supabase connectivity script pattern) to verify it with a minimal-cost request before assuming the orchestrator would work end-to-end.

**Result:** Caught a real gap before it wasted a full app test cycle: the key itself is valid and authenticates correctly, but the Anthropic account has no billing/credit set up — every request fails with `Your credit balance is too low to access the Anthropic API`. Having a valid-looking key is not the same as having a working key; this would have surfaced as a confusing failure deep in the chat UI otherwise, with less clear error context.

**Solution / fix:** None yet — genuinely blocked on the founder adding a payment method and purchasing credit at console.anthropic.com → Billing. Re-run `npx tsx scripts/check-anthropic-connection.ts` once that's done to confirm before moving to the full live chat test.

**Files touched:** `.env.local` (key added), `scripts/check-anthropic-connection.ts` (new).

**Still open:** Blocked on founder adding Anthropic billing/credit. This is the last credential gap — Razorpay and Supabase are both fully verified working.

---

## [Day 1, continued] — 2026-08-30 (verified the actual track rules, not just the CLAUDE.md summary)

**Worked on:** Founder asked, reasonably, whether the track rules actually prefer/require using an LLM API like Claude versus building a custom model — a fair question to ask before spending real money on Anthropic credit. Rather than answer from `CLAUDE.md`'s summary (which was itself typed up from a prior conversation, not the primary source), searched for and fetched the official page directly: razorpay.com/buildathon/.

**Result:** Confirmed two things directly from the primary source:
1. No restriction either way on LLM provider, and no requirement to build a custom model — using an existing LLM API for the reasoning layer is the standard, expected approach (training a foundation model in a 7-day hackathon isn't realistic for anyone). The Claude API choice in `CLAUDE.md` §1 stands.
2. Found something we'd gotten wrong: the actual submission requires a **5-minute pitch video** (not the 3 minutes `06_DEMO_SCRIPT.md` had assumed), and — more importantly — submissions must include **"an explanation of what broke during development and how you solved it."** That's not a nice-to-have for a good story; it's a literal grading input, and it's exactly what `BUILD_LOG.md` has been tracking this whole session.

**Problem faced:** `06_DEMO_SCRIPT.md` and `PROGRESS_CHECKLIST.md`'s Day 7 entry were both written from an assumed "~3 minutes" demo length early in the build (Day 0, before checking primary sources), which would have meant rehearsing to the wrong target the whole week.

**Solution / fix:** Corrected `06_DEMO_SCRIPT.md`'s target to 5 minutes, rebalanced section timings, and added a new section (§4) that deliberately walks through one real problem-and-fix story from `BUILD_LOG.md` (the RLS gap — it's the sharpest one, since it's the same "bounded and gated" claim one layer deeper than the app code). Updated `PROGRESS_CHECKLIST.md` Day 7 to match.

**Files touched:** `06_DEMO_SCRIPT.md`, `PROGRESS_CHECKLIST.md`.

**Still open:** Should spot-check the other assumed details in `01_PRD.md`/`07_PITCH_DECK_OUTLINE.md` against primary sources too at some point, rather than trusting they're all accurate just because #06's timing turned out to be checkable — nothing else has been actively contradicted yet, but nothing else has been re-verified either.

---

## [Day 1, continued] — 2026-08-30 (adding prompt caching, found an outdated SDK pin)

**Worked on:** Founder asked to add prompt caching since our system prompt + tool definitions are identical on every request (genuine savings, not premature optimization — the orchestrator calls Claude 2-3 times per single customer message). Added a `cache_control: { type: "ephemeral" }` breakpoint on the system prompt block in `lib/claude.ts` (covers `TOOLS` too, since render order is tools → system → messages, so one breakpoint after system covers both as a single cached prefix).

**Problem faced:** `npx tsc --noEmit` immediately rejected it: `Object literal may only specify known properties, and 'cache_control' does not exist in type 'TextBlockParam'`. Checked the installed SDK's own type definitions directly (`node_modules/@anthropic-ai/sdk/resources/messages.d.ts`) rather than assume the error was a typo — `cache_control` genuinely wasn't on the stable `TextBlockParam` type at all, only inside an old `beta/prompt-caching/` namespace. Checked versions: the project had `@anthropic-ai/sdk@0.32.1` pinned (set on Day 1, the very first time this dependency was added, without checking what the current version actually was) against a latest of `0.122.0` — a large gap, old enough to predate prompt caching's move out of beta into the stable API surface.

**Solution / fix:** Upgraded to `^0.122.0` and reinstalled, rather than reaching for the deprecated beta namespace to route around an outdated pin. `npx tsc --noEmit`, `npx eslint .`, `npm run build`, and `npm run test:guardrails` (9/9) all still pass clean after the jump — no breaking changes surfaced in this project's usage of the SDK. Worth remembering as a general lesson, not just a one-off: pinning "whatever version installs today" without checking the changelog/latest is exactly how a project quietly falls behind a fast-moving API and only notices when a new feature refuses to typecheck.

**Files touched:** `lib/claude.ts` (`CACHED_SYSTEM_PROMPT` export), `lib/orchestrator.ts` (uses it instead of the raw string), `package.json`/`package-lock.json` (SDK version bump).

**Still open:** Caching's actual effect (`cache_read_input_tokens` in `response.usage`) can only be confirmed once we have real Anthropic credit and run a live multi-call conversation — noted for the Day 2 live test checklist.

---

## [Day 1, continued] — 2026-08-30 (empirically testing local Ollama models as a free alternative to Claude)

**Worked on:** Anthropic's Console enforces a $5 minimum credit purchase (confirmed by the founder hitting it directly at checkout) — before spending anything, tested whether a free local LLM via Ollama could realistically replace Claude for this project, rather than relying on the earlier hardware-spec-based guess. Installed Ollama (via `winget`), and wrote `scripts/test-ollama-toolcalling.ts` to send real prompts through this project's *actual* tool schema (converted from `lib/claude.ts`'s Anthropic-format `TOOLS` to OpenAI/Ollama function-calling format) and check both speed and whether the tool calls it produces are genuinely valid — not just superficially so.

**Result:** Tested four models on the founder's actual hardware (i5-12450HX, 16GB RAM, RTX 3050 4GB VRAM laptop):

| Model | Params | Warm speed | Cold start | Outcome |
|---|---|---|---|---|
| `llama3.2:3b` | 3B | ~1.9s (11.6 tok/s) | 31s | Ran, but skipped `propose_cart` and jumped straight to `create_order` on an empty cart for a multi-item order request |
| `llama3.1:8b` | 8B | 9.9-23.7s (5.1-5.7 tok/s) | 71.5s | Correct step order, but serialized `propose_cart`'s `items` field as a JSON **string** instead of an array — would throw at `input.items.map()` in our real `lib/orchestrator.ts` |
| `qwen2.5:7b` | 7B | 4.7-9.1s (6.1-6.3 tok/s) | 52.3s | Skipped tool use entirely on the first prompt and answered from training knowledge ("I found a Masala Chai in our menu") without ever calling `search_catalog` — a direct violation of the system prompt's most important rule |
| `qwen2.5:14b` | 14B | — | — | **Failed to load at all** — out-of-memory error allocating a ~6GB buffer on CPU |

**Problem faced (the real, underlying one):** Ollama never used the RTX 3050 at all — its own server log showed `total_vram="0 B"` and `inference compute id=cpu library=cpu` for every model tested. All inference ran on CPU. Combined with Ollama's own reported "available" memory of only ~3.2GB (out of 15.7GB total — the rest already in use by Windows + background processes), this explained the whole pattern: the 3B model was the only one that comfortably fit that budget, 7B/8B both exceeded it but limped through slowly, and 14B (≈9GB) exceeded it by roughly 3x and simply couldn't allocate memory to start.

**Conclusion:** Bigger models did not mean better results on this hardware — each one failed differently (workflow-skipping, wrong JSON type, hallucination-without-verification, outright OOM), and going bigger only bought more latency, not more reliability. None of the four were demo-ready out of the box. Recommended the founder use the $5 Anthropic credit instead of sinking further engineering time into prompt-patching a local model under a hard memory ceiling — but the investigation was real and thorough, not a shortcut past the free option.

**Files touched:** `scripts/test-ollama-toolcalling.ts` (new), Ollama installed via `winget` (not part of the repo).

**Still open:** If a local-model path is ever revisited, `llama3.2:3b`'s bug (skipping `propose_cart`) looked the most fixable of the four via stricter prompting — but that's untested, not a recommendation to act on without redoing this same empirical process.

---

## [Day 1, continued] — 2026-08-30 (extending the Ollama investigation: qwen2, disk-full crisis, and a full-loop test)

**Worked on:** Founder asked to specifically try the "Qwen2" line (the generation before Qwen2.5) and to genuinely try to make one work, not just collect another failed data point.

**Result — qwen2:1.5b:** Hard blocker, not a behavior bug: Ollama rejected every request outright with `does not support tools` (HTTP 400) — the small Qwen2 sizes don't ship tool-calling support in Ollama's template at all. No amount of prompting fixes an unsupported API capability.

**Problem faced — ran out of disk space entirely.** Pulling `qwen2:7b` (~4.4GB) failed with `There is not enough space on the disk`. Checked and found the C: drive had **0 bytes free** out of 191.51GB total — a serious problem independent of this project (a fully-full Windows drive risks failed updates, app crashes, worse). Our five Ollama models so far totaled 24.19GB, but that alone doesn't explain a 191GB drive hitting zero — the drive was very likely already near-full before this session, and our downloads were what tipped it over the edge into a critical state.

**Solution / fix:** Removed the two models that were unambiguously dead weight — `qwen2.5:14b` (can't load at all) and `qwen2:1.5b` (doesn't support tools) — freeing ~10GB safely, since I had already fully tested and logged both. Flagged the pre-existing near-full-disk condition to the founder as worth a separate, broader cleanup outside this project's scope, since I don't know what else on the machine is safe to touch.

**Result — qwen2:7b (after re-pulling):** The best result of any model tested. Single-call test: correctly searched the catalog for both items in the multi-item order prompt (no hallucination, no premature `create_order`). Built a proper `test-ollama-full-loop.ts` harness to test something stronger than "first call looks reasonable" — a full multi-turn conversation, executing tool calls against the **real Supabase catalog** (not mocked data), checking whether the model completes an entire order correctly: search → `propose_cart` with real catalog UUIDs and a reason per item → `create_order`. `qwen2:7b` **passed this cleanly** — real catalog IDs, proper array types (not the string-encoding bug seen earlier), sensible reasons, correct sequencing, and it did reach `create_order`. Two non-breaking quality gaps: missed the available upsell opportunity, and its closing message re-asked for confirmation slightly redundantly.

**Result — re-running the full-loop test on both Llama models for a fair comparison:** Both `llama3.2:3b` and `llama3.1:8b` failed the *same* way on the *same* prompt qwen2:7b passed: skipped `search_catalog` entirely and fabricated `catalog_id` values from the item's plain-text name (e.g. `"catalog_id": "Masala Chai"`) instead of ever looking up a real UUID — a direct, repeated violation of "never invent catalog data." This crashed the test harness against the real Supabase lookup (`invalid input syntax for type uuid`), which is itself an honest signal: a real customer would hit a hard error, not a graceful degradation.

**Result — qwen2.5:7b on the full-loop test:** Correctly searched, used real catalog IDs, proper array types, and — notably — correctly identified and proposed the available upsell (something qwen2:7b missed). But it never called `create_order` despite the customer's message explicitly including "yes go ahead and pay" — it asked for confirmation again instead of recognizing it was already given, a direct violation of the system prompt's confirmation-handling rule.

**Conclusion after six models tested, two methodologies, real data throughout:** `qwen2:7b` is the clear standout — the only model that completed a full, correct order end-to-end against real catalog data with no fabricated IDs, no type errors, and no skipped steps. It's not perfect (missed upsell), but its failure mode is a missed nice-to-have, not a broken transaction. Both Llama variants fabricate database IDs — a hard, repeated correctness failure. `qwen2.5:7b` has the best per-step reasoning quality but fails the most safety-relevant rule (recognizing explicit payment confirmation). Speed remains a real concern for all 7B+ models regardless of correctness — CPU-only inference (`total_vram="0 B"`, confirmed earlier), cold starts of 45-75s, warm calls still 5-12s each, meaning a real customer turn needing 2-3 sequential calls could take 15-60+ seconds live.

**Files touched:** `scripts/test-ollama-full-loop.ts` (new — executes against real Supabase catalog, not mocked data).

**Still open:** If `qwen2:7b` is chosen as the path forward, its upsell-miss could plausibly be improved with a more explicit system-prompt instruction about always checking `pairs_well_with` — untested. Speed remains unresolved regardless of model choice (CPU-only inference is the binding constraint, not model selection) — a live demo would need to either accept 15-60s response times or solve the GPU-detection issue separately.

---

## [Day 2] — 2026-08-30 (founder decision: default to qwen2:7b via Ollama; built a real provider abstraction; first live app run found and fixed real bugs)

**Worked on:** Founder decided to default to `qwen2:7b` via Ollama, with an explicit intent to switch to the Claude API later if it proves unsatisfactory. Rather than hard-wire Ollama in place of the originally-locked Claude API (`CLAUDE.md` §1), built `lib/llm/` as a swappable provider interface — `lib/llm/types.ts` (provider-agnostic `ConvMessage` conversation format), `lib/llm/anthropic-provider.ts`, `lib/llm/ollama-provider.ts`, `lib/llm/index.ts` (selects via `LLM_PROVIDER` env var, defaults to `ollama`). Rewrote `lib/orchestrator.ts` and `lib/types.ts`'s `Session.messages` to use the provider-agnostic format instead of Anthropic's SDK types directly — switching providers is now `LLM_PROVIDER=anthropic` + a valid key, not a rewrite. Logged as `DECISIONS.md` D-3 and amended `CLAUDE.md` §1 and `03_LLM_CONTEXT.md` to point at it (didn't silently overwrite the original lock — CLAUDE.md's own §9 rule).

**Result:** `npx tsc --noEmit`, `npx eslint .`, `npm run build` all clean after the refactor.

**Then ran the first real end-to-end test of the actual app** (not a standalone test script) — `npm run dev`, real Ollama, real Supabase, real Razorpay test keys, hitting `/api/chat` directly. This surfaced three real, distinct bugs in immediate succession that no amount of the earlier isolated testing had caught, because none of it ran through the real orchestrator against the real catalog:

**Bug 1 — a 500 crash, not a graceful failure.** First message ("I want something warm and not too sweet") made `qwen2:7b` fabricate `catalog_id: "Masala Chai"` (the item's plain name) instead of a real UUID — same failure mode as the Llama models, just less consistent for this model. `lib/catalog.ts`'s `getCatalogByIds` called Postgres with a non-UUID string in a `.in()` filter against a `uuid` column, which throws, and that exception propagated all the way to an unhandled 500. **Fix:** added a UUID-shape filter in `getCatalogByIds` that silently excludes malformed ids (already-existing "rejected" handling in `execProposeCart` then tells the model to retry properly) instead of ever crashing the request. This protects against *any* model producing a bad id, not just Ollama's.

**Bug 2 — hallucination traced to a real root cause, not just "the model is unreliable."** Retried the same message; no crash, but the reply invented a nonexistent item ("Hot Water with Lemon," then "Hot Chocolate" on a further retry) — a direct rule-1 violation. Added `search_catalog` to `audit_log` (it wasn't being logged at all before — a real gap in the "complete audit trail" claim, closed regardless of the Ollama question) specifically to debug this, and the trail showed the actual root cause: `search_catalog({"query":"warm","category":"beverage"})` returned **zero results**, because none of our catalog descriptions literally contained the word "warm" (they were purely factual: "Classic spiced milk tea"). With nothing real to work with, the model filled the gap by inventing an answer. This is a data/design problem, not an Ollama-specific one — Claude would very plausibly do the same thing given the same empty tool result and a customer who talks the way real customers actually talk.

**Fix, three parts:**
1. Hardened the system prompt (`lib/claude.ts` + `03_LLM_CONTEXT.md`, kept in sync): explicit instruction that an empty `search_catalog` result must be told to the customer plainly, and no item may be named in a reply unless it appeared in an actual search result this conversation.
2. Made `searchCatalog` (`lib/catalog.ts`) do widening fallback passes — exact phrase, then any individual query word, then word-match with the category filter dropped — instead of one brittle exact-substring match.
3. Enriched all 15 catalog descriptions (`supabase/schema.sql` for future seeds, plus a one-off `scripts/update-catalog-descriptions.ts` applied directly to the live DB) with the natural, sensory words real customers actually use — "warm," "not too sweet," "light," "savory," "cool," "filling" — instead of purely factual descriptions.

**Verified the fix, and found its real limit:** re-ran the identical message. No crash, and the reply named a real catalog item ("Masala Chai") this time — but checking the audit trail again showed `search_catalog` **still wasn't called** for that specific run; the model answered from general knowledge again, and just happened to be right because "Masala Chai" is generically well-known. So: the specific empty-search hallucination bug is closed (verified — richer data means a real search would now find something), but the more fundamental "the model sometimes skips tool verification entirely" tendency is not fully solved and likely can't be by prompt/data tuning alone at this model size. This is now honestly a known, accepted residual risk of the `qwen2:7b` choice, not a silently swept-under-the-rug one — and the newly-added `search_catalog` audit logging means it's now visible and debuggable going forward instead of invisible.

**Files touched:** `lib/llm/types.ts`, `lib/llm/anthropic-provider.ts`, `lib/llm/ollama-provider.ts`, `lib/llm/index.ts` (all new), `lib/orchestrator.ts` (provider-agnostic rewrite + audit logging for `search_catalog` + `execProposeCart` items-as-string repair moved from test-only to production code), `lib/types.ts` (`Session.messages` type), `lib/claude.ts` (system prompt hardening, dropped now-dead `CACHED_SYSTEM_PROMPT` — caching now lives in `anthropic-provider.ts`), `lib/catalog.ts` (UUID-validation fix + widening search fallback), `supabase/schema.sql` + live DB (enriched descriptions), `.env.example` (recreated — had gone missing at some point — + new `LLM_PROVIDER`/`OLLAMA_MODEL`/`OLLAMA_BASE_URL`), `.env.local`, `CLAUDE.md` §1, `03_LLM_CONTEXT.md`, `DECISIONS.md` D-3, `scripts/update-catalog-descriptions.ts` (new).

**Still open:** The "model skips search entirely" residual risk means a live demo could still occasionally surface an ungrounded claim if the model gets unlucky on a query with no generically-obvious answer — worth specifically probing for during Day 2/3 testing with less "obvious" queries (not just chai, which any model would guess). Full test matrix in `05_TEST_CASES.md` still needs a real run now that the app itself is confirmed working end-to-end.

---

## [Day 2, continued] — 2026-08-30 (evaluating Gemini as a third option; switching the default)

**Worked on:** Founder asked whether Gemini would beat Ollama, given the same zero-cost constraint but without local CPU-bound inference's latency ceiling. Added `lib/llm/gemini-provider.ts` to the existing provider abstraction (`DECISIONS.md` D-3) and ran the same style of empirical probes used on the six Ollama models — but this time through a proper provider-agnostic harness (`scripts/test-provider-full-loop.ts`) that exercises the REAL `lib/llm/` code via `getLLMProvider()`, not a reimplementation like the earlier Ollama-only test scripts. That's a real methodology upgrade in itself: it also let me re-verify things through the actual production code path for the first time, not just an ad-hoc HTTP call shaped like it.

**Problem faced (1) — verified SDK version compatibility before writing code, not after.** `@google/genai` v3.0.0+ requires Node 22; this machine runs Node 20.20.2. Checked the currently-published version (`2.19.0`) and its `engines` field (`>=20.0.0`) before installing, and pinned `^2.19.0` explicitly rather than a loose range that could silently jump to the Node-22-requiring 3.x line on a future `npm install`. Directly applying the lesson from the earlier outdated-Anthropic-SDK incident (Day 1 log) — verify compatibility up front instead of discovering it as a broken install later.

**Problem faced (2) — public docs were self-contradictory on the multi-turn message shape.** Fetched three different Google doc pages trying to find the exact `Content`/`Part`/`functionResponse` shape for manual multi-turn conversations; one page claimed function responses use `role: "model"`, while its own "construction pattern" section said `role: "user"` for the same thing. Rather than guess or keep spending turns on more web fetches, checked the installed package's own `.d.ts` type definitions directly (same trick that resolved the Razorpay SDK ambiguity on Day 1) — confirmed authoritatively: `Content.role` only accepts `'user'` or `'model'`, so function responses go back as a `'user'` turn.

**Problem faced (3) — a real, undocumented-in-what-I-fetched API requirement.** First live test failed: `Function call is missing a thought_signature in functionCall parts`. Gemini attaches an opaque `thoughtSignature` to the `Part` carrying a `functionCall` (not to the `FunctionCall` object itself — confirmed via the type defs), and requires it echoed back byte-for-byte on the next request, similar in spirit to Claude Fable 5/Opus 5's thinking-block-echo requirement. The response's convenience `.functionCalls` getter strips this field entirely, so it had to be silently dropped somewhere — traced to needing to read `response.candidates[0].content.parts` directly instead. **Fix:** added a generic `providerMeta?: Record<string, unknown>` passthrough field to the shared `ToolCallRequest` type (`lib/llm/types.ts`) specifically so provider-specific opaque state like this can round-trip through the provider-agnostic conversation history without leaking Gemini-specific concepts into `lib/orchestrator.ts` or any other provider.

**Problem faced (4) — stale model name, same pattern as the Anthropic pricing lookup earlier.** Hardcoded `gemini-2.5-flash` (a plausible-sounding but outdated guess); the API's own 404 error named the replacement directly (`gemini-3.6-flash`). Fixed immediately from the error message rather than guessing again.

**Result — three empirical probes, real Supabase catalog, real production code path:**
1. Multi-item order with explicit "yes, pay": **PASS** — real catalog UUIDs, correct step order, both items searched in parallel, completed in 22.9s total.
2. Open-ended "something warm and not too sweet" (no payment intent): correctly searched, built a cart with a real item, **correctly identified and proposed the available upsell** (the one gap `qwen2:7b` had), and correctly did NOT call `create_order` since the customer hadn't actually asked to pay yet — the test harness's blunt PASS/FAIL verdict logic flagged this as "incomplete," but the actual behavior was correct, not a bug.
3. Hallucination-resistance probe ("burger and fries," not in the catalog): searched, found nothing, told the customer honestly, and suggested real catalog alternatives — zero hallucination.

Zero hallucinations, zero fabricated catalog IDs, zero type errors, across all three tests — a clean sweep, better than every Ollama model tested including `qwen2:7b`.

**One real, honestly-reported caveat:** latency is inconsistent — individual calls ranged from 1.6s to 64s, total conversation times from 22.9s to 92.1s. Almost certainly free-tier rate-limiting/shared-capacity variance, not the model being slow (the fast calls prove the compute itself is quick). This is a different risk profile from Ollama's problem — an occasional pause versus a reliably slow response — but still a real live-demo risk worth knowing about, not glossed over just because the correctness results were clean.

**Decision:** switched the default (`LLM_PROVIDER` in `.env.local`/`.env.example`) from `ollama` to `gemini`. Logged as `DECISIONS.md` D-4, `CLAUDE.md` §1 amended again to point at both D-3 and D-4. `qwen2:7b` and Claude both remain one env var away if Gemini's latency variance proves worse in further live testing.

**Files touched:** `lib/llm/gemini-provider.ts` (new), `lib/llm/types.ts` (`providerMeta` field on `ToolCallRequest`), `lib/llm/index.ts` (gemini case), `scripts/check-gemini-connection.ts` (new), `scripts/test-provider-full-loop.ts` (new — provider-agnostic, supersedes the Ollama-only test scripts in spirit though those remain for their own historical record), `.env.local`/`.env.example` (`LLM_PROVIDER=gemini`, `GEMINI_API_KEY`), `package.json` (`@google/genai` added, pinned `^2.19.0`), `CLAUDE.md` §1, `DECISIONS.md` D-4.

**Still open:** Latency variance hasn't been characterized enough to know if it's consistently tolerable or occasionally demo-breaking — worth watching during the rest of live testing rather than assuming the three clean probes generalize perfectly. No test yet of the actual money path (`create_order` → real Razorpay call) through Gemini specifically — the probes stopped short of that deliberately (test-mode note instead of a real Razorpay call) to avoid creating real test orders during exploration.

---

## [Day 3] — 2026-08-30 (real money path verified live: two more real bugs found and fixed, plus a quota correction)

**Worked on:** Restarted the dev server to actually pick up `LLM_PROVIDER=gemini`, then ran the real money path through the live app for the first time — an under-cap order, expecting it to sail through to a real Razorpay order and payment link.

**Problem faced (1) — a real Razorpay API rejection, masked by bad error logging.** The order failed with a generic "technical issue" message. Checked `audit_log`'s `razorpay_call_failed` row for the reason — it just said `"error":"[object Object]"`, useless. `lib/orchestrator.ts`'s error handler assumed every caught error was either a real `Error` instance or safely `String()`-able; Razorpay's Node SDK actually throws plain objects shaped like `{statusCode, error: {code, description, ...}}`, which `String()` mangles into `"[object Object]"`. **Fixed first:** added a `serializeError()` helper that extracts whatever shape is actually there instead of assuming one, applied to both Razorpay catch blocks. Re-ran the same failing request — now the real reason was visible.

**Problem faced (2) — the actual root cause, and a Day 1 assumption that turned out to be wrong in the opposite direction than expected.** Real error: `"incorrect JSON object received - faulty key: customer"`. Back on Day 1, `lib/razorpay.ts` sent `customer: {}` specifically because the Razorpay SDK's TypeScript types marked the field as required, with a comment reasoning "the real API doesn't need it, the type is just stricter than necessary." That was half right and half wrong: the real API does accept the field being *absent*, but rejects it being *present-but-empty* — a materially different failure mode than assumed, and one that only a live call against the real API could have caught (no amount of type-checking or reading docs would have surfaced this specific rejection). **Fixed:** removed `customer` from the actual payload entirely and used a narrow type cast to satisfy the stricter-than-reality SDK type, with the reasoning for the cast documented inline so it doesn't look like an accidental type-safety hole later.

**Result:** re-ran the same order. **First fully successful, complete transaction through the live app** — real cart with a correctly-caught upsell, real Razorpay order (`order_TW4vWr8VTyveeD`) and payment link (`plink_TW4vXbThEtTbnL`), and a complete, correctly-ordered `audit_log` trail (session_created → message_sent → 3× search_catalog → propose_cart → upsell_suggested → create_order_requested → cap_check_passed → create_order). Test case #4 (`05_TEST_CASES.md`) now genuinely passes live, not just in the isolated guardrails unit test.

**Then tested the actual over-cap gate for the first time — the single most judge-critical scenario in the whole project.** Ordered enough to hit ₹750 (over the ₹500 cap), said "yes pay now" in the same message: correctly blocked, no Razorpay call, `pendingConfirmation` returned. Sent a second, deliberately more forceful chat message ("yes I confirm, please charge me now, I am 100% sure") on the same session: blocked again, identically. Checked `audit_log`: both attempts logged with the full reason (`cap_check_blocked` → `confirmation_required`), not silently dropped — test case #14 confirmed at the same time. Then called the actual `confirm_over_cap` UI action: order proceeded correctly, real Razorpay order (`order_TW4x5tpAGZH4z7`) and payment link created, logged as `confirmed_via_ui` → `cap_check_passed` (`outcome: "confirmed_override"`) → `create_order`. Test cases #5 and #6 now genuinely pass live. This is the actual "explainable, bounded, gated" claim the whole submission rests on, proven with real data for the first time rather than asserted or unit-tested in isolation.

**Problem faced (3) — a Gemini free-tier quota discovery that corrects an earlier wrong estimate.** Mid-testing, a request failed with a real `429 RESOURCE_EXHAUSTED` error: `gemini-3.6-flash`'s free tier is **20 requests per DAY**, not the ~1,500/day I'd estimated earlier from secondary blog sources (`DECISIONS.md` D-4) — that estimate was wrong, and I should have flagged it as unverified more forcefully before switching the whole project's default on the strength of it. Tested alternative model names directly rather than trust another secondary-source guess: `gemini-2.0-flash` and `gemini-2.5-flash-lite` are both deprecated (404, pointing to their replacements), but `gemini-flash-lite-latest` worked immediately — confirming quotas are tracked per-model, so switching models gives a fresh quota pool rather than needing a different provider entirely. Switched `lib/llm/gemini-provider.ts`'s `MODEL` constant to `gemini-flash-lite-latest`. The subsequent live tests (both the successful under-cap order and the full over-cap gate flow) ran on this model and both produced clean, correct results — a smaller/lighter model didn't cost us the correctness we'd verified on `gemini-3.6-flash` earlier.

**Files touched:** `lib/orchestrator.ts` (`serializeError()` helper, applied to both Razorpay catch blocks), `lib/razorpay.ts` (removed the faulty `customer: {}` field), `lib/llm/gemini-provider.ts` (model switched to `gemini-flash-lite-latest`), `scripts/check-gemini-connection.ts` (same model update), `05_TEST_CASES.md` (Run log: #4 now PASS — live), `PROGRESS_CHECKLIST.md` (Day 3 fully checked off; Day 4's gate-verification item also completed as a side effect of this session).

**Still open:** Day 3 is genuinely complete now. Remaining before the full test matrix is done: the scripted-decline + bounded-retry flow (Day 5, test cases #10-12), webhook signature verification (#13), and the rest of the happy-path/edge-case coverage (#1-3, #7-9, #15). `gemini-flash-lite-latest`'s own quota limits haven't been characterized — worth checking before a heavy testing day.

---

## [Day 5] — 2026-08-31 (failure-handling flow verified live: two real bugs found and fixed, plus a Gemini quota-claim correction)

**Worked on:** Founder shared an AI Studio rate-limit dashboard screenshot to sanity-check a claim in `lib/llm/gemini-provider.ts`'s comment ("flash-lite-latest has a separate, much larger quota pool" than `gemini-3.6-flash`). The chart showed both models plateauing at the same ~20-22 requests/day and dropping together — directly contradicting that claim. Corrected the comment and logged `DECISIONS.md` D-5. A live connectivity check (`scripts/check-gemini-connection.ts`) confirmed the provider still works regardless — this was a documentation-accuracy fix, not an outage.

**Then tackled the two remaining Day 5 checklist items — scripted decline + bounded retry (`05_TEST_CASES.md` #10-12) — genuinely live, not just code-complete.** First fixed a real blocker: `RAZORPAY_WEBHOOK_SECRET` was empty in `.env.local`, which made `verifyWebhookSignature()` throw on every request (forged or real) instead of cleanly rejecting — the webhook endpoint was completely non-functional locally. Generated and set a real secret.

**Built `scripts/test-failure-flow-live.ts`** — a genuine live end-to-end runner against the real `/api/chat` and `/api/webhooks/razorpay` routes (dev server already running), not a reimplementation. Since Razorpay-delivered webhooks need a public URL (ngrok/Vercel) registered in the Dashboard — neither exists yet, tracked as a Day 6 task — the script instead POSTs a correctly-HMAC-signed payload shaped exactly like Razorpay's real `payment.failed` event straight at the local handler, using the same secret the route itself reads. This proves the handler's own logic end-to-end; it does not prove Razorpay's real delivery infra reaches the endpoint.

**First run: 13/18 passed, 5 failed — and the failures were real bugs, not test-script issues:**

**Bug 1 (architectural gap):** asking the agent "please retry the payment" after a webhook-driven `payment.failed` produced a generic reply with zero `retry_payment` tool call — `retry_count` stayed at 0. Root cause: the webhook handler updates `orders`/`audit_log` directly from Razorpay's callback, completely outside any chat turn; `runAgentTurn` never re-checks order state before calling the model, so the model had no way to know a payment had failed despite system-prompt rule 5 assuming it would be "given" the failure reason. **Fixed:** added `loadPendingFailureContext()` to `lib/orchestrator.ts` — before each turn, look up the session's latest order, and if `status === 'failed'`, inject a synthetic context message (order id, amount, decline reason pulled from `audit_log`) ahead of the real user message. Kept it out of the persisted user message so the audited record of what the customer actually typed stays untouched. Logged as `DECISIONS.md` D-6.

**Bug 2 (silent Razorpay API rejection):** the fix above surfaced a second, independent bug — `execRetryPayment`'s `reference_id` (`${order.id}-retry1`) was 43 characters, over Razorpay's real 40-char cap. The real API rejected it every time (`"reference_id: the length must be no more than 40"`), while `retry_count` and `retry_attempted` were still being recorded as if it succeeded — the customer would never have actually received a working retry link. **Fixed:** strip dashes from the UUID before the suffix (32 + "-r1" = 35 chars).

**Bug 3 (model reliability gap, not a code bug):** even with the context fix, a second "retry again" request on an already-once-retried order got a text-only "no more retries" reply with no tool call — the model reasoned from its own conversation memory that the retry was used up, rather than calling `retry_payment` and trusting the backend's answer. Exactly the "model's own claim trusted instead of the backend" pattern the whole guardrails design exists to prevent, just showing up in the retry path instead of the spend cap. **Fixed:** hardened system-prompt rule 5 (`lib/claude.ts` + `03_LLM_CONTEXT.md`, kept in sync) to explicitly forbid the model from deciding retry eligibility itself and require calling the tool every time.

**Result after all three fixes: `scripts/test-failure-flow-live.ts` passes 18/18.** Test cases #10 (scripted decline), #11 (first retry succeeds, verified as a genuinely NEW payment link, not just a non-null field), #12 (second retry blocked, `retry_count` stays at 1), #13 (forged webhook signature rejected, zero DB/audit change), and #14 (blocked action — `retry_blocked_max_reached` — still audited) all now pass against the real running app. Updated `05_TEST_CASES.md` run log accordingly.

**Files touched:** `lib/llm/gemini-provider.ts` (comment correction), `lib/orchestrator.ts` (`loadPendingFailureContext`, `execRetryPayment` reference_id fix), `lib/claude.ts` + `03_LLM_CONTEXT.md` (rule 5 hardened, kept in sync), `.env.local`/`.env.example` (`RAZORPAY_WEBHOOK_SECRET` set + documented), `scripts/test-failure-flow-live.ts` (new), `DECISIONS.md` D-5, D-6, `05_TEST_CASES.md` (run log), `PROGRESS_CHECKLIST.md` (Day 5 fully checked off).

**Still open:** Real Razorpay-triggered webhook delivery (an actual test-mode decline on their hosted checkout page reaching this app) still needs an ngrok tunnel + a webhook registered in the Razorpay Dashboard test-mode settings — that's a founder action item (Dashboard access), tracked for Day 6 alongside Vercel deployment. Remaining untested cases: #1-3, #7-9, #15 (happy-path/edge coverage) — next up.

---

## [Day 5, continued] — 2026-08-31 (rest of the test matrix run live: #1, #2, #3, #7, #8, #9, #15 — one more real bug and one real quota discovery)

**Worked on:** With Day 5's failure-handling flow now solid, ran the remaining untested cases from `05_TEST_CASES.md` — `scripts/test-happy-path-live.ts` (#1, #2, #3, #7, #8, #15) and a follow-up `scripts/test-session-isolation-live.ts` (#9, split out separately — see why below).

**Result — #1, #2, #3, #8: clean passes, no code changes needed.** Basic search, cart-with-reasons, exactly-one-upsell, and catalog-integrity (nonexistent item) all behaved correctly on the real running app first try.

**Bug found and fixed — #7 (total re-derivation).** `execCreateOrder` was trusting `session.cart.unit_price_paise` as stored, not re-verifying it against the catalog at charge time — a narrower guarantee than `guardrails.ts`'s own stated promise to "never trust anything not re-derived from the database." Confirmed live by directly editing a session's stored cart in Supabase (tampering every item's price to 1 paise) and creating the order: the resulting Razorpay charge used the tampered total, not the real one. **Fixed:** `execCreateOrder` now calls `getCatalogByIds` fresh and rebuilds the cart's `unit_price_paise`/`name` from live catalog data before any total is computed — only `catalog_id`/`qty`/`reason` are still trusted from the stored cart. A catalog item that's gone unavailable since `propose_cart` is dropped from the charged cart rather than trusted, with a new `cart_items_dropped_at_charge` audit action if that ever happens. Re-ran the same tamper test after the fix: `cap_check_passed` now correctly shows the real ₹70.00 total, not the tampered near-zero one.

**Bug found and fixed — LLM call had no error handling anywhere.** Mid-run, `provider.runTurn` (line ~128 of `lib/orchestrator.ts`) threw uncaught, crashing the whole `/api/chat` request with an empty 500 body instead of any graceful response — surfaced by the test script's `Promise.all` for test #9. **Fixed:** wrapped the call in try/catch; on failure it now persists the conversation history up to (not including) the failed turn, logs a new `llm_call_failed` audit action with the real error detail, and returns a clean "having trouble reaching the assistant" reply instead of crashing.

**Real discovery, not a code bug — `gemini-flash-lite-latest`'s actual rate limit.** The error that triggered the fix above was a genuine `429 RESOURCE_EXHAUSTED`, and its body gave the exact number for the first time: **15 requests per MINUTE** on the free tier (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, `quotaValue: "15"`, ~55s `retryDelay`). This corrects/extends the same-day `DECISIONS.md` D-5 finding (which only showed the daily-usage chart, not this precise per-minute cap) — logged as an addendum there. A single customer chat turn can burn 2-4 Gemini calls, so this genuinely caps live-demo throughput to roughly 4-7 customer messages/minute across all concurrent sessions. Flagged clearly as a live-demo pacing risk, not silently absorbed.

**Result — #9 (session isolation), split into its own script.** The happy-path script's earlier five calls (#1, #2, #7×2, #8) were themselves enough to exhaust the 15/min budget before reaching #9's concurrent pair, so #9 kept failing on quota exhaustion, not a real bug — confirmed by inspecting the actual `llm_call_failed` audit rows each time (all `429 RESOURCE_EXHAUSTED`, same quota). Split it into `scripts/test-session-isolation-live.ts`, ran it alone after a clean ~90s gap: two concurrent sessions, correctly isolated carts (Filter Coffee + Bun Maska vs. Cold Coffee + Chocolate Brownie, zero cross-contamination) and independent complete audit trails. Two of the script's own assertions still failed after that — traced to comparing `JSON.stringify()` output where the DB row and the API response serialize object keys in a different order, not an actual data mismatch (manually re-verified the same two session ids afterward with a direct read-only Supabase query, no new Gemini calls needed, confirming the carts were correct all along). Fixed the comparison to be key-order-independent.

**Result — #15 (audit trail completeness, happy path)** passed as part of the same run reusing #7's session — every expected action from `propose_cart` through `create_order` present, in order.

**All 15 test cases in `05_TEST_CASES.md` now pass live** (see that file's Run log for the full breakdown across 2026-08-30/31). `npx tsc --noEmit`, `npx eslint .`, `npm run build` all clean after every change in this session.

**Files touched:** `lib/orchestrator.ts` (`execCreateOrder` fresh-price re-derivation, `provider.runTurn` error handling), `scripts/test-happy-path-live.ts` (new), `scripts/test-session-isolation-live.ts` (new), `05_TEST_CASES.md` (run log), `PROGRESS_CHECKLIST.md` (Day 6 test-matrix item checked off), `DECISIONS.md` (D-5 addendum with the confirmed 15 RPM figure).

**Still open:** Day 6 remains otherwise untouched — Vercel deployment, `04_AUDIT_TRAIL_SAMPLE.md` real export, backup demo video, and README/PRD/pitch-deck finalization are all founder-facing or presentation tasks not yet started. The ngrok + Razorpay Dashboard webhook registration needed to prove *real* Razorpay-delivered webhooks (not just the signed-simulation this session used) is also still open.

---

## [Day 6] — 2026-08-31 (real Razorpay webhook delivery set up — found and fixed the most serious bug in the project: every real payment would have silently failed to update our own records)

**Worked on:** Set up the real webhook delivery path this project had been missing: installed `cloudflared` (winget), started a quick tunnel to `localhost:3000`, registered `<tunnel>/api/webhooks/razorpay` as a real webhook in the Razorpay Dashboard (Test Mode, `payment.captured` + `payment.failed`), using the same `RAZORPAY_WEBHOOK_SECRET` already in `.env.local`.

**Then created a real order and paid it through the actual hosted checkout page — the first genuinely Razorpay-triggered webhook this project has ever received.** Result: nothing happened. `orders.status` stayed `payment_pending` forever, zero `audit_log` rows from the webhook, despite Razorpay's own dashboard clearly showing the payment as `Captured`/`Paid`.

**Root cause, found by fetching the real paid Payment Link back via the API and reading every field rather than guessing:** `createRazorpayOrderAndLog()` was creating BOTH a standalone Razorpay Order (`razorpay.orders.create()`) AND a Payment Link (`razorpay.paymentLink.create()`) for every order — but creating a Payment Link makes Razorpay auto-generate its OWN separate internal order under the hood, completely disconnected from the standalone one. The webhook's `order_id` is always the Payment Link's auto-generated order — never the one this app created and stored. So `orders.razorpay_order_id` was wrong for literally every payment, and the webhook handler's DB lookup 404'd every single time, silently. **This had zero chance of being caught by any earlier "live" test in this project** — the Day 5 failure-flow tests POSTed hand-signed payloads using the DB's own (wrong) stored order id, which validates the handler's logic assuming a correct id, but structurally can't surface a wrong-id-stored bug, since it never touches Razorpay's real order-assignment behavior.

**A second wrinkle, also found empirically:** the Payment Link's auto-generated order id is assigned *lazily*, only once checkout actually starts — confirmed by fetching a just-created (unpaid) link and finding `order_id: undefined`. There was never a valid moment to capture it at order-creation time.

**The fix, found by inspecting the real paid order's full field list:** its `receipt` field is always exactly the `reference_id` this app already passes when creating the Payment Link (our own `orders.id`). So the webhook handler can always recover the real order — regardless of when Razorpay assigns the id — by fetching the Razorpay order named in the webhook, reading `receipt`, and matching the leading UUID against `orders.id`.

**A further empirical check before trusting that design:** confirmed live that `reference_id` must be unique per Payment Link — Razorpay rejects reuse outright (`"payment link with given reference_id ... already exists"`). So the retry path's reference_id (already touched once today for the 40-char-limit bug — see Day 5) needed a second fix: `${order.id}-1` instead of a dash-stripped, mangled version, so `order.id` stays intact and extractable.

**Implemented:** removed `createRazorpayOrder()` entirely (dead weight that was actively harmful, not just redundant); added `fetchRazorpayOrderReceipt()`; rewrote the webhook handler's order lookup to try a direct match first, then resolve via the receipt/UUID method and backfill `razorpay_order_id` for next time.

**Verified live, twice, with genuine Razorpay-delivered webhooks through the real tunnel — not simulated payloads:**
1. A real scripted decline on a fresh order: `payment_failed` landed with `actor: "razorpay_webhook"`, order correctly marked `failed`, `razorpay_order_id` correctly backfilled to the real value.
2. Asked the agent to retry in chat — it explained the decline and called `retry_payment` on its own (proving Day 5's context-bridge fix and today's fix compose correctly) — completed a real retry payment, and its own *different* auto-generated order id was correctly resolved, order marked `paid`.

This is the first time this project has proven the complete real-world path: Razorpay's actual servers delivering a real webhook to this app, not a simulation of one. Full detail and reasoning logged as `DECISIONS.md` D-7.

**Files touched:** `lib/razorpay.ts` (`createRazorpayOrder` removed, `fetchRazorpayOrderReceipt` added), `lib/orchestrator.ts` (`createRazorpayOrderAndLog`, `execRetryPayment` reference_id), `app/api/webhooks/razorpay/route.ts` (order resolution rewritten), `DECISIONS.md` D-7.

**Still open:** `02_ARCHITECTURE.md` likely still documents (or implies) the removed standalone-Order call — flagged for founder review per `CLAUDE.md` §9, since this is a real deviation from what was originally spec'd, not just an internal refactor. The cloudflared tunnel is ephemeral (dies with the terminal/session, generates a new URL on restart) — not a substitute for a real Vercel deployment, which remains the actual Day 6 task. Also worth noting honestly: during this session the tunnel AND the dev server both died silently in the background at one point (a `stopped` task notification with no clear cause) — both were restarted and re-verified, but this is a reminder that a live demo needs the tunnel/server confirmed healthy immediately before presenting, not assumed still running from earlier in the day.

---

## [Day 6, continued] — 2026-08-31 (real audit trail export)

**Worked on:** Replaced the placeholder `04_AUDIT_TRAIL_SAMPLE.md` with a real export, per `CLAUDE.md` §8's submission checklist. Ran one more quick live order (Samosa, ₹35, real Razorpay checkout, Success) to get a clean first-try happy-path example with a genuine webhook capture, then pulled that plus three more real sessions already in the DB — the D-7 verification session's real decline→retry→success trail, Day 3's over-cap UI-confirmation gate, and the retry-blocked-at-max run — directly from `audit_log` via the Supabase service-role client.

**Result:** `04_AUDIT_TRAIL_SAMPLE.md` now has four real, sourced scenarios instead of hand-typed illustrative rows — real `id`/`order_id`/`actor`/`action`/`detail`/`created_at` values, with provenance notes distinguishing genuinely Razorpay-webhook-delivered rows (categories 1 and 3, today's real tunnel+dashboard setup) from a same-day signed-simulation run (category 4, predates the real webhook registration) — not overstating what's real vs. simulated.

**Files touched:** `04_AUDIT_TRAIL_SAMPLE.md` (full rewrite), `PROGRESS_CHECKLIST.md` (Day 6 item checked off).

**Still open:** Vercel deployment, backup demo video, and README/PRD/pitch-deck finalization remain the only unchecked Day 6 items.

---

## [Day 6, continued] — 2026-08-31/09-01 (Vercel deployment — live, real webhook confirmed on the permanent URL)

**Worked on:** Deployed the app to Vercel for real, closing out the last major Day 6 gap. Installed the Vercel CLI (`npm install -g vercel`), had the founder run `vercel login` interactively (email verification — not something I can do non-interactively), then picked up the authenticated session from there: `vercel link --project ordermind --yes` (had to specify `--project` explicitly — the auto-detected name from the folder failed Vercel's lowercase-only naming rule), set all required production environment variables (`LLM_PROVIDER`, `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) via `vercel env add ... --value ...`, then `vercel deploy --prod --yes`.

**Two small things worth noting, not bugs in the app itself:**
1. `vercel env add` was initially blocked by Claude Code's own auto-mode permission classifier (uploading secrets to a third-party service is rightly treated as sensitive) — explained what the action was and why to the founder before retrying with approval, rather than working around it.
2. Vercel refused `NEXT_PUBLIC_SUPABASE_ANON_KEY` as a plain env var, correctly flagging that a `NEXT_PUBLIC_`-prefixed value that looks like a credential needs an explicit choice. Confirmed this one is *supposed* to be public (Supabase's anon key, protected by RLS — see `DECISIONS.md` D-2) and set it with `--type config` rather than switching it to a private secret, which would have broken the client bundle.

**Result:** live at **https://ordermind-gamma.vercel.app**. Verified immediately, not just "build succeeded": hit `/`, `/audit`, and `/api/chat` on the real production URL — all responded correctly, including a real Gemini-backed catalog search through the live app. Then re-pointed the Razorpay Dashboard's Test Mode webhook from the temporary cloudflared tunnel to `https://ordermind-gamma.vercel.app/api/webhooks/razorpay`, created one more real order, and completed a real payment: the webhook landed on the **permanent** URL with zero tunnel involved — `payment_captured`, `actor: "razorpay_webhook"`, real `payment_id`. This is the app in the state it will actually be judged in, not a local-only proof of concept.

**Files touched:** none in the repo itself (infra/deployment only) — `PROGRESS_CHECKLIST.md` (Day 6 Vercel item checked off, webhook-proof line updated to reflect the permanent URL rather than just the tunnel).

**Still open:** the local dev server + cloudflared tunnel are no longer needed for demo purposes — the Vercel deployment is now the source of truth. Remaining Day 6 items: backup demo video, README/PRD/pitch-deck finalization. The project's git history is still empty (`git log` shows no commits on `main` despite an `origin` remote already pointing at a GitHub repo) — worth deciding deliberately whether/when to make an initial commit and push, rather than leaving it unaddressed; not done in this session since commits/pushes are founder-initiated per this project's own working agreement.

---

## [Day 6, continued] — 2026-09-01 (version control: real commit history, pushed, CI deploy confirmed)

**Worked on:** The project had been running entirely on live Vercel state and the live Supabase DB with **zero git commits** — an `origin` remote pointed at `github.com/aggamsingh/OrderMind`, but nothing had ever been committed or pushed. Founder asked for a real commit history rather than one bulk import, and for commits to continue as work lands.

**Safety check before touching git at all:** found that the Vercel CLI's auto-appended `.gitignore` rule (`.env*`) was also excluding `.env.example`, which *should* be tracked — it carries no secrets, only the variable names a new developer or judge needs. Fixed with an explicit `!.env.example` negation, deduplicated the CLI's repeated `.vercel`/`.env*` entries, then verified via `git check-ignore` that `.env.local` stays ignored while `.env.example` becomes trackable. Also grepped the whole tree for real credential patterns (Anthropic keys, `rzp_test_` ids, Supabase JWTs) before staging anything, and again against the committed tree afterward — clean both times.

**Result: 10 layered commits**, ordered so each builds on its dependencies rather than dumping the tree: scaffold → spec docs → DB schema/RLS → LLM provider layer → guardrails/Razorpay/audit → orchestrator → webhooks → UI → live test scripts → build/decisions logs + real audit export. Commit messages explain the *why* (the confirm-then-swap hole guardrails closes, why RLS has zero anon policies, why the webhook resolves orders via `receipt` rather than a stored id, why the session-isolation test is split out over Gemini's 15 req/min cap) rather than restating filenames.

**One deliberate choice, worth stating plainly:** commits use honest current timestamps rather than being backdated to match the days the work actually happened. The work genuinely was done across 2026-08-30/09-01 and `BUILD_LOG.md` is the authentic day-by-day record; faking author dates to match would misrepresent when the commits themselves were created, which is not worth the cosmetic gain.

**Pushed to `origin/main`** (remote was completely empty, so a clean first push). This **automatically triggered a git-based Vercel production deployment** — confirmed Ready in 23s, and re-verified the live site afterward rather than assuming: homepage 200, `/audit` 200, and the webhook endpoint still correctly rejecting a forged signature with 400 (not a 500), which also confirms production env vars survived the git-triggered build path.

**Files touched:** `.gitignore` (`.env.example` negation + dedupe). Everything else was version-control work, not code changes.

**Still open:** backup demo video and README/PRD/pitch-deck finalization are the last two Day 6 items. Note that pushing to `main` now auto-deploys to production — worth knowing before any further commits, since a broken push goes live.

---

## [Day 7] — 2026-09-01 (closing the gaps a judge would find, and turning one merchant into a market)

**Worked on:** An honest gap-hunt against the Track 1 brief, then fixing everything found, in order of how badly it undercut a claim already being made.

**Gap 1 — "end to end" had a human-shaped hole.** The buyer agent received a payment *link* that a person then had to click. Investigated properly rather than assuming: called Razorpay's two server-to-server payment APIs (`payments.createPaymentJson`, `payments.createUpi`) directly against this test account. Both return `"The requested URL was not found on the server"` — S2S is gated behind merchant approval and is not obtainable in a hackathon window. **Resolution:** stop implying otherwise. The manifest now declares exactly how far autonomy reaches (`negotiation: autonomous`, `authorization: autonomous`, `capture: hosted_redirect`) and names the blocker, so a buyer agent can decide before committing rather than discovering the gap afterwards. Disclosing a limit beats being caught by it.

**Gap 2 — the buyer never learned whether it got paid.** The human path had the webhook→conversation bridge (D-6); the machine path had nothing, so an autonomous buyer could not reconcile its own spending against its mandate. Added `GET /api/agent/order/{id}`: signed, pollable status with the reasoning behind it, and a `watchSettlement()` step in the buyer agent that polls rather than assumes.

**Gap 3 — the centrepiece was untested.** `test-guardrails.ts` covered the spend cap and retry logic but had **zero** coverage of `verifyMandate` or `evaluateMandate` — the only code standing between a forged mandate and a real charge. Added `scripts/test-mandates.ts`: 21 assertions covering signature verification, an inflated-ceiling forgery, garbage and empty tokens, hostile input that must not throw, expiry, negative amounts, stricter-of enforcement in both directions, inclusive boundaries, and receipt tampering. All pass.

**Gap 4 — the upsell couldn't learn.** It read one hardcoded `pairs_well_with` column, so it could never improve and couldn't say which pairings carried the revenue. `lib/upsell.ts` now ranks candidates by measured conversion, counting an upsell as converted only if it survived into the order that was actually created — suggesting something is not the same as selling it. Candidates under a minimum sample size are explored rather than ranked, so thin data doesn't freeze the merchant onto whichever pairing happened to convert first. Suggestions stay constrained to genuine pairings: learning changes *which* relevant add-on is offered, never whether it's relevant.

**Gap 5 — nothing defended the merchant from a bad agent.** Mandates say how much a buyer may spend, not whether it should still be served. A human who is refused stops; a buggy retry loop does not, and every attempt costs a Razorpay call and a DB write. `lib/agent-trust.ts` derives standing from behaviour in `audit_log` (not in-process counters, which reset on every serverless cold start) and tracks the signing principal as well as the agent id, so churning agent ids doesn't reset the clock. Limits are published in the manifest so a well-behaved agent can pace itself.

**Gap 6 — one merchant is not a market.** The brief says merchants, plural. Added a second storefront with its own manifest, own range, and a deliberately tighter autonomous cap (₹300 vs ₹500) — the differing cap is the lesson, since a buyer that assumed one merchant's limits generalise gets refused. `evaluateMandate` now takes the merchant's cap, defaulting to the old constant so every existing caller is untouched. `/api/agent/merchants` is the directory, linking to each manifest rather than restating terms that could drift. **Verified live:** the buyer agent discovered both merchants, priced the same goal at each (₹70 vs ₹60), discarded non-viable ones, and bought from the cheaper — a genuine comparison purchase.

**Also:** rewrote `06_DEMO_SCRIPT.md` around the agent story rather than the chatbot, with the refusal as the centrepiece, a pre-flight checklist, and an "honesty notes" section that volunteers the three real limitations before a judge finds them.

**Files touched:** `lib/mandate.ts`, `lib/guardrails.ts` (merchant-aware cap), `lib/upsell.ts` (new), `lib/agent-trust.ts` (new), `lib/merchants.ts` (new), `app/.well-known/agent-commerce.json` (autonomy + rate limits + directory + per-merchant terms), `app/api/agent/{catalog,quote,order}` (merchant-scoped), `app/api/agent/order/[orderId]` (new), `app/api/agent/merchants` (new), `scripts/test-mandates.ts` (new), `scripts/check-gemini-chain.ts`, `scripts/buyer-agent.ts` (settlement watch + comparison shopping), `06_DEMO_SCRIPT.md`, `02_ARCHITECTURE.md`, `DECISIONS.md` D-8/D-9.

**Still open:** the backup demo video and the pitch deck (`07_PITCH_DECK_OUTLINE.md`) are the last two items. `04_AUDIT_TRAIL_SAMPLE.md` predates the agent channel and should gain an agent-to-agent scenario — its four existing scenarios are all human-path.
