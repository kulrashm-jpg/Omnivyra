-- Migration: Add error_code column to queue_jobs if missing
-- This ensures compatibility between different schema versions

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'queue_jobs' 
        AND column_name = 'error_code'
    ) THEN
        ALTER TABLE queue_jobs ADD COLUMN error_code VARCHAR(100);
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_error_code ON queue_jobs(error_code);
        RAISE NOTICE 'Added error_code column to queue_jobs';
    ELSE
        RAISE NOTICE 'queue_jobs.error_code already exists';
    END IF;
END $$;
