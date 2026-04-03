/**
 * Database Migration: Reports Table with Free Report Tracking
 * 
 * Created: March 29, 2026
 * Purpose: Define the reports table schema with support for free report limiting
 * 
 * Key fields:
 * - is_free: Boolean flag to track free vs paid reports
 * - domain: Website domain for free report limiting (1 per domain, lifetime)
 * - report_type: Type of report generated (content_readiness, competitor_analysis, etc.)
 * - status: Processing status (pending, processing, completed, failed)
 * 
 * TO BE APPLIED: When backend integration is ready
 */

-- ============================================================================
-- CREATE reports TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reports (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,

  -- Free report tracking
  domain VARCHAR(255) NOT NULL, -- Website domain for limiting
  is_free BOOLEAN DEFAULT FALSE, -- TRUE = free report, FALSE = paid/premium
  
  -- Report metadata
  report_type VARCHAR(100) DEFAULT 'content_readiness', -- content_readiness, competitor_analysis, gap_analysis
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, failed
  
  -- Report data (to be populated by backend)
  data JSONB, -- Report analysis data (insights, scores, recommendations, etc.)
  error_message TEXT, -- If status = 'failed', error reason

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Metadata
  metadata JSONB, -- Additional context (generation time, source, version, etc.)

  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT valid_report_type CHECK (report_type IN ('content_readiness', 'competitor_analysis', 'gap_analysis')),
  CONSTRAINT valid_domain CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*([a-z]{2,})?$')
);

-- ============================================================================
-- CREATE INDEXES
-- ============================================================================

-- Fast lookup by company (all reports for a company)
CREATE INDEX IF NOT EXISTS idx_reports_company_id 
  ON public.reports(company_id);

-- Fast lookup by user (who generated the report)
CREATE INDEX IF NOT EXISTS idx_reports_user_id 
  ON public.reports(user_id);

-- Fast lookup by domain + is_free (free report limiting check)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_free_per_domain 
  ON public.reports(domain, is_free) 
  WHERE is_free = true;
-- This ensures only 1 free report per domain

-- Fast lookup by status (for processing pipelines)
CREATE INDEX IF NOT EXISTS idx_reports_status 
  ON public.reports(status);

-- Fast lookup by created date (for sorting/pagination)
CREATE INDEX IF NOT EXISTS idx_reports_created_at 
  ON public.reports(created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Allow users to view reports from their company
DROP POLICY IF EXISTS "users_can_view_company_reports" ON public.reports;
CREATE POLICY "users_can_view_company_reports"
  ON public.reports FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM user_company_roles 
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Allow COMPANY_ADMIN to generate free reports
DROP POLICY IF EXISTS "only_admin_can_create_free_reports" ON public.reports;
CREATE POLICY "only_admin_can_create_free_reports"
  ON public.reports FOR INSERT
  WITH CHECK (
    is_free = FALSE OR (
      is_free = TRUE AND auth.uid() IN (
        SELECT user_id FROM user_company_roles 
        WHERE company_id = reports.company_id 
        AND role = 'COMPANY_ADMIN' 
        AND status = 'active'
      )
    )
  );

-- Allow updates on own reports
DROP POLICY IF EXISTS "users_can_update_own_reports" ON public.reports;
CREATE POLICY "users_can_update_own_reports"
  ON public.reports FOR UPDATE
  USING (
    user_id = auth.uid() OR
    auth.uid() IN (
      SELECT user_id FROM user_company_roles 
      WHERE company_id = reports.company_id AND role = 'COMPANY_ADMIN'
    )
  );

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for checking free report usage by domain
DROP VIEW IF EXISTS vw_free_reports_by_domain CASCADE;
CREATE VIEW vw_free_reports_by_domain AS
  SELECT 
    domain,
    COUNT(*) as free_report_count,
    MAX(created_at) as latest_free_report_at
  FROM reports
  WHERE is_free = TRUE
  GROUP BY domain;

-- View for company report statistics
DROP VIEW IF EXISTS vw_company_report_stats CASCADE;
CREATE VIEW vw_company_report_stats AS
  SELECT 
    company_id,
    COUNT(*) as total_reports,
    COUNT(*) FILTER (WHERE is_free = TRUE) as free_reports,
    COUNT(*) FILTER (WHERE is_free = FALSE) as paid_reports,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_reports,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_reports,
    MAX(created_at) as latest_report_at
  FROM reports
  GROUP BY company_id;

-- ============================================================================
-- SAMPLE QUERIES (FOR BACKEND IMPLEMENTATION)
-- ============================================================================

/*
-- Check if domain already has free report (backend logic)
SELECT COUNT(*) > 0 as has_free_report
FROM reports
WHERE domain = 'example.com' AND is_free = true;

-- Get all reports for company
SELECT * FROM reports
WHERE company_id = 'company-uuid'
ORDER BY created_at DESC;

-- Get latest free report for domain
SELECT * FROM reports
WHERE domain = 'example.com' AND is_free = true
ORDER BY created_at DESC
LIMIT 1;

-- Get report generation statistics
SELECT * FROM vw_company_report_stats WHERE company_id = 'company-uuid';

-- Check free report usage
SELECT domain, free_report_count, latest_free_report_at
FROM vw_free_reports_by_domain
WHERE domain = 'example.com';
*/
