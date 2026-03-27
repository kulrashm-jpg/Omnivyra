-- ─────────────────────────────────────────────────────────────────────────────
-- Security hardening: function search_path, vector extension, RLS policy fixes
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Fixes three categories of Supabase database-linter warnings:
--
--   1. function_search_path_mutable  (39 functions)
--      A mutable search_path lets an attacker shadow system objects by
--      creating objects with identical names in a high-priority schema.
--      Fix: pin search_path = 'public, extensions' on every affected function.
--      Using 'public, extensions' (not '') so that:
--        - public tables/types remain accessible without full qualification
--        - extension types (e.g. vector, pgvector) stay accessible after the
--          extension is moved to the extensions schema in section 2.
--
--   2. extension_in_public  (pgvector / vector)
--      Extensions in the public schema can be exploited via search_path
--      manipulation.  Move to a dedicated extensions schema.
--      Note: Supabase default search_path includes 'extensions', so existing
--      column types (vector(N)), operators and functions continue to work.
--
--   3. rls_policy_always_true  (4 policies)
--      Policies using USING (true) / WITH CHECK (true) for mutating operations
--      give unrestricted write access to any caller.  All mutating operations
--      in this application go through Next.js API routes (service-role key,
--      BYPASSRLS privilege), so permissive application-layer policies are not
--      required and should be removed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Pin search_path on all flagged functions
-- ══════════════════════════════════════════════════════════════════════════════
-- We use a DO block so the migration handles overloaded functions (multiple
-- signatures for the same name) and skips functions that no longer exist.
-- pg_get_function_identity_arguments() returns the canonical argument list
-- which is required to uniquely identify a function for ALTER FUNCTION.

DO $$
DECLARE
  r RECORD;
  func_names text[] := ARRAY[
    'increment_template_usage',
    'public_blogs_updated_at',
    'update_free_credit_profile_timestamp',
    'update_campaign_completion',
    'update_access_request_timestamp',
    'set_updated_at_timestamp',
    'delete_intelligence_signals_older_than_365_days',
    'sync_blog_likes_count',
    'get_engagement_thread_message_distance',
    'update_weekly_alignment',
    'get_12_week_plan_overview',
    'populate_weekly_content_from_ai_plan',
    'transition_campaign_stage',
    'set_opportunity_updated_at',
    'get_campaign_progress',
    'update_updated_at_column',
    'get_12_week_campaign_overview',
    'get_week_detail_view',
    'get_day_detail_view',
    'lead_platform_increment_signals',
    'lead_platform_increment_converted',
    'match_clusters_by_embedding',
    'insert_engagement_signals_avoid_dupes',
    'create_organization_credits_on_company_insert',
    'upsert_engagement_thread_memory_locked',
    'apply_credit_reservation',
    'fn_calendar_events_index_on_scheduled_post_update',
    'fn_calendar_events_index_on_scheduled_post_insert',
    'fn_calendar_events_index_on_scheduled_post_delete',
    'fn_calendar_events_index_on_scheduled_post_platform_title',
    'get_lead_recompute_queue_approx_count',
    'cleanup_lead_thread_recompute_queue_orphans',
    'schedule_lead_thread_recompute',
    'claim_conversation_memory_rebuild_batch',
    'increment_response_perf_like',
    'increment_response_perf_followup',
    'guard_firebase_uid_immutable',
    'claim_lead_thread_recompute_batch',
    'update_updated_at'
  ];
  fn text;
BEGIN
  -- For each name, iterate over ALL overloads (handles functions like
  -- get_engagement_thread_message_distance and upsert_engagement_thread_memory_locked
  -- which appear multiple times in the linter output).
  FOREACH fn IN ARRAY func_names LOOP
    FOR r IN
      SELECT
        p.oid,
        p.proname,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = fn
    LOOP
      -- Pin to 'public, extensions':
      --   • 'public' — tables / types defined in our schema
      --   • 'extensions' — pgvector and other Supabase extensions (see section 2)
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) SET search_path = ''public, extensions''',
        r.proname,
        r.args
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Move the vector extension out of public schema
-- ══════════════════════════════════════════════════════════════════════════════
-- Supabase provisions databases with search_path = "$user", public, extensions
-- so moving vector here keeps it accessible without requiring fully-qualified
-- type names in application queries or function bodies.

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  -- Only move if vector is currently installed in the public schema.
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector'
      AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION vector SET SCHEMA extensions;
  END IF;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Remove always-true RLS policies
-- ══════════════════════════════════════════════════════════════════════════════
-- All WRITE operations on these tables are performed exclusively through
-- Next.js API routes using the service-role key.  The service role has the
-- BYPASSRLS privilege and never needs an explicit USING/WITH CHECK policy.
-- Removing permissive policies closes the direct-PostgREST write surface.

-- ── 3a. blog_read_sessions ────────────────────────────────────────────────────
-- Original intent: anonymous browser-side tracking.
-- New intent: tracking goes through /api/blogs/* (service-role).
-- Dropping both INSERT and UPDATE permissive policies.

DROP POLICY IF EXISTS "anyone can track read sessions"  ON public.blog_read_sessions;
DROP POLICY IF EXISTS "anyone can update read sessions" ON public.blog_read_sessions;

-- ── 3b. campaign_versions ─────────────────────────────────────────────────────
-- "Service role has full access to campaign_versions" with USING (true):
-- Redundant — service_role bypasses RLS by default (BYPASSRLS privilege).

DROP POLICY IF EXISTS "Service role has full access to campaign_versions"
  ON public.campaign_versions;

-- ── 3c. engagement_message_sources ───────────────────────────────────────────
-- "Workers can manage message sources" with USING (true):
-- Workers authenticate with service-role key (BYPASSRLS), no policy needed.

DROP POLICY IF EXISTS "Workers can manage message sources"
  ON public.engagement_message_sources;
