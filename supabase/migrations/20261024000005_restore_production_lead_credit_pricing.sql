-- ============================================================================
-- Forward reproducibility migration — production lead-credit pricing DATA
--
-- Restores the two lead-capture credit prices that 20261024000001 (B1)
-- deliberately left out while their authority was unresolved (STEP 3AH-4).
--
-- AUTHORITY
--   STEP 3AH-20: the user selected CURRENT PRODUCTION billing values as the
--   reconstruction authority for these two rows. Every value below is copied
--   from production (SELECT-only reads, STEP 3AH-4 and STEP 3AH-16, 2026-09-12):
--
--     action_type              credits  smart_dedup_seconds  category  activity_class
--     lead_qualification             8                21600  medium    INTELLIGENCE_SCAN
--     lead_predictive_scoring       10                21600  medium    INTELLIGENCE_SCAN
--
--   Descriptions are production's exact text.
--
--   ELEVATED FROM PRODUCTION, observed 2026-09-12 (STEP 3AH-4 / 3AH-16). These
--   supersede the tracked values in 20260821_credit_catalog_lead_capture_
--   intelligence.sql (2 / 3 credits, dedup 0), which was never applied to
--   production. That legacy file is NOT modified.
--
-- WHY
--   20260821 is an 8-digit legacy migration, which the repository's replay rule
--   (scripts/ci/real-schema-ci.sh: `[ "${#ver}" -eq 14 ] || continue`) skips, and
--   baseline.sql is schema-only — so a fresh reconstruction has no row for either
--   action. getCreditCost() then throws "missing credit cost config", and the lead
--   job's best-effort billing silently charges nothing.
--
-- BEHAVIOUR NOTE (unchanged by this file)
--   leadJobProcessor charges credits x qualified-lead count, once per completed
--   job, with smartMode = false and referenceId = jobId. smart_dedup_seconds is
--   therefore not consulted as a dedup window on that path; it is restored only
--   so the row matches production.
--
-- NOT COPIED FROM PRODUCTION
--   id and updated_at take their column defaults (gen_random_uuid() / now()).
--
-- SAFETY
--   * One INSERT. No UPDATE, DELETE, TRUNCATE, DROP, ALTER, GRANT or DDL.
--   * ON CONFLICT (action_type) DO NOTHING — arbiter: the non-partial constraint
--     credit_cost_config_action_type_key UNIQUE (action_type). An existing row is
--     NEVER overwritten, so applying this to an already-configured database
--     (including production) changes nothing that exists.
--   * Safe to run twice: the second run inserts zero rows.
--   * credit_cost_config has no triggers and no FORCE ROW LEVEL SECURITY.
--   * Never run 20260821 against a configured database: it uses
--     ON CONFLICT DO UPDATE and would overwrite production prices.
-- ============================================================================

INSERT INTO public.credit_cost_config
  (action_type, credits, category, description, smart_dedup_seconds, activity_class)
VALUES
  ('lead_qualification',      8,  'medium', 'LLM lead qualification per qualified lead (value-gated; token-cost captured in usage_events)',       21600, 'INTELLIGENCE_SCAN'),
  ('lead_predictive_scoring', 10, 'medium', 'Predictive lead scoring per surfaced latent lead (value-gated; token-cost captured in usage_events)', 21600, 'INTELLIGENCE_SCAN')
ON CONFLICT (action_type) DO NOTHING;
