-- =====================================================================
-- BILLING HOTFIX 001 — credit_action_approvals client_request_id index
--
-- Symptom (production, every admin grant/revoke):
--   ERROR 42P10: there is no unique or exclusion constraint matching the
--   ON CONFLICT specification
--
-- Root cause:
--   creditApprovalService.proposeApproval() upserts with
--   `ON CONFLICT (client_request_id)` (no predicate). Migration 20260663
--   created idx_caa_client_request_unique as a PARTIAL unique index
--   (`WHERE client_request_id IS NOT NULL`). Postgres cannot use a
--   partial index as the arbiter for a bare ON CONFLICT (client_request_id)
--   → 42P10 → the grant/revoke/approval proposal fails before anything
--   is written.
--
-- Fix:
--   Replace the partial unique index with a NON-partial unique index on
--   the same column. NULLs remain distinct in a unique index, so an
--   unlimited number of null-client_request_id rows is still permitted —
--   functionally identical to the old partial index for this use case,
--   but now a valid ON CONFLICT (client_request_id) arbiter.
--
-- Safety: drop+recreate of a single index. The unique constraint it
--   enforces is unchanged (uniqueness among non-null client_request_id).
--   Idempotent (IF EXISTS / IF NOT EXISTS). Run once in the SQL editor;
--   re-running is a no-op. No data change. Verified via transactional
--   dry-run against production (rolled back).
--
-- If CREATE fails with a unique-violation, there are pre-existing
-- duplicate non-null client_request_id values to inspect first:
--   SELECT client_request_id, count(*) FROM public.credit_action_approvals
--   WHERE client_request_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- (On a freshly-migrated table this returns no rows.)
-- =====================================================================

DROP INDEX IF EXISTS public.idx_caa_client_request_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_caa_client_request_unique
  ON public.credit_action_approvals (client_request_id);

-- Refresh PostgREST so the planner/cache sees the new index immediately.
NOTIFY pgrst, 'reload schema';
