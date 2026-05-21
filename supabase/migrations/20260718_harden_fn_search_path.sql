-- ─────────────────────────────────────────────────────────────────────────────
-- Hardening: correct the malformed search_path on the remaining 34 functions.
--
-- These functions carry `search_path="public, extensions"` — the whole value
-- quoted as ONE identifier, i.e. a single non-existent schema literally named
-- `public, extensions`. Functions with schema-qualified bodies (most triggers)
-- tolerate it; any unqualified reference raises 42P01 at call time. Three
-- queue functions already broke this way and were fixed in 20260714.
--
-- This migration re-sets search_path with correct list syntax for the rest.
-- Configuration only — ALTER FUNCTION ... SET search_path — no bodies,
-- signatures, ownership, grants, or data touched. Additive, non-destructive,
-- reversible. Hardening parity for SECURITY DEFINER functions included
-- (a well-formed explicit search_path also closes search_path-injection risk).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.create_organization_credits_on_company_insert() SET search_path = public, extensions;
ALTER FUNCTION public.delete_intelligence_signals_older_than_365_days() SET search_path = public, extensions;
ALTER FUNCTION public.fn_calendar_events_index_on_scheduled_post_insert() SET search_path = public, extensions;
ALTER FUNCTION public.fn_calendar_events_index_on_scheduled_post_platform_title() SET search_path = public, extensions;
ALTER FUNCTION public.fn_calendar_events_index_on_scheduled_post_update() SET search_path = public, extensions;
ALTER FUNCTION public.get_12_week_campaign_overview(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_12_week_plan_overview(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_campaign_progress(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_day_detail_view(uuid, integer, character varying) SET search_path = public, extensions;
ALTER FUNCTION public.get_engagement_thread_message_distance(uuid, uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_engagement_thread_message_distance(uuid, uuid, integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_lead_recompute_queue_approx_count() SET search_path = public, extensions;
ALTER FUNCTION public.get_week_detail_view(uuid, integer) SET search_path = public, extensions;
ALTER FUNCTION public.guard_firebase_uid_immutable() SET search_path = public, extensions;
ALTER FUNCTION public.increment_response_perf_followup(uuid, timestamp with time zone) SET search_path = public, extensions;
ALTER FUNCTION public.increment_response_perf_like(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.increment_template_usage(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.insert_engagement_signals_avoid_dupes(jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.lead_platform_increment_converted(uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public.lead_platform_increment_signals(uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public.match_clusters_by_embedding(extensions.vector, integer, timestamp with time zone) SET search_path = public, extensions;
ALTER FUNCTION public.public_blogs_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.schedule_lead_thread_recompute(uuid, uuid) SET search_path = public, extensions;
ALTER FUNCTION public.set_opportunity_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_updated_at_timestamp() SET search_path = public, extensions;
ALTER FUNCTION public.sync_blog_likes_count() SET search_path = public, extensions;
ALTER FUNCTION public.transition_campaign_stage(uuid, character varying, character varying, jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.update_access_request_timestamp() SET search_path = public, extensions;
ALTER FUNCTION public.update_campaign_completion() SET search_path = public, extensions;
ALTER FUNCTION public.update_free_credit_profile_timestamp() SET search_path = public, extensions;
ALTER FUNCTION public.update_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, extensions;
ALTER FUNCTION public.upsert_engagement_thread_memory_locked(uuid, uuid, text, uuid) SET search_path = public, extensions;
ALTER FUNCTION public.upsert_engagement_thread_memory_locked(uuid, uuid, text, uuid, uuid) SET search_path = public, extensions;
