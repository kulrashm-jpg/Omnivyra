-- Identity spine enforcement — Phase 2B / file 1 of 6
-- Adds source_of_truth + source_priority to unified_persons,
-- and nullable unified_person_id FK columns to users + leads.
-- Fully reversible (see _identity_spine_phase2b/rollback.sql).

-- 1. unified_persons source-of-truth columns
ALTER TABLE public.unified_persons
  ADD COLUMN IF NOT EXISTS source_of_truth TEXT;

ALTER TABLE public.unified_persons
  ADD COLUMN IF NOT EXISTS source_priority JSONB
    DEFAULT '{"crm":1,"auth":2,"inbound":3,"manual":4}'::jsonb;

-- 2. users.unified_person_id (nullable; NOT NULL applied in file 6 after backfill)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS unified_person_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_unified_person'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_unified_person
      FOREIGN KEY (unified_person_id)
      REFERENCES public.unified_persons(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_unified_person
  ON public.users(unified_person_id)
  WHERE unified_person_id IS NOT NULL;

-- 3. leads.unified_person_id (nullable; NOT NULL applied in file 6 after backfill)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS unified_person_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_leads_unified_person'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT fk_leads_unified_person
      FOREIGN KEY (unified_person_id)
      REFERENCES public.unified_persons(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_unified_person
  ON public.leads(unified_person_id)
  WHERE unified_person_id IS NOT NULL;
