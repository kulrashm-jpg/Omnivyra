-- A6B — an index for the retry-candidate read.
--
-- WHY NOW, WHEN 20261020 DELIBERATELY ADDED NONE. That migration's own comment
-- said an index "would only pay off for a scheduler scanning for due work, and
-- no such reader exists... doing it now would be guessing at the query shape of
-- a component that has not been designed." The reader now exists
-- (`listDueRetryCandidates`), so the query shape is no longer a guess — this
-- index is built from the predicate that reader actually issues, in its order.
--
-- WHY NO EXISTING INDEX SERVES IT. There are eight indexes on this table and
-- not one can answer "which attempts are due":
--
--   *_person_unique / *_account_unique   (org, entity, provider, attempt_number)
--   *_person_live   / *_account_live     (org, entity, provider) WHERE completed_at IS NULL
--   _tenant_recent                       (org, started_at DESC)
--   _outcome                             (org, provider_key, outcome)
--   _expired_claims                      (org, claimed_until) WHERE completed_at IS NULL
--   _call_state                          (org, provider_call_state) WHERE completed_at IS NULL
--
-- Three carry `WHERE completed_at IS NULL`, which is the exact OPPOSITE of a
-- retry predicate: a retryable attempt is by definition finished, so those
-- partial indexes exclude every row this query wants. `_outcome` leads on
-- provider_key, which the retry read does not filter on, and holds no temporal
-- column. `_tenant_recent` orders by `started_at`, not by the horizon.
--
-- THE SHAPE. The reader filters `organization_id = $1 AND next_retry_at <= $2`
-- and orders by `next_retry_at ASC`. Tenant leads because it is an equality and
-- because tenant isolation is the one predicate that must never be optional;
-- `next_retry_at` follows as the range and the sort, so the index serves the
-- ORDER BY as well as the filter and no sort step is required.
--
-- PARTIAL, ON THE COLUMN'S OWN MEANING. `next_retry_at IS NULL` is the normal
-- case — most attempts carry no horizon at all, and the 20261020 comment is
-- explicit that NULL "does NOT mean retry now". Those rows can never be
-- candidates, so they are excluded from the index rather than stored in it.
-- The predicate is on the indexed column alone, so the planner can match it
-- without needing the query to restate anything else.
--
-- DELIBERATELY NOT INCLUDED. No `execution_status`, `outcome`,
-- `provider_call_state` or `completed_at` column. They are low-cardinality
-- filters applied to an already tiny candidate set — every row that reaches
-- them has a due horizon — and adding them would widen the index, tie it to a
-- retry policy that is not yet decided, and require a new migration each time
-- that policy moves. The horizon is the selective term; the rest is refinement.
--
-- NOT REDUNDANT. No existing index leads on `(organization_id, next_retry_at)`,
-- and none is a prefix of this one, so nothing is superseded and nothing here
-- duplicates an existing access path.
--
-- SAFE TO APPLY. One partial btree, no column change, no constraint, no
-- backfill, no other table. The table holds zero rows in production, so the
-- build is instantaneous. Rollback is a single DROP INDEX.
--
-- NOT APPLIED BY THE CHANGE THAT INTRODUCED IT. This file exists so the reader
-- has an access path when a scheduler is eventually built and the table stops
-- being empty; applying it is a separate, deliberate operator action.

CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_attempts_retry_due
  ON public.prospect_enrichment_attempts (organization_id, next_retry_at)
  WHERE next_retry_at IS NOT NULL;

COMMENT ON INDEX public.idx_prospect_enrichment_attempts_retry_due IS
  'A6B: serves the retry-candidate read — organization_id equality, '
  'next_retry_at range and ORDER BY. Partial on next_retry_at IS NOT NULL '
  'because an attempt with no provider-stated horizon can never be due. '
  'Carries no outcome/status column: those refine an already-due set and '
  'would bind the index to a retry policy that is not yet decided.';
