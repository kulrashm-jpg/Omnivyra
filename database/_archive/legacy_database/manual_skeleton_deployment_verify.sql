-- Manual Campaign Skeleton Pipeline — Production Deployment Verification
-- Run in Supabase SQL Editor after deployment.
--
-- Phases 4–7 use the most recent campaign that has daily_content_plans.
-- To check a specific campaign, replace the subquery with your UUID, e.g.:
--   WHERE campaign_id = '550e8400-e29b-41d4-a716-446655440000'
--
-- Do NOT modify production data unless a failure is detected.

-- =============================================================================
-- PHASE 1 — VERIFY CORE TABLES
-- Expected: 4 rows (campaigns, campaign_versions, twelve_week_plan, daily_content_plans)
-- If any table is missing, STOP deployment and report failure.
-- =============================================================================
SELECT 'PHASE 1: Core tables' AS phase;
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'campaigns',
  'campaign_versions',
  'twelve_week_plan',
  'daily_content_plans'
)
ORDER BY table_name;

-- =============================================================================
-- PHASE 2 — VERIFY REQUIRED DAILY PLAN COLUMNS
-- Expected: 8 columns (campaign_id, week_number, day_of_week, date, platform,
-- content_type, content, status). If any missing, create migration.
-- =============================================================================
SELECT 'PHASE 2: Required daily_content_plans columns' AS phase;
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'daily_content_plans'
AND column_name IN (
  'campaign_id',
  'week_number',
  'day_of_week',
  'date',
  'platform',
  'content_type',
  'content',
  'status'
)
ORDER BY ordinal_position;

-- =============================================================================
-- PHASE 3 — VERIFY GENERATION SOURCE COLUMN
-- Execution engine requires generation_source (AI, blueprint, board, manual).
-- If missing, run: ALTER TABLE daily_content_plans ADD COLUMN generation_source TEXT;
-- =============================================================================
SELECT 'PHASE 3: generation_source column' AS phase;
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'daily_content_plans'
AND column_name = 'generation_source';

-- =============================================================================
-- PHASE 4 — VERIFY CAMPAIGN SKELETON OUTPUT
-- Uses most recent campaign with daily plans. For a specific campaign, replace
-- the subquery with: WHERE campaign_id = 'your-uuid-here'
-- Expected: 24 rows (4 weeks × 6 slots). If count differs, investigate pipeline.
-- =============================================================================
SELECT 'PHASE 4: Campaign skeleton row count' AS phase;
SELECT COUNT(*) AS row_count
FROM daily_content_plans
WHERE campaign_id = (SELECT campaign_id FROM daily_content_plans ORDER BY created_at DESC LIMIT 1);

-- =============================================================================
-- PHASE 5 — VERIFY PLACEHOLDER FORMAT
-- Expected: {"placeholder": true, "label": "..."}
-- =============================================================================
SELECT 'PHASE 5: Placeholder format sample' AS phase;
SELECT id, content
FROM daily_content_plans
WHERE campaign_id = (SELECT campaign_id FROM daily_content_plans ORDER BY created_at DESC LIMIT 1)
LIMIT 5;

-- =============================================================================
-- PHASE 6 — VERIFY WEEK DISTRIBUTION
-- Expected: week 1-4 each with 6 slots.
-- =============================================================================
SELECT 'PHASE 6: Week distribution' AS phase;
SELECT week_number, COUNT(*) AS slot_count
FROM daily_content_plans
WHERE campaign_id = (SELECT campaign_id FROM daily_content_plans ORDER BY created_at DESC LIMIT 1)
GROUP BY week_number
ORDER BY week_number;

-- =============================================================================
-- PHASE 7 — VERIFY EXECUTION ENGINE CONSISTENCY
-- Expected: manual, AI, blueprint, board. If NULL for new rows, update execution engine.
-- =============================================================================
SELECT 'PHASE 7: generation_source distribution' AS phase;
SELECT generation_source, COUNT(*)
FROM daily_content_plans
WHERE campaign_id = (SELECT campaign_id FROM daily_content_plans ORDER BY created_at DESC LIMIT 1)
GROUP BY generation_source;

-- =============================================================================
-- PHASE 8 — VERIFY STATUS DEFAULT
-- Expected default: planned. If status is NULL, run remediation (see below).
-- =============================================================================
SELECT 'PHASE 8: Status distribution (global)' AS phase;
SELECT status, COUNT(*)
FROM daily_content_plans
GROUP BY status
ORDER BY count DESC;

-- Remediation (run ONLY if Phase 8 shows NULL status):
-- UPDATE daily_content_plans SET status = 'planned' WHERE status IS NULL;

-- =============================================================================
-- PHASE 9 — POST-DEPLOY MONITORING
-- New plans created within 24 hours. Zero after deployment = investigate triggers.
-- =============================================================================
SELECT 'PHASE 9: New plans (last 24h)' AS phase;
SELECT COUNT(*) AS new_plans_24h
FROM daily_content_plans
WHERE created_at > NOW() - INTERVAL '24 hours';

-- =============================================================================
-- PHASE 10 — DATA INTEGRITY CHECK
-- Expected: 0 rows. Duplicates indicate improper generation logic.
-- =============================================================================
SELECT 'PHASE 10: Duplicate day slots (should be 0)' AS phase;
SELECT campaign_id, week_number, day_of_week, COUNT(*) AS dup_count
FROM daily_content_plans
GROUP BY campaign_id, week_number, day_of_week
HAVING COUNT(*) > 1;

