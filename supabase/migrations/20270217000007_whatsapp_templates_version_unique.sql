-- WhatsApp templates: one row per (company, template name, version) (version 20270217000007,
-- reserved by virality-83; CLASS-2 B7, e9 sweep; on fix/unread-error-send-main).
--
-- B7. submitTemplate reads the highest version and inserts version + 1, then submits it to Meta.
-- Only a NON-unique index (idx_wa_templates_company_name) covers the pair, so a double-clicked
-- submit inserted the SAME version twice and submitted the template to Meta TWICE. With this unique
-- index the second insert fails (23505) BEFORE its Meta call; submitTemplate answers it as "a
-- submission of this template is already in progress".
--
-- PRODUCTION FACT (C19, via 83, read-only, 2026-11-12): whatsapp_templates has 0 rows. The preflight
-- RAISES on any duplicate rather than renumbering one. NULLS NOT DISTINCT: company_id is nullable.

BEGIN;

DO $preflight$
DECLARE
  v_dups bigint;
BEGIN
  IF to_regclass('public.whatsapp_templates') IS NULL THEN
    RAISE EXCEPTION 'WTVU preflight: public.whatsapp_templates is missing';
  END IF;
  SELECT count(*) INTO v_dups FROM (
    SELECT company_id, template_name, version FROM public.whatsapp_templates
     GROUP BY company_id, template_name, version HAVING count(*) > 1
  ) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'WTVU preflight: % (company, template_name, version) triple(s) are duplicated - resolve them (an owner-approved data step) before this migration; it does not renumber', v_dups;
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_version_unique
  ON public.whatsapp_templates (company_id, template_name, version) NULLS NOT DISTINCT;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.whatsapp_templates'::regclass AND c.relname = 'whatsapp_templates_version_unique'
       AND i.indisunique AND i.indnullsnotdistinct AND i.indpred IS NULL
  ) THEN
    RAISE EXCEPTION 'WTVU postcondition: whatsapp_templates_version_unique must be UNIQUE NULLS NOT DISTINCT (company_id, template_name, version)';
  END IF;
  RAISE NOTICE 'WTVU: one row per (company, template_name, version).';
END
$verify$;

COMMIT;
