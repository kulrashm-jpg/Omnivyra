-- ============================================================================
-- Meta OAuth Refactor
-- - Creates meta_oauth_connections (parent of all FB/IG/Threads tokens)
-- - Adds derived-token + linkage columns to social_accounts
-- - Drops dead columns (expires_at)
-- - Adds UNIQUE (company_id, platform, platform_user_id)
-- - Backfills broken Instagram rows (FB user id → IG business id)
-- - Defines meta_oauth_apply() RPC for transactional fan-out
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- STEP 1.1 — meta_oauth_connections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_oauth_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  company_id          uuid NOT NULL,
  fb_user_id          text NOT NULL,
  user_access_token   text NOT NULL,
  token_expires_at    timestamptz NOT NULL,
  granted_scopes      text[] NOT NULL DEFAULT '{}',
  idempotency_key     text NOT NULL,
  last_refreshed_at   timestamptz,
  refresh_failed_at   timestamptz,
  refresh_error       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_oauth_connections_company_fb_uid UNIQUE (company_id, fb_user_id),
  CONSTRAINT meta_oauth_connections_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_meta_oauth_connections_user
  ON public.meta_oauth_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_meta_oauth_connections_company
  ON public.meta_oauth_connections (company_id);
CREATE INDEX IF NOT EXISTS idx_meta_oauth_connections_expiry
  ON public.meta_oauth_connections (token_expires_at)
  WHERE refresh_failed_at IS NULL;

ALTER TABLE public.meta_oauth_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_oauth_connections_service_role ON public.meta_oauth_connections;
CREATE POLICY meta_oauth_connections_service_role
  ON public.meta_oauth_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- STEP 1.2 — social_accounts ALTER
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS meta_connection_id     uuid,
  ADD COLUMN IF NOT EXISTS page_access_token      text,
  ADD COLUMN IF NOT EXISTS ig_user_token          text,
  ADD COLUMN IF NOT EXISTS threads_token          text,
  ADD COLUMN IF NOT EXISTS linked_page_id         text,
  ADD COLUMN IF NOT EXISTS linked_ig_business_id  text,
  ADD COLUMN IF NOT EXISTS is_system_user         boolean NOT NULL DEFAULT false;

-- FK to meta_oauth_connections (cascade delete: removing the parent
-- connection takes all derived rows with it).
ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_meta_connection_fk;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_meta_connection_fk
    FOREIGN KEY (meta_connection_id)
    REFERENCES public.meta_oauth_connections (id)
    ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- STEP 1.3 — UNIQUE (company_id, platform, platform_user_id)
--   Race-free upserts; eliminates the SELECT-then-INSERT window.
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_company_platform_user_unique;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_company_platform_user_unique
    UNIQUE (company_id, platform, platform_user_id);

CREATE INDEX IF NOT EXISTS idx_social_accounts_meta_connection
  ON public.social_accounts (meta_connection_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_linked_page
  ON public.social_accounts (linked_page_id);

-- ---------------------------------------------------------------------------
-- STEP 1.4 — Backfill: Instagram rows with FB user id in platform_user_id
--
-- Strategy: for each instagram row whose platform_user_id matches the FB
-- user id of a sibling facebook row (same user_id+company_id), look up the
-- companion threads row whose platform_user_id IS the correct IG business
-- account id. Move it onto the instagram row.
--
-- Rows that cannot be repaired via this lookup are deactivated; their
-- owners must reconnect.
-- ---------------------------------------------------------------------------
WITH ig_repair AS (
  SELECT
    ig.id            AS ig_row_id,
    ig.platform_user_id AS bad_id,
    th.platform_user_id AS correct_ig_business_id,
    fb.platform_user_id AS facebook_page_id
  FROM public.social_accounts ig
  JOIN public.social_accounts fb
    ON fb.user_id = ig.user_id
   AND COALESCE(fb.company_id::text, '') = COALESCE(ig.company_id::text, '')
   AND fb.platform = 'facebook'
  LEFT JOIN public.social_accounts th
    ON th.user_id = ig.user_id
   AND COALESCE(th.company_id::text, '') = COALESCE(ig.company_id::text, '')
   AND th.platform = 'threads'
  WHERE ig.platform = 'instagram'
    AND ig.platform_user_id = fb.platform_user_id
)
UPDATE public.social_accounts s
SET
  platform_user_id = r.correct_ig_business_id,
  linked_page_id   = r.facebook_page_id,
  is_active        = (r.correct_ig_business_id IS NOT NULL),
  updated_at       = now()
FROM ig_repair r
WHERE s.id = r.ig_row_id;

-- Threads rows: ensure linked_page_id and linked_ig_business_id are populated
-- from the existing data (business_account_id = Page id; platform_user_id on
-- threads rows is the IG business id but per Meta IG/Threads share the id).
UPDATE public.social_accounts
SET
  linked_page_id        = COALESCE(linked_page_id, business_account_id),
  linked_ig_business_id = COALESCE(linked_ig_business_id, platform_user_id),
  updated_at            = now()
WHERE platform = 'threads'
  AND (linked_page_id IS NULL OR linked_ig_business_id IS NULL);

-- Facebook rows: page_access_token cannot be backfilled from SQL (it lives
-- only in Meta's /me/accounts response). Mark inactive so the publish path
-- forces re-OAuth; the new callback populates page_access_token on reconnect.
UPDATE public.social_accounts
SET is_active = false, updated_at = now()
WHERE platform = 'facebook'
  AND page_access_token IS NULL
  AND is_system_user = false;

-- ---------------------------------------------------------------------------
-- STEP 1.5 — Drop dead columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_accounts DROP COLUMN IF EXISTS expires_at;

-- ---------------------------------------------------------------------------
-- STEP 1.6 — Integrity CHECKs (deferred; backfill above ensures rows pass)
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_facebook_token_chk;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_facebook_token_chk
    CHECK (
      platform <> 'facebook'
      OR is_system_user = true
      OR is_active = false
      OR page_access_token IS NOT NULL
    );

ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_instagram_link_chk;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_instagram_link_chk
    CHECK (
      platform <> 'instagram'
      OR is_active = false
      OR linked_page_id IS NOT NULL
    );

ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_threads_link_chk;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_threads_link_chk
    CHECK (
      platform <> 'threads'
      OR is_active = false
      OR (linked_page_id IS NOT NULL AND linked_ig_business_id IS NOT NULL)
    );

-- ============================================================================
-- STEP 4 — meta_oauth_apply RPC (single-transaction OAuth fan-out)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.meta_oauth_apply(
  p_connection jsonb,
  p_pages      jsonb,
  p_instagrams jsonb,
  p_threads    jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_connection_id    uuid;
  v_user_id          uuid := (p_connection->>'user_id')::uuid;
  v_company_id       uuid := (p_connection->>'company_id')::uuid;
  v_fb_user_id       text := p_connection->>'fb_user_id';
  v_idempotency_key  text := p_connection->>'idempotency_key';
  v_token_expires_at timestamptz := (p_connection->>'token_expires_at')::timestamptz;
  v_existing_id      uuid;
  v_existing_age     interval;
  v_page             jsonb;
  v_instagram        jsonb;
  v_thread           jsonb;
BEGIN
  IF v_user_id IS NULL OR v_company_id IS NULL OR v_fb_user_id IS NULL OR v_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'meta_oauth_apply: missing required connection fields';
  END IF;

  -- Idempotency short-circuit: if this exact code has been processed in the
  -- last hour, return the prior connection id without re-running side effects.
  SELECT id, now() - created_at
    INTO v_existing_id, v_existing_age
    FROM public.meta_oauth_connections
   WHERE idempotency_key = v_idempotency_key
   LIMIT 1;

  IF v_existing_id IS NOT NULL AND v_existing_age < interval '1 hour' THEN
    RETURN v_existing_id;
  END IF;

  -- Upsert parent connection (by company_id + fb_user_id).
  INSERT INTO public.meta_oauth_connections (
    user_id, company_id, fb_user_id,
    user_access_token, token_expires_at, granted_scopes,
    idempotency_key, last_refreshed_at, refresh_failed_at, refresh_error,
    created_at, updated_at
  )
  VALUES (
    v_user_id,
    v_company_id,
    v_fb_user_id,
    p_connection->>'user_access_token',
    v_token_expires_at,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_connection->'granted_scopes')),
      '{}'::text[]
    ),
    v_idempotency_key,
    now(),
    NULL,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (company_id, fb_user_id) DO UPDATE
    SET user_access_token  = EXCLUDED.user_access_token,
        token_expires_at   = EXCLUDED.token_expires_at,
        granted_scopes     = EXCLUDED.granted_scopes,
        idempotency_key    = EXCLUDED.idempotency_key,
        last_refreshed_at  = now(),
        refresh_failed_at  = NULL,
        refresh_error      = NULL,
        updated_at         = now()
  RETURNING id INTO v_connection_id;

  -- Upsert facebook rows (one per Page).
  FOR v_page IN SELECT * FROM jsonb_array_elements(COALESCE(p_pages, '[]'::jsonb))
  LOOP
    INSERT INTO public.social_accounts (
      user_id, company_id, meta_connection_id,
      platform, platform_user_id,
      account_name, username,
      page_access_token, token_expires_at,
      is_active, is_system_user,
      last_sync_at, created_at, updated_at,
      access_token
    )
    VALUES (
      v_user_id, v_company_id, v_connection_id,
      'facebook',
      v_page->>'page_id',
      COALESCE(v_page->>'page_name', 'Facebook Page'),
      v_page->>'username',
      v_page->>'page_access_token',
      v_token_expires_at,
      true, false,
      now(), now(), now(),
      v_page->>'page_access_token'  -- legacy access_token column kept in sync
    )
    ON CONFLICT (company_id, platform, platform_user_id) DO UPDATE
      SET meta_connection_id = EXCLUDED.meta_connection_id,
          account_name       = EXCLUDED.account_name,
          username           = COALESCE(EXCLUDED.username, public.social_accounts.username),
          page_access_token  = EXCLUDED.page_access_token,
          access_token       = EXCLUDED.access_token,
          token_expires_at   = EXCLUDED.token_expires_at,
          is_active          = true,
          is_system_user     = false,
          last_sync_at       = now(),
          updated_at         = now();
  END LOOP;

  -- Upsert instagram rows.
  FOR v_instagram IN SELECT * FROM jsonb_array_elements(COALESCE(p_instagrams, '[]'::jsonb))
  LOOP
    INSERT INTO public.social_accounts (
      user_id, company_id, meta_connection_id,
      platform, platform_user_id,
      account_name, username,
      ig_user_token, token_expires_at,
      linked_page_id,
      is_active, is_system_user,
      last_sync_at, created_at, updated_at,
      access_token
    )
    VALUES (
      v_user_id, v_company_id, v_connection_id,
      'instagram',
      v_instagram->>'ig_business_id',
      COALESCE(v_instagram->>'name', '@' || COALESCE(v_instagram->>'username','instagram')),
      v_instagram->>'username',
      v_instagram->>'ig_user_token',
      v_token_expires_at,
      v_instagram->>'linked_page_id',
      true, false,
      now(), now(), now(),
      v_instagram->>'ig_user_token'
    )
    ON CONFLICT (company_id, platform, platform_user_id) DO UPDATE
      SET meta_connection_id = EXCLUDED.meta_connection_id,
          account_name       = EXCLUDED.account_name,
          username           = COALESCE(EXCLUDED.username, public.social_accounts.username),
          ig_user_token      = EXCLUDED.ig_user_token,
          access_token       = EXCLUDED.access_token,
          token_expires_at   = EXCLUDED.token_expires_at,
          linked_page_id     = EXCLUDED.linked_page_id,
          is_active          = true,
          is_system_user     = false,
          last_sync_at       = now(),
          updated_at         = now();
  END LOOP;

  -- Upsert threads rows.
  FOR v_thread IN SELECT * FROM jsonb_array_elements(COALESCE(p_threads, '[]'::jsonb))
  LOOP
    INSERT INTO public.social_accounts (
      user_id, company_id, meta_connection_id,
      platform, platform_user_id,
      account_name, username,
      threads_token, token_expires_at,
      linked_page_id, linked_ig_business_id,
      is_active, is_system_user,
      last_sync_at, created_at, updated_at,
      access_token
    )
    VALUES (
      v_user_id, v_company_id, v_connection_id,
      'threads',
      v_thread->>'threads_user_id',
      COALESCE(v_thread->>'account_name', 'Threads'),
      v_thread->>'username',
      v_thread->>'threads_token',
      v_token_expires_at,
      v_thread->>'linked_page_id',
      v_thread->>'linked_ig_business_id',
      true, false,
      now(), now(), now(),
      v_thread->>'threads_token'
    )
    ON CONFLICT (company_id, platform, platform_user_id) DO UPDATE
      SET meta_connection_id    = EXCLUDED.meta_connection_id,
          account_name          = EXCLUDED.account_name,
          username              = COALESCE(EXCLUDED.username, public.social_accounts.username),
          threads_token         = EXCLUDED.threads_token,
          access_token          = EXCLUDED.access_token,
          token_expires_at      = EXCLUDED.token_expires_at,
          linked_page_id        = EXCLUDED.linked_page_id,
          linked_ig_business_id = EXCLUDED.linked_ig_business_id,
          is_active             = true,
          is_system_user        = false,
          last_sync_at          = now(),
          updated_at            = now();
  END LOOP;

  RETURN v_connection_id;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_oauth_apply(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meta_oauth_apply(jsonb, jsonb, jsonb, jsonb) TO service_role;

COMMIT;
