-- ROLLBACK for 20270211000007_pi_ldb_lead_intelligence_indexes_concurrently.sql
--
-- Drops the PI-LDB indexes CONCURRENTLY (no write block). NO BEGIN/COMMIT:
-- DROP INDEX CONCURRENTLY cannot run inside a transaction. One statement per
-- index. Run this BEFORE the 0005/0003/0001 rollbacks. Loses no data.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_lead_intelligence_company_origin_category;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_lead_intelligence_display_name;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_source_assertions_unmapped;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_source_assertions_platform_mapping_profile;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_source_assertions_mapping_profile;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_source_assertions_source_field;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname IN (
                'idx_lead_intelligence_company_origin_category', 'idx_lead_intelligence_display_name',
                'idx_source_assertions_unmapped', 'idx_source_assertions_platform_mapping_profile',
                'idx_source_assertions_mapping_profile', 'idx_source_assertions_source_field')) THEN
    RAISE EXCEPTION 'PI-LDB index rollback postcondition: an index survived';
  END IF;
END
$verify$;
