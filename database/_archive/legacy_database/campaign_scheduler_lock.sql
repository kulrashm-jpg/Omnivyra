    -- Stage 19: Idempotent Execution & Concurrency Guard
    -- Scheduler lock prevents concurrent schedule-structured-plan executions

    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS scheduler_lock_id UUID NULL;

    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS scheduler_locked_at TIMESTAMPTZ NULL;

    CREATE INDEX IF NOT EXISTS idx_campaigns_scheduler_lock_id
    ON campaigns(scheduler_lock_id)
    WHERE scheduler_lock_id IS NOT NULL;
