-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK for 20260406_multi_tenant_auth_migration.sql
--
-- Run this to undo the migration. Safe to run multiple times.
-- Does NOT delete data from company_domains / signup_intents / company_join_requests.
-- Those tables are dropped entirely (they had no data before migration).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Remove deprecation comments ──────────────────────────────────────
COMMENT ON COLUMN users.company_id IS NULL;

-- ── 2. Drop new users columns ───────────────────────────────────────────────
ALTER TABLE users DROP COLUMN IF EXISTS active_company_id;
ALTER TABLE users DROP COLUMN IF EXISTS onboarding_state;
ALTER TABLE users DROP COLUMN IF EXISTS has_password;
ALTER TABLE users DROP COLUMN IF EXISTS signup_source;
ALTER TABLE users DROP COLUMN IF EXISTS supabase_uid;

-- ── 3. Drop new indexes on users ────────────────────────────────────────────
DROP INDEX IF EXISTS users_supabase_uid_key;
DROP INDEX IF EXISTS idx_users_active_company_id;
DROP INDEX IF EXISTS idx_users_onboarding_state;

-- ── 4. Drop new tables ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS company_join_requests CASCADE;
DROP TABLE IF EXISTS signup_intents CASCADE;
DROP TABLE IF EXISTS company_domains CASCADE;

-- ── 5. Drop new indexes on user_company_roles ───────────────────────────────
DROP INDEX IF EXISTS idx_user_company_roles_user_company_active;

-- ── 6. Remove deprecation comment from companies ────────────────────────────
COMMENT ON COLUMN companies.admin_email_domain IS NULL;

-- ── 7. Un-soft-delete rows that were soft-deleted by duplicate cleanup ───────
-- NOTE: This cannot perfectly restore — the cleanup identified duplicates and
-- marked them is_deleted=true. If you need to restore, you'll need to manually
-- review rows with deleted_at matching the migration run time.

COMMIT;
