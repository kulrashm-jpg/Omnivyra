-- ROLLBACK for 20261001000000_li1_canonical_attribute_surface.sql
--
-- ############################################################################
-- #  WARNING — THIS IS DESTRUCTIVE. DROPPING A COLUMN DESTROYS ITS DATA.      #
-- ############################################################################
--
-- Unlike the W2/W4/W5 rollbacks, this one is NOT lossless. Those changed only
-- constraints; this removes columns. Every attribute written since LI-1 was
-- applied — every name, title, seniority, geography and firmographic — is gone
-- the moment this runs, and no other table holds a copy (LI-2 source-record
-- retention does not exist yet, which is precisely why there is no second copy).
--
-- The only period during which this is genuinely cheap is BEFORE any ingestion
-- or enrichment has written to these columns. At the time of writing that is
-- the case: the sole populated field is `full_name` on the persons backfilled
-- from `leads.name`, and that value still exists in `leads`.
--
-- BEFORE RUNNING, check what you are about to destroy:
--
--   SELECT count(*) FILTER (WHERE full_name IS NOT NULL)     AS names,
--          count(*) FILTER (WHERE job_title IS NOT NULL)     AS titles,
--          count(*) FILTER (WHERE country_code IS NOT NULL)  AS geo,
--          count(*) FILTER (WHERE attributes_source IS NOT NULL
--                       AND attributes_source <> 'li1_backfill_lead_name') AS non_backfill
--     FROM public.unified_persons;
--
--   SELECT count(*) FILTER (WHERE industry IS NOT NULL)      AS industries,
--          count(*) FILTER (WHERE employee_count IS NOT NULL
--                        OR employee_band IS NOT NULL)       AS sizing
--     FROM public.prospect_accounts;
--
-- If `non_backfill` or any account figure is greater than zero, something other
-- than the LI-1 backfill has written here and this rollback will lose it.
--
-- The guard below fails closed so this cannot be run by reflex.

BEGIN;

DO $guard$
DECLARE
  v_ack       TEXT := current_setting('li1.confirm_drop_attribute_surface', true);
  v_non_bf    BIGINT;
  v_acct      BIGINT;
BEGIN
  IF v_ack IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'LI-1 rollback refused. Dropping these columns DESTROYS all canonical person and '
      'account attributes. To proceed deliberately: '
      'SET LOCAL "li1.confirm_drop_attribute_surface" = ''yes'';';
  END IF;

  SELECT count(*) INTO v_non_bf FROM public.unified_persons
   WHERE attributes_source IS NOT NULL AND attributes_source <> 'li1_backfill_lead_name';
  SELECT count(*) INTO v_acct FROM public.prospect_accounts
   WHERE attributes_source IS NOT NULL;

  IF v_non_bf > 0 OR v_acct > 0 THEN
    RAISE WARNING 'LI-1 ROLLBACK: destroying attributes written by a real source — % person row(s), % account row(s).', v_non_bf, v_acct;
  END IF;
  RAISE WARNING 'LI-1 ROLLBACK: removing the canonical attribute surface.';
END
$guard$;

-- Constraints first, then columns, so a partially-applied rollback cannot leave
-- a CHECK referencing a dropped column.
ALTER TABLE public.unified_persons
  DROP CONSTRAINT IF EXISTS unified_persons_names_not_blank,
  DROP CONSTRAINT IF EXISTS unified_persons_job_fields_not_blank,
  DROP CONSTRAINT IF EXISTS unified_persons_seniority_valid,
  DROP CONSTRAINT IF EXISTS unified_persons_country_code_shape,
  DROP CONSTRAINT IF EXISTS unified_persons_geo_not_blank,
  DROP CONSTRAINT IF EXISTS unified_persons_attributes_provenance_coherent,
  DROP CONSTRAINT IF EXISTS unified_persons_attributes_source_not_blank;

ALTER TABLE public.prospect_accounts
  DROP CONSTRAINT IF EXISTS prospect_accounts_firmographics_not_blank,
  DROP CONSTRAINT IF EXISTS prospect_accounts_employee_count_valid,
  DROP CONSTRAINT IF EXISTS prospect_accounts_employee_band_valid,
  DROP CONSTRAINT IF EXISTS prospect_accounts_country_code_shape,
  DROP CONSTRAINT IF EXISTS prospect_accounts_attributes_provenance_coherent,
  DROP CONSTRAINT IF EXISTS prospect_accounts_attributes_source_not_blank;

ALTER TABLE public.unified_persons
  DROP COLUMN IF EXISTS full_name,
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS job_title,
  DROP COLUMN IF EXISTS department,
  DROP COLUMN IF EXISTS seniority,
  DROP COLUMN IF EXISTS country_code,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS attributes_source,
  DROP COLUMN IF EXISTS attributes_updated_at;

ALTER TABLE public.prospect_accounts
  DROP COLUMN IF EXISTS industry,
  DROP COLUMN IF EXISTS employee_count,
  DROP COLUMN IF EXISTS employee_band,
  DROP COLUMN IF EXISTS country_code,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS attributes_source,
  DROP COLUMN IF EXISTS attributes_updated_at;

-- Identity, tenancy and provenance are untouched: no column on the identity
-- path, no unique index, no foreign key and no W5 composite key is affected.

COMMIT;
