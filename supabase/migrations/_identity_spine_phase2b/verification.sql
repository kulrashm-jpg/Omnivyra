-- VERIFICATION QUERIES for identity-spine Phase 2B
-- Run after applying files 1-6 (in order) on a Supabase branch.
-- Each query has an expected result documented inline.
-- If any FAIL row appears, do NOT promote to prod.

-- =====================================================================
-- A. SCHEMA HEALTH — new columns + indexes + tables exist
-- =====================================================================

-- A1. unified_persons has source_of_truth + source_priority
SELECT
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS found,
  array_agg(column_name ORDER BY column_name) AS columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'unified_persons'
  AND column_name IN ('source_of_truth', 'source_priority');
-- expect: PASS / 2 / {source_of_truth, source_priority}

-- A2. users + leads have unified_person_id (NOT NULL)
SELECT
  table_name,
  is_nullable,
  CASE WHEN is_nullable = 'NO' THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'leads')
  AND column_name = 'unified_person_id';
-- expect: 2 rows, both PASS, both is_nullable = 'NO'

-- A3. FK constraints exist on users + leads
SELECT
  conname,
  CASE WHEN conname IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status
FROM pg_constraint
WHERE conname IN ('fk_users_unified_person', 'fk_leads_unified_person');
-- expect: 2 rows PASS

-- A4. UNIQUE indexes (with phone LENGTH guard)
SELECT
  indexname,
  indexdef,
  CASE
    WHEN indexname = 'idx_unified_persons_company_email_unique'
      AND indexdef LIKE '%UNIQUE%'                        THEN 'PASS'
    WHEN indexname = 'idx_unified_persons_company_phone_unique'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%length%'                        THEN 'PASS'
    ELSE 'FAIL'
  END AS status
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'unified_persons'
  AND indexname IN (
    'idx_unified_persons_company_email_unique',
    'idx_unified_persons_company_phone_unique'
  );
-- expect: 2 rows PASS, phone index includes length guard in WHERE clause

-- A5. Old non-unique indexes were dropped
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('idx_unified_persons_company_email', 'idx_unified_persons_company_phone');
-- expect: 0 rows

-- A6. Merge log table exists
SELECT
  CASE WHEN to_regclass('public.unified_person_merges') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
  to_regclass('public.unified_person_merges') AS table_oid;
-- expect: PASS / public.unified_person_merges

-- =====================================================================
-- B. ZERO NULLs on users + leads.unified_person_id (Fix 5 hard guarantee)
-- =====================================================================

SELECT 'users.unified_person_id NULL count' AS check_name, COUNT(*) AS cnt,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM public.users WHERE unified_person_id IS NULL
UNION ALL
SELECT 'leads.unified_person_id NULL count', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.leads WHERE unified_person_id IS NULL;
-- expect: 2 rows, both cnt=0, both PASS

-- =====================================================================
-- C. FK INTEGRITY — every unified_person_id references a real spine row
-- =====================================================================

SELECT 'users orphan FKs' AS check_name, COUNT(*) AS cnt,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM public.users u LEFT JOIN public.unified_persons up ON u.unified_person_id = up.id
WHERE u.unified_person_id IS NOT NULL AND up.id IS NULL
UNION ALL
SELECT 'leads orphan FKs', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.leads l LEFT JOIN public.unified_persons up ON l.unified_person_id = up.id
WHERE l.unified_person_id IS NOT NULL AND up.id IS NULL
UNION ALL
SELECT 'canonical_users orphan FKs', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.canonical_users cu LEFT JOIN public.unified_persons up ON cu.unified_person_id = up.id
WHERE cu.unified_person_id IS NOT NULL AND up.id IS NULL
UNION ALL
SELECT 'canonical_leads orphan FKs', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.canonical_leads cl LEFT JOIN public.unified_persons up ON cl.unified_person_id = up.id
WHERE cl.unified_person_id IS NOT NULL AND up.id IS NULL
UNION ALL
SELECT 'canonical_revenue_events orphan FKs', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.canonical_revenue_events cre LEFT JOIN public.unified_persons up ON cre.unified_person_id = up.id
WHERE cre.unified_person_id IS NOT NULL AND up.id IS NULL
UNION ALL
SELECT 'contacts orphan FKs', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.contacts c LEFT JOIN public.unified_persons up ON c.unified_person_id = up.id
WHERE c.unified_person_id IS NOT NULL AND up.id IS NULL
UNION ALL
SELECT 'engagement_threads orphan FKs', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.engagement_threads t LEFT JOIN public.unified_persons up ON t.unified_person_id = up.id
WHERE t.unified_person_id IS NOT NULL AND up.id IS NULL;
-- expect: 7 rows, all cnt=0, all PASS

-- =====================================================================
-- D. UNIQUE INDEX HEALTH — confirm no duplicates exist post-backfill
-- =====================================================================

SELECT 'duplicate (company_id, primary_email)' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS dup_groups
FROM (
  SELECT company_id, primary_email FROM public.unified_persons
  WHERE primary_email IS NOT NULL
  GROUP BY company_id, primary_email
  HAVING COUNT(*) > 1
) d;

SELECT 'duplicate (company_id, primary_phone) [length>=10]' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
  COUNT(*) AS dup_groups
FROM (
  SELECT company_id, primary_phone FROM public.unified_persons
  WHERE primary_phone IS NOT NULL AND LENGTH(primary_phone) >= 10
  GROUP BY company_id, primary_phone
  HAVING COUNT(*) > 1
) d;
-- expect: both PASS / 0

-- =====================================================================
-- E. COVERAGE — backfill counts vs source counts
-- =====================================================================

-- E1. Spine row count (post-backfill total)
SELECT 'unified_persons total' AS scope, COUNT(*) AS cnt FROM public.unified_persons
UNION ALL
SELECT 'unified_persons backfilled (this run)', COUNT(*)
  FROM public.unified_persons WHERE source_of_truth = 'legacy_migration_20260506';

-- E2. Source coverage by table
SELECT 'users linked'                        AS scope, COUNT(*) FILTER (WHERE unified_person_id IS NOT NULL) AS linked, COUNT(*) AS total FROM public.users
UNION ALL SELECT 'leads linked',              COUNT(*) FILTER (WHERE unified_person_id IS NOT NULL), COUNT(*) FROM public.leads
UNION ALL SELECT 'canonical_users linked',    COUNT(*) FILTER (WHERE unified_person_id IS NOT NULL), COUNT(*) FROM public.canonical_users
UNION ALL SELECT 'canonical_leads linked',    COUNT(*) FILTER (WHERE unified_person_id IS NOT NULL), COUNT(*) FROM public.canonical_leads
UNION ALL SELECT 'canonical_revenue_events linked', COUNT(*) FILTER (WHERE unified_person_id IS NOT NULL), COUNT(*) FROM public.canonical_revenue_events
UNION ALL SELECT 'contacts linked (best-effort)',     COUNT(*) FILTER (WHERE unified_person_id IS NOT NULL), COUNT(*) FROM public.contacts
UNION ALL SELECT 'engagement_threads linked (best-effort)', COUNT(*) FILTER (WHERE unified_person_id IS NOT NULL), COUNT(*) FROM public.engagement_threads;
-- expect:
--   users:    linked = total
--   leads:    linked = total
--   canonical_users: ideally linked = total, but rows with no email/phone/external_user_key remain NULL
--   canonical_leads: linked tracks canonical_users
--   canonical_revenue_events: linked tracks canonical_leads
--   contacts: 0 unless prior ingestion populated unified_persons.external_keys.contact_keys
--   engagement_threads: 0 unless contact_id-linked contacts have unified_person_id set, or raw_payload carries external_user_key

-- =====================================================================
-- F. SOURCE-OF-TRUTH distribution
-- =====================================================================

SELECT source_of_truth, COUNT(*) AS cnt
FROM public.unified_persons
GROUP BY source_of_truth
ORDER BY cnt DESC;
-- expect: 'legacy_migration_20260506' for all backfilled rows; NULL for rows that
-- existed before this migration (none in current prod). Future runtime writes
-- should use a different tag (e.g. 'crm_ingestion', 'auth_signup', etc.).

-- =====================================================================
-- G. SOFT (non-blocking) coverage observability
-- These DO NOT raise exceptions — they surface deferred-gap counts so
-- coverage is visible in Phase 2B.5 planning (contacts/threads enrichment).
-- =====================================================================

SELECT 'unlinked_contacts (deferred — Phase 2B.5)' AS metric, COUNT(*) AS cnt
FROM public.contacts WHERE unified_person_id IS NULL
UNION ALL
SELECT 'unlinked_engagement_threads (deferred — Phase 2B.5)', COUNT(*)
FROM public.engagement_threads WHERE unified_person_id IS NULL
UNION ALL
SELECT 'unlinked_canonical_users excluding anonymous (should be 0)', COUNT(*)
FROM public.canonical_users WHERE unified_person_id IS NULL AND user_type <> 'anonymous'
UNION ALL
SELECT 'anonymous canonical_users (NULL by design)', COUNT(*)
FROM public.canonical_users WHERE user_type = 'anonymous';

-- =====================================================================
-- H. merge_unified_persons procedure exists
-- =====================================================================

SELECT
  proname AS function_name,
  CASE WHEN proname IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status
FROM pg_proc
WHERE proname = 'merge_unified_persons'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
-- expect: 1 row PASS

-- =====================================================================
-- I. GIN index on external_keys
-- =====================================================================

SELECT
  indexname,
  CASE WHEN indexdef LIKE '%USING gin%' THEN 'PASS' ELSE 'FAIL' END AS status,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'idx_unified_persons_external_keys';
-- expect: 1 row PASS, indexdef contains 'USING gin'
