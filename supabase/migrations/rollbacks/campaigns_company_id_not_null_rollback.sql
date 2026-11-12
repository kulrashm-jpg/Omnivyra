-- Rollback for 20270217000025_campaigns_company_id_not_null.sql.
-- Restores the pre-migration shape: campaigns.company_id nullable, and campaigns_company_id_fkey
-- ON DELETE SET NULL (ON UPDATE kept as it is). No data is touched.
-- NOTE: rolling back re-opens the defect class (a campaign can again be created without its company,
-- and deleting a company again orphans its campaigns). Roll back only with a reason.

BEGIN;

DO $fk$
DECLARE
  v_deltype "char";
  v_updtype "char";
  v_on_update text;
BEGIN
  SELECT confdeltype, confupdtype INTO v_deltype, v_updtype
    FROM pg_constraint
   WHERE conrelid = 'public.campaigns'::regclass AND conname = 'campaigns_company_id_fkey';
  IF v_deltype IS NULL THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN rollback: campaigns_company_id_fkey not found';
  END IF;
  IF v_deltype = 'n' THEN
    RETURN;
  END IF;
  v_on_update := CASE v_updtype
    WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END;
  ALTER TABLE public.campaigns DROP CONSTRAINT campaigns_company_id_fkey;
  EXECUTE format(
    'ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE %s ON DELETE SET NULL',
    v_on_update);
END
$fk$;

ALTER TABLE public.campaigns ALTER COLUMN company_id DROP NOT NULL;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.campaigns'::regclass
       AND a.attname = 'company_id' AND NOT a.attisdropped AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN rollback verify: company_id is still NOT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.campaigns'::regclass AND conname = 'campaigns_company_id_fkey'
       AND contype = 'f' AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'CAMPAIGNS-COMPANY-NN rollback verify: campaigns_company_id_fkey is not ON DELETE SET NULL';
  END IF;
END
$verify$;

COMMIT;
