-- 20270208000000 vendor_enrichment_pricing (reserved by virality-83, 2026-11-10)
--
-- PI mode B, owner B2 (2026-11-10): central data-vendor access is priced as
-- vendor cost x 1.5 through the EXISTING pricing engine, converted at each
-- organisation's own credit_rate_usd. Vendor costs are managed in the existing
-- Super Admin pricing surface (llm_model_pricing), one row per vendor + unit.
--
-- WHAT THIS DOES (no new table, so no grant moves):
--   1. llm_model_pricing_kind_check gains 'unit' (a per-vendor-unit cost, e.g.
--      provider 'apollo', model 'credit', input_per_1k_usd = 1000 x USD/unit).
--   2. action_pricing_config_source_type_check gains 'vendor_unit'.
--   3. Seeds ONE active action_pricing_config row: action_key
--      'prospect_enrichment', source_type 'vendor_unit' (stated explicitly: the
--      column is NOT NULL with no default), cost_multiplier 1.5, floor 0 and NO
--      ceiling (a ceiling would silently under-price a multi-unit call).
--   It seeds NO vendor cost: until a Super Admin enters one, the vendor is
--   shown as "not available yet" and a paid run is refused (never priced at 0).
--   Credits always arrive via amountOverride, so no credit_cost_config row.
--
-- PRODUCTION FACTS (virality-83 C1, catalogue-only, owner-approved, 2026-11-10):
--   action_pricing_config.source_type text NOT NULL, no default/domain/trigger/rule;
--     CHECK action_pricing_config_source_type_check: llm|embedding|fixed.
--   llm_model_pricing.kind text NOT NULL default 'completion';
--     CHECK llm_model_pricing_kind_check: completion|embedding.
--   action_pricing_config has NO unique CONSTRAINT (the repo restore file
--   describes a partial unique INDEX on action_key WHERE is_active). Either
--   way the seed is guarded by WHERE NOT EXISTS, never ON CONFLICT.
-- The widened CHECKs keep their exact names so the rollback restores the
-- originals verbatim. Each PRECONDITION refuses to widen a CHECK whose current
-- value set differs from the one recorded above (drift => stop, not overwrite).
--
-- APPLIED STATUS: this version has never been applied anywhere.

BEGIN;

DO $pre$
DECLARE
  v text[];
BEGIN
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.action_pricing_config'::regclass
     AND c.conname = 'action_pricing_config_source_type_check';
  IF v IS DISTINCT FROM ARRAY['embedding','fixed','llm']::text[]
     AND v IS DISTINCT FROM ARRAY['embedding','fixed','llm','vendor_unit']::text[] THEN
    RAISE EXCEPTION 'vendor pricing precondition: action_pricing_config_source_type_check is %, expected {embedding,fixed,llm}', v;
  END IF;

  SELECT array_agg(m[1] ORDER BY m[1]) INTO v
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.llm_model_pricing'::regclass
     AND c.conname = 'llm_model_pricing_kind_check';
  IF v IS DISTINCT FROM ARRAY['completion','embedding']::text[]
     AND v IS DISTINCT FROM ARRAY['completion','embedding','unit']::text[] THEN
    RAISE EXCEPTION 'vendor pricing precondition: llm_model_pricing_kind_check is %, expected {completion,embedding}', v;
  END IF;
END
$pre$;

ALTER TABLE public.llm_model_pricing DROP CONSTRAINT IF EXISTS llm_model_pricing_kind_check;
ALTER TABLE public.llm_model_pricing ADD CONSTRAINT llm_model_pricing_kind_check
  CHECK (kind = ANY (ARRAY['completion'::text, 'embedding'::text, 'unit'::text]));

ALTER TABLE public.action_pricing_config DROP CONSTRAINT IF EXISTS action_pricing_config_source_type_check;
ALTER TABLE public.action_pricing_config ADD CONSTRAINT action_pricing_config_source_type_check
  CHECK (source_type = ANY (ARRAY['llm'::text, 'embedding'::text, 'fixed'::text, 'vendor_unit'::text]));

INSERT INTO public.action_pricing_config
  (action_key, source_type, cost_multiplier, minimum_charge_usd, ceiling_usd, is_active, notes)
SELECT 'prospect_enrichment', 'vendor_unit', 1.5, 0, NULL, true,
       'PI mode B (owner B2): central data-vendor access = vendor cost x 1.5 at the org credit rate; vendor costs in llm_model_pricing kind=unit'
WHERE NOT EXISTS (
  SELECT 1 FROM public.action_pricing_config
   WHERE action_key = 'prospect_enrichment' AND is_active = true
);

DO $post$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.action_pricing_config
   WHERE action_key = 'prospect_enrichment' AND is_active = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'vendor pricing postcondition: % active prospect_enrichment rows, expected 1', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.action_pricing_config
                  WHERE action_key = 'prospect_enrichment' AND is_active = true
                    AND source_type = 'vendor_unit' AND cost_multiplier = 1.5) THEN
    RAISE EXCEPTION 'vendor pricing postcondition: the active prospect_enrichment row is not vendor_unit x 1.5 (a pre-existing row was kept; review it)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_model_pricing_kind_check'
                  AND conrelid = 'public.llm_model_pricing'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'vendor pricing postcondition: llm_model_pricing_kind_check missing or not validated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_pricing_config_source_type_check'
                  AND conrelid = 'public.action_pricing_config'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'vendor pricing postcondition: action_pricing_config_source_type_check missing or not validated';
  END IF;
END
$post$;

COMMIT;
