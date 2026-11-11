-- PI-LDB D3(b) origin backfill: READ-ONLY DRY-RUN COUNT for 20270211000008.
-- Run BEFORE any apply, through Release-controls' catalogue runner, owner-
-- approved in the 83 tab, reviewed by virality-05. One statement; counts only,
-- no row data, no personal data. It uses the SAME classification as the
-- migration's @classify block (the real-schema suite pins that the two agree).
--
-- Output rows: (bucket, basis, category, n)
--   bucket 'would_classify'  rows the backfill would write, by basis + category
--   bucket 'stays_unknown'   rows with NULL origin and no structural evidence,
--                            by source_table (category column carries the table)
--   bucket 'already_set'     rows that already carry an origin (untouched)
SELECT bucket, basis, category, count(*) AS n
  FROM (
    SELECT CASE
             WHEN li.origin_category IS NOT NULL THEN 'already_set'
             WHEN (li.source_table = 'leads' AND l.id IS NOT NULL)
               OR (li.source_table = 'canonical_leads' AND psc.id IS NOT NULL) THEN 'would_classify'
             ELSE 'stays_unknown'
           END AS bucket,
           CASE
             WHEN li.origin_category IS NOT NULL THEN NULL
             WHEN li.source_table = 'leads' AND l.id IS NOT NULL THEN 'classifyInboundLead'
             WHEN li.source_table = 'canonical_leads' AND psc.id IS NOT NULL THEN 'pi_adapter_profile_contribution'
           END AS basis,
           CASE
             WHEN li.origin_category IS NOT NULL THEN NULL
             WHEN li.source_table = 'leads' AND l.id IS NOT NULL THEN
               CASE WHEN l.form_id IS NOT NULL THEN 'inbound_form'
                    WHEN l.integration_id IS NOT NULL THEN 'inbound_webhook'
                    WHEN l.visitor_session_id IS NOT NULL THEN 'website'
                    ELSE 'manual' END
             WHEN li.source_table = 'canonical_leads' AND psc.id IS NOT NULL THEN psc.source_category
             ELSE coalesce(li.source_table, '(no source_table)')
           END AS category
      FROM public.lead_intelligence li
      LEFT JOIN public.leads l
        ON li.source_table = 'leads' AND l.id::text = li.source_id AND l.company_id = li.company_id
      LEFT JOIN public.prospect_source_contributions psc
        ON li.source_table = 'canonical_leads' AND psc.canonical_lead_id::text = li.source_id
       AND psc.organization_id = li.company_id AND psc.contribution_role = 'originating'
  ) x
 GROUP BY bucket, basis, category
 ORDER BY bucket, basis, category
