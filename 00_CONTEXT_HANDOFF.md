# 00 — Context Handoff

This file exists so any new Claude Code session (or a human teammate) can get oriented in under a minute.

## One-line summary
OrderMind is a conversational checkout agent for a fictional café ("Chai Point Express") built for Razorpay's AI Buildathon, Track 1 (AI Growth & Agentic Commerce). It takes a chat order, proposes a cart with visible reasoning, suggests one upsell, and completes payment via Razorpay test-mode APIs — auto-approving under ₹500, gating behind explicit confirmation above it — with every decision logged to an audit trail and one scripted payment failure handled with exactly one bounded retry.

## Where the real spec lives
- `01_PRD.md` — problem, users, scope, non-goals
- `02_ARCHITECTURE.md` — system diagram, exact Postgres schema, request flow
- `03_LLM_CONTEXT.md` — exact Claude system prompt and tool JSON schemas
- `04_AUDIT_TRAIL_SAMPLE.md` — sample audit_log rows (placeholder until real export)
- `05_TEST_CASES.md` — the test matrix judges' scrutiny maps to
- `06_DEMO_SCRIPT.md` — the ~3 minute live demo script
- `07_PITCH_DECK_OUTLINE.md` — slide-by-slide outline
- `09_README.md` — public-facing README (setup + run instructions)
- `CLAUDE.md` — working process, locked decisions, definition of "winning"
- `BUILD_LOG.md` — chronological build diary, including problems and how they were solved
- `DECISIONS.md` — ADR-lite log for choices with real alternatives
- `PROGRESS_CHECKLIST.md` — the day-by-day plan as checkboxes

## Non-negotiable rule to remember above all else
Claude proposes tool calls; it never talks to Razorpay directly, and its own claim of "confirmed" is never trusted. The backend orchestrator re-verifies the spend cap and confirmation state server-side, independent of the model, before any money-moving call. See `CLAUDE.md` §1.

## What existed before this build started
Nothing but the four meta docs (`CLAUDE.md`, `BUILD_LOG.md`, `DECISIONS.md`, `PROGRESS_CHECKLIST.md`) and an empty git repo with no commits. Docs `00`–`09` (this one included) and all application code were created in this build session, working from the spec summarized in `CLAUDE.md`.

## Accounts / credentials the founder (not Claude) must provide
Claude Code cannot sign up for third-party accounts or hold real secrets in chat. These are tracked as they come up, with a running list kept in `BUILD_LOG.md` under "Action needed from founder."
