-- Threads is not an independent OAuth provider in this app.
-- It is derived from a connected Instagram Business account via Meta OAuth.

ALTER TABLE IF EXISTS social_accounts
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS auth_source TEXT,
  ADD COLUMN IF NOT EXISTS instagram_id TEXT;

COMMENT ON COLUMN social_accounts.provider IS 'Logical provider represented by this row, e.g. instagram or threads.';
COMMENT ON COLUMN social_accounts.auth_source IS 'OAuth source for the row, e.g. meta or meta_instagram.';
COMMENT ON COLUMN social_accounts.instagram_id IS 'Instagram Business Account id used by Instagram-derived providers such as Threads.';

CREATE INDEX IF NOT EXISTS idx_social_accounts_auth_source
  ON social_accounts(auth_source);

CREATE INDEX IF NOT EXISTS idx_social_accounts_instagram_id
  ON social_accounts(instagram_id)
  WHERE instagram_id IS NOT NULL;

UPDATE social_accounts
SET
  provider = COALESCE(provider, platform),
  auth_source = COALESCE(auth_source, CASE
    WHEN platform = 'threads' THEN 'meta_instagram'
    WHEN platform IN ('facebook', 'instagram', 'whatsapp') THEN 'meta'
    ELSE NULL
  END),
  instagram_id = CASE
    WHEN platform IN ('instagram', 'threads') THEN COALESCE(instagram_id, platform_user_id)
    ELSE instagram_id
  END
WHERE platform IN ('facebook', 'instagram', 'whatsapp', 'threads');

-- If old standalone Threads rows exist beside an Instagram row with the same
-- account id, make sure they reuse the Instagram token fields going forward.
UPDATE social_accounts threads
SET
  access_token = instagram.access_token,
  refresh_token = instagram.refresh_token,
  token_expires_at = instagram.token_expires_at,
  auth_source = 'meta_instagram',
  provider = 'threads',
  instagram_id = instagram.platform_user_id,
  updated_at = NOW()
FROM social_accounts instagram
WHERE threads.platform = 'threads'
  AND instagram.platform = 'instagram'
  AND threads.user_id = instagram.user_id
  AND COALESCE(threads.company_id::TEXT, '') = COALESCE(instagram.company_id::TEXT, '')
  AND threads.platform_user_id = instagram.platform_user_id;
