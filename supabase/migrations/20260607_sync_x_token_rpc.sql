-- Atomic token sync RPC.
--
-- Why: setToken used to do two separate UPDATEs — social_accounts then
-- community_ai_platform_tokens — with the second one wrapped in try/catch
-- (non-fatal). If the second write failed (network blip, permission error,
-- whatever), social_accounts had a freshly-rotated refresh_token while
-- community_ai_platform_tokens still held the now-invalidated old one.
-- Next refresh against the stale connector row returned invalid_grant and
-- the account was bricked until manual reconnect.
--
-- This function does both writes in a single transaction. Either both land
-- or neither does. The mirror block fires only for X (platform IN x/twitter)
-- and only when social_accounts has a non-NULL company_id to map on.
--
-- The function is intentionally narrow: it knows about exactly two tables
-- and one platform family. Other platforms keep going through the existing
-- single-table path in setToken.

CREATE OR REPLACE FUNCTION sync_x_token(
  p_social_account_id UUID,
  p_access_token_sa TEXT,
  p_refresh_token_sa TEXT,           -- nullable: pass NULL to leave column unchanged
  p_access_token_cat TEXT,
  p_refresh_token_cat TEXT,          -- nullable: pass NULL to leave column unchanged
  p_expires_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_id UUID;
  v_platform   TEXT;
  v_mirror_count INTEGER;
BEGIN
  -- Update social_accounts (canonical row).
  UPDATE social_accounts
  SET
    access_token     = p_access_token_sa,
    refresh_token    = COALESCE(p_refresh_token_sa, refresh_token),
    token_expires_at = COALESCE(p_expires_at, token_expires_at),
    updated_at       = NOW()
  WHERE id = p_social_account_id
  RETURNING company_id, LOWER(platform)
    INTO v_company_id, v_platform;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'social_accounts row not found: %', p_social_account_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Mirror to community_ai_platform_tokens for X only, when mappable.
  IF v_company_id IS NOT NULL AND v_platform IN ('x', 'twitter') THEN
    UPDATE community_ai_platform_tokens
    SET
      access_token  = p_access_token_cat,
      refresh_token = COALESCE(p_refresh_token_cat, refresh_token),
      expires_at    = COALESCE(p_expires_at, expires_at),
      updated_at    = NOW()
    WHERE organization_id = v_company_id
      AND LOWER(platform) IN ('x', 'twitter');

    -- Note: an UPDATE matching 0 rows is NOT an error here — it just means
    -- this org never connected via the community-ai connector flow, so
    -- there's no mirror row to keep in sync. The social_accounts write above
    -- is the canonical record either way.
    GET DIAGNOSTICS v_mirror_count = ROW_COUNT;
  END IF;
END;
$$;
