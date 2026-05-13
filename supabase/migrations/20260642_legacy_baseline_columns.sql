-- ─────────────────────────────────────────────────────────────────────────────
-- 20260642_legacy_baseline_columns.sql
--
-- Phase 2.B.2 — declares pre-existing columns whose creation history is not
-- captured in any prior migration in this folder.
--
-- Why this file exists
-- ────────────────────
-- During the Phase 2.B drift audit we discovered `companies.status` (and a
-- handful of other columns) present on the live database but NOT created by
-- any `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` statement in
-- `supabase/migrations/`. These columns predate the canonical migration
-- tree; their original DDL likely lived in an internal tool, an early
-- ad-hoc deploy, or a now-deleted migration file.
--
-- The CI drift checker (`scripts/check-schema-drift.js`) flagged these
-- references as schema drift, which forced us to maintain a `LEGACY_COLUMNS`
-- allowlist inside the script. Allowlists rot: they hide future drift in
-- the same column name, and they're invisible to anyone reading the
-- migrations folder.
--
-- This migration replaces the allowlist with explicit, declarative,
-- idempotent DDL: `ADD COLUMN IF NOT EXISTS` is a no-op on environments
-- where the column already exists, but it becomes the canonical "this
-- column is part of the schema contract" statement for any new environment
-- (CI ephemeral DBs, local dev resets, future replicas).
--
-- Audit policy
-- ────────────
-- Adding to this file means a column lacks proper migration history.
-- Prefer authoring a real migration for any NEW column instead. This
-- file should shrink, not grow.
--
-- Safe to run twice — every statement is `IF NOT EXISTS`.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- companies.status — operational flag ('active' | 'inactive'). Referenced
-- by super-admin tooling, TenantGuard, and the recommendation tab.
-- Confirmed present on production via `\d companies`; historical DDL not
-- in this folder.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS status TEXT;

COMMENT ON COLUMN companies.status IS
  'Operational lifecycle flag for the company. ''active'' = operational, '
  '''inactive'' = disabled (set by disable_company_cascade). NOT a soft-delete '
  '— see companies.deleted_at for that. Original DDL pre-dates the migrations '
  'tree; declared here by 20260642_legacy_baseline_columns.sql.';

COMMIT;
