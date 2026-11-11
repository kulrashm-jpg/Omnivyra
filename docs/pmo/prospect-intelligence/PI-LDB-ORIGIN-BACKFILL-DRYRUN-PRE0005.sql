-- PI-LDB D3(b) origin backfill: READ-ONLY SIZING COUNT, PRE-20270211000005.
-- Sizes the 20270211000008 backfill BEFORE any of 20270211000000..07 is
-- applied (Release-controls, 2026-11-11). It names NO column those migrations
-- add (in particular not lead_intelligence.origin_category): every row is
-- treated as not-yet-classified, which is exactly production's state today.
-- After 0005 is applied, use PI-LDB-ORIGIN-BACKFILL-DRYRUN.sql instead (it has
-- the already_set bucket).
--
-- Columns it reads (existence to be confirmed in the same catalogue call):
--   lead_intelligence.(company_id, source_table, source_id)
--   leads.(id, company_id, form_id, integration_id, visitor_session_id)
--   prospect_source_contributions.(id, organization_id, canonical_lead_id,
--                                  contribution_role, source_category)
-- One statement; counts only; the only text returned is schema identifiers
-- (source_table names) and category codes - no row values, no personal data.
--
-- Output rows: (bucket, basis, category, n)
--   would_classify  by basis + category (the backfill's rule, as in its @classify block)
--   stays_unknown   by source_table (category column carries the table name)
SELECT bucket, basis, category, count(*) AS n
  FROM (
    SELECT CASE
             WHEN (li.source_table = 'leads' AND l.id IS NOT NULL)
               OR (li.source_table = 'canonical_leads' AND psc.id IS NOT NULL) THEN 'would_classify'
             ELSE 'stays_unknown'
           END AS bucket,
           CASE
             WHEN li.source_table = 'leads' AND l.id IS NOT NULL THEN 'classifyInboundLead'
             WHEN li.source_table = 'canonical_leads' AND psc.id IS NOT NULL THEN 'pi_adapter_profile_contribution'
           END AS basis,
           CASE
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
