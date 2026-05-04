/**
 * Harden reports free-report enforcement and generation lifecycle.
 *
 * Goals:
 * - strict one free report per domain
 * - explicit generating/completed/failed lifecycle
 * - DB-level protection against duplicate concurrent generation per domain
 */

-- Drop dependent views before altering reports.status.
DROP VIEW IF EXISTS public.vw_company_report_stats;
DROP VIEW IF EXISTS public.vw_free_reports_by_domain;

-- Normalize any legacy status constraint before applying new lifecycle values.
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS valid_status;

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS valid_report_status;

-- Ensure the status column exists.
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS status VARCHAR(20);

-- Migrate legacy statuses into the new lifecycle.
UPDATE public.reports
SET status = CASE
  WHEN status IN ('pending', 'processing') THEN 'generating'
  WHEN status IN ('completed', 'failed') THEN status
  WHEN status IS NULL OR btrim(status) = '' THEN 'completed'
  ELSE 'failed'
END;

ALTER TABLE public.reports
  ALTER COLUMN status TYPE VARCHAR(20);

ALTER TABLE public.reports
  ALTER COLUMN status SET DEFAULT 'completed';

ALTER TABLE public.reports
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.reports
  ADD CONSTRAINT valid_report_status
  CHECK (status IN ('generating', 'completed', 'failed'));

-- Drop legacy indexes/constraints if they exist.
DROP INDEX IF EXISTS public.idx_reports_free_per_domain;
DROP INDEX IF EXISTS public.unique_free_report_per_domain;
DROP INDEX IF EXISTS public.reports_domain_is_free_idx;

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_domain_is_free_key;

DO $$
DECLARE
  duplicate_domain_count integer;
  duplicate_domains text;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_domain_count
  FROM (
    SELECT domain
    FROM public.reports
    WHERE is_free = true
    GROUP BY domain
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_domain_count > 0 THEN
    SELECT string_agg(domain, ', ' ORDER BY domain)
    INTO duplicate_domains
    FROM (
      SELECT domain
      FROM public.reports
      WHERE is_free = true
      GROUP BY domain
      HAVING COUNT(*) > 1
    ) duplicate_list;

    RAISE WARNING 'Duplicate free reports detected for domain(s): %', duplicate_domains;
  ELSE
    CREATE UNIQUE INDEX unique_free_report_per_domain
      ON public.reports(domain)
      WHERE is_free = true;
  END IF;
END $$;

-- Hard-stop duplicate concurrent generation for the same domain.
CREATE UNIQUE INDEX IF NOT EXISTS unique_generating_report_per_domain
  ON public.reports(domain)
  WHERE status = 'generating';

CREATE INDEX IF NOT EXISTS idx_reports_status
  ON public.reports(status);

-- Recreate dependent views after the status migration.
CREATE VIEW public.vw_free_reports_by_domain AS
  SELECT
    domain,
    COUNT(*) AS free_report_count,
    MAX(created_at) AS latest_free_report_at
  FROM public.reports
  WHERE is_free = TRUE
  GROUP BY domain;

CREATE VIEW public.vw_company_report_stats AS
  SELECT
    company_id,
    COUNT(*) AS total_reports,
    COUNT(*) FILTER (WHERE is_free = TRUE) AS free_reports,
    COUNT(*) FILTER (WHERE is_free = FALSE) AS paid_reports,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed_reports,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_reports,
    COUNT(*) FILTER (WHERE status = 'generating') AS generating_reports,
    MAX(created_at) AS latest_report_at
  FROM public.reports
  GROUP BY company_id;
