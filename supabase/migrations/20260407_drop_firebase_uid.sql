-- ─────────────────────────────────────────────────────────────────────────────
-- Remove firebase_uid from users table
--
-- Firebase auth has been fully replaced by Supabase auth.
-- supabase_uid is now the sole auth identity column.
-- firebase_uid is dead code and its presence is misleading.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the unique constraint added in 20260401_firebase_uid_full_unique.sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_firebase_uid_unique;

-- Drop the partial index added in 20260331_auth_columns.sql / 20260323_apply_all_pending.sql
DROP INDEX IF EXISTS users_firebase_uid_key;

-- Drop the column
ALTER TABLE users DROP COLUMN IF EXISTS firebase_uid;
