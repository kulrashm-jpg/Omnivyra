-- =====================================================
-- LEAD THREAD RECOMPUTE QUEUE RPC
-- Claim rows (UPDATE claimed_at) for worker processing.
-- Rows deleted only after successful computeThreadLeadScore.
-- FOR UPDATE SKIP LOCKED ensures multi-instance safety.
-- claimed_at IS NULL OR claimed_at < NOW() - 60s allows reclaim after crash.
-- =====================================================
-- Run after: lead_thread_recompute_queue_v2.sql
-- =====================================================

-- Schedule recompute: ON CONFLICT DO UPDATE only when new time is meaningfully earlier
CREATE OR REPLACE FUNCTION schedule_lead_thread_recompute(p_thread_id UUID, p_organization_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO lead_thread_recompute_queue (thread_id, organization_id, scheduled_at)
  VALUES (p_thread_id, p_organization_id, NOW() + interval '5 seconds')
  ON CONFLICT (thread_id, organization_id)
  DO UPDATE SET scheduled_at = CASE
    WHEN EXCLUDED.scheduled_at < lead_thread_recompute_queue.scheduled_at - interval '2 seconds'
    THEN EXCLUDED.scheduled_at
    ELSE lead_thread_recompute_queue.scheduled_at
  END;
$$;

-- Approximate queue size (avoids full COUNT(*) scan on large tables)
CREATE OR REPLACE FUNCTION get_lead_recompute_queue_approx_count()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((SELECT c.reltuples::bigint FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'lead_thread_recompute_queue' AND n.nspname = 'public'), 0);
$$;

DROP FUNCTION IF EXISTS claim_lead_thread_recompute_batch(INTEGER);
DROP FUNCTION IF EXISTS claim_lead_thread_recompute_batch(INTEGER, BOOLEAN);

CREATE OR REPLACE FUNCTION claim_lead_thread_recompute_batch(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (thread_id UUID, organization_id UUID, retry_count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  lim INTEGER := LEAST(p_limit, 200);
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _claim_batch (
    thread_id UUID,
    organization_id UUID,
    retry_count INTEGER,
    scheduled_at TIMESTAMPTZ,
    is_expired BOOLEAN
  ) ON COMMIT DROP;

  TRUNCATE _claim_batch;

  -- ORDER BY (claimed_at IS NOT NULL) DESC: expired rows first, prevents starvation
  -- idx_lead_recompute_claim_priority ((claimed_at IS NOT NULL), scheduled_at, retry_count) supports scan
  INSERT INTO _claim_batch (thread_id, organization_id, retry_count, scheduled_at, is_expired)
  SELECT q.thread_id, q.organization_id, q.retry_count, q.scheduled_at, (q.claimed_at IS NOT NULL)
  FROM lead_thread_recompute_queue q
  WHERE q.scheduled_at <= NOW()
    AND (q.claimed_at IS NULL OR q.claimed_at <= NOW() - interval '60 seconds')
  ORDER BY (q.claimed_at IS NOT NULL) DESC, q.scheduled_at ASC, q.retry_count ASC
  LIMIT lim
  FOR UPDATE OF q SKIP LOCKED;

  UPDATE lead_thread_recompute_queue q
  SET claimed_at = NOW()
  FROM _claim_batch b
  WHERE q.thread_id = b.thread_id AND q.organization_id = b.organization_id;

  RETURN QUERY SELECT b.thread_id, b.organization_id, b.retry_count
  FROM _claim_batch b
  ORDER BY b.is_expired DESC, b.scheduled_at ASC, b.retry_count ASC;
END;
$$;

-- Cleanup orphan queue rows (thread or organization no longer exists)
CREATE OR REPLACE FUNCTION cleanup_lead_thread_recompute_queue_orphans()
RETURNS INTEGER
LANGUAGE sql
AS $$
  WITH deleted AS (
    DELETE FROM lead_thread_recompute_queue q
    WHERE NOT EXISTS (
      SELECT 1 FROM engagement_threads t WHERE t.id = q.thread_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM companies c WHERE c.id = q.organization_id
    )
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER FROM deleted;
$$;
