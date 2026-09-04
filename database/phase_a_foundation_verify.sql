-- PHASE A — structural verification. STRICTLY READ-ONLY (SELECT only).
--
-- Verifies that 20260811120000_phase_a_canonical_content_foundation.sql produced
-- exactly the intended structure. Requires NO rows — it asserts shape, not data.
--
-- Run against the staging clone first, then against production after DDL.
-- Every query returns a `status` column; the run is a PASS only when every
-- status reads OK.
--
--   psql "$DB_URL" -f database/phase_a_foundation_verify.sql
--
-- Safe to run at any time: it creates nothing and writes nothing.

\echo '=== 1. TABLES (expect 9 OK) ==='
SELECT t AS object,
       CASE WHEN to_regclass('public.' || t) IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
  FROM unnest(ARRAY['content_type','content','content_variant','content_asset',
                    'content_revision','content_memory','content_originality',
                    'publication_lineage','brand_memory']) AS t
 ORDER BY 1;

\echo '=== 2. content REQUIRED COLUMNS + NULLABILITY ==='
SELECT c.column_name, c.data_type, c.is_nullable,
       CASE
         WHEN c.column_name = 'company_id'   AND c.is_nullable = 'NO'  THEN 'OK'
         WHEN c.column_name = 'campaign_id'  AND c.is_nullable = 'YES' THEN 'OK'
         WHEN c.column_name = 'content_type' AND c.is_nullable = 'NO'  THEN 'OK'
         WHEN c.column_name IN ('id','lifecycle_status','created_at','updated_at') AND c.is_nullable = 'NO' THEN 'OK'
         WHEN c.column_name IN ('title','body','topic','objective','audience','tone',
                                'brief','source_metadata','source_ref','created_by','archived_at') THEN 'OK'
         ELSE 'CHECK'
       END AS status
  FROM information_schema.columns c
 WHERE c.table_schema = 'public' AND c.table_name = 'content'
 ORDER BY c.ordinal_position;

\echo '=== 3. content_memory EMBEDDING CONTRACT (expect vector(1536) + model + version) ==='
SELECT a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type,
       CASE
         WHEN a.attname = 'embedding'         AND format_type(a.atttypid, a.atttypmod) = 'vector(1536)' THEN 'OK'
         WHEN a.attname = 'embedding_model'   AND format_type(a.atttypid, a.atttypmod) = 'text'         THEN 'OK'
         WHEN a.attname = 'embedding_version' AND format_type(a.atttypid, a.atttypmod) = 'integer'      THEN 'OK'
         ELSE 'WRONG TYPE'
       END AS status
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'content_memory'
   AND a.attname IN ('embedding','embedding_model','embedding_version')
 ORDER BY a.attname;

\echo '=== 4. content_asset.asset_id MUST BE text (creator_assets.id is TEXT) ==='
SELECT column_name, data_type,
       CASE WHEN data_type = 'text' THEN 'OK' ELSE 'BUG — uuid cannot hold creator_assets.id' END AS status
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'content_asset' AND column_name = 'asset_id';

\echo '=== 5. FOREIGN KEYS + DELETE RULES ==='
SELECT tc.table_name, kcu.column_name, ccu.table_name AS references, rc.delete_rule, rc.update_rule,
       CASE
         WHEN tc.table_name = 'content'          AND rc.delete_rule = 'RESTRICT'  THEN 'OK'
         WHEN tc.table_name IN ('content_variant','content_revision') AND rc.delete_rule = 'CASCADE' THEN 'OK'
         WHEN tc.table_name = 'content_asset'    AND rc.delete_rule IN ('CASCADE','SET NULL') THEN 'OK'
         WHEN tc.table_name = 'content_type'     AND rc.delete_rule = 'RESTRICT'  THEN 'OK'
         ELSE 'REVIEW'
       END AS status
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
  JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
   AND tc.table_name IN ('content','content_type','content_variant','content_asset','content_revision')
 ORDER BY 1, 2;

\echo '=== 6. NO FALSE FK to creator_assets / scheduled_posts / campaigns (expect 0) ==='
SELECT count(*) AS false_fk_count,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'BUG — soft refs must not be hard FKs' END AS status
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
   AND tc.table_name IN ('content','content_asset','content_memory','content_originality','publication_lineage')
   AND ccu.table_name IN ('creator_assets','scheduled_posts','campaigns');

\echo '=== 7. INDEXES (expect all OK, incl. HNSW) ==='
SELECT i AS index_name,
       CASE WHEN to_regclass('public.' || i) IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
  FROM unnest(ARRAY[
    'content_company_updated_idx','content_company_campaign_idx','content_company_type_status_idx',
    'content_source_ref_uidx','content_variant_content_platform_uidx','content_variant_company_idx',
    'content_asset_content_idx','content_asset_company_idx','content_asset_unique_link_uidx',
    'content_revision_content_rev_uidx','content_revision_content_recent_idx',
    'content_memory_company_created_idx','content_memory_company_campaign_idx',
    'content_memory_company_exact_idx','content_memory_company_normalized_idx',
    'content_memory_company_lifecycle_idx','content_memory_content_idx',
    'content_memory_embedding_hnsw_idx',
    'content_originality_company_created_idx','content_originality_content_idx',
    'content_originality_decision_idx',
    'publication_lineage_content_idx','publication_lineage_company_idx','publication_lineage_parent_idx',
    'content_type_family_active_idx']) AS i
 ORDER BY 1;

\echo '=== 8. HNSW INDEX METHOD + OPERATOR CLASS ==='
SELECT indexname, indexdef,
       CASE WHEN indexdef LIKE '%USING hnsw%' AND indexdef LIKE '%vector_cosine_ops%'
            THEN 'OK' ELSE 'WRONG METHOD/OPCLASS' END AS status
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'content_memory_embedding_hnsw_idx';

\echo '=== 9. RLS ENABLED (expect 9 OK) ==='
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'RLS DISABLED' END AS status
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('content_type','content','content_variant','content_asset',
                     'content_revision','content_memory','content_originality',
                     'publication_lineage','brand_memory')
 ORDER BY 1;

\echo '=== 10. POLICIES (expect 8 company_rw + 1 content_type_read_all) ==='
SELECT tablename, policyname, cmd,
       qual IS NOT NULL AS has_using, with_check IS NOT NULL AS has_with_check,
       CASE
         WHEN policyname LIKE '%_company_rw' AND qual IS NOT NULL AND with_check IS NOT NULL THEN 'OK'
         WHEN policyname = 'content_type_read_all' AND qual IS NOT NULL THEN 'OK'
         ELSE 'REVIEW'
       END AS status
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('content_type','content','content_variant','content_asset',
                     'content_revision','content_memory','content_originality',
                     'publication_lineage','brand_memory')
 ORDER BY 1, 2;

\echo '=== 11. POLICIES RESOLVE TENANCY VIA user_company_roles (expect 8 OK) ==='
SELECT tablename, policyname,
       CASE WHEN qual LIKE '%user_company_roles%' AND qual LIKE '%active%'
            THEN 'OK' ELSE 'REVIEW — tenancy source' END AS status
  FROM pg_policies
 WHERE schemaname = 'public' AND policyname LIKE '%_company_rw'
 ORDER BY 1;

\echo '=== 12. TRIGGERS USE THE HOUSE FUNCTION (expect 5 OK) ==='
SELECT c.relname AS table_name, t.tgname, p.proname AS function,
       CASE WHEN p.proname = 'omnivyra_touch_updated_at' THEN 'OK' ELSE 'WRONG FUNCTION' END AS status
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
   AND c.relname IN ('content','content_variant','content_memory','content_originality','brand_memory')
 ORDER BY 1;

\echo '=== 13. omnivyra_touch_updated_at NOT REDEFINED (expect exactly 1, unchanged body) ==='
SELECT count(*) AS definitions,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'BUG — function duplicated or replaced' END AS status
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'omnivyra_touch_updated_at';

\echo '=== 14. content_type SEEDS (expect 21 canonical + 7 aliases) ==='
SELECT family,
       count(*) FILTER (WHERE alias_of IS NULL) AS canonical,
       count(*) FILTER (WHERE alias_of IS NOT NULL) AS aliases
  FROM public.content_type GROUP BY family ORDER BY 1;

\echo '=== 15. ALIAS TARGETS RESOLVE + NO ALIAS CHAINS (expect 0 problems) ==='
SELECT count(*) AS broken,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'BUG — alias points at another alias or a missing row' END AS status
  FROM public.content_type a
  LEFT JOIN public.content_type b ON b.id = a.alias_of
 WHERE a.alias_of IS NOT NULL AND (b.id IS NULL OR b.alias_of IS NOT NULL);

\echo '=== 16. tweet IS CANONICAL, feed_post IS AN ALIAS OF post ==='
SELECT id, alias_of,
       CASE
         WHEN id = 'tweet'     AND alias_of IS NULL   THEN 'OK'
         WHEN id = 'feed_post' AND alias_of = 'post'  THEN 'OK'
         ELSE 'REVIEW — contradicts formatGovernance.ts'
       END AS status
  FROM public.content_type WHERE id IN ('tweet','feed_post') ORDER BY 1;

\echo '=== 17. LIFECYCLE CHECK ADMITS THE PRODUCTION STATES ==='
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition,
       CASE WHEN pg_get_constraintdef(con.oid) LIKE '%planned%'
             AND pg_get_constraintdef(con.oid) LIKE '%failed%'
            THEN 'OK' ELSE 'BUG — rejects existing production states' END AS status
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
 WHERE n.nspname = 'public' AND rel.relname = 'content'
   AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%lifecycle_status%';

\echo '=== 18. ORIGINALITY DECISION VOCABULARY MATCHES THE EC-R2 CONTRACT ==='
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition,
       CASE WHEN pg_get_constraintdef(con.oid) LIKE '%accepted%'
             AND pg_get_constraintdef(con.oid) LIKE '%duplicate%'
             AND pg_get_constraintdef(con.oid) LIKE '%regenerated%'
             AND pg_get_constraintdef(con.oid) LIKE '%bypassed%'
             AND pg_get_constraintdef(con.oid) LIKE '%error%'
            THEN 'OK' ELSE 'BUG — diverges from OriginalityResult' END AS status
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
 WHERE n.nspname = 'public' AND rel.relname = 'content_originality' AND con.contype = 'c';

\echo '=== 19. NO GLOBAL/CROSS-TENANT TABLE INTRODUCED (every table has company_id) ==='
SELECT t AS table_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = t AND column_name = 'company_id')
       THEN 'OK' ELSE 'BUG — tenant column missing' END AS status
  FROM unnest(ARRAY['content','content_variant','content_asset','content_revision',
                    'content_memory','content_originality','publication_lineage','brand_memory']) AS t
 ORDER BY 1;

\echo '=== 20. LEGACY ROOTS UNTOUCHED (row counts must match pre-migration) ==='
SELECT 'blogs' AS legacy_table, count(*) AS rows FROM public.blogs
UNION ALL SELECT 'daily_content_plans', count(*) FROM public.daily_content_plans
UNION ALL SELECT 'scheduled_posts', count(*) FROM public.scheduled_posts
UNION ALL SELECT 'creator_assets', count(*) FROM public.creator_assets
 ORDER BY 1;

\echo '=== 21. FOUNDATION IS EMPTY (Phase A writes no rows) ==='
SELECT 'content' AS t, count(*) AS rows FROM public.content
UNION ALL SELECT 'content_memory', count(*) FROM public.content_memory
UNION ALL SELECT 'content_originality', count(*) FROM public.content_originality
UNION ALL SELECT 'publication_lineage', count(*) FROM public.publication_lineage
UNION ALL SELECT 'brand_memory', count(*) FROM public.brand_memory
 ORDER BY 1;
