-- Rollback for 20270217000027_creator_render_output_company_id.sql.
-- Removes the guard triggers and function, the FK, the index and the column. Idempotent. Nothing is lost: the
-- value is fully re-derivable from the output's lineage (attempt -> variant -> job.organization_id), whose foreign
-- keys are all NOT NULL and ON DELETE RESTRICT. NOTE: once rows exist, RE-applying 027 after this rollback is
-- refused by its preflight (append-only ledger rows cannot be backfilled in place); that needs a ruling.
-- Provenance: it REFUSES to drop a company_id column when the guard function is absent, unless the column is absent
-- too (already rolled back): only what 027 created is removed (027's preflight refuses to adopt a pre-existing
-- column, so column + guard together prove 027 created it).
-- WARNING: after this, render outputs are tenant-scoped only through their lineage again (the seam's child path).

BEGIN;

DO $provenance$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.creator_render_output'::regclass
              AND attname = 'company_id' AND NOT attisdropped)
     AND to_regprocedure('public.creator_render_output_company_id_guard()') IS NULL THEN
    RAISE EXCEPTION 'CRO-COMPANY rollback: creator_render_output.company_id exists without the 027 guard function; it was not created by 027, refusing to drop it';
  END IF;
END
$provenance$;

DROP TRIGGER IF EXISTS creator_render_output_company_id_guard_ins ON public.creator_render_output;
DROP TRIGGER IF EXISTS creator_render_output_company_id_guard_upd ON public.creator_render_output;
DROP FUNCTION IF EXISTS public.creator_render_output_company_id_guard();
ALTER TABLE public.creator_render_output DROP CONSTRAINT IF EXISTS creator_render_output_company_id_fkey;
DROP INDEX IF EXISTS public.idx_creator_render_output_company_id;
ALTER TABLE public.creator_render_output DROP COLUMN IF EXISTS company_id;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.creator_render_output'::regclass
              AND attname = 'company_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CRO-COMPANY rollback verify: creator_render_output.company_id still exists';
  END IF;
  IF to_regprocedure('public.creator_render_output_company_id_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'CRO-COMPANY rollback verify: guard function still exists';
  END IF;
END
$verify$;

COMMIT;
