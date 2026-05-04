-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260503043152  Name: creator_execution_reliability
-- Idempotency: GUARDED.

ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS locked_by TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE daily_content_plans ADD COLUMN IF NOT EXISTS failure_type TEXT;

CREATE INDEX IF NOT EXISTS idx_daily_content_plans_plan_version ON daily_content_plans(campaign_id, plan_version);
CREATE INDEX IF NOT EXISTS idx_daily_content_plans_creator_lock ON daily_content_plans(locked_by, lease_expires_at) WHERE locked_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_valid_creator_daily_content_payload(
  p_intent_type TEXT,
  p_asset_type TEXT,
  p_content TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  parsed JSONB;
BEGIN
  IF COALESCE(p_intent_type, '') <> 'creator' THEN
    RETURN TRUE;
  END IF;

  BEGIN
    parsed := p_content::jsonb;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;

  IF parsed IS NULL THEN
    RETURN FALSE;
  END IF;
  IF NOT (parsed ? 'intent_type' AND parsed ? 'asset_type' AND parsed ? 'asset_payload' AND parsed ? 'packaging') THEN
    RETURN FALSE;
  END IF;
  IF parsed->>'intent_type' <> 'creator' THEN
    RETURN FALSE;
  END IF;
  IF COALESCE(p_asset_type, '') <> '' AND parsed->>'asset_type' <> p_asset_type THEN
    RETURN FALSE;
  END IF;
  IF jsonb_typeof(parsed->'packaging') <> 'object' THEN
    RETURN FALSE;
  END IF;
  IF jsonb_typeof(parsed->'asset_instruction') <> 'object' THEN
    RETURN FALSE;
  END IF;
  IF jsonb_typeof(parsed->'asset_payload') <> 'object' THEN
    RETURN FALSE;
  END IF;
  IF NOT (
    (parsed->'packaging' ? 'caption')
    AND (parsed->'packaging' ? 'hashtags')
    AND (parsed->'packaging' ? 'meta_description')
    AND (parsed->'packaging' ? 'keywords')
    AND (parsed->'packaging' ? 'cta')
  ) THEN
    RETURN FALSE;
  END IF;
  IF jsonb_typeof(parsed->'packaging'->'hashtags') <> 'array' THEN
    RETURN FALSE;
  END IF;
  IF jsonb_typeof(parsed->'packaging'->'keywords') <> 'array' THEN
    RETURN FALSE;
  END IF;
  IF p_asset_type = 'carousel' THEN
    IF NOT (parsed->'asset_payload' ? 'slides') OR jsonb_typeof(parsed->'asset_payload'->'slides') <> 'array' THEN
      RETURN FALSE;
    END IF;
  ELSIF p_asset_type = 'image' THEN
    IF NOT (parsed->'asset_payload' ? 'visual_descriptor') OR jsonb_typeof(parsed->'asset_payload'->'visual_descriptor') <> 'object' THEN
      RETURN FALSE;
    END IF;
  ELSIF p_asset_type = 'video' THEN
    IF NOT (parsed->'asset_payload' ? 'scenes') OR jsonb_typeof(parsed->'asset_payload'->'scenes') <> 'array' THEN
      RETURN FALSE;
    END IF;
  ELSIF p_asset_type IN ('post_with_asset', 'thread_with_asset') THEN
    IF NOT (parsed->'asset_payload' ? 'caption_blueprint') OR jsonb_typeof(parsed->'asset_payload'->'caption_blueprint') <> 'object' THEN
      RETURN FALSE;
    END IF;
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_creator_platform_asset_combo(
  p_intent_type TEXT,
  p_platform TEXT,
  p_asset_type TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_platform TEXT := lower(trim(coalesce(p_platform, '')));
BEGIN
  IF coalesce(p_intent_type, '') <> 'creator' THEN
    RETURN TRUE;
  END IF;
  IF normalized_platform = 'twitter' THEN
    normalized_platform := 'x';
  END IF;

  IF normalized_platform = 'linkedin' THEN
    RETURN p_asset_type IN ('image', 'carousel', 'video', 'post_with_asset');
  ELSIF normalized_platform = 'instagram' THEN
    RETURN p_asset_type IN ('image', 'carousel', 'video', 'post_with_asset');
  ELSIF normalized_platform = 'x' THEN
    RETURN p_asset_type IN ('image', 'video', 'thread_with_asset', 'post_with_asset');
  ELSIF normalized_platform = 'tiktok' THEN
    RETURN p_asset_type IN ('video');
  ELSIF normalized_platform = 'pinterest' THEN
    RETURN p_asset_type IN ('image', 'carousel', 'post_with_asset');
  END IF;
  RETURN FALSE;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_content_plans_creator_payload_check'
  ) THEN
    ALTER TABLE daily_content_plans
      ADD CONSTRAINT daily_content_plans_creator_payload_check
      CHECK (public.is_valid_creator_daily_content_payload(intent_type, asset_type, content)) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_content_plans_creator_capability_check'
  ) THEN
    ALTER TABLE daily_content_plans
      ADD CONSTRAINT daily_content_plans_creator_capability_check
      CHECK (public.is_valid_creator_platform_asset_combo(intent_type, platform, asset_type)) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_creator_execution_lock(
  p_daily_plan_id UUID,
  p_lock_owner TEXT,
  p_expected_plan_version INTEGER,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER,
  retry_count INTEGER,
  max_retries INTEGER,
  plan_version INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE daily_content_plans
     SET locked_by = p_lock_owner,
         lease_expires_at = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 900))),
         attempt_count = COALESCE(attempt_count, 0) + 1,
         updated_at = now()
   WHERE id = p_daily_plan_id
     AND plan_version = COALESCE(p_expected_plan_version, 1)
     AND (
       locked_by IS NULL
       OR lease_expires_at IS NULL
       OR lease_expires_at <= now()
       OR locked_by = p_lock_owner
     )
  RETURNING daily_content_plans.locked_by,
            daily_content_plans.lease_expires_at,
            daily_content_plans.attempt_count,
            daily_content_plans.retry_count,
            daily_content_plans.max_retries,
            daily_content_plans.plan_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.extend_creator_execution_lock(
  p_daily_plan_id UUID,
  p_lock_owner TEXT,
  p_lease_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE daily_content_plans
     SET lease_expires_at = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 900))),
         updated_at = now()
   WHERE id = p_daily_plan_id
     AND locked_by = p_lock_owner
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at > now()
  RETURNING daily_content_plans.locked_by,
            daily_content_plans.lease_expires_at;
END;
$$;

ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS execution_platform_id TEXT;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS asset_hash TEXT;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS publish_source TEXT NOT NULL DEFAULT 'unknown';

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_posts_idempotency_key_unique
  ON scheduled_posts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS creator_execution_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  daily_plan_id UUID NOT NULL,
  company_id UUID NULL,
  user_id UUID NULL,
  platform TEXT NULL,
  asset_type TEXT NULL,
  stage TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  plan_version INTEGER NULL,
  status TEXT NULL,
  failure_type TEXT NULL,
  log_level TEXT NOT NULL DEFAULT 'production',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_execution_audit_campaign ON creator_execution_audit_logs(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_execution_audit_daily_plan ON creator_execution_audit_logs(daily_plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_execution_audit_expires_at ON creator_execution_audit_logs(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS creator_execution_dead_letter_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  daily_plan_id UUID NOT NULL,
  platform TEXT NULL,
  asset_type TEXT NULL,
  failure_reason TEXT NOT NULL,
  payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_execution_dead_letter_campaign ON creator_execution_dead_letter_queue(campaign_id, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_execution_dead_letter_plan ON creator_execution_dead_letter_queue(daily_plan_id, failed_at DESC);

CREATE TABLE IF NOT EXISTS creator_execution_summaries (
  daily_plan_id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL,
  platform TEXT NULL,
  asset_type TEXT NULL,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  final_status TEXT NOT NULL,
  failure_reason TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_execution_summaries_campaign ON creator_execution_summaries(campaign_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS creator_execution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  daily_plan_id UUID NOT NULL,
  platform TEXT NULL,
  asset_type TEXT NULL,
  metric_name TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_execution_metrics_campaign ON creator_execution_metrics(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_execution_metrics_name ON creator_execution_metrics(metric_name, created_at DESC);

CREATE OR REPLACE FUNCTION public.purge_expired_creator_execution_audit_logs()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count BIGINT;
BEGIN
  DELETE FROM creator_execution_audit_logs
   WHERE expires_at IS NOT NULL
     AND expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
