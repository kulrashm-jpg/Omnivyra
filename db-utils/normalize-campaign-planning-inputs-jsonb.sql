-- Normalize campaign_planning_inputs.available_content + weekly_capacity to JSONB
-- Safe + idempotent: only alters columns when they exist and are not jsonb.

BEGIN;

DO $$
DECLARE
  available_type TEXT;
  capacity_type TEXT;
BEGIN
  SELECT data_type INTO available_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'campaign_planning_inputs'
    AND column_name = 'available_content';

  SELECT data_type INTO capacity_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'campaign_planning_inputs'
    AND column_name = 'weekly_capacity';

  IF available_type IS NOT NULL AND available_type <> 'jsonb' THEN
    CREATE OR REPLACE FUNCTION public.safe_jsonb(v TEXT)
    RETURNS JSONB
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF v IS NULL OR btrim(v) = '' THEN
        RETURN '{}'::jsonb;
      END IF;
      BEGIN
        RETURN v::jsonb;
      EXCEPTION WHEN others THEN
        RETURN '{}'::jsonb;
      END;
    END;
    $fn$;

    EXECUTE 'ALTER TABLE public.campaign_planning_inputs ' ||
            'ALTER COLUMN available_content TYPE jsonb USING public.safe_jsonb(available_content::text)';
  END IF;

  IF capacity_type IS NOT NULL AND capacity_type <> 'jsonb' THEN
    CREATE OR REPLACE FUNCTION public.safe_jsonb(v TEXT)
    RETURNS JSONB
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF v IS NULL OR btrim(v) = '' THEN
        RETURN '{}'::jsonb;
      END IF;
      BEGIN
        RETURN v::jsonb;
      EXCEPTION WHEN others THEN
        RETURN '{}'::jsonb;
      END;
    END;
    $fn$;

    EXECUTE 'ALTER TABLE public.campaign_planning_inputs ' ||
            'ALTER COLUMN weekly_capacity TYPE jsonb USING public.safe_jsonb(weekly_capacity::text)';
  END IF;
END $$;

COMMIT;

