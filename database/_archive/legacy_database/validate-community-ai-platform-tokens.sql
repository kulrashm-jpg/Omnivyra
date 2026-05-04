-- =============================================================================
-- Database Validation: community_ai_platform_tokens
-- =============================================================================
-- Role: Database Reliability Engineer
-- Input: database/deploy-community-ai-platform-tokens.sql
-- Purpose: Confirm table, columns, indexes deployed correctly and compatible
--          with connector token refresh (G5.4) and owner-based disconnect (G2.4).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PHASE 1 — TABLE EXISTENCE VERIFICATION
-- -----------------------------------------------------------------------------
-- Run the following query. Expected: 1 row (table exists).

SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'community_ai_platform_tokens'
) AS table_exists;

-- -----------------------------------------------------------------------------
-- PHASE 2 — COLUMN VERIFICATION (Required Columns)
-- -----------------------------------------------------------------------------
-- Run: expected columns for token storage + G2.4 ownership.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'community_ai_platform_tokens'
ORDER BY ordinal_position;

-- Expected columns:
-- | column_name          | data_type        | is_nullable |
-- |----------------------|------------------|-------------|
-- | id                   | uuid             | NO          |
-- | tenant_id            | uuid             | NO          |
-- | organization_id      | uuid             | NO          |
-- | platform             | text             | NO          |
-- | access_token         | text             | YES         |
-- | refresh_token        | text             | YES         |
-- | expires_at           | timestamp        | YES         |
-- | created_at           | timestamp        | YES         |
-- | updated_at           | timestamp        | YES         |
-- | connected_by_user_id | uuid             | YES         |  <-- G2.4

-- -----------------------------------------------------------------------------
-- PHASE 3 — G2.4 OWNERSHIP COLUMN VERIFICATION
-- -----------------------------------------------------------------------------

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'community_ai_platform_tokens'
  AND column_name = 'connected_by_user_id';

-- Expected: 1 row (column_name=connected_by_user_id, data_type=uuid)

-- -----------------------------------------------------------------------------
-- PHASE 4 — INDEX VERIFICATION
-- -----------------------------------------------------------------------------

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'community_ai_platform_tokens'
ORDER BY indexname;

-- Expected indexes (or equivalent):
-- - community_ai_platform_tokens_pkey (PRIMARY KEY on id)
-- - idx_community_ai_platform_tokens_tenant_id
-- - idx_community_ai_platform_tokens_organization_id
-- - idx_community_ai_platform_tokens_platform
-- - idx_community_ai_platform_tokens_connected_by (partial, WHERE connected_by_user_id IS NOT NULL)

-- -----------------------------------------------------------------------------
-- PHASE 5 — SCHEMA COMPATIBILITY (Connector Token Refresh Service)
-- -----------------------------------------------------------------------------
-- Service expects: id, tenant_id, organization_id, platform, access_token,
--                  refresh_token, expires_at
-- All present? Run Phase 2 query and confirm.

-- -----------------------------------------------------------------------------
-- PHASE 6 — OWNER-BASED DISCONNECT SUPPORT
-- -----------------------------------------------------------------------------
-- getConnectorConnectedByUserId selects connected_by_user_id.
-- Verify column exists (Phase 3) and is nullable (legacy tokens allowed).

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'community_ai_platform_tokens'
  AND column_name = 'connected_by_user_id';

-- Expected: data_type=uuid, is_nullable=YES

-- -----------------------------------------------------------------------------
-- PHASE 7 — SAFETY CHECK (Read-Only Validation)
-- -----------------------------------------------------------------------------
-- Count existing rows (no write). Optional sanity check.

SELECT COUNT(*) AS token_count FROM community_ai_platform_tokens;

-- -----------------------------------------------------------------------------
-- SUMMARY VALIDATION (Single Query)
-- -----------------------------------------------------------------------------
-- Run to get a compact pass/fail summary.

SELECT
  (SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'community_ai_platform_tokens'
  )) AS table_exists,
  (SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'community_ai_platform_tokens'
      AND column_name = 'connected_by_user_id'
  )) AS ownership_column_exists,
  (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'community_ai_platform_tokens') AS index_count;

-- Expected: table_exists=true, ownership_column_exists=true, index_count>=4
