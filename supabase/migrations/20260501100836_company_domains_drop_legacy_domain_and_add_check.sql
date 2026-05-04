-- FINAL FIX: fully idempotent + replay safe

DO $$
BEGIN

  -- 1. Drop legacy column ONLY if it exists
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'company_domains'
      AND column_name = 'domain'
  ) THEN

    ALTER TABLE public.company_domains
      DROP COLUMN domain;

  END IF;


  -- 2. Ensure final_domain_not_empty constraint exists
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'final_domain_not_empty'
      AND conrelid = 'public.company_domains'::regclass
  ) THEN

    ALTER TABLE public.company_domains
      ADD CONSTRAINT final_domain_not_empty
      CHECK (final_domain <> '');

  END IF;

END $$;