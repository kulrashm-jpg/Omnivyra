-- Creator Render Queue — additive async orchestration substrate
--
-- PURE ADDITIVE. Mutable OPERATIONAL queue state only. Immutable render
-- lineage stays in the R1 tables (creator_render_job / _attempt /
-- _output) — this table never holds financial/lineage truth.
--
-- No AI video. No scheduler change. Reuses raise-immutable? NO — this is
-- intentionally MUTABLE (lease/retry/state), guarded monotonic like
-- creator_render_job_state. Uses omnivyra_touch_updated_at.
--
--   §1  creator_render_queue_job   (mutable; monotonic queue_state)
--   §2  monotonic guard
--   §3  claim/scan indexes

------------------------------------------------------------------------------
-- §1  QUEUE JOB (operational state)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_render_queue_job (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id     uuid NOT NULL REFERENCES public.creator_render_job(id) ON DELETE RESTRICT,
  provider_key      text NOT NULL,
  queue_state       text NOT NULL DEFAULT 'queued'
    CHECK (queue_state IN (
      'queued','claimed','rendering','processing','moderation',
      'completed','failed','retry_scheduled','cancelled'
    )),
  priority          text NOT NULL DEFAULT 'standard'
    CHECK (priority IN ('interactive','standard','batch')),
  retry_count       integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries       integer NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  lease_owner       text,
  lease_expires_at  timestamptz,
  next_retry_at     timestamptz,
  last_error        text,
  -- one live queue row per render lineage (no duplicate render attempts)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (render_job_id)
);

DROP TRIGGER IF EXISTS trg_crqj_touch ON public.creator_render_queue_job;
CREATE TRIGGER trg_crqj_touch
  BEFORE UPDATE ON public.creator_render_queue_job
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

------------------------------------------------------------------------------
-- §2  MONOTONIC QUEUE-STATE GUARD (terminal frozen; retry_count non-decreasing)
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_render_queue_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal CONSTANT text[] := ARRAY['completed','cancelled'];
BEGIN
  IF OLD.queue_state = ANY (v_terminal) AND NEW.queue_state <> OLD.queue_state THEN
    RAISE EXCEPTION
      'RENDER_QUEUE_FROZEN: % is terminal, cannot transition to % (queue_job=%)',
      OLD.queue_state, NEW.queue_state, OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.retry_count < OLD.retry_count THEN
    RAISE EXCEPTION 'RENDER_QUEUE_RETRY_MONOTONIC: retry_count cannot decrease (% -> %)',
      OLD.retry_count, NEW.retry_count USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_crqj_monotonic ON public.creator_render_queue_job;
CREATE TRIGGER guard_crqj_monotonic
  BEFORE UPDATE ON public.creator_render_queue_job
  FOR EACH ROW EXECUTE FUNCTION public.guard_render_queue_monotonic();

------------------------------------------------------------------------------
-- §3  INDEXES (claim scan + retry sweep)
------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crqj_claimable
  ON public.creator_render_queue_job(queue_state, priority, created_at)
  WHERE queue_state IN ('queued','retry_scheduled');
CREATE INDEX IF NOT EXISTS idx_crqj_lease
  ON public.creator_render_queue_job(lease_expires_at)
  WHERE queue_state IN ('claimed','rendering','processing','moderation');
CREATE INDEX IF NOT EXISTS idx_crqj_retry
  ON public.creator_render_queue_job(next_retry_at)
  WHERE queue_state = 'retry_scheduled';
CREATE INDEX IF NOT EXISTS idx_crqj_job
  ON public.creator_render_queue_job(render_job_id);
