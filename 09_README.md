# OrderMind

A conversational checkout agent for a café merchant, built for Razorpay's AI Buildathon (Track 1 — AI Growth & Agentic Commerce).

Every money action is explainable, bounded, and gated: Claude proposes tool calls, but a server-side orchestrator independently re-verifies the ₹500 spend cap and confirmation state before anything touches Razorpay. Every decision — including blocked ones — is written to a Postgres audit trail visible at `/audit`.

Full spec: see `00_CONTEXT_HANDOFF.md` for a map of every doc in this repo.

## Stack
Next.js (App Router, TypeScript) · Supabase (Postgres) · Claude API (Sonnet, tool use) · Razorpay Test-Mode APIs · Vercel

## Setup

1. Copy `.env.example` to `.env.local` and fill in real values (see below for where to get each one).
2. `npm install`
3. Apply `supabase/schema.sql` to your Supabase project (SQL editor, or `supabase db push`).
4. `npm run dev` and open `http://localhost:3000`.

### Where to get each credential
- `ANTHROPIC_API_KEY` — console.anthropic.com
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase project settings → API
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — Razorpay Dashboard (Test Mode) → Settings → API Keys
- `RAZORPAY_WEBHOOK_SECRET` — Razorpay Dashboard → Webhooks → set a secret when creating the webhook pointing at `/api/webhooks/razorpay`

## Project structure
See `CLAUDE.md` §3 for the intended file layout.

## Testing
See `05_TEST_CASES.md` for the full test matrix and `05_TEST_CASES.md`'s Run log for the latest results.

## Demo
See `06_DEMO_SCRIPT.md`.
