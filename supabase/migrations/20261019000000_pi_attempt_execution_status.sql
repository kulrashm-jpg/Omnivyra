-- A5 — execution status: how OUR execution ended, as distinct from what the
-- provider said and from whether transport happened.
--
-- WHAT THE EXISTING COLUMNS CANNOT SAY. The attempt row already answers two
-- questions. `outcome` says what the PROVIDER said, or names a refusal we made
-- before reaching one. `provider_call_state` (A4Q) says whether transport
-- happened, three-valued because the question has three answers. Neither can
-- say how OUR execution ended, and the A4T audit found the gap concretely:
--
--   * a post-provider persistence failure closes with `outcome = NULL`
--   * a pre-transport marker failure closes with `outcome = NULL`
--
-- Both look identical in the columns that exist, and were separable only by
-- reading free-text `detail`. Yet their retry safety is OPPOSITE: the first was
-- paid for and must never be blindly re-called; the second provably was not and
-- is freely retryable. A retry consumer reading only today's columns would treat
-- them the same, which is precisely the double-spend A4Q and A4V exist to stop.
--
-- `outcome` cannot absorb this. Every value in ENRICHMENT_OUTCOMES describes
-- either a provider verdict or a refusal we made; none can name OUR failure
-- without blaming the vendor for it. So the third question gets a third column.
--
-- THE SIX VALUES, AND WHY NOT MORE.
--
--   in_flight         opened or claimed; no terminal state yet. The default.
--   refused_pre_call  WE declined before transport — no credential, no adapter,
--                     cost denied, or a still-fresh duplicate.
--   mark_failed       the pre-transport marker could not be persisted, so A4V
--                     forbade transport. Provably `not_called`.
--   platform_failed   OUR failure. `provider_call_state` says whether transport
--                     had already happened; that distinction is what makes one
--                     of these retryable and the other not.
--   completed         the execution ran to its end; a verdict or refusal is
--                     recorded.
--   abandoned         opened and never closed; the process did not survive.
--
-- `mark_failed` and `platform_failed` are deliberately NOT one value. They are
-- the exact pair A4T found conflated, and merging them would rebuild the defect
-- this migration exists to fix.
--
-- There is no `retrying`, `retry_exhausted`, `waiting`, `queued` or `scheduled`.
-- Those describe a scheduler's intentions rather than an execution's history,
-- and no scheduler exists. This column RECORDS; it does not DECIDE.
--
-- `abandoned` HAS NO WRITER. A4T established it is currently a DERIVED
-- condition — `completed_at IS NULL` past a lease or staleness cutoff — and the
-- reclaimer that would write it does not exist. It is admitted by the CHECK so
-- the vocabulary is complete and a future reclaimer needs no migration, but
-- nothing in this change ever writes it. Registering a state is not
-- implementing it.
--
-- DEFAULT. `in_flight`, matching what `recordAttempt` now writes explicitly.
-- The two agree deliberately: the default protects a direct SQL insert, and the
-- explicit write keeps the TypeScript vocabulary the source of truth. On a table
-- holding zero rows the default also serves as the backfill — there is nothing
-- to backfill, and no existing row can be mislabelled.
--
-- DELIBERATELY NOT HERE. No `next_retry_at`, no `retry_class`, no `terminal`,
-- no `prior_attempt_id`, no `retry_policy_version`, no `rate_limit_reset_at`.
-- A4T classified every one of those as DERIVABLE, NOT REQUIRED or DEFER, and
-- named execution status as the single immediate prerequisite. Adding them now
-- would be building a job system ahead of the evidence that shapes it.
--
-- NO INDEX. A supporting index would only pay off for a reader that filters on
-- this column, and no such reader exists — there is no reclaimer, no retry
-- consumer and no scheduler. `idx_prospect_enrichment_attempts_call_state`
-- already covers the live-row reads a future maintenance loop performs. An
-- index added now would be speculative, and the table is empty, so adding one
-- later is free.
--
-- SAFE TO APPLY. One column with a default plus one CHECK, on a table holding
-- zero rows in production. No existing constraint, index or RLS policy is
-- altered, and no other table is touched. Rollback is the exact inverse: drop
-- the constraint, drop the column.

ALTER TABLE public.prospect_enrichment_attempts
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'in_flight';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.prospect_enrichment_attempts'::regclass
       AND conname  = 'prospect_enrichment_attempts_execution_status_valid'
  ) THEN
    ALTER TABLE public.prospect_enrichment_attempts
      ADD CONSTRAINT prospect_enrichment_attempts_execution_status_valid
      CHECK (execution_status IN (
        'in_flight', 'refused_pre_call', 'mark_failed',
        'platform_failed', 'completed', 'abandoned'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.prospect_enrichment_attempts.execution_status IS
  'A5: how OUR execution ended — in_flight | refused_pre_call | mark_failed | '
  'platform_failed | completed | abandoned. Orthogonal to `outcome` (what the '
  'provider said) and to `provider_call_state` (whether transport happened); '
  'never infer one from another. `abandoned` is derived and currently has no '
  'writer. This column records execution history and expresses no retry policy.';
