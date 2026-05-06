-- Phase 3 / Prompt 31 — AI message drafts table + send guard.
-- Already applied to prod via mcp__supabase__apply_migration; this file lets
-- a fresh environment reach the same state via `supabase db push`.
--
-- Trigger enforces three invariants:
--   1. draft.platform must match thread.platform (channel isolation)
--   2. status='sent' only allowed transitioning from 'approved'
--   3. status='sent' requires approved_by + approved_at populated

CREATE TABLE IF NOT EXISTS ai_message_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES engagement_threads(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  generated_text TEXT NOT NULL,
  edited_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'rejected')),
  created_by UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_message_drafts_thread_id
  ON ai_message_drafts(thread_id);

CREATE INDEX IF NOT EXISTS idx_ai_message_drafts_status
  ON ai_message_drafts(status)
  WHERE status IN ('draft', 'approved');

CREATE OR REPLACE FUNCTION ai_message_drafts_guard() RETURNS TRIGGER AS $$
DECLARE
  thread_platform TEXT;
BEGIN
  SELECT platform INTO thread_platform
  FROM engagement_threads WHERE id = NEW.thread_id;

  IF thread_platform IS NULL THEN
    RAISE EXCEPTION 'AI_DRAFT_THREAD_NOT_FOUND: thread % does not exist', NEW.thread_id;
  END IF;

  IF NEW.platform IS DISTINCT FROM thread_platform THEN
    RAISE EXCEPTION 'AI_DRAFT_PLATFORM_MISMATCH: draft.platform=% must match thread.platform=%',
      NEW.platform, thread_platform;
  END IF;

  IF NEW.status = 'sent' THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'approved' THEN
      RAISE EXCEPTION 'AI_DRAFT_SEND_REQUIRES_APPROVAL: status=sent only allowed transitioning from approved (was: %)',
        COALESCE(OLD.status, '<insert>');
    END IF;
    IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'AI_DRAFT_SEND_REQUIRES_APPROVER: approved_by and approved_at must be set before sending';
    END IF;
    IF NEW.sent_at IS NULL THEN
      NEW.sent_at := now();
    END IF;
  END IF;

  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_message_drafts_guard_trigger ON ai_message_drafts;
CREATE TRIGGER ai_message_drafts_guard_trigger
  BEFORE INSERT OR UPDATE ON ai_message_drafts
  FOR EACH ROW
  EXECUTE FUNCTION ai_message_drafts_guard();

COMMENT ON TABLE ai_message_drafts IS
  'AI-generated message drafts. Enforced via trigger: platform must match thread; status=sent only from approved.';
COMMENT ON FUNCTION ai_message_drafts_guard() IS
  'Send guard for ai_message_drafts. Blocks platform mismatch + direct-to-sent transitions.';
