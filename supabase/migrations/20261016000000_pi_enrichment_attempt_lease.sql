-- A4N — the enrichment attempt lease.
--
-- WHAT THIS CLOSES. A4J made attempt recording fail closed, so an execution
-- that could not be recorded can no longer reach a provider. It did NOT stop
-- two workers from both reaching one: `nextAttemptNumber` is read-then-
-- increment, so if worker A commits attempt N+1 before worker B reads, B
-- computes N+2, both INSERTs succeed, and the tenant is charged twice for the
-- same work. Distinct attempt numbers are not proof of safe concurrency —
-- they are proof of two independent executions.
--
-- WHY A "LIVE" PARTIAL UNIQUE INDEX AND NOT A LOCK TABLE. The claimable thing
-- here is not a row that already exists: unlike `thread_runtime_queue_entries`,
-- nothing enqueues enrichment work before the attempt itself. So the claim has
-- to BE the attempt insert, and the arbiter has to be an index.
--
-- This mirrors `uniq_thread_runtime_queue_live_dedup` exactly, which is the
-- repository's established shape: a partial unique index over the LIVE subset,
-- while historic rows coexist freely. Here "live" is `completed_at IS NULL` —
-- an open attempt is an in-flight execution, and two simultaneous in-flight
-- executions for one (tenant, entity, provider) is the defect. Every completed
-- attempt, of any outcome, leaves the index immediately, so append-only history
-- is untouched and a retry is still a new row with a higher attempt_number.
--
-- WHY A LEASE AND NOT JUST THE OPEN ROW. A4E leaves an open row when the
-- process dies mid-execution — deliberately, because an open row is truthful
-- evidence of "started, end unknown". Without an expiry that row would hold the
-- live slot forever and permanently block the work item. `claimed_until` is
-- the visibility timeout that makes recovery possible, and `claimed_by` says
-- who holds it. Reclaiming is a conditional UPDATE, which is atomic for the
-- same reason `supabaseExecutionQueue`'s claim is: PostgreSQL takes the row
-- lock and re-evaluates the WHERE after acquiring it, so of two racing
-- reclaimers exactly one gets a row back.
--
-- DELIBERATELY NOT HERE. No `next_retry_at`, no `retry_class`, no `terminal`,
-- no `prior_attempt_id`, no retry policy version, and no execution-status
-- taxonomy. Those belong to the retry/scheduler foundation and must be shaped
-- by its real requirements, not guessed ahead of it. No claim STATUS column
-- either: `completed_at IS NULL` already is the status, and a second
-- representation of the same fact is a second thing to keep in step.
--
-- SAFE TO APPLY. Two nullable columns and three indexes on a table holding
-- zero rows. Nothing is backfilled and no existing constraint changes.

ALTER TABLE public.prospect_enrichment_attempts
  -- Who holds the lease. Free text: a worker/process identifier, never a
  -- credential and never a user.
  ADD COLUMN IF NOT EXISTS claimed_by    text,
  -- The visibility timeout. NULL means the row was never claimed through the
  -- lease path — the manual, user-initiated path does not claim.
  ADD COLUMN IF NOT EXISTS claimed_until timestamptz;

-- ── the arbiter ────────────────────────────────────────────────────────────
-- At most ONE live (open) attempt per (tenant, entity, provider). Partial on
-- the subject leg for the same reason the attempt_number indexes are: a single
-- index across two nullable columns would treat NULLs as distinct and enforce
-- nothing.
--
-- These are what actually make the race safe. A second worker's INSERT is
-- rejected by the database with 23505; there is no window in which both can
-- proceed, and no dependence on the two workers computing the same number.
CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_person_live
  ON public.prospect_enrichment_attempts (organization_id, person_id, provider_key)
  WHERE person_id IS NOT NULL AND completed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_account_live
  ON public.prospect_enrichment_attempts (organization_id, account_id, provider_key)
  WHERE account_id IS NOT NULL AND completed_at IS NULL;

-- The read a reclaimer performs: "which live attempts have expired leases?".
-- Partial on the same live predicate so it stays small — it indexes in-flight
-- work only, never history.
CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_attempts_expired_claims
  ON public.prospect_enrichment_attempts (organization_id, claimed_until)
  WHERE completed_at IS NULL;

COMMENT ON COLUMN public.prospect_enrichment_attempts.claimed_by IS
  'A4N: worker/process identifier holding the execution lease. Never a credential.';
COMMENT ON COLUMN public.prospect_enrichment_attempts.claimed_until IS
  'A4N: lease visibility timeout. NULL when the attempt was not claimed through the lease path.';
