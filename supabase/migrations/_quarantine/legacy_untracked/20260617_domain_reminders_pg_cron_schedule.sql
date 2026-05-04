-- Switch the domain-reminder cron from Vercel (Hobby tier blocks */5) to
-- Supabase pg_cron + pg_net. Idempotent — re-runnable.
--
-- After this migration applies, run ONCE (with real values) to register the
-- target URL + bearer secret in supabase_vault:
--
--   SELECT public.configure_domain_reminder_cron(
--     p_url         => 'https://<your-app>/api/internal/process-reminders',
--     p_cron_secret => '<your-CRON_SECRET>'
--   );
--
-- The cron fires every 5 minutes, calls the URL with `Authorization: Bearer
-- <secret>`, and the existing process-reminders handler does the rest. If
-- the secrets are not configured yet, the cron emits a NOTICE and returns
-- NULL (no spurious HTTP request).
--
-- Applied to live DB via mcp__supabase__apply_migration on 2026-05-01.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_domain_reminder_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_url        TEXT;
  v_secret     TEXT;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'domain_reminder_cron_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'domain_reminder_cron_secret'
  LIMIT 1;

  IF v_url IS NULL OR length(trim(v_url)) = 0 THEN
    RAISE NOTICE 'trigger_domain_reminder_cron: vault secret domain_reminder_cron_url not set';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url,
    headers := CASE
      WHEN v_secret IS NOT NULL AND length(trim(v_secret)) > 0
        THEN jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json')
        ELSE jsonb_build_object('Content-Type', 'application/json')
      END,
    body                 := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;
  RETURN v_request_id;
END $$;

CREATE OR REPLACE FUNCTION public.configure_domain_reminder_cron(
  p_url         TEXT,
  p_cron_secret TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_url_id    uuid;
  v_secret_id uuid;
BEGIN
  IF p_url IS NULL OR length(trim(p_url)) = 0 THEN
    RAISE EXCEPTION 'configure_domain_reminder_cron: p_url is required';
  END IF;

  SELECT id INTO v_url_id
  FROM vault.decrypted_secrets
  WHERE name = 'domain_reminder_cron_url'
  LIMIT 1;
  IF v_url_id IS NULL THEN
    PERFORM vault.create_secret(p_url, 'domain_reminder_cron_url',
      'URL pg_cron POSTs to every 5 minutes for domain reminders');
  ELSE
    PERFORM vault.update_secret(v_url_id, p_url, 'domain_reminder_cron_url', NULL);
  END IF;

  IF p_cron_secret IS NOT NULL AND length(trim(p_cron_secret)) > 0 THEN
    SELECT id INTO v_secret_id
    FROM vault.decrypted_secrets
    WHERE name = 'domain_reminder_cron_secret'
    LIMIT 1;
    IF v_secret_id IS NULL THEN
      PERFORM vault.create_secret(p_cron_secret, 'domain_reminder_cron_secret',
        'Bearer secret sent in the Authorization header to /api/internal/process-reminders');
    ELSE
      PERFORM vault.update_secret(v_secret_id, p_cron_secret, 'domain_reminder_cron_secret', NULL);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'domain-reminder-cron') THEN
    PERFORM cron.unschedule('domain-reminder-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'domain-reminder-cron',
  '*/5 * * * *',
  'SELECT public.trigger_domain_reminder_cron();'
);

COMMENT ON FUNCTION public.trigger_domain_reminder_cron IS
  'Called by pg_cron every 5 minutes. Reads URL + bearer from supabase_vault '
  'and POSTs to the process-reminders endpoint. Returns the pg_net request id.';
COMMENT ON FUNCTION public.configure_domain_reminder_cron IS
  'One-shot: register the URL + bearer secret used by the domain-reminder cron. '
  'Run after migration applies. Idempotent — rerunning rotates the values.';
