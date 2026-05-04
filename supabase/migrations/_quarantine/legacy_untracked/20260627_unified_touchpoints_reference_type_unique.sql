BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unified_touchpoints_reference_unique'
      AND conrelid = 'public.unified_touchpoints'::regclass
  ) THEN
    ALTER TABLE public.unified_touchpoints
      DROP CONSTRAINT unified_touchpoints_reference_unique;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unified_touchpoints_reference_type_unique'
      AND conrelid = 'public.unified_touchpoints'::regclass
  ) THEN
    ALTER TABLE public.unified_touchpoints
      ADD CONSTRAINT unified_touchpoints_reference_type_unique
      UNIQUE (company_id, reference_table, reference_id, touchpoint_type);
  END IF;
END $$;

COMMENT ON CONSTRAINT unified_touchpoints_reference_type_unique ON public.unified_touchpoints IS
  'Idempotency key for unified touchpoints. Allows different touchpoint types to reference the same source record while preventing duplicate records for the same type.';

COMMIT;
