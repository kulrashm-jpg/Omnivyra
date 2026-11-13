-- Rollback of 20270217000039_platform_usage_events_unattributed_sources.sql (6f).
-- Restores the original source_type CHECK and the NOT NULL on resource_id / model_name, and drops the three CHECKs
-- 039 added. REFUSES while any row uses what 039 allowed - a cache / external_api source, a NULL resource_id, a NULL
-- model_name - because restoring the old shape would require deleting financial records. Move or archive those rows
-- first (an owner-approved, count-guarded D-step); this rollback never deletes data.
-- The privilege statements of 039 restate the posture that already existed and are deliberately NOT reverted.
DO $guard$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.platform_usage_events
   WHERE source_type IN ('cache', 'external_api') OR resource_id IS NULL OR model_name IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '039 rollback ABORTED: % platform_usage_events row(s) use the 039 shape (cache/external_api, NULL resource_id or NULL model_name) - move or archive them first; nothing was changed', v_n;
  END IF;
END
$guard$;

ALTER TABLE public.platform_usage_events DROP CONSTRAINT IF EXISTS platform_usage_events_total_cost_check;
ALTER TABLE public.platform_usage_events DROP CONSTRAINT IF EXISTS platform_usage_events_model_name_check;
ALTER TABLE public.platform_usage_events DROP CONSTRAINT IF EXISTS platform_usage_events_unattributed_resource_check;
ALTER TABLE public.platform_usage_events ALTER COLUMN model_name SET NOT NULL;
ALTER TABLE public.platform_usage_events ALTER COLUMN resource_id SET NOT NULL;
ALTER TABLE public.platform_usage_events DROP CONSTRAINT IF EXISTS platform_usage_events_source_type_check;
ALTER TABLE public.platform_usage_events ADD CONSTRAINT platform_usage_events_source_type_check
  CHECK (source_type IN ('system', 'embedding', 'llm', 'internal'));

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_usage_events'::regclass
               AND conname IN ('platform_usage_events_total_cost_check', 'platform_usage_events_model_name_check', 'platform_usage_events_unattributed_resource_check')) THEN
    RAISE EXCEPTION '039 rollback: a 039 CHECK is still present';
  END IF;
  IF (SELECT bool_and(attnotnull) FROM pg_attribute WHERE attrelid = 'public.platform_usage_events'::regclass AND attname IN ('resource_id', 'model_name')) IS NOT TRUE THEN
    RAISE EXCEPTION '039 rollback: resource_id / model_name are not NOT NULL again';
  END IF;
END
$verify$;
