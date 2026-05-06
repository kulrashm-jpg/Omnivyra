-- Identity spine enforcement — Phase 2B / file 4 of 6
-- Links every users/leads/canonical_users/canonical_leads/canonical_revenue_events/
-- contacts/engagement_threads row to its unified_persons row, where a path exists.
--
-- FIX A: contacts and engagement_threads now have explicit linking SQL.
-- FIX F: canonical_users gains an external_user_keys fallback after email/phone.
--
-- Linking precedence (per Fix 3): email > phone > external_keys.
-- Each match is its own statement; no OR-mixed JOINs.
--
-- IMPORTANT: contacts.contact_key and canonical_users.external_user_key are
-- enriched into unified_persons.external_keys *first*, so subsequent linking
-- statements can match through that index.

-- =====================================================================
-- USERS — email-first, phone fallback
-- =====================================================================
UPDATE public.users u
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE u.unified_person_id IS NULL
  AND u.company_id = up.company_id
  AND u.email IS NOT NULL
  AND up.primary_email = LOWER(TRIM(u.email));

UPDATE public.users u
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE u.unified_person_id IS NULL
  AND u.phone IS NOT NULL
  AND u.company_id = up.company_id
  AND up.primary_phone = REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g')
  AND REGEXP_REPLACE(u.phone, '[^0-9]', '', 'g') <> '';

-- =====================================================================
-- LEADS — email-first, phone fallback
-- =====================================================================
UPDATE public.leads l
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE l.unified_person_id IS NULL
  AND l.company_id = up.company_id
  AND l.email IS NOT NULL
  AND up.primary_email = LOWER(TRIM(l.email));

UPDATE public.leads l
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE l.unified_person_id IS NULL
  AND l.phone IS NOT NULL
  AND l.company_id = up.company_id
  AND up.primary_phone = REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g')
  AND REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g') <> '';

-- =====================================================================
-- CANONICAL_USERS — email-first, phone fallback
-- =====================================================================
UPDATE public.canonical_users cu
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE cu.unified_person_id IS NULL
  AND cu.company_id = up.company_id
  AND cu.email IS NOT NULL
  AND up.primary_email = LOWER(TRIM(cu.email));

UPDATE public.canonical_users cu
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE cu.unified_person_id IS NULL
  AND cu.phone IS NOT NULL
  AND cu.company_id = up.company_id
  AND up.primary_phone = REGEXP_REPLACE(cu.phone, '[^0-9]', '', 'g')
  AND REGEXP_REPLACE(cu.phone, '[^0-9]', '', 'g') <> '';

-- =====================================================================
-- ENRICHMENT: write canonical_users.external_user_key into
-- unified_persons.external_keys.external_user_keys[] for newly-linked rows.
-- Required so the FIX F fallback below has data to match against.
-- =====================================================================
UPDATE public.unified_persons up
SET external_keys = jsonb_set(
  COALESCE(up.external_keys, '{}'::jsonb),
  '{external_user_keys}',
  COALESCE(up.external_keys->'external_user_keys', '[]'::jsonb)
    || to_jsonb(cu.external_user_key)
)
FROM public.canonical_users cu
WHERE cu.unified_person_id = up.id
  AND cu.external_user_key IS NOT NULL
  AND TRIM(cu.external_user_key) <> ''
  AND NOT (
    COALESCE(up.external_keys->'external_user_keys', '[]'::jsonb)
      @> to_jsonb(cu.external_user_key)
  );

-- =====================================================================
-- FIX F: CANONICAL_USERS — external_user_keys fallback
-- For canonical_users still NULL after email/phone, match by external_user_key
-- against unified_persons.external_keys.external_user_keys[].
-- =====================================================================
UPDATE public.canonical_users cu
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE cu.unified_person_id IS NULL
  AND cu.external_user_key IS NOT NULL
  AND TRIM(cu.external_user_key) <> ''
  AND cu.company_id = up.company_id
  AND up.external_keys -> 'external_user_keys' ? cu.external_user_key;

-- =====================================================================
-- CANONICAL_LEADS — link via canonical_users (no email column on canonical_leads)
-- =====================================================================
UPDATE public.canonical_leads cl
SET unified_person_id = cu.unified_person_id
FROM public.canonical_users cu
WHERE cl.unified_person_id IS NULL
  AND cu.unified_person_id IS NOT NULL
  AND cl.user_id = cu.id
  AND cl.company_id = cu.company_id;

-- =====================================================================
-- CANONICAL_REVENUE_EVENTS — link via canonical_leads
-- =====================================================================
UPDATE public.canonical_revenue_events cre
SET unified_person_id = cl.unified_person_id
FROM public.canonical_leads cl
WHERE cre.unified_person_id IS NULL
  AND cl.unified_person_id IS NOT NULL
  AND cre.lead_id = cl.id
  AND cre.company_id = cl.company_id;

-- =====================================================================
-- ENRICHMENT: write contacts.contact_key into
-- unified_persons.external_keys.contact_keys[] for spine rows that
-- already have a path through engagement_threads → contacts → owner_user.
-- For initial backfill (no thread→user enrichment yet) this is a no-op,
-- but the SQL is in place so future ingestion writes contact_keys can
-- be linked retroactively via the UPDATE below.
-- =====================================================================
UPDATE public.unified_persons up
SET external_keys = jsonb_set(
  COALESCE(up.external_keys, '{}'::jsonb),
  '{contact_keys}',
  COALESCE(up.external_keys->'contact_keys', '[]'::jsonb)
    || to_jsonb(c.contact_key)
)
FROM public.contacts c
WHERE c.unified_person_id = up.id
  AND c.contact_key IS NOT NULL
  AND TRIM(c.contact_key) <> ''
  AND NOT (
    COALESCE(up.external_keys->'contact_keys', '[]'::jsonb)
      @> to_jsonb(c.contact_key)
  );

-- =====================================================================
-- FIX A: CONTACTS — link via unified_persons.external_keys.contact_keys[]
-- For initial backfill: no spine row currently carries contact_keys, so this
-- statement is a no-op. It is in place for future ingestion that populates
-- contact_keys at write time, plus any retroactive enrichment that does so.
-- =====================================================================
UPDATE public.contacts c
SET unified_person_id = up.id
FROM public.unified_persons up
WHERE c.unified_person_id IS NULL
  AND c.organization_id = up.company_id
  AND up.external_keys -> 'contact_keys' ? c.contact_key;

-- =====================================================================
-- FIX A: ENGAGEMENT_THREADS — link via contacts (primary path)
-- =====================================================================
UPDATE public.engagement_threads t
SET unified_person_id = c.unified_person_id
FROM public.contacts c
WHERE t.unified_person_id IS NULL
  AND t.contact_id = c.id
  AND c.unified_person_id IS NOT NULL;

-- =====================================================================
-- FIX A: ENGAGEMENT_THREADS — fallback via raw_payload.external_user_key
-- engagement_threads.raw_payload may carry the upstream external_user_key
-- (e.g. from social-platform webhooks). Defensive read: '?' guards against
-- missing key, '->>' returns NULL if not present.
-- =====================================================================
UPDATE public.engagement_threads t
SET unified_person_id = cu.unified_person_id
FROM public.canonical_users cu
WHERE t.unified_person_id IS NULL
  AND cu.unified_person_id IS NOT NULL
  AND t.raw_payload IS NOT NULL
  AND t.raw_payload ? 'external_user_key'
  AND cu.external_user_key = (t.raw_payload->>'external_user_key');

-- NOTE: contacts and engagement_threads do not get a NOT NULL constraint in
-- file 6 because some rows may have no resolution path (e.g. a social DM from
-- an anonymous handle). They remain optional and are linked best-effort.
