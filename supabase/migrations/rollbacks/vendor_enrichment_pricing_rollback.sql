-- ROLLBACK for 20270208000000_vendor_enrichment_pricing.sql
--
-- Restores both CHECKs to their production originals (virality-83 C1,
-- 2026-11-10): verbatim value sets and names. LOSSY: every vendor-unit cost a
-- Super Admin entered (llm_model_pricing kind='unit') and every
-- action_pricing_config row with source_type 'vendor_unit' is DELETED, because
-- the original CHECKs cannot hold them. Central vendor access becomes unpriced,
-- so paid runs are refused (never charged at 0). Grants nothing.
--
-- Run only after central vendor access is switched off for every tenant.

BEGIN;

DELETE FROM public.action_pricing_config WHERE source_type = 'vendor_unit';
DELETE FROM public.llm_model_pricing WHERE kind = 'unit';

ALTER TABLE public.llm_model_pricing DROP CONSTRAINT IF EXISTS llm_model_pricing_kind_check;
ALTER TABLE public.llm_model_pricing ADD CONSTRAINT llm_model_pricing_kind_check
  CHECK (kind = ANY (ARRAY['completion'::text, 'embedding'::text]));

ALTER TABLE public.action_pricing_config DROP CONSTRAINT IF EXISTS action_pricing_config_source_type_check;
ALTER TABLE public.action_pricing_config ADD CONSTRAINT action_pricing_config_source_type_check
  CHECK (source_type = ANY (ARRAY['llm'::text, 'embedding'::text, 'fixed'::text]));

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.llm_model_pricing WHERE kind = 'unit')
     OR EXISTS (SELECT 1 FROM public.action_pricing_config WHERE source_type = 'vendor_unit') THEN
    RAISE EXCEPTION 'vendor pricing rollback postcondition: a vendor-unit row survived';
  END IF;
END
$verify$;

COMMIT;
