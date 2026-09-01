-- PHASE 168 — request-level uniqueness for live BOLT executions.
--
-- STATUS: PREPARED, NOT APPLIED.
--
-- WHAT IT DOES
--   Makes it impossible for one company to hold two LIVE executions of the same
--   logical request. The application already refuses to create one via a
--   pre-insert check; that check cannot arbitrate two requests that interleave
--   between SELECT and INSERT. This index moves the decision to the database,
--   where exactly one writer wins and the loser receives 23505.
--
-- WHY A PARTIAL INDEX OVER `payload->>'idempotency_key'`
--   The fingerprint is stamped into the existing JSONB payload, so this adds NO
--   column and needs no backfill. The predicate covers only the live set
--   ('started','running') because the invariant is about CONCURRENT execution,
--   not history: a failed or completed run must never block a legitimate rerun
--   of the same strategy. Rows written before this ships have no
--   `idempotency_key`, so `payload->>'idempotency_key'` is NULL for them and
--   they are excluded — NULLs are not indexed by a UNIQUE btree.
--
-- PREFLIGHT
--   Refuses to create the index if live duplicates already exist, rather than
--   failing halfway through with an opaque error. It NEVER modifies data —
--   resolving duplicates is an operator decision, not a migration's.

DO $$
DECLARE
  offending INTEGER;
BEGIN
  SELECT COUNT(*) INTO offending
  FROM (
    SELECT company_id, payload->>'idempotency_key' AS k
    FROM public.bolt_execution_runs
    WHERE status IN ('started', 'running')
      AND payload->>'idempotency_key' IS NOT NULL
    GROUP BY company_id, payload->>'idempotency_key'
    HAVING COUNT(*) > 1
  ) dupes;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'Refusing to create %: % live duplicate request fingerprint(s) exist. Resolve them first; this migration will not modify data.',
      'uidx_bolt_runs_live_request_fingerprint', offending;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_bolt_runs_live_request_fingerprint
  ON public.bolt_execution_runs (company_id, (payload->>'idempotency_key'))
  WHERE status IN ('started', 'running')
    AND payload->>'idempotency_key' IS NOT NULL;

COMMENT ON INDEX public.uidx_bolt_runs_live_request_fingerprint IS
  'PHASE 168: one live BOLT execution per (company, request fingerprint). Live set only, so failed/completed runs never block a legitimate rerun.';
