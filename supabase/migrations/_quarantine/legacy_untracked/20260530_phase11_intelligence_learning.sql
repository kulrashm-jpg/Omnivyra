-- =============================================================================
-- Phase 11 — adaptive intelligence layer
--
-- Lightweight learning memory + recommendation tracking. NO ML; this is
-- periodic aggregation over the same community_ai_actions /
-- ai_suggestions tables the intelligence service already reads.
--
-- 1. intelligence_patterns      — per-(org, platform, action_type, pattern_type)
--                                  success_rate + sample_size, refreshed by
--                                  patternLearningService every 10-15 min.
-- 2. intelligence_recommendations — which recommendation was shown, did the
--                                  user accept it, and what execution
--                                  correlation did it drive. Feeds the
--                                  next pass of pattern learning.
-- =============================================================================

BEGIN;

-- ── 1. intelligence_patterns ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.intelligence_patterns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  platform            text NOT NULL,
  action_type         text NOT NULL,
  pattern_type        text NOT NULL,
  success_count       integer NOT NULL DEFAULT 0,
  failure_count       integer NOT NULL DEFAULT 0,
  sample_size         integer NOT NULL DEFAULT 0,
  success_rate        numeric NOT NULL DEFAULT 0,
  /**
   * Baseline against which this pattern's uplift is computed. For
   * dichotomous patterns (short vs long, with question vs without) we
   * store the counterpart's success_rate alongside so
   * /api/intelligence/context can emit comparisons without re-computing.
   */
  baseline_rate       numeric,
  uplift_ratio        numeric,      -- success_rate / NULLIF(baseline_rate, 0)
  last_updated_at     timestamptz NOT NULL DEFAULT NOW(),
  created_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_intelligence_patterns_scope
  ON public.intelligence_patterns (organization_id, platform, action_type, pattern_type);

CREATE INDEX IF NOT EXISTS idx_intelligence_patterns_org_platform_action
  ON public.intelligence_patterns (organization_id, platform, action_type, success_rate DESC);

ALTER TABLE public.intelligence_patterns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'intelligence_patterns'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.intelligence_patterns
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.intelligence_patterns IS
  'Learning memory for the adaptive intelligence layer. One row per '
  '(org, platform, action_type, pattern_type). Refreshed by the '
  'pattern-learning worker every ~10 min; read cheaply at request time.';

-- ── 2. intelligence_recommendations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.intelligence_recommendations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL,
  platform                  text,
  action_type               text,
  pattern_type              text NOT NULL,
  label                     text,
  confidence_score          integer,
  execution_correlation_id  uuid,
  target_id                 text,
  shown_at                  timestamptz NOT NULL DEFAULT NOW(),
  accepted_at               timestamptz,
  rejected_at               timestamptz,
  metadata                  jsonb,
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  updated_at                timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT intelligence_recommendations_outcome_exclusive
    CHECK (accepted_at IS NULL OR rejected_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_recommendations_org_shown
  ON public.intelligence_recommendations (organization_id, shown_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_recommendations_correlation
  ON public.intelligence_recommendations (execution_correlation_id)
  WHERE execution_correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intelligence_recommendations_pattern
  ON public.intelligence_recommendations (organization_id, platform, action_type, pattern_type, shown_at DESC);

ALTER TABLE public.intelligence_recommendations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'intelligence_recommendations'
      AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON public.intelligence_recommendations
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.intelligence_recommendations IS
  'One row per shown recommendation. shown_at set at emission; '
  'accepted_at / rejected_at set when the user acts. Feeds the next '
  'pattern-learning pass so the system can self-tune over time.';

-- ── 3. Minimal extension to ai_suggestions (optional) ──────────────────────
-- Stores the extracted pattern_type alongside the suggestion so the
-- learner can join shown-suggestions to their pattern class without
-- re-deriving from text. Optional column — the pattern-learning worker
-- reads community_ai_actions directly and does NOT depend on this
-- column, so the migration is safe to skip when ai_suggestions is
-- missing (e.g. environments that haven't applied the Phase 5 baseline).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public' AND table_name = 'ai_suggestions'
  ) THEN
    ALTER TABLE public.ai_suggestions
      ADD COLUMN IF NOT EXISTS pattern_type text;

    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_pattern_type
      ON public.ai_suggestions (organization_id, platform, action_type, pattern_type)
      WHERE pattern_type IS NOT NULL;

    COMMENT ON COLUMN public.ai_suggestions.pattern_type IS
      'Pattern class of the suggestion content (short_reply / has_question / '
      'has_emoji / long_reply / neutral). Stamped at shown time.';
  END IF;
END $$;

COMMIT;
