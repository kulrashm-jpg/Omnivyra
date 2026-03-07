-- =====================================================
-- EXTERNAL API SOURCE REQUESTS — Workflow columns
-- Adds company_id, status enum, approval timestamps.
-- =====================================================
-- Run after: external-api-requests.sql
-- =====================================================

ALTER TABLE external_api_source_requests
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE external_api_source_requests
  ADD COLUMN IF NOT EXISTS approved_by_admin_at TIMESTAMPTZ;

ALTER TABLE external_api_source_requests
  ADD COLUMN IF NOT EXISTS sent_to_super_admin_at TIMESTAMPTZ;

-- Default new rows to pending_admin_review; allow full status set
ALTER TABLE external_api_source_requests
  ALTER COLUMN status SET DEFAULT 'pending_admin_review';

-- Optional: constraint for valid status (PostgreSQL allows existing 'pending' to remain)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_api_source_requests_status_check'
  ) THEN
    ALTER TABLE external_api_source_requests
      ADD CONSTRAINT external_api_source_requests_status_check CHECK (
        status IN (
          'pending_admin_review',
          'approved_by_admin',
          'sent_to_super_admin',
          'approved',
          'rejected',
          'pending'
        )
      );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS index_external_api_source_requests_company
  ON external_api_source_requests (company_id);

-- Request New API form fields
ALTER TABLE external_api_source_requests
  ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE external_api_source_requests
  ADD COLUMN IF NOT EXISTS connection_type TEXT;

ALTER TABLE external_api_source_requests
  ADD COLUMN IF NOT EXISTS documentation_url TEXT;

ALTER TABLE external_api_source_requests
  ADD COLUMN IF NOT EXISTS sample_response TEXT;
