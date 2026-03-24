-- ─────────────────────────────────────────────────────────────────────────────
-- Replace partial unique index on firebase_uid with a full unique constraint
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Problem: The partial index `WHERE firebase_uid IS NOT NULL` cannot be used by
-- PostgREST's `ON CONFLICT (firebase_uid)` clause — PostgreSQL requires the
-- exact predicate to be specified in the inference clause, which supabase-js
-- does not supply. This causes every upsert to fail with PostgreSQL error 42P10
-- ("there is no unique or exclusion constraint matching the ON CONFLICT
-- specification"), silently preventing new user rows from being created.
--
-- Fix: Replace the partial index with a standard UNIQUE constraint.
-- In PostgreSQL, a UNIQUE constraint on a nullable column allows multiple NULL
-- values (NULLs are treated as distinct), so invited-user stub rows that have
-- firebase_uid = NULL are unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the partial unique index created in 20260323_apply_all_pending.sql
-- (also guard against the variant name from 20260331_auth_columns.sql)
DROP INDEX IF EXISTS users_firebase_uid_key;

-- Add a standard unique constraint (allows multiple NULLs, enforces uniqueness
-- for all non-NULL values). This is what ON CONFLICT (firebase_uid) resolves to.
ALTER TABLE users
  ADD CONSTRAINT users_firebase_uid_unique UNIQUE (firebase_uid);
