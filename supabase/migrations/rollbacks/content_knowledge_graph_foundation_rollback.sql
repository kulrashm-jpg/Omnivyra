-- ============================================================================
-- ROLLBACK — B7.1 Content Knowledge Graph Foundation
--   for supabase/migrations/20260922000000_content_knowledge_graph_foundation.sql
-- ============================================================================
--
-- The forward migration is purely additive (TWO new tables plus their own
-- indexes, policy and triggers), so the rollback removes exactly those two
-- tables and nothing else.
--
-- DATA GUARD (Phase A convention, mirrored):
-- Aborts if either table holds rows. platform_topic_node is AUTHORITATIVE and
-- NOT derivable — identity resolution is a judgement, so dropping populated
-- topic identities is unrecoverable and would invalidate every topic_id
-- reference in company_topic_coverage. company_topic_coverage is rebuildable in
-- principle, but only once B7.2's resolver exists; until then a drop is equally
-- unrecoverable. The guard therefore refuses rather than warns.
--
-- To roll back deliberately with data present, clear the tables first — an
-- explicit act, which is the point of the guard.
--
-- PRESERVED (created before this migration, never touched by it):
--   · the `vector` extension          — content_memory.embedding depends on it
--   · omnivyra_touch_updated_at()     — serves 60 production triggers
--   · public.user_company_roles       — read by the RLS policy, not owned by it
--   · every legacy and canonical table
--
-- Indexes, the RLS policy and both triggers are dropped implicitly with their
-- tables; they are named here only so a reviewer can confirm the forward
-- migration created no other object:
--   platform_topic_node_normalized_uidx, platform_topic_node_canonical_idx,
--   platform_topic_node_parent_idx, platform_topic_node_embedding_idx,
--   platform_topic_node_last_seen_idx, platform_topic_node_touch_updated_at,
--   company_topic_coverage_uidx, company_topic_coverage_recent_idx,
--   company_topic_coverage_topic_idx, company_topic_coverage_recent_idx,
--   company_topic_coverage_company_rw, company_topic_coverage_touch_updated_at
-- ============================================================================

BEGIN;

-- ── Guard: refuse to destroy data ──────────────────────────────────────────
DO $$
DECLARE
  t text;
  n bigint;
  tables text[] := ARRAY['company_topic_coverage','platform_topic_node'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION
          'B7.1 ROLLBACK ABORTED: public.% contains % row(s). platform_topic_node is authoritative and not rebuildable; rolling back would destroy knowledge identity. Clear the tables deliberately before proceeding.', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ── Drop (coverage first: it soft-references topic ids) ────────────────────
DROP TABLE IF EXISTS public.company_topic_coverage;
DROP TABLE IF EXISTS public.platform_topic_node;

-- ── Verify nothing remains ─────────────────────────────────────────────────
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(t, ', ')
    INTO remaining
    FROM unnest(ARRAY['platform_topic_node','company_topic_coverage']) AS t
   WHERE to_regclass('public.' || t) IS NOT NULL;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'B7.1 ROLLBACK INCOMPLETE: still present → %', remaining;
  END IF;
  RAISE NOTICE 'B7.1 ROLLBACK COMPLETE — both objects removed; shared function, extension, user_company_roles and all legacy tables untouched.';
END $$;

COMMIT;
