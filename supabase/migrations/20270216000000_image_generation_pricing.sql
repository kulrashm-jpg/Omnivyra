-- 20270216000000 image_generation_pricing (reserved by virality-83, 2026-11-12,
-- registry a5b9441c8)
--
-- Owner ruling 2026-11-11 (BLOCKING, money): charge image credits BEFORE
-- launch, through the EXISTING pricing engine: provider unit cost x the action
-- multiplier (owner: 1.5, same as Apollo), converted at each organisation's own
-- credit_rate_usd, then clamped by the helper to the IMAGE_GENERATION catalog
-- bounds (2..12 credits). The owner ENTERS the gpt-image unit costs in Super
-- Admin (Pricing > Provider unit costs); NOTHING is seeded, so until a SKU is
-- priced every image of that SKU is REFUSED before the provider call (never
-- rendered free).
--
-- WHAT THIS DOES (no new table, so no grant moves):
--   1. llm_model_pricing_kind_check gains 'unit' and
--      action_pricing_config_source_type_check gains 'vendor_unit'. This is the
--      SAME change PI's reserved 20270208000000_vendor_enrichment_pricing makes;
--      both preconditions accept the original AND the extended state, so
--      whichever applies first changes the constraints and the other's step is
--      a no-op (ordering accepted by virality-83, recorded in the registry).
--   2. Seeds ONE active action_pricing_config row: action_key
--      'image_generation', source_type 'vendor_unit', cost_multiplier 1.5,
--      floor 0, NO ceiling (the helper clamps to the catalog bounds in credits).
--   3. Seeds NO unit cost (owner).
--
-- effective_from is deliberately OMITTED from the seed: production records it
-- as timestamptz NOT NULL DEFAULT now() (virality-83 C1), so the default fills
-- it and the reader's effective_from <= now() matches. action_pricing_config has
-- no unique CONSTRAINT, so the seed is guarded by WHERE NOT EXISTS.

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
    RAISE EXCEPTION 'image pricing precondition: action_pricing_config_source_type_check is %, expected {embedding,fixed,llm}[+vendor_unit]', v;
  END IF;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conrelid = 'public.llm_model_pricing'::regclass
     AND c.conname = 'llm_model_pricing_kind_check';
  IF v IS DISTINCT FROM ARRAY['completion','embedding']::text[]
     AND v IS DISTINCT FROM ARRAY['completion','embedding','unit']::text[] THEN
    RAISE EXCEPTION 'image pricing precondition: llm_model_pricing_kind_check is %, expected {completion,embedding}[+unit]', v;
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
SELECT 'image_generation', 'vendor_unit', 1.5, 0, NULL, true,
       'Image credits (owner 2026-11-11): provider unit cost x 1.5 at the org credit rate, clamped to IMAGE_GENERATION 2..12 credits; unit costs (openai gpt-image SKUs) are entered in Super Admin'
WHERE NOT EXISTS (
  SELECT 1 FROM public.action_pricing_config
   WHERE action_key = 'image_generation' AND is_active = true
);

DO $post$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.action_pricing_config
   WHERE action_key = 'image_generation' AND is_active = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'image pricing postcondition: % active image_generation rows, expected 1', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.action_pricing_config
                  WHERE action_key = 'image_generation' AND is_active = true
                    AND source_type = 'vendor_unit' AND cost_multiplier = 1.5) THEN
    RAISE EXCEPTION 'image pricing postcondition: the active image_generation row is not vendor_unit x 1.5 (a pre-existing row was kept; review it)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'llm_model_pricing_kind_check'
                  AND conrelid = 'public.llm_model_pricing'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'image pricing postcondition: llm_model_pricing_kind_check missing or not validated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_pricing_config_source_type_check'
                  AND conrelid = 'public.action_pricing_config'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'image pricing postcondition: action_pricing_config_source_type_check missing or not validated';
  END IF;
END
$post$;

COMMIT;
