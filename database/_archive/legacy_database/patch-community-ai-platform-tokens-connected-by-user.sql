-- G2.4: Owner-based connector management
-- Add connected_by_user_id to track who connected the account.
-- Allows: Company Admin can disconnect any; connector can disconnect own.

ALTER TABLE community_ai_platform_tokens
  ADD COLUMN IF NOT EXISTS connected_by_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_community_ai_platform_tokens_connected_by
  ON community_ai_platform_tokens(connected_by_user_id)
  WHERE connected_by_user_id IS NOT NULL;

COMMENT ON COLUMN community_ai_platform_tokens.connected_by_user_id IS
  'User who connected this platform (G2.4). Owner or Company Admin may disconnect.';
