CREATE TABLE IF NOT EXISTS public.analytics_provider_config (
  provider text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  oauth_client_id_encrypted text,
  oauth_client_secret_encrypted text,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  redirect_uri text,
  status text NOT NULL DEFAULT 'inactive',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT analytics_provider_config_provider_check CHECK (provider IN ('google_analytics')),
  CONSTRAINT analytics_provider_config_status_check CHECK (status IN ('active', 'disabled', 'inactive'))
);

INSERT INTO public.analytics_provider_config (
  provider,
  enabled,
  oauth_client_id_encrypted,
  oauth_client_secret_encrypted,
  scopes,
  redirect_uri,
  status
)
SELECT
  'google_analytics',
  COALESCE(enabled, false),
  oauth_client_id_encrypted,
  oauth_client_secret_encrypted,
  COALESCE(oauth_scopes, ARRAY[
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/analytics.readonly'
  ]::text[]),
  COALESCE(NULLIF(current_setting('app.settings.app_url', true), ''), NULL),
  CASE WHEN COALESCE(enabled, false) THEN 'active' ELSE 'disabled' END
FROM public.platform_oauth_configs
WHERE platform = 'ga4'
ON CONFLICT (provider) DO NOTHING;
