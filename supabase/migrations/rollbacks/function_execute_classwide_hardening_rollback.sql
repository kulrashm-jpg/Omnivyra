-- Rollback for 20270111000003_function_execute_classwide_hardening.sql.
--
-- Restores, for every function the forward migration lists, the client EXECUTE
-- grants production had on 2026-10-31T04:08Z (evidence/prod-functions.json:
-- PUBLIC / anon / authenticated, exactly as recorded) and RESETs search_path on
-- the functions the forward migration pinned. service_role and postgres are not
-- revoked: production held those before the forward migration too. Function
-- bodies, owners, SECURITY flags and triggers are never touched.
-- Re-widening is deliberate: it is the exact pre-migration production state.

BEGIN;

ALTER FUNCTION public.ai_message_drafts_guard() RESET search_path;
ALTER FUNCTION public.canonical_decisions_append_only() RESET search_path;
ALTER FUNCTION public.capability_audit_log_block_mutation() RESET search_path;
ALTER FUNCTION public.creator_audit_log_immutable() RESET search_path;
ALTER FUNCTION public.enforce_community_ai_executor_writes() RESET search_path;
ALTER FUNCTION public.engagement_messages_tenant_from_thread() RESET search_path;
ALTER FUNCTION public.guard_approval_post_execute() RESET search_path;
ALTER FUNCTION public.guard_bo_no_delete() RESET search_path;
ALTER FUNCTION public.guard_contract_immutable_after_active() RESET search_path;
ALTER FUNCTION public.guard_invoice_line_items_frozen() RESET search_path;
ALTER FUNCTION public.guard_jer_status_monotonic() RESET search_path;
ALTER FUNCTION public.guard_render_queue_monotonic() RESET search_path;
ALTER FUNCTION public.guard_render_state_monotonic() RESET search_path;
ALTER FUNCTION public.omnivyra_log_decision_event() RESET search_path;
ALTER FUNCTION public.omnivyra_prevent_decision_delete() RESET search_path;
ALTER FUNCTION public.omnivyra_prevent_decision_overwrite() RESET search_path;
ALTER FUNCTION public.omnivyra_touch_updated_at() RESET search_path;
ALTER FUNCTION public.omnivyra_validate_decision_action() RESET search_path;
ALTER FUNCTION public.omnivyra_validate_decision_object_entity() RESET search_path;
ALTER FUNCTION public.prevent_company_context_snapshot_mutation() RESET search_path;
ALTER FUNCTION public.prospect_icp_versions_guard_immutable() RESET search_path;
ALTER FUNCTION public.raise_audit_immutable() RESET search_path;
ALTER FUNCTION public.raise_ledger_immutable() RESET search_path;
ALTER FUNCTION public.set_updated_at() RESET search_path;
ALTER FUNCTION public.source_assertions_relationship_guard() RESET search_path;
ALTER FUNCTION public.sync_company_id_columns() RESET search_path;
ALTER FUNCTION public.telemetry_events_reject_mutation() RESET search_path;
ALTER FUNCTION public.trg_cec_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_consent_records_append_only_update() RESET search_path;
ALTER FUNCTION public.trg_consent_records_block_delete() RESET search_path;
ALTER FUNCTION public.trg_contacts_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_curated_industry_sources_updated_at() RESET search_path;
ALTER FUNCTION public.trg_governance_policy_protect_update() RESET search_path;
ALTER FUNCTION public.trg_incident_timeline_block_mutation() RESET search_path;
ALTER FUNCTION public.trg_lead_signals_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_marketplace_certs_block_mutation() RESET search_path;
ALTER FUNCTION public.trg_phase0_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase10_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase11_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase12_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase2_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase3_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase4_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase5_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase6_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase7_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase8_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_phase9_set_updated_at() RESET search_path;
ALTER FUNCTION public.trg_prospect_lifecycle_guard() RESET search_path;
ALTER FUNCTION public.trg_safeguard_triggers_block_mutation() RESET search_path;
ALTER FUNCTION public.trg_safety_rail_events_block_mutation() RESET search_path;
ALTER FUNCTION public.trg_stab_events_block_mutation() RESET search_path;
ALTER FUNCTION public.update_feature_completion_updated_at() RESET search_path;
ALTER FUNCTION public.update_free_credit_unlock_timestamp() RESET search_path;
ALTER FUNCTION public.update_org_controls_timestamp() RESET search_path;
ALTER FUNCTION public.ws3_protect_task_provenance() RESET search_path;
ALTER FUNCTION public.ws3_reject_mutation() RESET search_path;
ALTER FUNCTION public.ws3_suppression_guard() RESET search_path;
ALTER FUNCTION public.advance_job_execution(text,text,uuid,text) RESET search_path;
ALTER FUNCTION public.advance_payment_provider_event_state(uuid,text,text) RESET search_path;
ALTER FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) RESET search_path;
ALTER FUNCTION public.cancel_credit_action_approval(uuid,uuid,text) RESET search_path;
ALTER FUNCTION public.claim_creator_execution_lock(uuid,text,integer,integer) RESET search_path;
ALTER FUNCTION public.claim_job_execution(text,text,text,text,text,uuid,jsonb) RESET search_path;
ALTER FUNCTION public.enhance_weekly_content_with_ai(uuid,integer,text) RESET search_path;
ALTER FUNCTION public.expire_org_free_credits(uuid,integer,text) RESET search_path;
ALTER FUNCTION public.extend_creator_execution_lock(uuid,text,integer) RESET search_path;
ALTER FUNCTION public.finalize_weekly_content(uuid,integer,text,uuid) RESET search_path;
ALTER FUNCTION public.free_credits_summary() RESET search_path;
ALTER FUNCTION public.insert_thread_atomic(jsonb) RESET search_path;
ALTER FUNCTION public.lookup_fx_rate(text,text,timestamp with time zone) RESET search_path;
ALTER FUNCTION public.merge_unified_persons(uuid,uuid,text,text) RESET search_path;
ALTER FUNCTION public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb) RESET search_path;
ALTER FUNCTION public.pi_canonical_attribute_allowlist(text) RESET search_path;
ALTER FUNCTION public.pi_relationship_clear_primary(uuid,uuid) RESET search_path;
ALTER FUNCTION public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone) RESET search_path;
ALTER FUNCTION public.pi_relationship_set_primary(uuid,uuid,uuid) RESET search_path;
ALTER FUNCTION public.populate_daily_plans_from_weekly(uuid,integer) RESET search_path;
ALTER FUNCTION public.populate_weekly_content_from_ai_plan(uuid,jsonb) RESET search_path;
ALTER FUNCTION public.purge_expired_creator_execution_audit_logs() RESET search_path;
ALTER FUNCTION public.purge_old_creator_render_metrics(integer) RESET search_path;
ALTER FUNCTION public.purge_old_system_health_metrics() RESET search_path;
ALTER FUNCTION public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb) RESET search_path;
ALTER FUNCTION public.replace_thread_children(uuid,jsonb) RESET search_path;
ALTER FUNCTION public.required_approvals_for_action(text,integer) RESET search_path;
ALTER FUNCTION public.sign_credit_action_approval(uuid,uuid,text,text) RESET search_path;
ALTER FUNCTION public.update_weekly_alignment(uuid,integer,character varying,text,uuid) RESET search_path;
ALTER FUNCTION public.is_valid_creator_daily_content_payload(text,text,text) RESET search_path;
ALTER FUNCTION public.is_valid_creator_platform_asset_combo(text,text,text) RESET search_path;

-- grant-ok: rollback restores the pre-20270111000003 production ACL of ai_message_drafts_guard exactly.
GRANT EXECUTE ON FUNCTION public.ai_message_drafts_guard() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of canonical_decisions_append_only exactly.
GRANT EXECUTE ON FUNCTION public.canonical_decisions_append_only() TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of capability_audit_log_block_mutation exactly.
GRANT EXECUTE ON FUNCTION public.capability_audit_log_block_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of content_publish_snapshots_guard_immutable exactly.
GRANT EXECUTE ON FUNCTION public.content_publish_snapshots_guard_immutable() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of create_organization_credits_on_company_insert exactly.
GRANT EXECUTE ON FUNCTION public.create_organization_credits_on_company_insert() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of creator_audit_log_immutable exactly.
GRANT EXECUTE ON FUNCTION public.creator_audit_log_immutable() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of enforce_community_ai_executor_writes exactly.
GRANT EXECUTE ON FUNCTION public.enforce_community_ai_executor_writes() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of engagement_messages_tenant_from_thread exactly.
GRANT EXECUTE ON FUNCTION public.engagement_messages_tenant_from_thread() TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_approval_post_execute exactly.
GRANT EXECUTE ON FUNCTION public.guard_approval_post_execute() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_bo_no_delete exactly.
GRANT EXECUTE ON FUNCTION public.guard_bo_no_delete() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_contract_immutable_after_active exactly.
GRANT EXECUTE ON FUNCTION public.guard_contract_immutable_after_active() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_firebase_uid_immutable exactly.
GRANT EXECUTE ON FUNCTION public.guard_firebase_uid_immutable() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_invoice_line_items_frozen exactly.
GRANT EXECUTE ON FUNCTION public.guard_invoice_line_items_frozen() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_jer_status_monotonic exactly.
GRANT EXECUTE ON FUNCTION public.guard_jer_status_monotonic() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_render_queue_monotonic exactly.
GRANT EXECUTE ON FUNCTION public.guard_render_queue_monotonic() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_render_state_monotonic exactly.
GRANT EXECUTE ON FUNCTION public.guard_render_state_monotonic() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of guard_super_admin_membership_company exactly.
GRANT EXECUTE ON FUNCTION public.guard_super_admin_membership_company() TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of omnivyra_log_decision_event exactly.
GRANT EXECUTE ON FUNCTION public.omnivyra_log_decision_event() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of omnivyra_prevent_decision_delete exactly.
GRANT EXECUTE ON FUNCTION public.omnivyra_prevent_decision_delete() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of omnivyra_prevent_decision_overwrite exactly.
GRANT EXECUTE ON FUNCTION public.omnivyra_prevent_decision_overwrite() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of omnivyra_touch_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.omnivyra_touch_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of omnivyra_validate_decision_action exactly.
GRANT EXECUTE ON FUNCTION public.omnivyra_validate_decision_action() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of omnivyra_validate_decision_object_entity exactly.
GRANT EXECUTE ON FUNCTION public.omnivyra_validate_decision_object_entity() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of prevent_company_context_snapshot_mutation exactly.
GRANT EXECUTE ON FUNCTION public.prevent_company_context_snapshot_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of prospect_icp_versions_guard_immutable exactly.
GRANT EXECUTE ON FUNCTION public.prospect_icp_versions_guard_immutable() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of prospect_score_evaluations_immutable exactly.
GRANT EXECUTE ON FUNCTION public.prospect_score_evaluations_immutable() TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of public_blogs_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.public_blogs_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of raise_audit_immutable exactly.
GRANT EXECUTE ON FUNCTION public.raise_audit_immutable() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of raise_ledger_immutable exactly.
GRANT EXECUTE ON FUNCTION public.raise_ledger_immutable() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of set_opportunity_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.set_opportunity_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of set_updated_at_timestamp exactly.
GRANT EXECUTE ON FUNCTION public.set_updated_at_timestamp() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of source_assertions_relationship_guard exactly.
GRANT EXECUTE ON FUNCTION public.source_assertions_relationship_guard() TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of sync_blog_likes_count exactly.
GRANT EXECUTE ON FUNCTION public.sync_blog_likes_count() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of sync_company_id_columns exactly.
GRANT EXECUTE ON FUNCTION public.sync_company_id_columns() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of telemetry_events_reject_mutation exactly.
GRANT EXECUTE ON FUNCTION public.telemetry_events_reject_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_cec_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_cec_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_consent_records_append_only_update exactly.
GRANT EXECUTE ON FUNCTION public.trg_consent_records_append_only_update() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_consent_records_block_delete exactly.
GRANT EXECUTE ON FUNCTION public.trg_consent_records_block_delete() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_contacts_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_contacts_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_curated_industry_sources_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_curated_industry_sources_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_governance_policy_protect_update exactly.
GRANT EXECUTE ON FUNCTION public.trg_governance_policy_protect_update() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_incident_timeline_block_mutation exactly.
GRANT EXECUTE ON FUNCTION public.trg_incident_timeline_block_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_lead_signals_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_lead_signals_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_marketplace_certs_block_mutation exactly.
GRANT EXECUTE ON FUNCTION public.trg_marketplace_certs_block_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase0_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase0_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase10_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase10_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase11_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase11_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase12_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase12_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase2_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase2_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase3_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase3_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase4_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase4_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase5_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase5_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase6_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase6_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase7_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase7_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase8_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase8_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_phase9_set_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.trg_phase9_set_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_prospect_lifecycle_guard exactly.
GRANT EXECUTE ON FUNCTION public.trg_prospect_lifecycle_guard() TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_safeguard_triggers_block_mutation exactly.
GRANT EXECUTE ON FUNCTION public.trg_safeguard_triggers_block_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_safety_rail_events_block_mutation exactly.
GRANT EXECUTE ON FUNCTION public.trg_safety_rail_events_block_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of trg_stab_events_block_mutation exactly.
GRANT EXECUTE ON FUNCTION public.trg_stab_events_block_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_access_request_timestamp exactly.
GRANT EXECUTE ON FUNCTION public.update_access_request_timestamp() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_campaign_completion exactly.
GRANT EXECUTE ON FUNCTION public.update_campaign_completion() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_campaign_context_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.update_campaign_context_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_feature_completion_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.update_feature_completion_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_free_credit_profile_timestamp exactly.
GRANT EXECUTE ON FUNCTION public.update_free_credit_profile_timestamp() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_free_credit_unlock_timestamp exactly.
GRANT EXECUTE ON FUNCTION public.update_free_credit_unlock_timestamp() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_org_controls_timestamp exactly.
GRANT EXECUTE ON FUNCTION public.update_org_controls_timestamp() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_updated_at exactly.
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_updated_at_column exactly.
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of worker_snapshot_shadow_telemetry_append_only exactly.
GRANT EXECUTE ON FUNCTION public.worker_snapshot_shadow_telemetry_append_only() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of ws3_protect_task_provenance exactly.
GRANT EXECUTE ON FUNCTION public.ws3_protect_task_provenance() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of ws3_reject_mutation exactly.
GRANT EXECUTE ON FUNCTION public.ws3_reject_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of ws3_suppression_guard exactly.
GRANT EXECUTE ON FUNCTION public.ws3_suppression_guard() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of advance_job_execution exactly.
GRANT EXECUTE ON FUNCTION public.advance_job_execution(text,text,uuid,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of advance_payment_provider_event_state exactly.
GRANT EXECUTE ON FUNCTION public.advance_payment_provider_event_state(uuid,text,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of apply_credit_partial_confirm exactly.
GRANT EXECUTE ON FUNCTION public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of apply_credit_reservation exactly.
GRANT EXECUTE ON FUNCTION public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of cancel_credit_action_approval exactly.
GRANT EXECUTE ON FUNCTION public.cancel_credit_action_approval(uuid,uuid,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of claim_conversation_memory_rebuild_batch exactly.
GRANT EXECUTE ON FUNCTION public.claim_conversation_memory_rebuild_batch(integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of claim_creator_execution_lock exactly.
GRANT EXECUTE ON FUNCTION public.claim_creator_execution_lock(uuid,text,integer,integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of claim_job_execution exactly.
GRANT EXECUTE ON FUNCTION public.claim_job_execution(text,text,text,text,text,uuid,jsonb) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of claim_lead_thread_recompute_batch exactly.
GRANT EXECUTE ON FUNCTION public.claim_lead_thread_recompute_batch(integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of cleanup_lead_thread_recompute_queue_orphans exactly.
GRANT EXECUTE ON FUNCTION public.cleanup_lead_thread_recompute_queue_orphans() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of enhance_weekly_content_with_ai exactly.
GRANT EXECUTE ON FUNCTION public.enhance_weekly_content_with_ai(uuid,integer,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of expire_org_free_credits exactly.
GRANT EXECUTE ON FUNCTION public.expire_org_free_credits(uuid,integer,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of extend_creator_execution_lock exactly.
GRANT EXECUTE ON FUNCTION public.extend_creator_execution_lock(uuid,text,integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of finalize_weekly_content exactly.
GRANT EXECUTE ON FUNCTION public.finalize_weekly_content(uuid,integer,text,uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of free_credits_summary exactly.
GRANT EXECUTE ON FUNCTION public.free_credits_summary() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_12_week_campaign_overview exactly.
GRANT EXECUTE ON FUNCTION public.get_12_week_campaign_overview(uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_12_week_plan_overview exactly.
GRANT EXECUTE ON FUNCTION public.get_12_week_plan_overview(uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_campaign_progress exactly.
GRANT EXECUTE ON FUNCTION public.get_campaign_progress(uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_day_detail_view exactly.
GRANT EXECUTE ON FUNCTION public.get_day_detail_view(uuid,integer,character varying) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_engagement_thread_message_distance exactly.
GRANT EXECUTE ON FUNCTION public.get_engagement_thread_message_distance(uuid,uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_engagement_thread_message_distance exactly.
GRANT EXECUTE ON FUNCTION public.get_engagement_thread_message_distance(uuid,uuid,integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_lead_recompute_queue_approx_count exactly.
GRANT EXECUTE ON FUNCTION public.get_lead_recompute_queue_approx_count() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of get_week_detail_view exactly.
GRANT EXECUTE ON FUNCTION public.get_week_detail_view(uuid,integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of increment_response_perf_followup exactly.
GRANT EXECUTE ON FUNCTION public.increment_response_perf_followup(uuid,timestamp with time zone) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of increment_response_perf_like exactly.
GRANT EXECUTE ON FUNCTION public.increment_response_perf_like(uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of increment_template_usage exactly.
GRANT EXECUTE ON FUNCTION public.increment_template_usage(uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of insert_engagement_signals_avoid_dupes exactly.
GRANT EXECUTE ON FUNCTION public.insert_engagement_signals_avoid_dupes(jsonb) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of insert_thread_atomic exactly.
GRANT EXECUTE ON FUNCTION public.insert_thread_atomic(jsonb) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of lead_platform_increment_converted exactly.
GRANT EXECUTE ON FUNCTION public.lead_platform_increment_converted(uuid,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of lead_platform_increment_signals exactly.
GRANT EXECUTE ON FUNCTION public.lead_platform_increment_signals(uuid,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of lookup_fx_rate exactly.
GRANT EXECUTE ON FUNCTION public.lookup_fx_rate(text,text,timestamp with time zone) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of match_clusters_by_embedding exactly.
GRANT EXECUTE ON FUNCTION public.match_clusters_by_embedding(extensions.vector,integer,timestamp with time zone) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of merge_unified_persons exactly.
GRANT EXECUTE ON FUNCTION public.merge_unified_persons(uuid,uuid,text,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of pi_apply_canonical_decisions exactly.
GRANT EXECUTE ON FUNCTION public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb) TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of pi_canonical_attribute_allowlist exactly.
GRANT EXECUTE ON FUNCTION public.pi_canonical_attribute_allowlist(text) TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of pi_relationship_clear_primary exactly.
GRANT EXECUTE ON FUNCTION public.pi_relationship_clear_primary(uuid,uuid) TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of pi_relationship_end exactly.
GRANT EXECUTE ON FUNCTION public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone) TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of pi_relationship_set_primary exactly.
GRANT EXECUTE ON FUNCTION public.pi_relationship_set_primary(uuid,uuid,uuid) TO authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of populate_daily_plans_from_weekly exactly.
GRANT EXECUTE ON FUNCTION public.populate_daily_plans_from_weekly(uuid,integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of populate_weekly_content_from_ai_plan exactly.
GRANT EXECUTE ON FUNCTION public.populate_weekly_content_from_ai_plan(uuid,jsonb) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of purge_expired_creator_execution_audit_logs exactly.
GRANT EXECUTE ON FUNCTION public.purge_expired_creator_execution_audit_logs() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of purge_old_creator_render_metrics exactly.
GRANT EXECUTE ON FUNCTION public.purge_old_creator_render_metrics(integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of purge_old_system_health_metrics exactly.
GRANT EXECUTE ON FUNCTION public.purge_old_system_health_metrics() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of record_payment_provider_event exactly.
GRANT EXECUTE ON FUNCTION public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of replace_thread_children exactly.
GRANT EXECUTE ON FUNCTION public.replace_thread_children(uuid,jsonb) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of required_approvals_for_action exactly.
GRANT EXECUTE ON FUNCTION public.required_approvals_for_action(text,integer) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of schedule_lead_thread_recompute exactly.
GRANT EXECUTE ON FUNCTION public.schedule_lead_thread_recompute(uuid,uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of sign_credit_action_approval exactly.
GRANT EXECUTE ON FUNCTION public.sign_credit_action_approval(uuid,uuid,text,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of transition_campaign_stage exactly.
GRANT EXECUTE ON FUNCTION public.transition_campaign_stage(uuid,character varying,character varying,jsonb) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of update_weekly_alignment exactly.
GRANT EXECUTE ON FUNCTION public.update_weekly_alignment(uuid,integer,character varying,text,uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of upsert_engagement_thread_memory_locked exactly.
GRANT EXECUTE ON FUNCTION public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of upsert_engagement_thread_memory_locked exactly.
GRANT EXECUTE ON FUNCTION public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid,uuid) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of current_company_id exactly.
GRANT EXECUTE ON FUNCTION public.current_company_id() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of is_valid_creator_daily_content_payload exactly.
GRANT EXECUTE ON FUNCTION public.is_valid_creator_daily_content_payload(text,text,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of is_valid_creator_platform_asset_combo exactly.
GRANT EXECUTE ON FUNCTION public.is_valid_creator_platform_asset_combo(text,text,text) TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000003 production ACL of pi_canonical_attribute_set exactly.
GRANT EXECUTE ON FUNCTION public.pi_canonical_attribute_set(text[]) TO PUBLIC, anon, authenticated;

DO $verify$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.ai_message_drafts_guard()', true, true, true, true),
    ('public.canonical_decisions_append_only()', false, true, false, true),
    ('public.capability_audit_log_block_mutation()', true, true, true, true),
    ('public.content_publish_snapshots_guard_immutable()', true, true, true, false),
    ('public.create_organization_credits_on_company_insert()', true, true, true, false),
    ('public.creator_audit_log_immutable()', true, true, true, true),
    ('public.enforce_community_ai_executor_writes()', true, true, true, true),
    ('public.engagement_messages_tenant_from_thread()', false, true, false, true),
    ('public.guard_approval_post_execute()', true, true, true, true),
    ('public.guard_bo_no_delete()', true, true, true, true),
    ('public.guard_contract_immutable_after_active()', true, true, true, true),
    ('public.guard_firebase_uid_immutable()', true, true, true, false),
    ('public.guard_invoice_line_items_frozen()', true, true, true, true),
    ('public.guard_jer_status_monotonic()', true, true, true, true),
    ('public.guard_render_queue_monotonic()', true, true, true, true),
    ('public.guard_render_state_monotonic()', true, true, true, true),
    ('public.guard_super_admin_membership_company()', false, true, false, false),
    ('public.omnivyra_log_decision_event()', true, true, true, true),
    ('public.omnivyra_prevent_decision_delete()', true, true, true, true),
    ('public.omnivyra_prevent_decision_overwrite()', true, true, true, true),
    ('public.omnivyra_touch_updated_at()', true, true, true, true),
    ('public.omnivyra_validate_decision_action()', true, true, true, true),
    ('public.omnivyra_validate_decision_object_entity()', true, true, true, true),
    ('public.pi_prospect_alias_guard()', false, false, false, false),
    ('public.prevent_company_context_snapshot_mutation()', true, true, true, true),
    ('public.prospect_icp_versions_guard_immutable()', true, true, true, true),
    ('public.prospect_score_evaluations_immutable()', false, true, false, false),
    ('public.public_blogs_updated_at()', true, true, true, false),
    ('public.raise_audit_immutable()', true, true, true, true),
    ('public.raise_ledger_immutable()', true, true, true, true),
    ('public.set_opportunity_updated_at()', true, true, true, false),
    ('public.set_updated_at()', true, true, true, true),
    ('public.set_updated_at_timestamp()', true, true, true, false),
    ('public.source_assertions_relationship_guard()', false, true, false, true),
    ('public.sync_blog_likes_count()', true, true, true, false),
    ('public.sync_company_id_columns()', true, true, true, true),
    ('public.telemetry_events_reject_mutation()', true, true, true, true),
    ('public.tenant_sending_domains_identity_guard()', false, false, false, false),
    ('public.trg_cec_set_updated_at()', true, true, true, true),
    ('public.trg_consent_records_append_only_update()', true, true, true, true),
    ('public.trg_consent_records_block_delete()', true, true, true, true),
    ('public.trg_contacts_set_updated_at()', true, true, true, true),
    ('public.trg_curated_industry_sources_updated_at()', true, true, true, true),
    ('public.trg_governance_policy_protect_update()', true, true, true, true),
    ('public.trg_incident_timeline_block_mutation()', true, true, true, true),
    ('public.trg_lead_signals_set_updated_at()', true, true, true, true),
    ('public.trg_marketplace_certs_block_mutation()', true, true, true, true),
    ('public.trg_phase0_set_updated_at()', true, true, true, true),
    ('public.trg_phase10_set_updated_at()', true, true, true, true),
    ('public.trg_phase11_set_updated_at()', true, true, true, true),
    ('public.trg_phase12_set_updated_at()', true, true, true, true),
    ('public.trg_phase2_set_updated_at()', true, true, true, true),
    ('public.trg_phase3_set_updated_at()', true, true, true, true),
    ('public.trg_phase4_set_updated_at()', true, true, true, true),
    ('public.trg_phase5_set_updated_at()', true, true, true, true),
    ('public.trg_phase6_set_updated_at()', true, true, true, true),
    ('public.trg_phase7_set_updated_at()', true, true, true, true),
    ('public.trg_phase8_set_updated_at()', true, true, true, true),
    ('public.trg_phase9_set_updated_at()', true, true, true, true),
    ('public.trg_prospect_lifecycle_guard()', false, true, false, true),
    ('public.trg_safeguard_triggers_block_mutation()', true, true, true, true),
    ('public.trg_safety_rail_events_block_mutation()', true, true, true, true),
    ('public.trg_stab_events_block_mutation()', true, true, true, true),
    ('public.update_access_request_timestamp()', true, true, true, false),
    ('public.update_campaign_completion()', true, true, true, false),
    ('public.update_campaign_context_updated_at()', true, true, true, false),
    ('public.update_feature_completion_updated_at()', true, true, true, true),
    ('public.update_free_credit_profile_timestamp()', true, true, true, false),
    ('public.update_free_credit_unlock_timestamp()', true, true, true, true),
    ('public.update_org_controls_timestamp()', true, true, true, true),
    ('public.update_updated_at()', true, true, true, false),
    ('public.update_updated_at_column()', true, true, true, false),
    ('public.worker_snapshot_shadow_telemetry_append_only()', true, true, true, false),
    ('public.ws3_protect_task_provenance()', true, true, true, true),
    ('public.ws3_reject_mutation()', true, true, true, true),
    ('public.ws3_suppression_guard()', true, true, true, true),
    ('public.advance_job_execution(text,text,uuid,text)', true, true, true, true),
    ('public.advance_payment_provider_event_state(uuid,text,text)', true, true, true, true),
    ('public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)', true, true, true, false),
    ('public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', true, true, true, true),
    ('public.cancel_credit_action_approval(uuid,uuid,text)', true, true, true, true),
    ('public.claim_conversation_memory_rebuild_batch(integer)', true, true, true, false),
    ('public.claim_creator_execution_lock(uuid,text,integer,integer)', true, true, true, true),
    ('public.claim_job_execution(text,text,text,text,text,uuid,jsonb)', true, true, true, true),
    ('public.claim_lead_thread_recompute_batch(integer)', true, true, true, false),
    ('public.cleanup_lead_thread_recompute_queue_orphans()', true, true, true, false),
    ('public.enhance_weekly_content_with_ai(uuid,integer,text)', true, true, true, true),
    ('public.expire_org_free_credits(uuid,integer,text)', true, true, true, true),
    ('public.extend_creator_execution_lock(uuid,text,integer)', true, true, true, true),
    ('public.finalize_weekly_content(uuid,integer,text,uuid)', true, true, true, true),
    ('public.free_credits_summary()', true, true, true, true),
    ('public.get_12_week_campaign_overview(uuid)', true, true, true, false),
    ('public.get_12_week_plan_overview(uuid)', true, true, true, false),
    ('public.get_campaign_progress(uuid)', true, true, true, false),
    ('public.get_day_detail_view(uuid,integer,character varying)', true, true, true, false),
    ('public.get_engagement_thread_message_distance(uuid,uuid)', true, true, true, false),
    ('public.get_engagement_thread_message_distance(uuid,uuid,integer)', true, true, true, false),
    ('public.get_lead_recompute_queue_approx_count()', true, true, true, false),
    ('public.get_week_detail_view(uuid,integer)', true, true, true, false),
    ('public.increment_response_perf_followup(uuid,timestamp with time zone)', true, true, true, false),
    ('public.increment_response_perf_like(uuid)', true, true, true, false),
    ('public.increment_template_usage(uuid)', true, true, true, false),
    ('public.insert_engagement_signals_avoid_dupes(jsonb)', true, true, true, false),
    ('public.insert_thread_atomic(jsonb)', true, true, true, true),
    ('public.lead_platform_increment_converted(uuid,text)', true, true, true, false),
    ('public.lead_platform_increment_signals(uuid,text)', true, true, true, false),
    ('public.lookup_fx_rate(text,text,timestamp with time zone)', true, true, true, true),
    ('public.match_clusters_by_embedding(extensions.vector,integer,timestamp with time zone)', true, true, true, false),
    ('public.merge_unified_persons(uuid,uuid,text,text)', true, true, true, true),
    ('public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb)', false, true, false, true),
    ('public.pi_canonical_attribute_allowlist(text)', false, true, false, true),
    ('public.pi_relationship_clear_primary(uuid,uuid)', false, true, false, true),
    ('public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone)', false, true, false, true),
    ('public.pi_relationship_set_primary(uuid,uuid,uuid)', false, true, false, true),
    ('public.populate_daily_plans_from_weekly(uuid,integer)', true, true, true, true),
    ('public.populate_weekly_content_from_ai_plan(uuid,jsonb)', true, true, true, true),
    ('public.purge_expired_creator_execution_audit_logs()', true, true, true, true),
    ('public.purge_old_creator_render_metrics(integer)', true, true, true, true),
    ('public.purge_old_system_health_metrics()', true, true, true, true),
    ('public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb)', true, true, true, true),
    ('public.replace_thread_children(uuid,jsonb)', true, true, true, true),
    ('public.required_approvals_for_action(text,integer)', true, true, true, true),
    ('public.schedule_lead_thread_recompute(uuid,uuid)', true, true, true, false),
    ('public.sign_credit_action_approval(uuid,uuid,text,text)', true, true, true, true),
    ('public.transition_campaign_stage(uuid,character varying,character varying,jsonb)', true, true, true, false),
    ('public.update_weekly_alignment(uuid,integer,character varying,text,uuid)', true, true, true, true),
    ('public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid)', true, true, true, false),
    ('public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid,uuid)', true, true, true, false),
    ('public.current_company_id()', true, true, true, false),
    ('public.is_valid_creator_daily_content_payload(text,text,text)', true, true, true, true),
    ('public.is_valid_creator_platform_asset_combo(text,text,text)', true, true, true, true),
    ('public.pi_canonical_attribute_set(text[])', true, true, true, false)
  ) AS t(sig, anon_x, auth_x, public_x, was_pinned)
  LOOP
    IF has_function_privilege('anon', r.sig::regprocedure, 'EXECUTE') <> r.anon_x
       OR has_function_privilege('authenticated', r.sig::regprocedure, 'EXECUTE') <> r.auth_x THEN
      RAISE EXCEPTION 'SEC-B rollback: client EXECUTE on % not restored to the production state', r.sig;
    END IF;
    IF r.public_x <> EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                              WHERE p.oid = r.sig::regprocedure AND x.grantee = 0) THEN
      RAISE EXCEPTION 'SEC-B rollback: PUBLIC EXECUTE on % not restored', r.sig;
    END IF;
    IF r.was_pinned AND (SELECT proconfig FROM pg_proc WHERE oid = r.sig::regprocedure) IS NOT NULL THEN
      RAISE EXCEPTION 'SEC-B rollback: % still carries a proconfig', r.sig;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;
