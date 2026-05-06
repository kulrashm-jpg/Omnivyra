-- Phase 2B.5 — engagement identity deterministic backfill.
-- All steps are idempotent (NOT EXISTS / IS NULL guards, ON CONFLICT DO NOTHING).
-- Already applied to prod via mcp__supabase__execute_sql; this file exists so
-- a fresh environment can reach the same state via `supabase db push`.

-- 1. candidates (idempotent)
INSERT INTO engagement_identity_candidates (platform, external_id, identity_type)
SELECT DISTINCT 'linkedin', raw_payload->>'sender_username', 'urn'
FROM engagement_messages
WHERE raw_payload->>'sender_username' IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2. derive company per URN from threads where the URN appears
CREATE TEMP TABLE urn_company_map ON COMMIT DROP AS
SELECT DISTINCT
  raw_payload->>'sender_username' AS external_id,
  t.organization_id AS company_id
FROM engagement_messages m
JOIN engagement_threads t ON t.id = m.thread_id
WHERE raw_payload->>'sender_username' IS NOT NULL
  AND t.organization_id IS NOT NULL;

-- 3. insert spine (idempotent) — one unified_persons row per (company, URN)
INSERT INTO unified_persons (company_id, external_keys, source_of_truth)
SELECT
  ucm.company_id,
  jsonb_build_object('linkedin_urns', jsonb_build_array(ucm.external_id)),
  'engagement'
FROM urn_company_map ucm
WHERE NOT EXISTS (
  SELECT 1 FROM unified_persons up
  WHERE up.external_keys @> jsonb_build_object(
    'linkedin_urns', jsonb_build_array(ucm.external_id)
  )
);

-- 4. link candidates to spine
UPDATE engagement_identity_candidates eic
SET unified_person_id = up.id
FROM unified_persons up
WHERE up.external_keys @> jsonb_build_object(
  'linkedin_urns', jsonb_build_array(eic.external_id)
)
AND eic.unified_person_id IS NULL
AND eic.identity_type = 'urn';

-- 5. thread attribution — counterparty is the most-common non-self URN per thread
UPDATE engagement_threads t
SET unified_person_id = sub.unified_person_id
FROM (
  SELECT
    m.thread_id,
    up.id AS unified_person_id,
    ROW_NUMBER() OVER (
      PARTITION BY m.thread_id
      ORDER BY COUNT(*) DESC
    ) AS rn
  FROM engagement_messages m
  JOIN unified_persons up
    ON up.external_keys @> jsonb_build_object(
      'linkedin_urns',
      jsonb_build_array(m.raw_payload->>'sender_username')
    )
  WHERE m.raw_payload->>'sender_username' IS NOT NULL
    AND COALESCE((m.raw_payload->>'author_self')::boolean, false) = false
  GROUP BY m.thread_id, up.id
) sub
WHERE t.id = sub.thread_id
AND sub.rn = 1;
