-- Migration 001 — allow 'buyer_agent' as an audit_log actor.
--
-- Why: /api/agent/* lets an autonomous buyer agent transact with this
-- merchant end to end, with no human in the loop. Logging those actions as
-- 'customer' would be inaccurate in exactly the way that matters — the whole
-- point of the audit trail is to show WHO took each money action, and "a
-- program acting under a signed mandate" is a materially different actor
-- from "a person who clicked a button". See DECISIONS.md D-8.
--
-- Apply this in the Supabase SQL Editor against the existing project. It is
-- additive and safe: it only widens an existing CHECK constraint, so no
-- existing row can be invalidated by it.

alter table audit_log drop constraint if exists audit_log_actor_check;

alter table audit_log
  add constraint audit_log_actor_check
  check (actor in ('customer', 'agent', 'orchestrator', 'razorpay_webhook', 'buyer_agent'));
