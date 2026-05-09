/**
 * Phase 1 — Scope report dedupe to (company_id, domain).
 *
 * Replaces the global domain-only partial unique index
 * `unique_generating_report_per_domain` with a company-scoped variant.
 *
 * Behavior after this migration:
 *   - Same company + same domain + status='generating'  -> blocked
 *   - Different company + same domain                   -> allowed
 *
 * Pre-flight: any pre-existing rows that would violate the new index
 * (i.e. multiple 'generating' rows for the same (company_id, domain))
 * are demoted to 'failed' so the index creation does not fail.
 */

BEGIN;

-- Pre-flight: demote duplicate generating rows so the new index can be created.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, domain
      ORDER BY started_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.reports
  WHERE status = 'generating'
)
UPDATE public.reports r
SET
  status = 'failed',
  error_message = COALESCE(r.error_message, 'Demoted by company-scoped dedupe migration'),
  updated_at = NOW()
FROM ranked
WHERE ranked.id = r.id
  AND ranked.rn > 1;

-- Drop the legacy domain-only partial unique index.
DROP INDEX IF EXISTS public.unique_generating_report_per_domain;

-- Create the new company-scoped partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS unique_generating_report_per_company_domain
  ON public.reports(company_id, domain)
  WHERE status = 'generating';

-- Supporting btree index for the recovery sweeper query.
CREATE INDEX IF NOT EXISTS idx_reports_status_started_at
  ON public.reports(status, started_at)
  WHERE status = 'generating';

COMMIT;
