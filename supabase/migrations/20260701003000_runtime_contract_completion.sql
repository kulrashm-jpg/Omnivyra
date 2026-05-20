-- Complete remaining runtime schema contracts referenced by application code.
-- This migration prefers canonical table remaps in code and creates only the
-- public contracts that still have active runtime reads/writes.

SET search_path = public;

CREATE TABLE IF NOT EXISTS public.adapter_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  auto_truncate boolean NOT NULL DEFAULT true,
  auto_format_hashtags boolean NOT NULL DEFAULT true,
  preserve_links boolean NOT NULL DEFAULT true,
  custom_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_adapter_configs_user_id
  ON public.adapter_configs(user_id);

CREATE TABLE IF NOT EXISTS public.company_scheduler_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE,
  interval_minutes integer NOT NULL DEFAULT 60,
  timezone text NOT NULL DEFAULT 'UTC',
  working_start integer NOT NULL DEFAULT 9,
  working_end integer NOT NULL DEFAULT 18,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_scheduler_prefs_interval_check
    CHECK (interval_minutes IN (15, 30, 60, 120, 240, 480)),
  CONSTRAINT company_scheduler_prefs_hours_check
    CHECK (working_start >= 0 AND working_start <= 23 AND working_end >= 0 AND working_end <= 23 AND working_start < working_end)
);

CREATE TABLE IF NOT EXISTS public.campaign_autonomous_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  campaign_id uuid,
  learning_type text NOT NULL DEFAULT 'content_pattern',
  platform text,
  content_type text,
  pattern text NOT NULL,
  engagement_impact double precision NOT NULL DEFAULT 0,
  confidence double precision NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 1,
  decay_factor double precision NOT NULL DEFAULT 1.0,
  reinforcement_score double precision NOT NULL DEFAULT 0,
  times_reinforced integer NOT NULL DEFAULT 0,
  last_reinforced_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_autonomous_learnings_company
  ON public.campaign_autonomous_learnings(company_id);
CREATE INDEX IF NOT EXISTS idx_campaign_autonomous_learnings_rank
  ON public.campaign_autonomous_learnings(company_id, confidence DESC, engagement_impact DESC);

CREATE TABLE IF NOT EXISTS public.free_credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid,
  credits_granted integer NOT NULL DEFAULT 0,
  credits_used integer NOT NULL DEFAULT 0,
  reason text,
  granted_by uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT free_credit_grants_nonnegative_check
    CHECK (credits_granted >= 0 AND credits_used >= 0)
);

CREATE INDEX IF NOT EXISTS idx_free_credit_grants_org
  ON public.free_credit_grants(organization_id);

CREATE TABLE IF NOT EXISTS public.post_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid,
  company_id uuid,
  user_id uuid,
  event_type text NOT NULL DEFAULT 'event',
  platform text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_events_created_at
  ON public.post_events(created_at DESC);

ALTER TABLE public.content_plans
  ADD COLUMN IF NOT EXISTS week_number integer,
  ADD COLUMN IF NOT EXISTS theme varchar(255),
  ADD COLUMN IF NOT EXISTS focus_area text,
  ADD COLUMN IF NOT EXISTS alignment_status varchar(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS alignment_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS refinement_status varchar(50) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS ai_suggestions jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_edits jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS finalization_notes text,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_plan_generated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_plan_generated_at timestamptz;

ALTER TABLE public.campaign_performance
  ADD COLUMN IF NOT EXISTS week_number integer,
  ADD COLUMN IF NOT EXISTS theme varchar(255),
  ADD COLUMN IF NOT EXISTS content_types text[],
  ADD COLUMN IF NOT EXISTS platforms text[],
  ADD COLUMN IF NOT EXISTS objectives text[],
  ADD COLUMN IF NOT EXISTS planned_content_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_content_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_content_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_content_count integer DEFAULT 0;

ALTER TABLE public.ai_threads
  ADD COLUMN IF NOT EXISTS plan_review_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS weekly_themes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_status varchar(50) DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_content_plans_week_number
  ON public.content_plans(week_number);
CREATE INDEX IF NOT EXISTS idx_content_plans_alignment_status
  ON public.content_plans(alignment_status);
CREATE INDEX IF NOT EXISTS idx_campaign_performance_week_number
  ON public.campaign_performance(week_number);

CREATE OR REPLACE VIEW public.weekly_alignment_summary AS
SELECT
  c.id AS campaign_id,
  c.name AS campaign_name,
  cp.week_number,
  cp.theme,
  cp.focus_area,
  cp.alignment_status,
  count(cp.id) AS total_content_items,
  count(*) FILTER (WHERE cp.status = 'published') AS published_content,
  count(*) FILTER (WHERE cp.alignment_status = 'aligned') AS aligned_content,
  count(*) FILTER (WHERE cp.alignment_status = 'needs-adjustment') AS needs_adjustment_content,
  array_remove(array_agg(DISTINCT cp.platform), NULL) AS platforms,
  array_remove(array_agg(DISTINCT cp.content_type), NULL) AS content_types
FROM public.campaigns c
LEFT JOIN public.content_plans cp ON c.id = cp.campaign_id
WHERE cp.week_number IS NOT NULL
GROUP BY c.id, c.name, cp.week_number, cp.theme, cp.focus_area, cp.alignment_status;

CREATE OR REPLACE VIEW public.weekly_refinement_status AS
SELECT
  c.id AS campaign_id,
  c.name AS campaign_name,
  wcr.week_number,
  wcr.theme,
  wcr.focus_area,
  wcr.refinement_status,
  wcr.ai_enhancement_applied,
  wcr.manual_edits_applied,
  wcr.finalized,
  wcr.daily_plan_populated,
  count(DISTINCT cp.id) AS total_content_items,
  count(DISTINCT dcp.id) AS daily_plans_generated,
  wcr.created_at,
  wcr.finalized_at
FROM public.campaigns c
LEFT JOIN public.weekly_content_refinements wcr ON c.id = wcr.campaign_id
LEFT JOIN public.content_plans cp ON c.id = cp.campaign_id AND cp.week_number = wcr.week_number
LEFT JOIN public.daily_content_plans dcp ON c.id = dcp.campaign_id AND dcp.week_number = wcr.week_number
GROUP BY c.id, c.name, wcr.week_number, wcr.theme, wcr.focus_area, wcr.refinement_status,
  wcr.ai_enhancement_applied, wcr.manual_edits_applied, wcr.finalized, wcr.daily_plan_populated,
  wcr.created_at, wcr.finalized_at;

CREATE OR REPLACE FUNCTION public.update_weekly_alignment(
  campaign_uuid uuid,
  week_num integer,
  new_status varchar(50),
  notes text DEFAULT NULL,
  reviewer_uuid uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.content_plans
  SET alignment_status = new_status,
      alignment_notes = COALESCE(notes, alignment_notes),
      reviewed_by = COALESCE(reviewer_uuid, reviewed_by),
      reviewed_at = CASE WHEN new_status IN ('aligned', 'completed') THEN now() ELSE reviewed_at END,
      updated_at = now()
  WHERE campaign_id = campaign_uuid
    AND week_number = week_num;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.populate_weekly_content_from_ai_plan(
  campaign_uuid uuid,
  ai_plan_data jsonb
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  week_data jsonb;
  content_item jsonb;
  inserted_count integer := 0;
  week_num integer;
  campaign_start date;
BEGIN
  SELECT start_date INTO campaign_start FROM public.campaigns WHERE id = campaign_uuid;

  FOR week_data IN SELECT * FROM jsonb_array_elements(COALESCE(ai_plan_data->'weeks', '[]'::jsonb))
  LOOP
    week_num := (week_data->>'week_number')::integer;

    FOR content_item IN SELECT * FROM jsonb_array_elements(COALESCE(week_data->'content', '[]'::jsonb))
    LOOP
      INSERT INTO public.content_plans (
        campaign_id, week_number, theme, focus_area, platform, content_type,
        topic, content, status, ai_generated, alignment_status, day_of_week,
        date, created_at, updated_at
      ) VALUES (
        campaign_uuid,
        week_num,
        week_data->>'theme',
        week_data->>'focus_area',
        content_item->>'platform',
        COALESCE(content_item->>'type', content_item->>'content_type', 'post'),
        content_item->>'topic',
        COALESCE(content_item->>'description', content_item->>'content', ''),
        'planned',
        true,
        'pending',
        content_item->>'day',
        COALESCE(campaign_start, current_date) + ((week_num - 1) * 7),
        now(),
        now()
      );

      inserted_count := inserted_count + 1;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enhance_weekly_content_with_ai(
  campaign_uuid uuid,
  week_num integer,
  enhancement_prompt text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  week_content jsonb;
  refinement_id uuid;
BEGIN
  SELECT jsonb_agg(to_jsonb(cp)) INTO week_content
  FROM public.content_plans cp
  WHERE cp.campaign_id = campaign_uuid
    AND cp.week_number = week_num;

  INSERT INTO public.weekly_content_refinements (
    campaign_id, week_number, theme, focus_area, original_content,
    ai_enhanced_content, finalized_content, refinement_status,
    ai_enhancement_applied, ai_enhancement_notes
  ) VALUES (
    campaign_uuid,
    week_num,
    COALESCE((SELECT theme FROM public.content_plans WHERE campaign_id = campaign_uuid AND week_number = week_num LIMIT 1), 'Week ' || week_num::text),
    COALESCE((SELECT focus_area FROM public.content_plans WHERE campaign_id = campaign_uuid AND week_number = week_num LIMIT 1), ''),
    COALESCE(week_content, '[]'::jsonb),
    '{}'::jsonb,
    COALESCE(week_content, '[]'::jsonb),
    'ai-enhanced',
    true,
    COALESCE(enhancement_prompt, 'AI enhancement applied')
  )
  ON CONFLICT (campaign_id, week_number)
  DO UPDATE SET
    refinement_status = 'ai-enhanced',
    ai_enhancement_applied = true,
    ai_enhancement_notes = EXCLUDED.ai_enhancement_notes,
    updated_at = now()
  RETURNING id INTO refinement_id;

  UPDATE public.content_plans
  SET refinement_status = 'ai-enhanced',
      ai_suggestions = jsonb_build_object('enhancement_applied', true, 'enhanced_at', now()),
      updated_at = now()
  WHERE campaign_id = campaign_uuid
    AND week_number = week_num;

  RETURN jsonb_build_object('refinement_id', refinement_id, 'status', 'ai-enhanced');
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_weekly_content(
  campaign_uuid uuid,
  week_num integer,
  finalization_notes text DEFAULT NULL,
  finalized_by_uuid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  refinement_id uuid;
BEGIN
  UPDATE public.weekly_content_refinements
  SET refinement_status = 'finalized',
      finalized = true,
      finalization_notes = COALESCE(finalization_notes, 'Weekly content finalized'),
      finalized_by = finalized_by_uuid,
      finalized_at = now(),
      updated_at = now()
  WHERE campaign_id = campaign_uuid
    AND week_number = week_num
  RETURNING id INTO refinement_id;

  UPDATE public.content_plans
  SET refinement_status = 'finalized',
      finalization_notes = COALESCE(finalization_notes, 'Weekly content finalized'),
      finalized_at = now(),
      updated_at = now()
  WHERE campaign_id = campaign_uuid
    AND week_number = week_num;

  RETURN jsonb_build_object('refinement_id', refinement_id, 'status', 'finalized');
END;
$$;

CREATE OR REPLACE FUNCTION public.populate_daily_plans_from_weekly(
  campaign_uuid uuid,
  week_num integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  week_content record;
  inserted_count integer := 0;
  campaign_start date;
BEGIN
  SELECT start_date INTO campaign_start FROM public.campaigns WHERE id = campaign_uuid;

  FOR week_content IN
    SELECT * FROM public.content_plans
    WHERE campaign_id = campaign_uuid
      AND week_number = week_num
      AND refinement_status = 'finalized'
  LOOP
    INSERT INTO public.daily_content_plans (
      campaign_id, week_number, day_of_week, date, platform, content_type,
      title, content, hashtags, scheduled_time, source_week_content_id,
      ai_generated, status, priority
    ) VALUES (
      campaign_uuid,
      week_num,
      COALESCE(week_content.day_of_week, 'Monday'),
      COALESCE(campaign_start, current_date) + ((week_num - 1) * 7),
      week_content.platform,
      week_content.content_type,
      week_content.topic,
      COALESCE(week_content.content, ''),
      week_content.hashtags,
      '09:00',
      week_content.id,
      week_content.ai_generated,
      'planned',
      'medium'
    );

    inserted_count := inserted_count + 1;
  END LOOP;

  UPDATE public.weekly_content_refinements
  SET refinement_status = 'daily-populated',
      daily_plan_populated = true,
      updated_at = now()
  WHERE campaign_id = campaign_uuid
    AND week_number = week_num;

  UPDATE public.content_plans
  SET refinement_status = 'daily-populated',
      daily_plan_generated = true,
      daily_plan_generated_at = now(),
      updated_at = now()
  WHERE campaign_id = campaign_uuid
    AND week_number = week_num;

  RETURN inserted_count;
END;
$$;
