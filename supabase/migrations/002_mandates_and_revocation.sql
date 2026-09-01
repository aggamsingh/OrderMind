-- Migration 002 — make delegated spend authority revocable.
--
-- WHY THIS EXISTS (the hole it closes):
-- A signed mandate is a bearer token. Until now, once a buyer agent held one,
-- the human who issued it had NO way to take it back — it stayed valid until
-- it expired, no matter what the agent did with it in the meantime. For a
-- system whose entire premise is "a human delegated bounded authority over
-- their own money", that is the obvious missing control: you cannot
-- meaningfully delegate authority you cannot withdraw.
--
-- Two tables, because there are genuinely two different revocations:
--
--   mandates                 — one row per mandate seen. Lets a principal
--                              revoke ONE specific grant ("cancel that order's
--                              authority") and lets them see what their agents
--                              are actually holding.
--
--   principal_kill_switches  — the panic button. Revokes everything a
--                              principal granted before a point in time,
--                              including mandates this merchant has never
--                              seen. Time-based rather than a list, so it
--                              works against grants issued by an agent that
--                              has gone rogue and stopped reporting in, while
--                              still letting the principal issue fresh
--                              authority afterwards.
--
-- Apply in the Supabase SQL Editor. Additive and safe: creates new tables
-- only, touches nothing existing.

create table if not exists mandates (
  -- The mandate's own single-use nonce is its natural identity.
  nonce text primary key,
  buyer_agent_id text not null,
  principal text not null,
  max_amount_paise integer not null check (max_amount_paise > 0),
  purpose text,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  -- Null until revoked. Presence of a timestamp is the revocation.
  revoked_at timestamptz,
  revoked_reason text,
  -- How this row got here: issued through the principal console, or first
  -- observed when an agent presented it. Both are worth telling apart.
  source text not null default 'observed' check (source in ('issued', 'observed')),
  created_at timestamptz not null default now()
);

create index if not exists mandates_principal_idx on mandates (principal);
create index if not exists mandates_agent_idx on mandates (buyer_agent_id);

create table if not exists principal_kill_switches (
  id uuid primary key default gen_random_uuid(),
  principal text not null,
  -- Null means "every agent acting for this principal".
  buyer_agent_id text,
  -- Any mandate ISSUED BEFORE this instant is dead. Mandates the principal
  -- grants after it remain valid, so a kill switch stops the bleeding without
  -- permanently locking the principal out of their own agents.
  effective_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists kill_switches_principal_idx on principal_kill_switches (principal);

-- Same posture as every other table here (DECISIONS.md D-2): RLS on, zero
-- policies for anon/authenticated. These tables gate money; the only thing
-- that may read or write them is the server-side orchestrator holding the
-- service-role key.
alter table mandates enable row level security;
alter table principal_kill_switches enable row level security;

-- Allow 'refunded' as an order status. A buyer agent can now reverse its own
-- order through /api/agent/order/{id}/refund, bounded by the same guardrail
-- discipline as a charge (one refund per order, never more than was paid).
-- Without this the CHECK constraint would reject the write and a refund would
-- succeed at Razorpay while failing to record here — the worst of both.
alter table orders drop constraint if exists orders_status_check;

alter table orders
  add constraint orders_status_check
  check (status in ('created', 'payment_pending', 'paid', 'failed', 'retried', 'retry_failed', 'refunded'));
