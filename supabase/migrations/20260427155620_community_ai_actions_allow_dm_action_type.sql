-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260427155620  Name: community_ai_actions_allow_dm_action_type
-- Idempotency: GUARDED (DROP CONSTRAINT IF EXISTS).

-- Allow action_type='dm' on community_ai_actions so engagement-inbox DM
-- replies (which dispatch via the Chrome extension's browser runtime) can
-- be persisted. Without this, /api/engagement/reply returns
-- "Execution failed" because the row write violates the prior CHECK that
-- only allowed like/reply/share/follow/schedule.
ALTER TABLE community_ai_actions
  DROP CONSTRAINT IF EXISTS community_ai_actions_action_type_check;

ALTER TABLE community_ai_actions
  ADD CONSTRAINT community_ai_actions_action_type_check
  CHECK (action_type IN ('like', 'reply', 'share', 'follow', 'schedule', 'dm'));
