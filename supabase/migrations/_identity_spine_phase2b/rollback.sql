-- ROLLBACK SCRIPT for identity-spine Phase 2B (files 1–6).
-- NOT a Supabase migration — store outside migrations/ runner. Run manually
-- via psql / Supabase SQL editor only if a rollback is required.
--
-- Strategy: reverse order of forward migrations. Drop NOT NULL, drop unique
-- indexes, restore non-unique indexes, NULL out FKs, delete spine rows
-- created during backfill (versioned tag), drop merge table, drop new columns.
--
-- FIX E: spine rows are tagged 'legacy_migration_20260506' (versioned).
-- This DELETE will NOT remove future runtime rows that use other tags
-- (e.g. 'legacy_migration_20260615' or 'crm_ingestion'). Safe to re-run.

BEGIN;

-- 1. Drop NOT NULL on users / leads
ALTER TABLE public.users  ALTER COLUMN unified_person_id DROP NOT NULL;
ALTER TABLE public.leads  ALTER COLUMN unified_person_id DROP NOT NULL;

-- 2. Drop new unique indexes; restore old non-unique ones
DROP INDEX IF EXISTS public.idx_unified_persons_company_email_unique;
DROP INDEX IF EXISTS public.idx_unified_persons_company_phone_unique;

CREATE INDEX IF NOT EXISTS idx_unified_persons_company_email
  ON public.unified_persons(company_id, primary_email)
  WHERE primary_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unified_persons_company_phone
  ON public.unified_persons(company_id, primary_phone)
  WHERE primary_phone IS NOT NULL;

-- 3. NULL out FKs that point to backfilled spine rows (so DELETE below
--    doesn't cascade ON DELETE SET NULL on every linked row separately).
UPDATE public.engagement_threads
   SET unified_person_id = NULL
 WHERE unified_person_id IN (
   SELECT id FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506'
 );

UPDATE public.contacts
   SET unified_person_id = NULL
 WHERE unified_person_id IN (
   SELECT id FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506'
 );

UPDATE public.canonical_revenue_events
   SET unified_person_id = NULL
 WHERE unified_person_id IN (
   SELECT id FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506'
 );

UPDATE public.canonical_leads
   SET unified_person_id = NULL
 WHERE unified_person_id IN (
   SELECT id FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506'
 );

UPDATE public.canonical_users
   SET unified_person_id = NULL
 WHERE unified_person_id IN (
   SELECT id FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506'
 );

UPDATE public.users
   SET unified_person_id = NULL
 WHERE unified_person_id IN (
   SELECT id FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506'
 );

UPDATE public.leads
   SET unified_person_id = NULL
 WHERE unified_person_id IN (
   SELECT id FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506'
 );

-- 4. Delete the spine rows that were created at backfill time (versioned tag)
DELETE FROM public.unified_persons
 WHERE source_of_truth = 'legacy_migration_20260506';

-- 5. Drop FK constraints + indexes + unified_person_id columns from users/leads
ALTER TABLE public.users  DROP CONSTRAINT IF EXISTS fk_users_unified_person;
ALTER TABLE public.leads  DROP CONSTRAINT IF EXISTS fk_leads_unified_person;
DROP INDEX IF EXISTS public.idx_users_unified_person;
DROP INDEX IF EXISTS public.idx_leads_unified_person;
ALTER TABLE public.users  DROP COLUMN IF EXISTS unified_person_id;
ALTER TABLE public.leads  DROP COLUMN IF EXISTS unified_person_id;

-- 6. Drop merge log table
DROP INDEX IF EXISTS public.idx_unified_person_merges_winner;
DROP INDEX IF EXISTS public.idx_unified_person_merges_company_created;
DROP TABLE IF EXISTS public.unified_person_merges;

-- 7. Drop source-of-truth columns from unified_persons
ALTER TABLE public.unified_persons DROP COLUMN IF EXISTS source_priority;
ALTER TABLE public.unified_persons DROP COLUMN IF EXISTS source_of_truth;

-- NOTE: external_keys enrichments written in file 4 (contact_keys + external_user_keys
-- arrays) are NOT explicitly cleaned up here — that JSON state is harmless without
-- the surrounding linking SQL. If a fully clean state is required:
--   UPDATE public.unified_persons SET external_keys = external_keys - 'contact_keys' - 'external_user_keys';

COMMIT;

-- POST-ROLLBACK VERIFICATION
-- Run these after COMMIT:
--   SELECT COUNT(*) FROM public.unified_persons WHERE source_of_truth IS NOT NULL;  -- column gone → error expected
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='users' AND column_name='unified_person_id';  -- expect 0 rows
--   SELECT to_regclass('public.unified_person_merges');  -- expect NULL
