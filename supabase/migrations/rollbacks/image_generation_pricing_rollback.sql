-- ROLLBACK for 20270216000000_image_generation_pricing.sql
--
-- Removes the image_generation pricing rule and the image unit costs a Super
-- Admin entered for EXACTLY the SKUs this feature defines (REQUIRED_IMAGE_SKUS in
-- backend/services/billing/imageCredits.ts) - never any other openai unit cost.
-- LOSSY for those six costs. Image generation becomes unpriced, so every image is REFUSED
-- before the provider call (never rendered free). Grants nothing.
--
-- The CHECK constraints are restored to their production originals ONLY when no
-- other vendor-unit row remains: PI's 20270208000000 (prospect_enrichment, data
-- vendor costs) relies on the same extended constraints, so if it is applied
-- they are left as they are.
--
-- Run only after image generation is switched off or accepted as refused.
BEGIN;

DELETE FROM public.action_pricing_config WHERE action_key = 'image_generation' AND source_type = 'vendor_unit';
DELETE FROM public.llm_model_pricing WHERE kind = 'unit' AND provider = 'openai'
  AND model_name IN ('gpt-image-1.5:1024x1024:low', 'gpt-image-1.5:1024x1024:medium', 'gpt-image-1.5:1024x1536:medium', 'gpt-image-1.5:1536x1024:medium', 'gpt-image-1:1024x1024:low', 'gpt-image-1:1024x1024:medium');

DO $restore$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.llm_model_pricing WHERE kind = 'unit')
     AND NOT EXISTS (SELECT 1 FROM public.action_pricing_config WHERE source_type = 'vendor_unit') THEN
    ALTER TABLE public.llm_model_pricing DROP CONSTRAINT IF EXISTS llm_model_pricing_kind_check;
    ALTER TABLE public.llm_model_pricing ADD CONSTRAINT llm_model_pricing_kind_check
      CHECK (kind = ANY (ARRAY['completion'::text, 'embedding'::text]));
    ALTER TABLE public.action_pricing_config DROP CONSTRAINT IF EXISTS action_pricing_config_source_type_check;
    ALTER TABLE public.action_pricing_config ADD CONSTRAINT action_pricing_config_source_type_check
      CHECK (source_type = ANY (ARRAY['llm'::text, 'embedding'::text, 'fixed'::text]));
  ELSE
    RAISE NOTICE 'image pricing rollback: other vendor-unit pricing remains (PI 20270208000000); constraints left extended';
  END IF;
END
$restore$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.action_pricing_config WHERE action_key = 'image_generation' AND source_type = 'vendor_unit')
     OR EXISTS (SELECT 1 FROM public.llm_model_pricing WHERE kind = 'unit' AND provider = 'openai'
                  AND model_name IN ('gpt-image-1.5:1024x1024:low', 'gpt-image-1.5:1024x1024:medium', 'gpt-image-1.5:1024x1536:medium', 'gpt-image-1.5:1536x1024:medium', 'gpt-image-1:1024x1024:low', 'gpt-image-1:1024x1024:medium')) THEN
    RAISE EXCEPTION 'image pricing rollback postcondition: an image pricing row survived';
  END IF;
END
$verify$;

COMMIT;
