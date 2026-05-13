-- Add Search Console as a first-class analytics provider capability.
-- GA4 and GSC intentionally share the existing analytics integration tables:
-- integrations own capability state, tokens own encrypted OAuth tokens, and
-- properties own selectable GA properties / GSC sites.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_provider') THEN
    ALTER TYPE public.analytics_provider ADD VALUE IF NOT EXISTS 'GSC';
  END IF;
END
$$;

ALTER TABLE public.analytics_provider_config
  DROP CONSTRAINT IF EXISTS analytics_provider_config_provider_check;

ALTER TABLE public.analytics_provider_config
  ADD CONSTRAINT analytics_provider_config_provider_check
  CHECK (provider IN ('google_analytics'));

UPDATE public.analytics_provider_config
SET scopes = (
  SELECT ARRAY(
    SELECT DISTINCT scope
    FROM unnest(
      COALESCE(scopes, '{}'::text[]) ||
      ARRAY[
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/analytics.readonly',
        'https://www.googleapis.com/auth/webmasters.readonly'
      ]::text[]
    ) AS scope
    WHERE scope IS NOT NULL AND scope <> ''
  )
)
WHERE provider = 'google_analytics';

CREATE INDEX IF NOT EXISTS analytics_integrations_provider_status_idx
  ON public.analytics_integrations (provider, status);
