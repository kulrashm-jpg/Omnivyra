-- Identity spine enforcement — Phase 2B / file 3 of 6
-- FIX B: canonical_users REMOVED as INSERT source (canonical tables are not
--        authoritative identity sources; they map to existing rows only).
-- FIX E: source_of_truth = 'legacy_migration_20260506' (versioned tag — rollback
--        scoped strictly to this migration run, won't delete future runtime rows
--        even if they reuse the tag stem).
-- FIX 3 (prior): email-first; phone is a separate statement, never OR-mixed.
-- FIX 7 (prior): NOT EXISTS guard prevents collisions with any existing row.

-- ============================================================
-- STEP 1: USERS — email-first
-- ============================================================
INSERT INTO public.unified_persons (id, company_id, primary_email, primary_phone, source_of_truth)
SELECT
  gen_random_uuid(),
  u.company_id,
  LOWER(TRIM(u.email)),
  NULLIF(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), ''),
  'legacy_migration_20260506'
FROM public.users u
WHERE u.email IS NOT NULL
  AND TRIM(u.email) <> ''
  AND u.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.unified_persons up
    WHERE up.company_id = u.company_id
      AND up.primary_email = LOWER(TRIM(u.email))
  );

-- ============================================================
-- STEP 2: USERS — phone-only fallback (users with phone but no email)
-- ============================================================
INSERT INTO public.unified_persons (id, company_id, primary_email, primary_phone, source_of_truth)
SELECT
  gen_random_uuid(),
  u.company_id,
  NULL,
  REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g'),
  'legacy_migration_20260506'
FROM public.users u
WHERE (u.email IS NULL OR TRIM(u.email) = '')
  AND u.phone IS NOT NULL
  AND REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g') <> ''
  AND u.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.unified_persons up
    WHERE up.company_id = u.company_id
      AND up.primary_phone = REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g')
  );

-- ============================================================
-- STEP 3: LEADS — email-first
-- ============================================================
INSERT INTO public.unified_persons (id, company_id, primary_email, primary_phone, source_of_truth)
SELECT
  gen_random_uuid(),
  l.company_id,
  LOWER(TRIM(l.email)),
  NULLIF(REGEXP_REPLACE(COALESCE(l.phone, ''), '[^0-9]', '', 'g'), ''),
  'legacy_migration_20260506'
FROM public.leads l
WHERE l.email IS NOT NULL
  AND TRIM(l.email) <> ''
  AND l.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.unified_persons up
    WHERE up.company_id = l.company_id
      AND up.primary_email = LOWER(TRIM(l.email))
  );

-- ============================================================
-- STEP 4: LEADS — phone-only fallback
-- ============================================================
INSERT INTO public.unified_persons (id, company_id, primary_email, primary_phone, source_of_truth)
SELECT
  gen_random_uuid(),
  l.company_id,
  NULL,
  REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'),
  'legacy_migration_20260506'
FROM public.leads l
WHERE (l.email IS NULL OR TRIM(l.email) = '')
  AND l.phone IS NOT NULL
  AND REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g') <> ''
  AND l.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.unified_persons up
    WHERE up.company_id = l.company_id
      AND up.primary_phone = REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g')
  );

-- NOTE (FIX B): canonical_users is INTENTIONALLY OMITTED as an INSERT source.
-- Canonical tables are downstream of authoritative identity sources (auth/CRM/inbound),
-- so they can only MAP to existing unified_persons rows — never originate new ones.
-- canonical_users that have no matching email/phone in users/leads will remain
-- with NULL unified_person_id after this migration and are picked up by the
-- external_user_keys fallback in file 4.
