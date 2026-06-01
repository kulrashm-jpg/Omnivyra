-- 20260601055400_engagement_thread_collaboration_contract.sql
-- Bring the engagement collaboration schema into the active migration window.
--
-- The API layer already reads/writes these additive columns for assignment and
-- reply soft-lock flows. Keep this migration idempotent so environments that
-- received the later collaboration migration out-of-band remain safe.

ALTER TABLE IF EXISTS public.community_ai_actions
  ADD COLUMN IF NOT EXISTS acting_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_community_ai_actions_acting_user
  ON public.community_ai_actions (organization_id, acting_user_id);

ALTER TABLE IF EXISTS public.engagement_threads
  ADD COLUMN IF NOT EXISTS assigned_to UUID,
  ADD COLUMN IF NOT EXISTS assigned_by UUID,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ignored_by UUID,
  ADD COLUMN IF NOT EXISTS reply_lock_user_id UUID,
  ADD COLUMN IF NOT EXISTS reply_lock_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_engagement_threads_assigned_to
  ON public.engagement_threads (organization_id, assigned_to);

CREATE TABLE IF NOT EXISTS public.engagement_thread_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  thread_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL,
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_thread_events_thread
  ON public.engagement_thread_events (organization_id, thread_id, created_at DESC);

ALTER TABLE public.engagement_thread_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.engagement_thread_events TO service_role;
