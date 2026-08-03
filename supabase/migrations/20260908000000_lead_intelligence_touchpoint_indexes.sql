-- HARDEN-INT-001 (3) — indexes for the Lead Intelligence snapshot loader.
-- ADDITIVE ONLY: creates two indexes, alters no table, changes no data and no
-- existing behaviour. Safe to apply before or after the application deploy.
--
-- WHY: every intelligence generation loads campaign_touchpoints twice —
--   1) WHERE company_id = ? AND lead_id = ?             (primary)
--   2) WHERE company_id = ? AND visitor_session_id = ?  (fallback when 1 is empty)
-- both ORDER BY touched_at. The table shipped with only
-- idx_campaign_touchpoints_company_time (company_id, touched_at DESC) and
-- idx_campaign_touchpoints_campaign (campaign_id), so neither lookup column
-- was indexed: Postgres had to scan every touchpoint the tenant owns and
-- filter, on the hot path of every generation.
--
-- The composite (company_id, <lookup>, touched_at DESC) shape serves the
-- equality filter and supplies the ordering, so the planner can satisfy each
-- query with a single index scan. Both are partial (lookup column NOT NULL) —
-- touchpoints legitimately carry a null lead_id until a session is stitched,
-- and those rows are never selected by these predicates.
--
-- The existing indexes are intentionally left in place: they serve the
-- company-wide time-ordered reporting reads elsewhere in the platform.
--
-- CONCURRENTLY is deliberately NOT used: the repo applies migrations inside a
-- transaction, where CONCURRENTLY is not permitted. These are two indexes on
-- one table; build time is proportional to existing touchpoint volume.

CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_company_lead_time
  ON public.campaign_touchpoints (company_id, lead_id, touched_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_company_session_time
  ON public.campaign_touchpoints (company_id, visitor_session_id, touched_at DESC)
  WHERE visitor_session_id IS NOT NULL;
