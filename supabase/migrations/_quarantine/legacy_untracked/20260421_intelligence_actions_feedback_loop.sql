CREATE TABLE IF NOT EXISTS public.intelligence_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recommendation_type TEXT NOT NULL,
  recommendation_message TEXT NOT NULL,
  action_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (action_status IN ('pending', 'implemented', 'ignored')),
  impact_score NUMERIC,
  recommendation_key TEXT,
  linked_insight_type TEXT,
  recommendation_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  baseline_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluation_due_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  user_feedback_status TEXT,
  manual_override JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_actions_company_created
  ON public.intelligence_actions(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_actions_company_status
  ON public.intelligence_actions(company_id, action_status, evaluation_due_at);

CREATE INDEX IF NOT EXISTS idx_intelligence_actions_company_type
  ON public.intelligence_actions(company_id, recommendation_type, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_actions_pending_key
  ON public.intelligence_actions(company_id, recommendation_key)
  WHERE action_status = 'pending' AND evaluated_at IS NULL AND recommendation_key IS NOT NULL;
