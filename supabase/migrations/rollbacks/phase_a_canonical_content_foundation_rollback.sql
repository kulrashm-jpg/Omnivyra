-- ROLLBACK — PHASE A: Canonical Content Intelligence Foundation.
-- Reverses supabase/migrations/20260811120000_phase_a_canonical_content_foundation.sql
--
-- SAFETY
-- ------
-- Phase A creates ONLY new, empty objects and writes no rows, so this rollback
-- has ZERO data-loss exposure at the moment of application. That property is
-- lost the instant application code begins writing to these tables — see the
-- guard below, which refuses to drop non-empty tables.
--
-- Drops in strict dependency order: triggers → policies → child tables →
-- memory/lineage → content → reference table. Indexes are dropped implicitly
-- with their tables; they are not listed separately.
--
-- DELIBERATELY NOT DROPPED (pre-existing, shared, or owned elsewhere):
--   omnivyra_touch_updated_at()   — serves 60 other production triggers
--   the `vector` extension        — used by intelligence_signals / signal_clusters
--   user_company_roles, companies, creator_assets
--   blogs, daily_content_plans, scheduled_posts and every other legacy root
--   content_similarity_checks, global_campaign_patterns, angle_industry_matrix

-- ── guard — refuse to drop tables that have started holding data ────────────
-- If any table is non-empty, application code is already writing. Rolling back
-- would then be a DATA-DESTROYING operation, not a clean revert. Resolve
-- deliberately rather than letting a rollback script delete production content.
DO $$
DECLARE
  t text;
  n bigint;
  tables text[] := ARRAY[
    'content','content_variant','content_asset','content_revision',
    'content_memory','content_originality','publication_lineage','brand_memory'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION
          'PHASE A ROLLBACK ABORTED: public.% contains % row(s). Rolling back would destroy data. Review before proceeding.', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ── triggers ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS content_touch_updated_at              ON public.content;
DROP TRIGGER IF EXISTS content_variant_touch_updated_at      ON public.content_variant;
DROP TRIGGER IF EXISTS content_memory_touch_updated_at       ON public.content_memory;
DROP TRIGGER IF EXISTS content_originality_touch_updated_at  ON public.content_originality;
DROP TRIGGER IF EXISTS brand_memory_touch_updated_at         ON public.brand_memory;

-- ── policies ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS content_company_rw              ON public.content;
DROP POLICY IF EXISTS content_variant_company_rw      ON public.content_variant;
DROP POLICY IF EXISTS content_asset_company_rw        ON public.content_asset;
DROP POLICY IF EXISTS content_revision_company_rw     ON public.content_revision;
DROP POLICY IF EXISTS content_memory_company_rw       ON public.content_memory;
DROP POLICY IF EXISTS content_originality_company_rw  ON public.content_originality;
DROP POLICY IF EXISTS publication_lineage_company_rw  ON public.publication_lineage;
DROP POLICY IF EXISTS brand_memory_company_rw         ON public.brand_memory;
DROP POLICY IF EXISTS content_type_read_all           ON public.content_type;

-- ── child tables (FK dependents of content) ─────────────────────────────────
DROP TABLE IF EXISTS public.content_asset;
DROP TABLE IF EXISTS public.content_revision;
DROP TABLE IF EXISTS public.content_variant;

-- ── independent memory / verdict / lineage surfaces ────────────────────────
DROP TABLE IF EXISTS public.content_memory;
DROP TABLE IF EXISTS public.content_originality;
DROP TABLE IF EXISTS public.publication_lineage;
DROP TABLE IF EXISTS public.brand_memory;

-- ── canonical root, then the taxonomy it references ────────────────────────
DROP TABLE IF EXISTS public.content;
DROP TABLE IF EXISTS public.content_type;

-- ── post-rollback assertion ────────────────────────────────────────────────
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(t, ', ') INTO remaining
    FROM unnest(ARRAY['content','content_type','content_variant','content_asset',
                      'content_revision','content_memory','content_originality',
                      'publication_lineage','brand_memory']) AS t
   WHERE to_regclass('public.' || t) IS NOT NULL;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PHASE A ROLLBACK INCOMPLETE: still present → %', remaining;
  END IF;
  RAISE NOTICE 'PHASE A ROLLBACK COMPLETE — all 9 objects removed; shared function, extension and legacy tables untouched.';
END $$;
