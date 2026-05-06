-- Identity spine enforcement — Phase 2B / file 6 of 6
-- Asserts zero NULLs on users/leads.unified_person_id, then enforces NOT NULL.
-- DO block raises EXCEPTION if any orphan exists, aborting the transaction.
--
-- NOT NULL is NOT applied to:
--   - canonical_users / canonical_leads / canonical_revenue_events
--     (some rows may have no email/phone/external_user_key path and stay NULL)
--   - contacts / engagement_threads
--     (out-of-scope linkage; best-effort only)
--
-- This file is intentionally last — by this point file 4 has linked everything
-- it can, file 5 has verified uniqueness, and the only thing left is to enforce
-- the spine FK on the two authoritative identity-source tables.

DO $$
DECLARE
  null_users  INTEGER;
  null_leads  INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_users  FROM public.users WHERE unified_person_id IS NULL;
  SELECT COUNT(*) INTO null_leads  FROM public.leads WHERE unified_person_id IS NULL;

  IF null_users > 0 THEN
    RAISE EXCEPTION 'IDENTITY_SPINE_BACKFILL_INCOMPLETE: % users still have NULL unified_person_id', null_users;
  END IF;

  IF null_leads > 0 THEN
    RAISE EXCEPTION 'IDENTITY_SPINE_BACKFILL_INCOMPLETE: % leads still have NULL unified_person_id', null_leads;
  END IF;
END $$;

ALTER TABLE public.users
  ALTER COLUMN unified_person_id SET NOT NULL;

ALTER TABLE public.leads
  ALTER COLUMN unified_person_id SET NOT NULL;
