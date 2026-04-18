-- ============================================================
-- Data migration: seed ONE default api_provider_accounts row
-- for every existing external_api_sources row that does not
-- already have an account (idempotent).
--
-- Credentials stored in credentials_encrypted are a JSON object
-- that mirrors the two existing credential paths:
--   { "api_key_env_name": "<env var name>" }         ← api_key / query / bearer / header auth
--   { "oauth_client_id": "<enc>", "oauth_client_secret": "<enc>" }  ← oauth auth
--
-- NOTE: We do NOT decrypt then re-encrypt OAuth credentials here.
-- Instead we store a JSON wrapper {"oauth_client_id_ref":"<existing_encrypted>","oauth_client_secret_ref":"<existing_encrypted>"}
-- so the existing encrypted blobs are reused verbatim.
-- The service layer resolves the "ref" fields and passes them
-- through decryptCredential() as before.
-- ============================================================

INSERT INTO api_provider_accounts (
  api_source_id,
  account_name,
  credentials_encrypted,
  rate_limit_per_min,
  rate_limit_per_day,
  priority,
  is_active,
  created_at,
  updated_at
)
SELECT
  s.id,
  'default',
  -- Build credentials JSON based on auth_type and existing fields.
  -- We store the raw field values as a plain JSON string (unencrypted wrapper).
  -- The api_key_env_name is not secret (it is an env var NAME, not a value).
  -- OAuth refs point to the already-encrypted blobs stored on the source row.
  CASE
    WHEN s.auth_type IN ('api_key', 'bearer', 'query', 'header')
      THEN json_build_object(
             'api_key_env_name', COALESCE(s.api_key_env_name, s.api_key_name, '')
           )::text

    WHEN s.auth_type = 'oauth'
      THEN json_build_object(
             'oauth_client_id_ref',     COALESCE(s.oauth_client_id_encrypted, ''),
             'oauth_client_secret_ref', COALESCE(s.oauth_client_secret_encrypted, '')
           )::text

    ELSE '{}'::text
  END,
  s.rate_limit_per_min,
  NULL,      -- rate_limit_per_day: not tracked yet at source level
  1,         -- priority = 1 (highest; only account)
  s.is_active,
  now(),
  now()
FROM external_api_sources s
WHERE NOT EXISTS (
  SELECT 1
  FROM api_provider_accounts a
  WHERE a.api_source_id = s.id
    AND a.account_name  = 'default'
);
