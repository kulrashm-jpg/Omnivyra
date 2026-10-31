-- SEC B — class-wide function EXECUTE + search_path hardening (public schema).
--
-- Scope: 76 trigger functions (58 pinned here), 52 service-only functions (29 pinned here), 4 client-callable helpers (2 pinned here).
-- Every function is named explicitly below; the lists were generated from the
-- production function inventory (read-only evidence 2026-10-31T04:08Z,
-- drafts/DATABASE_FUNCTION_SECURITY_INVENTORY) and reviewed one by one. Nothing
-- here loops over the catalog to decide what to change.
--
-- ─── WHAT PRODUCTION HAS ──────────────────────────────────────────────────
--   171 functions in public, all owned by postgres, none extension-owned.
--   80 return `trigger`: 69 are EXECUTE-able by anon (PUBLIC + anon grants from
--   before the 20261026000000 default-privilege tightening), 60 have no pinned
--   search_path. 57 non-trigger functions are EXECUTE-able by anon and/or
--   authenticated, so PostgREST exposes them on /rpc to any holder of the
--   publishable key or a user JWT. None of the 34 SECURITY DEFINER functions is
--   client-executable (they are untouched here).
--
-- ─── WHAT CHANGES ─────────────────────────────────────────────────────────
--   class T  trigger functions: REVOKE ALL FROM PUBLIC, anon, authenticated.
--            The owner (postgres) and service_role keep EXECUTE. Firing a trigger
--            never checks EXECUTE (re-proved by sec_b_function_classwide.test.ts),
--            and PostgREST never exposes trigger-returning functions, so no write
--            path changes. search_path = pg_catalog, public is pinned ONLY where
--            every unqualified name in the body was verified to resolve in
--            pg_catalog or public; functions that already pin a path keep theirs.
--   class B  service-only functions: every application caller uses the
--            service-role client (backend/db/supabaseClient.ts) or there is no
--            caller at all. REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT
--            EXECUTE TO service_role (already held in production). Unpinned ones
--            are pinned to pg_catalog, public after the same verification.
--            Includes pi_apply_canonical_decisions (ownedDbRpc → service role)
--            and merge_unified_persons (no caller; INVOKER; no tenant check of
--            its own — RLS currently makes it fail closed for clients).
--   class A  helpers evaluated AS the client — current_company_id() (60 RLS
--            policies) and three CHECK-constraint validators: PUBLIC is replaced
--            by explicit grants to anon, authenticated, service_role (identical
--            effective access). The two plpgsql validators are pinned; the SQL
--            helpers stay unpinned so the planner can still inline them.
--
-- ─── WHAT DOES NOT CHANGE ─────────────────────────────────────────────────
--   No function body, owner, SECURITY DEFINER/INVOKER flag, trigger, table,
--   policy or table grant. No function outside schema public, no
--   extension-owned function. The three opportunity trigger functions belong to
--   20270110000001 (SEC A2) and are not repeated here. pi_authority_providers_ok
--   (CHECK helper, already explicit grants) is left as is.
--   public.set_content_updated_at() exists in production only (no migration
--   creates it), so a replay cannot preflight it: it is NOT in this migration;
--   $verify$ reports any such leftover in a NOTICE.
--
-- Re-runnable: REVOKE/GRANT/ALTER ... SET are idempotent; $preflight$ accepts an
-- already-pinned function only when it carries exactly the value pinned here.
-- Rollback: supabase/migrations/rollbacks/function_execute_classwide_hardening_rollback.sql

BEGIN;

DO $preflight$
DECLARE
  r      record;
  v_oid  oid;
  v_n    integer := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.ai_message_drafts_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.canonical_decisions_append_only()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.capability_audit_log_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.content_publish_snapshots_guard_immutable()', 'T', false, false, '{"search_path=\"\""}'::text[], 1),
    ('public.create_organization_credits_on_company_insert()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.creator_audit_log_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.enforce_community_ai_executor_writes()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.engagement_messages_tenant_from_thread()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_approval_post_execute()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_bo_no_delete()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_contract_immutable_after_active()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_firebase_uid_immutable()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.guard_invoice_line_items_frozen()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_jer_status_monotonic()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_render_queue_monotonic()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_render_state_monotonic()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_super_admin_membership_company()', 'T', false, false, '{"search_path=public"}'::text[], 1),
    ('public.omnivyra_log_decision_event()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_prevent_decision_delete()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_prevent_decision_overwrite()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_touch_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 74),
    ('public.omnivyra_validate_decision_action()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_validate_decision_object_entity()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.pi_prospect_alias_guard()', 'T', false, false, '{"search_path=public, pg_temp"}'::text[], 2),
    ('public.prevent_company_context_snapshot_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.prospect_icp_versions_guard_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.prospect_score_evaluations_immutable()', 'T', false, false, '{"search_path=public, pg_temp"}'::text[], 1),
    ('public.public_blogs_updated_at()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.raise_audit_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.raise_ledger_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 46),
    ('public.set_opportunity_updated_at()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 12),
    ('public.set_updated_at_timestamp()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 7),
    ('public.source_assertions_relationship_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.sync_blog_likes_count()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.sync_company_id_columns()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.telemetry_events_reject_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.tenant_sending_domains_identity_guard()', 'T', false, false, '{"search_path=public, pg_temp"}'::text[], 1),
    ('public.trg_cec_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_consent_records_append_only_update()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_consent_records_block_delete()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_contacts_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_curated_industry_sources_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_governance_policy_protect_update()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_incident_timeline_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_lead_signals_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_marketplace_certs_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase0_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase10_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 8),
    ('public.trg_phase11_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 5),
    ('public.trg_phase12_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase2_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase3_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_phase4_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase5_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 4),
    ('public.trg_phase6_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase7_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase8_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 6),
    ('public.trg_phase9_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 6),
    ('public.trg_prospect_lifecycle_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 3),
    ('public.trg_safeguard_triggers_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_safety_rail_events_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_stab_events_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.update_access_request_timestamp()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.update_campaign_completion()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.update_campaign_context_updated_at()', 'T', false, false, '{"search_path=public"}'::text[], 1),
    ('public.update_feature_completion_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.update_free_credit_profile_timestamp()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.update_free_credit_unlock_timestamp()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.update_org_controls_timestamp()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.update_updated_at()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 3),
    ('public.update_updated_at_column()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 9),
    ('public.worker_snapshot_shadow_telemetry_append_only()', 'T', false, false, '{"search_path=\"\""}'::text[], 1),
    ('public.ws3_protect_task_provenance()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.ws3_reject_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 6),
    ('public.ws3_suppression_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.advance_job_execution(text,text,uuid,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.advance_payment_provider_event_state(uuid,text,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.cancel_credit_action_approval(uuid,uuid,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.claim_conversation_memory_rebuild_batch(integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.claim_creator_execution_lock(uuid,text,integer,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.claim_job_execution(text,text,text,text,text,uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.claim_lead_thread_recompute_batch(integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.cleanup_lead_thread_recompute_queue_orphans()', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.enhance_weekly_content_with_ai(uuid,integer,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.expire_org_free_credits(uuid,integer,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.extend_creator_execution_lock(uuid,text,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.finalize_weekly_content(uuid,integer,text,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.free_credits_summary()', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.get_12_week_campaign_overview(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_12_week_plan_overview(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_campaign_progress(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_day_detail_view(uuid,integer,character varying)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_engagement_thread_message_distance(uuid,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_engagement_thread_message_distance(uuid,uuid,integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_lead_recompute_queue_approx_count()', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_week_detail_view(uuid,integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.increment_response_perf_followup(uuid,timestamp with time zone)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.increment_response_perf_like(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.increment_template_usage(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.insert_engagement_signals_avoid_dupes(jsonb)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.insert_thread_atomic(jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.lead_platform_increment_converted(uuid,text)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.lead_platform_increment_signals(uuid,text)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.lookup_fx_rate(text,text,timestamp with time zone)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.match_clusters_by_embedding(extensions.vector,integer,timestamp with time zone)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.merge_unified_persons(uuid,uuid,text,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_canonical_attribute_allowlist(text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_relationship_clear_primary(uuid,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_relationship_set_primary(uuid,uuid,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.populate_daily_plans_from_weekly(uuid,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.populate_weekly_content_from_ai_plan(uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.purge_expired_creator_execution_audit_logs()', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.purge_old_creator_render_metrics(integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.purge_old_system_health_metrics()', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.replace_thread_children(uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.required_approvals_for_action(text,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.schedule_lead_thread_recompute(uuid,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.sign_credit_action_approval(uuid,uuid,text,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.transition_campaign_stage(uuid,character varying,character varying,jsonb)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.update_weekly_alignment(uuid,integer,character varying,text,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.current_company_id()', 'A', false, false, NULL::text[], 0),
    ('public.is_valid_creator_daily_content_payload(text,text,text)', 'A', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.is_valid_creator_platform_asset_combo(text,text,text)', 'A', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_canonical_attribute_set(text[])', 'A', false, false, NULL::text[], 0)
  ) AS t(sig, cls, secdef, pin, cfg, min_trg)
  LOOP
    v_oid := to_regprocedure(r.sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'SEC-B preflight: % does not exist', r.sig;
    END IF;
    IF (SELECT pronamespace <> 'public'::regnamespace FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'SEC-B preflight: % is not in schema public', r.sig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = v_oid AND d.deptype = 'e') THEN
      RAISE EXCEPTION 'SEC-B preflight: % is owned by an extension; refusing to touch it', r.sig;
    END IF;
    IF (r.cls = 'T') <> (SELECT prorettype = 'trigger'::regtype FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'SEC-B preflight: % expected class % but its return type disagrees', r.sig, r.cls;
    END IF;
    IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM r.secdef THEN
      RAISE EXCEPTION 'SEC-B preflight: % SECURITY DEFINER flag differs from the reviewed state (expected %)', r.sig, r.secdef;
    END IF;
    -- A function about to be pinned must still be unpinned (or already carry exactly
    -- this value, on a re-run); anything else means its body changed since review.
    IF r.pin AND (SELECT proconfig FROM pg_proc WHERE oid = v_oid) IS NOT NULL
       AND (SELECT proconfig FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM r.cfg THEN
      RAISE EXCEPTION 'SEC-B preflight: % carries an unexpected proconfig %', r.sig, (SELECT proconfig FROM pg_proc WHERE oid = v_oid);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 132 THEN
    RAISE EXCEPTION 'SEC-B preflight: expected 132 listed functions, checked %', v_n;
  END IF;
END
$preflight$;

-- ─── Trigger functions (class T): no client may name them ─────────────────
REVOKE ALL ON FUNCTION public.ai_message_drafts_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.canonical_decisions_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capability_audit_log_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_publish_snapshots_guard_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_organization_credits_on_company_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_audit_log_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_community_ai_executor_writes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.engagement_messages_tenant_from_thread() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_approval_post_execute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_bo_no_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_contract_immutable_after_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_firebase_uid_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_invoice_line_items_frozen() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_jer_status_monotonic() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_render_queue_monotonic() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_render_state_monotonic() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_super_admin_membership_company() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omnivyra_log_decision_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omnivyra_prevent_decision_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omnivyra_prevent_decision_overwrite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omnivyra_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omnivyra_validate_decision_action() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.omnivyra_validate_decision_object_entity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pi_prospect_alias_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_company_context_snapshot_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_icp_versions_guard_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prospect_score_evaluations_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_blogs_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_audit_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raise_ledger_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_opportunity_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_assertions_relationship_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_blog_likes_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_company_id_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telemetry_events_reject_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_sending_domains_identity_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_cec_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_consent_records_append_only_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_consent_records_block_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_contacts_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_curated_industry_sources_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_governance_policy_protect_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_incident_timeline_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_lead_signals_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_marketplace_certs_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase0_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase10_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase11_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase12_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase2_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase3_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase4_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase5_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase6_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase7_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase8_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_phase9_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_prospect_lifecycle_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_safeguard_triggers_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_safety_rail_events_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_stab_events_block_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_access_request_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_campaign_completion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_campaign_context_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_feature_completion_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_free_credit_profile_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_free_credit_unlock_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_org_controls_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.worker_snapshot_shadow_telemetry_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ws3_protect_task_provenance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ws3_reject_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ws3_suppression_guard() FROM PUBLIC, anon, authenticated;

-- Pinned only where every unqualified reference in the body was verified to
-- resolve in pg_catalog or public (see the inventory).
ALTER FUNCTION public.ai_message_drafts_guard() SET search_path = pg_catalog, public;
ALTER FUNCTION public.canonical_decisions_append_only() SET search_path = pg_catalog, public;
ALTER FUNCTION public.capability_audit_log_block_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.creator_audit_log_immutable() SET search_path = pg_catalog, public;
ALTER FUNCTION public.enforce_community_ai_executor_writes() SET search_path = pg_catalog, public;
ALTER FUNCTION public.engagement_messages_tenant_from_thread() SET search_path = pg_catalog, public;
ALTER FUNCTION public.guard_approval_post_execute() SET search_path = pg_catalog, public;
ALTER FUNCTION public.guard_bo_no_delete() SET search_path = pg_catalog, public;
ALTER FUNCTION public.guard_contract_immutable_after_active() SET search_path = pg_catalog, public;
ALTER FUNCTION public.guard_invoice_line_items_frozen() SET search_path = pg_catalog, public;
ALTER FUNCTION public.guard_jer_status_monotonic() SET search_path = pg_catalog, public;
ALTER FUNCTION public.guard_render_queue_monotonic() SET search_path = pg_catalog, public;
ALTER FUNCTION public.guard_render_state_monotonic() SET search_path = pg_catalog, public;
ALTER FUNCTION public.omnivyra_log_decision_event() SET search_path = pg_catalog, public;
ALTER FUNCTION public.omnivyra_prevent_decision_delete() SET search_path = pg_catalog, public;
ALTER FUNCTION public.omnivyra_prevent_decision_overwrite() SET search_path = pg_catalog, public;
ALTER FUNCTION public.omnivyra_touch_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.omnivyra_validate_decision_action() SET search_path = pg_catalog, public;
ALTER FUNCTION public.omnivyra_validate_decision_object_entity() SET search_path = pg_catalog, public;
ALTER FUNCTION public.prevent_company_context_snapshot_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.prospect_icp_versions_guard_immutable() SET search_path = pg_catalog, public;
ALTER FUNCTION public.raise_audit_immutable() SET search_path = pg_catalog, public;
ALTER FUNCTION public.raise_ledger_immutable() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.source_assertions_relationship_guard() SET search_path = pg_catalog, public;
ALTER FUNCTION public.sync_company_id_columns() SET search_path = pg_catalog, public;
ALTER FUNCTION public.telemetry_events_reject_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_cec_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_consent_records_append_only_update() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_consent_records_block_delete() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_contacts_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_curated_industry_sources_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_governance_policy_protect_update() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_incident_timeline_block_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_lead_signals_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_marketplace_certs_block_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase0_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase10_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase11_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase12_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase2_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase3_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase4_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase5_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase6_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase7_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase8_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_phase9_set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_prospect_lifecycle_guard() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_safeguard_triggers_block_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_safety_rail_events_block_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.trg_stab_events_block_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_feature_completion_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_free_credit_unlock_timestamp() SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_org_controls_timestamp() SET search_path = pg_catalog, public;
ALTER FUNCTION public.ws3_protect_task_provenance() SET search_path = pg_catalog, public;
ALTER FUNCTION public.ws3_reject_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.ws3_suppression_guard() SET search_path = pg_catalog, public;

-- ─── Service-only functions (class B) ──────────────────────────────────────
-- service_role already holds EXECUTE in production (Supabase default privileges);
-- granting it explicitly keeps it after PUBLIC is revoked on replays that lack them.
REVOKE ALL ON FUNCTION public.advance_job_execution(text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_job_execution(text,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.advance_payment_provider_event_state(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_payment_provider_event_state(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_credit_action_approval(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_credit_action_approval(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_conversation_memory_rebuild_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversation_memory_rebuild_batch(integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_creator_execution_lock(uuid,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_creator_execution_lock(uuid,text,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_job_execution(text,text,text,text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_execution(text,text,text,text,text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.claim_lead_thread_recompute_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lead_thread_recompute_batch(integer) TO service_role;
REVOKE ALL ON FUNCTION public.cleanup_lead_thread_recompute_queue_orphans() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_lead_thread_recompute_queue_orphans() TO service_role;
REVOKE ALL ON FUNCTION public.enhance_weekly_content_with_ai(uuid,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enhance_weekly_content_with_ai(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.expire_org_free_credits(uuid,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_org_free_credits(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.extend_creator_execution_lock(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_creator_execution_lock(uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_weekly_content(uuid,integer,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_weekly_content(uuid,integer,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.free_credits_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_credits_summary() TO service_role;
REVOKE ALL ON FUNCTION public.get_12_week_campaign_overview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_12_week_campaign_overview(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_12_week_plan_overview(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_12_week_plan_overview(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_campaign_progress(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_progress(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_day_detail_view(uuid,integer,character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_day_detail_view(uuid,integer,character varying) TO service_role;
REVOKE ALL ON FUNCTION public.get_engagement_thread_message_distance(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_engagement_thread_message_distance(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_engagement_thread_message_distance(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_engagement_thread_message_distance(uuid,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_lead_recompute_queue_approx_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_recompute_queue_approx_count() TO service_role;
REVOKE ALL ON FUNCTION public.get_week_detail_view(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_week_detail_view(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.increment_response_perf_followup(uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_response_perf_followup(uuid,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.increment_response_perf_like(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_response_perf_like(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.increment_template_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_template_usage(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.insert_engagement_signals_avoid_dupes(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_engagement_signals_avoid_dupes(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.insert_thread_atomic(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_thread_atomic(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.lead_platform_increment_converted(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_platform_increment_converted(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.lead_platform_increment_signals(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_platform_increment_signals(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.lookup_fx_rate(text,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_fx_rate(text,text,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.match_clusters_by_embedding(extensions.vector,integer,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_clusters_by_embedding(extensions.vector,integer,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.merge_unified_persons(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_unified_persons(uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pi_canonical_attribute_allowlist(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_canonical_attribute_allowlist(text) TO service_role;
REVOKE ALL ON FUNCTION public.pi_relationship_clear_primary(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_relationship_clear_primary(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.pi_relationship_set_primary(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_relationship_set_primary(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.populate_daily_plans_from_weekly(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.populate_daily_plans_from_weekly(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.populate_weekly_content_from_ai_plan(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.populate_weekly_content_from_ai_plan(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.purge_expired_creator_execution_audit_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_creator_execution_audit_logs() TO service_role;
REVOKE ALL ON FUNCTION public.purge_old_creator_render_metrics(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_creator_render_metrics(integer) TO service_role;
REVOKE ALL ON FUNCTION public.purge_old_system_health_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_system_health_metrics() TO service_role;
REVOKE ALL ON FUNCTION public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.replace_thread_children(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_thread_children(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.required_approvals_for_action(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.required_approvals_for_action(text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.schedule_lead_thread_recompute(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_lead_thread_recompute(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.sign_credit_action_approval(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_credit_action_approval(uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.transition_campaign_stage(uuid,character varying,character varying,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_campaign_stage(uuid,character varying,character varying,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.update_weekly_alignment(uuid,integer,character varying,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_weekly_alignment(uuid,integer,character varying,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid,uuid) TO service_role;

ALTER FUNCTION public.advance_job_execution(text,text,uuid,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.advance_payment_provider_event_state(uuid,text,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.cancel_credit_action_approval(uuid,uuid,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.claim_creator_execution_lock(uuid,text,integer,integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.claim_job_execution(text,text,text,text,text,uuid,jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.enhance_weekly_content_with_ai(uuid,integer,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.expire_org_free_credits(uuid,integer,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.extend_creator_execution_lock(uuid,text,integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.finalize_weekly_content(uuid,integer,text,uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.free_credits_summary() SET search_path = pg_catalog, public;
ALTER FUNCTION public.insert_thread_atomic(jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.lookup_fx_rate(text,text,timestamp with time zone) SET search_path = pg_catalog, public;
ALTER FUNCTION public.merge_unified_persons(uuid,uuid,text,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.pi_canonical_attribute_allowlist(text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.pi_relationship_clear_primary(uuid,uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone) SET search_path = pg_catalog, public;
ALTER FUNCTION public.pi_relationship_set_primary(uuid,uuid,uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.populate_daily_plans_from_weekly(uuid,integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.populate_weekly_content_from_ai_plan(uuid,jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.purge_expired_creator_execution_audit_logs() SET search_path = pg_catalog, public;
ALTER FUNCTION public.purge_old_creator_render_metrics(integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.purge_old_system_health_metrics() SET search_path = pg_catalog, public;
ALTER FUNCTION public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.replace_thread_children(uuid,jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION public.required_approvals_for_action(text,integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.sign_credit_action_approval(uuid,uuid,text,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_weekly_alignment(uuid,integer,character varying,text,uuid) SET search_path = pg_catalog, public;

-- ─── Client-callable helpers (class A): same effective access, made explicit ─
REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC;
-- grant-ok: current_company_id is evaluated as the client (RLS policy / CHECK constraint); anon and authenticated held it before, now explicitly instead of via PUBLIC.
GRANT EXECUTE ON FUNCTION public.current_company_id() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_valid_creator_daily_content_payload(text,text,text) FROM PUBLIC;
-- grant-ok: is_valid_creator_daily_content_payload is evaluated as the client (RLS policy / CHECK constraint); anon and authenticated held it before, now explicitly instead of via PUBLIC.
GRANT EXECUTE ON FUNCTION public.is_valid_creator_daily_content_payload(text,text,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_valid_creator_platform_asset_combo(text,text,text) FROM PUBLIC;
-- grant-ok: is_valid_creator_platform_asset_combo is evaluated as the client (RLS policy / CHECK constraint); anon and authenticated held it before, now explicitly instead of via PUBLIC.
GRANT EXECUTE ON FUNCTION public.is_valid_creator_platform_asset_combo(text,text,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pi_canonical_attribute_set(text[]) FROM PUBLIC;
-- grant-ok: pi_canonical_attribute_set is evaluated as the client (RLS policy / CHECK constraint); anon and authenticated held it before, now explicitly instead of via PUBLIC.
GRANT EXECUTE ON FUNCTION public.pi_canonical_attribute_set(text[]) TO anon, authenticated, service_role;
ALTER FUNCTION public.is_valid_creator_daily_content_payload(text,text,text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_valid_creator_platform_asset_combo(text,text,text) SET search_path = pg_catalog, public;

DO $verify$
DECLARE
  r       record;
  v_oid   oid;
  v_p     record;
  v_n     integer := 0;
  v_left  text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.ai_message_drafts_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.canonical_decisions_append_only()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.capability_audit_log_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.content_publish_snapshots_guard_immutable()', 'T', false, false, '{"search_path=\"\""}'::text[], 1),
    ('public.create_organization_credits_on_company_insert()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.creator_audit_log_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.enforce_community_ai_executor_writes()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.engagement_messages_tenant_from_thread()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_approval_post_execute()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_bo_no_delete()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_contract_immutable_after_active()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_firebase_uid_immutable()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.guard_invoice_line_items_frozen()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_jer_status_monotonic()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_render_queue_monotonic()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_render_state_monotonic()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.guard_super_admin_membership_company()', 'T', false, false, '{"search_path=public"}'::text[], 1),
    ('public.omnivyra_log_decision_event()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_prevent_decision_delete()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_prevent_decision_overwrite()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_touch_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 74),
    ('public.omnivyra_validate_decision_action()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.omnivyra_validate_decision_object_entity()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.pi_prospect_alias_guard()', 'T', false, false, '{"search_path=public, pg_temp"}'::text[], 2),
    ('public.prevent_company_context_snapshot_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.prospect_icp_versions_guard_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.prospect_score_evaluations_immutable()', 'T', false, false, '{"search_path=public, pg_temp"}'::text[], 1),
    ('public.public_blogs_updated_at()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.raise_audit_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.raise_ledger_immutable()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 46),
    ('public.set_opportunity_updated_at()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 12),
    ('public.set_updated_at_timestamp()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 7),
    ('public.source_assertions_relationship_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.sync_blog_likes_count()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.sync_company_id_columns()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.telemetry_events_reject_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.tenant_sending_domains_identity_guard()', 'T', false, false, '{"search_path=public, pg_temp"}'::text[], 1),
    ('public.trg_cec_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_consent_records_append_only_update()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_consent_records_block_delete()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_contacts_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_curated_industry_sources_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_governance_policy_protect_update()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_incident_timeline_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_lead_signals_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_marketplace_certs_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase0_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase10_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 8),
    ('public.trg_phase11_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 5),
    ('public.trg_phase12_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase2_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase3_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.trg_phase4_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase5_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 4),
    ('public.trg_phase6_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase7_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_phase8_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 6),
    ('public.trg_phase9_set_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 6),
    ('public.trg_prospect_lifecycle_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 3),
    ('public.trg_safeguard_triggers_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_safety_rail_events_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.trg_stab_events_block_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 2),
    ('public.update_access_request_timestamp()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.update_campaign_completion()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.update_campaign_context_updated_at()', 'T', false, false, '{"search_path=public"}'::text[], 1),
    ('public.update_feature_completion_updated_at()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.update_free_credit_profile_timestamp()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 1),
    ('public.update_free_credit_unlock_timestamp()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.update_org_controls_timestamp()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.update_updated_at()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 3),
    ('public.update_updated_at_column()', 'T', false, false, '{"search_path=public, extensions"}'::text[], 9),
    ('public.worker_snapshot_shadow_telemetry_append_only()', 'T', false, false, '{"search_path=\"\""}'::text[], 1),
    ('public.ws3_protect_task_provenance()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.ws3_reject_mutation()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 6),
    ('public.ws3_suppression_guard()', 'T', false, true, '{"search_path=pg_catalog, public"}'::text[], 1),
    ('public.advance_job_execution(text,text,uuid,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.advance_payment_provider_event_state(uuid,text,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.cancel_credit_action_approval(uuid,uuid,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.claim_conversation_memory_rebuild_batch(integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.claim_creator_execution_lock(uuid,text,integer,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.claim_job_execution(text,text,text,text,text,uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.claim_lead_thread_recompute_batch(integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.cleanup_lead_thread_recompute_queue_orphans()', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.enhance_weekly_content_with_ai(uuid,integer,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.expire_org_free_credits(uuid,integer,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.extend_creator_execution_lock(uuid,text,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.finalize_weekly_content(uuid,integer,text,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.free_credits_summary()', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.get_12_week_campaign_overview(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_12_week_plan_overview(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_campaign_progress(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_day_detail_view(uuid,integer,character varying)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_engagement_thread_message_distance(uuid,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_engagement_thread_message_distance(uuid,uuid,integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_lead_recompute_queue_approx_count()', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.get_week_detail_view(uuid,integer)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.increment_response_perf_followup(uuid,timestamp with time zone)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.increment_response_perf_like(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.increment_template_usage(uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.insert_engagement_signals_avoid_dupes(jsonb)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.insert_thread_atomic(jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.lead_platform_increment_converted(uuid,text)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.lead_platform_increment_signals(uuid,text)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.lookup_fx_rate(text,text,timestamp with time zone)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.match_clusters_by_embedding(extensions.vector,integer,timestamp with time zone)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.merge_unified_persons(uuid,uuid,text,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_canonical_attribute_allowlist(text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_relationship_clear_primary(uuid,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_relationship_set_primary(uuid,uuid,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.populate_daily_plans_from_weekly(uuid,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.populate_weekly_content_from_ai_plan(uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.purge_expired_creator_execution_audit_logs()', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.purge_old_creator_render_metrics(integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.purge_old_system_health_metrics()', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.replace_thread_children(uuid,jsonb)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.required_approvals_for_action(text,integer)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.schedule_lead_thread_recompute(uuid,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.sign_credit_action_approval(uuid,uuid,text,text)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.transition_campaign_stage(uuid,character varying,character varying,jsonb)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.update_weekly_alignment(uuid,integer,character varying,text,uuid)', 'B', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid,uuid)', 'B', false, false, '{"search_path=public, extensions"}'::text[], 0),
    ('public.current_company_id()', 'A', false, false, NULL::text[], 0),
    ('public.is_valid_creator_daily_content_payload(text,text,text)', 'A', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.is_valid_creator_platform_asset_combo(text,text,text)', 'A', false, true, '{"search_path=pg_catalog, public"}'::text[], 0),
    ('public.pi_canonical_attribute_set(text[])', 'A', false, false, NULL::text[], 0)
  ) AS t(sig, cls, secdef, pin, cfg, min_trg)
  LOOP
    v_oid := to_regprocedure(r.sig);
    SELECT p.prosecdef, p.proconfig, p.proowner, p.proacl INTO v_p FROM pg_proc p WHERE p.oid = v_oid;
    IF v_p.prosecdef IS DISTINCT FROM r.secdef THEN
      RAISE EXCEPTION 'SEC-B postcondition: % SECURITY DEFINER flag changed', r.sig;
    END IF;
    IF v_p.proconfig IS DISTINCT FROM r.cfg THEN
      RAISE EXCEPTION 'SEC-B postcondition: % proconfig is %, expected %', r.sig, v_p.proconfig, r.cfg;
    END IF;
    -- PUBLIC never holds a privilege on any listed function.
    IF EXISTS (SELECT 1 FROM aclexplode(COALESCE(v_p.proacl, acldefault('f', v_p.proowner))) x WHERE x.grantee = 0) THEN
      RAISE EXCEPTION 'SEC-B postcondition: PUBLIC still holds a privilege on %', r.sig;
    END IF;
    -- The owner keeps EXECUTE (CREATE TRIGGER and pg_cron jobs run as the owner).
    IF NOT has_function_privilege(v_p.proowner, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'SEC-B postcondition: owner lost EXECUTE on %', r.sig;
    END IF;
    IF r.cls IN ('T', 'B') THEN
      IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'SEC-B postcondition: a client role still has EXECUTE on %', r.sig;
      END IF;
    END IF;
    IF r.cls = 'B' AND NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'SEC-B postcondition: service_role lacks EXECUTE on %', r.sig;
    END IF;
    IF r.cls = 'A' AND NOT (has_function_privilege('anon', v_oid, 'EXECUTE')
                            AND has_function_privilege('authenticated', v_oid, 'EXECUTE')
                            AND has_function_privilege('service_role', v_oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'SEC-B postcondition: client-callable helper % lost a grant', r.sig;
    END IF;
    -- Triggers are never touched: every one that used a listed function is still there and enabled.
    IF r.cls = 'T' AND (SELECT count(*) FROM pg_trigger t
                         WHERE t.tgfoid = v_oid AND NOT t.tgisinternal AND t.tgenabled <> 'D') < r.min_trg THEN
      RAISE EXCEPTION 'SEC-B postcondition: % has fewer enabled triggers than the reviewed %', r.sig, r.min_trg;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 132 THEN
    RAISE EXCEPTION 'SEC-B postcondition: expected 132 listed functions, verified %', v_n;
  END IF;

  -- Informational only (never fails): public trigger functions outside this list that a
  -- client can still EXECUTE — e.g. objects that exist in one environment only.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.proname) INTO v_left
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_left IS NOT NULL THEN
    RAISE NOTICE 'SEC-B: trigger functions NOT in this migration still client-executable: %', v_left;
  END IF;

  RAISE NOTICE 'SEC-B: 76 trigger + 52 service-only + 4 helper functions verified (grants, search_path, INVOKER/DEFINER unchanged, triggers enabled).';
END
$verify$;

COMMIT;
