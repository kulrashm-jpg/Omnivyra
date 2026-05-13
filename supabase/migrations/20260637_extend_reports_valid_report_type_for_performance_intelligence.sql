-- Align the reports table constraint with the canonical monetization/report
-- registry. Performance Intelligence report generation now persists the
-- canonical report_type `performance_intelligence`; older live databases may
-- still only allow the legacy orchestration label `performance`.

BEGIN;

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS valid_report_type;

ALTER TABLE public.reports
  ADD CONSTRAINT valid_report_type CHECK (
    report_type IN (
      'content_readiness',
      'competitor_analysis',
      'gap_analysis',
      'snapshot',
      'performance',
      'performance_intelligence',
      'growth',
      'strategic'
    )
  );

COMMIT;
