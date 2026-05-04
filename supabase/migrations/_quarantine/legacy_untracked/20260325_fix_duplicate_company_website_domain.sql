-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: backfill website_domain for companies where it is NULL but website exists
--      and deactivate duplicate Omnivyra company (www.omnivyra.com created 3/25)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Backfill website_domain for all companies that have a website URL but
--    no website_domain stored yet.
UPDATE companies
SET website_domain = (
  -- Strip protocol and www. from the stored website URL
  LOWER(REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(website, '^https?://', ''),  -- strip protocol
      '^www\.', ''                                 -- strip www.
    ),
    '/.*$', ''                                     -- strip path
  ))
)
WHERE website IS NOT NULL
  AND website != ''
  AND website_domain IS NULL;

-- 2. Normalise any existing website_domain values that still carry "www." prefix
UPDATE companies
SET website_domain = REGEXP_REPLACE(website_domain, '^www\.', '')
WHERE website_domain LIKE 'www.%';

-- 3. Merge duplicate Omnivyra: the company created on 2026-03-22 (website
--    omnivyra.com) is the canonical one. The duplicate created on 2026-03-25
--    (www.omnivyra.com, now also resolved to omnivyra.com after step 2) needs
--    to be deactivated after any users/roles are migrated to the original.
--
--    First, re-parent any user_company_roles rows that point to the duplicate.
DO $$
DECLARE
  v_canonical_id   uuid;
  v_duplicate_id   uuid;
BEGIN
  -- Find the two Omnivyra companies sorted by creation date (oldest = canonical)
  SELECT id INTO v_canonical_id
  FROM companies
  WHERE LOWER(name) LIKE '%omnivyra%'
    AND status = 'active'
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT id INTO v_duplicate_id
  FROM companies
  WHERE LOWER(name) LIKE '%omnivyra%'
    AND status = 'active'
    AND id != v_canonical_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_canonical_id IS NULL OR v_duplicate_id IS NULL THEN
    RAISE NOTICE 'Omnivyra dedup: could not find both companies — skipping merge.';
    RETURN;
  END IF;

  RAISE NOTICE 'Merging duplicate % into canonical %', v_duplicate_id, v_canonical_id;

  -- Move any roles that don't already exist on the canonical company
  UPDATE user_company_roles
  SET company_id = v_canonical_id
  WHERE company_id = v_duplicate_id
    AND user_id NOT IN (
      SELECT user_id FROM user_company_roles WHERE company_id = v_canonical_id
    );

  -- Delete orphaned duplicate roles (user already exists on canonical)
  DELETE FROM user_company_roles WHERE company_id = v_duplicate_id;

  -- Deactivate the duplicate company
  UPDATE companies
  SET status = 'inactive', updated_at = NOW()
  WHERE id = v_duplicate_id;

  RAISE NOTICE 'Omnivyra dedup complete.';
END $$;
