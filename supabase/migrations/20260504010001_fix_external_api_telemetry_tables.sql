-- Phase C fix migration — adds external API telemetry tables to canonical set.
-- These tables already exist in prod (applied out-of-band via database/external_api_*.sql)
-- but had no source-of-truth migration. Replay used to fail because canonical migrations
-- referenced these tables without creating them.
--
-- Tables: external_api_sources (FK target), external_api_health, external_api_usage
-- All statements are idempotent.

-- ── external_api_sources ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.external_api_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_url text NOT NULL,
  purpose text NOT NULL,
  category text,
  is_active boolean DEFAULT true,
  auth_type text DEFAULT 'none'::text,
  api_key_name text,
  created_at timestamp with time zone DEFAULT now(),
  platform_type text NOT NULL DEFAULT 'social'::text,
  supported_content_types jsonb DEFAULT '[]'::jsonb,
  promotion_modes jsonb DEFAULT '[]'::jsonb,
  required_metadata jsonb DEFAULT '{}'::jsonb,
  posting_constraints jsonb DEFAULT '{}'::jsonb,
  requires_admin boolean DEFAULT true,
  method text DEFAULT 'GET'::text,
  headers jsonb DEFAULT '{}'::jsonb,
  query_params jsonb DEFAULT '{}'::jsonb,
  api_key_env_name text,
  is_preset boolean DEFAULT false,
  company_id uuid,
  rate_limit_per_min integer,
  retry_count integer,
  timeout_ms integer,
  oauth_client_id_encrypted text,
  oauth_client_secret_encrypted text,
  is_whitelisted boolean NOT NULL DEFAULT false
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='external_api_sources_pkey') THEN
    ALTER TABLE public.external_api_sources ADD CONSTRAINT external_api_sources_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ── external_api_health ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.external_api_health (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  api_source_id uuid NOT NULL,
  last_success_at timestamp with time zone,
  last_failure_at timestamp with time zone,
  success_count integer DEFAULT 0,
  failure_count integer DEFAULT 0,
  last_payload_hash text,
  freshness_score double precision DEFAULT 1.0,
  reliability_score double precision DEFAULT 1.0,
  created_at timestamp with time zone DEFAULT now(),
  last_test_status text,
  last_test_at timestamp with time zone,
  last_test_latency_ms integer
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='external_api_health_pkey') THEN
    ALTER TABLE public.external_api_health ADD CONSTRAINT external_api_health_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_external_api_health_source
  ON public.external_api_health (api_source_id);

-- ── external_api_usage (incl. signals_generated column) ─────────────────────
CREATE TABLE IF NOT EXISTS public.external_api_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  api_source_id uuid NOT NULL,
  user_id text NOT NULL,
  usage_date date NOT NULL,
  request_count integer DEFAULT 0,
  success_count integer DEFAULT 0,
  failure_count integer DEFAULT 0,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_failure_at timestamp with time zone,
  last_error_code text,
  last_error_message text,
  last_error_at timestamp with time zone,
  last_success_at timestamp with time zone,
  signals_generated integer NOT NULL DEFAULT 0,
  account_id uuid
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='external_api_usage_pkey') THEN
    ALTER TABLE public.external_api_usage ADD CONSTRAINT external_api_usage_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='external_api_usage_api_source_id_user_id_usage_date_key') THEN
    ALTER TABLE public.external_api_usage
      ADD CONSTRAINT external_api_usage_api_source_id_user_id_usage_date_key
      UNIQUE (api_source_id, user_id, usage_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ext_api_usage_account_id
  ON public.external_api_usage (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_api_usage_date
  ON public.external_api_usage (usage_date);
CREATE INDEX IF NOT EXISTS idx_external_api_usage_user
  ON public.external_api_usage (user_id);
