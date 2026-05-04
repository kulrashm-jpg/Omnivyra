-- Demote community_ai_platform_tokens to metadata-only.
--
-- Why: this table previously stored access_token / refresh_token / expires_at
-- in parallel with social_accounts. The dual-table model caused refresh_token
-- drift: a successful refresh through one path silently invalidated the other
-- (X v2 rotates refresh_tokens on every use). The audit before this migration
-- traced every X invalid_grant in production back to that drift.
--
-- After this change, tokens live exclusively in social_accounts. This table
-- keeps only the rows that record "this org has connected this platform via
-- the community-AI flow, and this user clicked the button" — pure metadata.
-- Token reads route through tokenStore.getToken(socialAccountId) via
-- platformTokenService.resolveSocialAccountIdForOrg.
--
-- Rollback: re-add the columns. Tokens themselves cannot be recovered from
-- this migration alone — they must be re-issued via reconnect.

ALTER TABLE community_ai_platform_tokens DROP COLUMN IF EXISTS access_token;
ALTER TABLE community_ai_platform_tokens DROP COLUMN IF EXISTS refresh_token;
ALTER TABLE community_ai_platform_tokens DROP COLUMN IF EXISTS expires_at;

-- Drop the atomic dual-write RPC. With only one token table left there is
-- no second write to coordinate; setToken in tokenStore.ts is now a single
-- UPDATE on social_accounts.
DROP FUNCTION IF EXISTS sync_x_token(
  UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
);
