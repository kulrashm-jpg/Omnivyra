ALTER TABLE public.analytics_provider_config
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.analytics_provider_config
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{capability_redirect_uris}',
  jsonb_build_object(
    'google_analytics',
    COALESCE(NULLIF(redirect_uri, ''), NULLIF(current_setting('app.settings.app_url', true), '') || '/api/analytics/connect/google/callback'),
    'google_search_console',
    COALESCE(NULLIF(redirect_uri, ''), NULLIF(current_setting('app.settings.app_url', true), '') || '/api/analytics/connect/google/callback')
  ),
  true
)
WHERE provider = 'google_analytics'
  AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'capability_redirect_uris');
