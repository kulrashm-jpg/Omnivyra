ALTER TABLE public.intelligence_actions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'report_recommendation';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'intelligence_actions_action_status_check'
      AND conrelid = 'public.intelligence_actions'::regclass
  ) THEN
    ALTER TABLE public.intelligence_actions
      DROP CONSTRAINT intelligence_actions_action_status_check;
  END IF;
END $$;

ALTER TABLE public.intelligence_actions
  ADD CONSTRAINT intelligence_actions_action_status_check
  CHECK (action_status IN ('pending', 'in_progress', 'completed', 'implemented', 'ignored'));

CREATE INDEX IF NOT EXISTS idx_intelligence_actions_company_source
  ON public.intelligence_actions(company_id, source, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_actions_guidance_key
  ON public.intelligence_actions(company_id, recommendation_key, source)
  WHERE source = 'guidance_alert' AND recommendation_key IS NOT NULL;
