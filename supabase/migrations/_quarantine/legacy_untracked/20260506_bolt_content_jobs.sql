-- ============================================================
-- BOLT Content Jobs: Queue-based per-topic job tracking
-- Enables resume, retry, and progress polling for large
-- campaigns (10+ platforms × 5+ content types × 3+/week).
-- ============================================================

-- ── bolt_content_jobs ────────────────────────────────────────
-- One row per topic group (same topic × same week). Tracks the
-- full lifecycle: pending → queued → generating_master →
-- generating_variants → scheduling → done | failed.
-- Stored master_content means variant-only retries skip the
-- expensive LLM master call.

CREATE TABLE IF NOT EXISTS bolt_content_jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID        REFERENCES bolt_execution_runs(id) ON DELETE CASCADE,
  campaign_id       UUID        NOT NULL,
  -- All daily_content_plans row IDs belonging to this topic group
  daily_plan_ids    UUID[]      NOT NULL DEFAULT '{}',
  content_type      TEXT        NOT NULL,
  topic             TEXT        NOT NULL,
  -- Processing priority: 1 = blog (highest), 5 = post
  priority          INT         NOT NULL DEFAULT 5,
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','queued','generating_master','generating_variants','scheduling','done','failed')),
  attempt_count     INT         NOT NULL DEFAULT 0,
  max_attempts      INT         NOT NULL DEFAULT 3,
  -- Cached master prevents re-generation on variant-only retries
  master_content    TEXT,
  master_id         TEXT,
  -- Platform variants keyed "platform::content_type" → generated text
  variants_json     JSONB,
  -- IDs of scheduled_posts created by this job
  scheduled_post_ids UUID[],
  error_message     TEXT,
  -- Worker lock: prevents two workers picking up the same job
  worker_id         TEXT,
  locked_at         TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  -- For exponential back-off retry scheduling
  next_attempt_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bolt_content_jobs_run_status
  ON bolt_content_jobs (run_id, status);

CREATE INDEX IF NOT EXISTS idx_bolt_content_jobs_campaign_status_priority
  ON bolt_content_jobs (campaign_id, status, priority);

-- Retry queue: only scan failed rows that are ready to retry
CREATE INDEX IF NOT EXISTS idx_bolt_content_jobs_retry
  ON bolt_content_jobs (status, next_attempt_at)
  WHERE status = 'failed';

-- ── master_content_cache ──────────────────────────────────────
-- Company-scoped cache keyed by a hash of (topic + intent +
-- brand_voice). Eliminates duplicate LLM calls when the same
-- topic appears across multiple campaigns (common at 3+/week).

CREATE TABLE IF NOT EXISTS master_content_cache (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL,
  -- SHA-256 of canonical(topic || intent_json || brand_voice)
  topic_hash     TEXT        NOT NULL,
  -- Original topic title for human readability / debugging
  topic_title    TEXT,
  master_content TEXT        NOT NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = no expiry; set 30 days for time-sensitive topics
  expires_at     TIMESTAMPTZ,
  hit_count      INT         NOT NULL DEFAULT 0,
  UNIQUE (company_id, topic_hash)
);

CREATE INDEX IF NOT EXISTS idx_master_content_cache_lookup
  ON master_content_cache (company_id, topic_hash);

-- ── platform_content_slots ───────────────────────────────────
-- One row per (daily_plan_id, platform). Decouples planning
-- from generation: the UI can query "how many slots are still
-- empty" and show a live progress bar while workers run.

CREATE TABLE IF NOT EXISTS platform_content_slots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID        NOT NULL,
  daily_plan_id     UUID        REFERENCES daily_content_plans(id) ON DELETE CASCADE,
  bolt_job_id       UUID        REFERENCES bolt_content_jobs(id) ON DELETE SET NULL,
  platform          TEXT        NOT NULL,
  content_type      TEXT        NOT NULL,
  scheduled_for     TIMESTAMPTZ,
  status            TEXT        NOT NULL DEFAULT 'empty'
    CHECK (status IN ('empty','generating','ready','approved','published','failed')),
  generated_content TEXT,
  scheduled_post_id UUID        REFERENCES scheduled_posts(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_content_slots_campaign_status
  ON platform_content_slots (campaign_id, platform, status);

CREATE INDEX IF NOT EXISTS idx_platform_content_slots_job
  ON platform_content_slots (bolt_job_id);

CREATE INDEX IF NOT EXISTS idx_platform_content_slots_daily_plan
  ON platform_content_slots (daily_plan_id);

-- ── content_generation_budget ────────────────────────────────
-- Per-company, per-period AI call budget. Prevents a single
-- misconfigured campaign from exhausting the Claude API quota.

CREATE TABLE IF NOT EXISTS content_generation_budget (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL,
  period_start   DATE        NOT NULL,
  period_end     DATE        NOT NULL,
  plan_tier      TEXT        NOT NULL DEFAULT 'growth',
  -- Soft limits: system warns but doesn't hard-block
  max_ai_calls   INT         NOT NULL DEFAULT 500,
  used_ai_calls  INT         NOT NULL DEFAULT 0,
  max_posts      INT         NOT NULL DEFAULT 2000,
  used_posts     INT         NOT NULL DEFAULT 0,
  -- Optional token-level budget (NULL = unlimited)
  token_budget   BIGINT,
  tokens_used    BIGINT      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_content_generation_budget_company
  ON content_generation_budget (company_id, period_start);

-- ── RPC: atomically increment bolt_execution_runs progress ──────
-- Workers call this after scheduling each topic group.
-- bolt_execution_runs must have scheduled_count / skipped_count columns
-- (add them if missing — they default to 0).

ALTER TABLE bolt_execution_runs
  ADD COLUMN IF NOT EXISTS content_jobs_total   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_jobs_done    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_jobs_failed  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_scheduled      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_skipped        INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_bolt_run_progress(
  p_run_id    UUID,
  p_scheduled INT DEFAULT 0,
  p_skipped   INT DEFAULT 0,
  p_job_done  INT DEFAULT 1,
  p_job_failed INT DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE bolt_execution_runs
  SET
    content_jobs_done  = content_jobs_done  + p_job_done,
    content_jobs_failed = content_jobs_failed + p_job_failed,
    posts_scheduled    = posts_scheduled    + p_scheduled,
    posts_skipped      = posts_skipped      + p_skipped,
    updated_at         = now()
  WHERE id = p_run_id;
END;
$$;

-- ── updated_at triggers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bolt_content_jobs_updated_at') THEN
    CREATE TRIGGER trg_bolt_content_jobs_updated_at
      BEFORE UPDATE ON bolt_content_jobs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_platform_content_slots_updated_at') THEN
    CREATE TRIGGER trg_platform_content_slots_updated_at
      BEFORE UPDATE ON platform_content_slots
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_content_generation_budget_updated_at') THEN
    CREATE TRIGGER trg_content_generation_budget_updated_at
      BEFORE UPDATE ON content_generation_budget
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE bolt_content_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_content_cache      ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_content_slots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_generation_budget ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (workers run as service role)
CREATE POLICY "service_role_bolt_content_jobs"
  ON bolt_content_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_master_content_cache"
  ON master_content_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_platform_content_slots"
  ON platform_content_slots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_content_generation_budget"
  ON content_generation_budget FOR ALL TO service_role USING (true) WITH CHECK (true);
