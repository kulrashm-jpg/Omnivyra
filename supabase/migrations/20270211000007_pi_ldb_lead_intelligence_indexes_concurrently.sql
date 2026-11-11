-- 20270211000007 pi_ldb_lead_intelligence_indexes_concurrently
-- (reserved by virality-83, registry commit c6092583f, 2026-11-11)
--
-- The PI-LDB block's indexes on two LIVE, growing tables (source_assertions,
-- lead_intelligence), built CONCURRENTLY. A plain CREATE INDEX holds a SHARE
-- lock that blocks every write for the whole build, and the production row
-- counts are not measured, so guessing wrong would be a write outage.
--
-- NO BEGIN/COMMIT: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- ONE statement per index (the Management API sends one statement per call).
-- Apply AFTER 20270211000006. Idempotent (IF NOT EXISTS).
--
-- A FAILED concurrent build leaves an INVALID index behind, which IF NOT
-- EXISTS would then silently skip on a re-run. So the postcondition (its own
-- statement, last) asserts each index exists AND pg_index.indisvalid. If it
-- RAISEs on an invalid index: DROP INDEX CONCURRENTLY that index, then re-run.

-- "Which of my columns fed this attribute?" (mapping audit)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_source_assertions_source_field
  ON public.source_assertions (organization_id, source_field, attribute)
  WHERE source_field IS NOT NULL;

-- "What did this tenant profile version decide?" (drift and correction)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_source_assertions_mapping_profile
  ON public.source_assertions (mapping_profile_id)
  WHERE mapping_profile_id IS NOT NULL;

-- The platform (vendor) profile reference: also the index a profile delete's
-- SET NULL needs, so it does not scan source_assertions.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_source_assertions_platform_mapping_profile
  ON public.source_assertions (platform_mapping_profile_id)
  WHERE platform_mapping_profile_id IS NOT NULL;

-- "What arrived with no mapping layer?" (the honesty query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_source_assertions_unmapped
  ON public.source_assertions (organization_id, mapping_method)
  WHERE mapping_method IS NULL OR mapping_method = 'no_mapping_layer';

-- Name search without a full scan of the display jsonb.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_intelligence_display_name
  ON public.lead_intelligence ((display ->> 'name'))
  WHERE display ? 'name';

-- Per-tenant origin breakdown (stats byOriginCategory).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_intelligence_company_origin_category
  ON public.lead_intelligence (company_id, origin_category)
  WHERE origin_category IS NOT NULL;

DO $verify$
DECLARE
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['idx_source_assertions_source_field', 'idx_source_assertions_mapping_profile',
      'idx_source_assertions_platform_mapping_profile', 'idx_source_assertions_unmapped',
      'idx_lead_intelligence_display_name', 'idx_lead_intelligence_company_origin_category'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = p AND c.relkind = 'i') THEN
      RAISE EXCEPTION 'PI-LDB index postcondition: index % is missing', p;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = p AND i.indisvalid) THEN
      RAISE EXCEPTION 'PI-LDB index postcondition: index % exists but is INVALID (a failed CONCURRENTLY build that IF NOT EXISTS would skip). DROP INDEX CONCURRENTLY public.% and re-run this migration.', p, p;
    END IF;
  END LOOP;
END
$verify$;
