-- Allow action_type='dm' on community_ai_actions so engagement-inbox DM
-- replies (which dispatch via the Chrome extension's browser runtime) can
-- be persisted. Without this, /api/engagement/reply returned
-- "Execution failed" because the row INSERT violated the prior CHECK that
-- only allowed like/reply/share/follow/schedule.

ALTER TABLE community_ai_actions
  DROP CONSTRAINT IF EXISTS community_ai_actions_action_type_check;

ALTER TABLE community_ai_actions
  ADD CONSTRAINT community_ai_actions_action_type_check
  CHECK (action_type IN ('like', 'reply', 'share', 'follow', 'schedule', 'dm'));
