-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260420180351  Name: rename_twitter_platform_to_x
-- Idempotency: SAFE (UPDATE … WHERE platform = 'twitter' is a no-op on second apply).

UPDATE platform_oauth_configs
SET platform = 'x',
    oauth_scopes = ARRAY['tweet.read','tweet.write','users.read','like.write','follows.write','offline.access'],
    updated_at = NOW()
WHERE platform = 'twitter';

UPDATE social_accounts SET platform = 'x' WHERE platform = 'twitter';
UPDATE community_ai_platform_tokens SET platform = 'x' WHERE platform = 'twitter';
