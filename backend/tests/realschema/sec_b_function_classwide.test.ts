/**
 * SEC B — class-wide function EXECUTE + search_path hardening against real PostgreSQL.
 *
 * Migration exercised: 20270111000003_function_execute_classwide_hardening.sql
 * (override with SEC_B_MIGRATION_FILE=<path> for the mutant run; a no-op file
 * must make every security assertion here FAIL).
 *
 * A green run concerns a disposable database built from the committed baseline
 * plus replayed migrations. It is NOT evidence about production.
 *
 * WHY EVERY TEST RE-APPLIES THE MIGRATION. A CI replay has no Supabase default
 * privileges, so the functions do not carry production's PUBLIC/anon/
 * authenticated grants and asserting "anon cannot EXECUTE" on the replay alone
 * would be tautological. Each test therefore, inside its own rolled-back
 * transaction:
 *   1. restores the PRODUCTION grant + search_path state of every listed function
 *      (evidence/prod-functions.json, captured read-only 2026-10-31T04:08Z,
 *      embedded below as PROD), and proves that state is client-executable;
 *   2. runs the migration file (BEGIN/COMMIT stripped so it joins the test txn);
 *   3. asserts.
 * Nothing persists. Roles act via SET LOCAL ROLE; service_role receives the table
 * privileges production gives it (GRANT ALL ON ALL TABLES, Supabase default)
 * inside the same transaction.
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, inRollback, seedTenants, ORG_A, ORG_B, newPerson } from './setup';

type Cls = 'T' | 'B' | 'A';
/** [signature, class, pinned by the migration, prod anon EXECUTE, prod authenticated EXECUTE, prod PUBLIC EXECUTE] */
type Row = [string, Cls, boolean, boolean, boolean, boolean];

// GENERATED from evidence/prod-functions.json + the reviewed inventory. 132 functions.
const PROD: Row[] = [
  ['public.advance_job_execution(text,text,uuid,text)', 'B', true, true, true, true],
  ['public.advance_payment_provider_event_state(uuid,text,text)', 'B', true, true, true, true],
  ['public.ai_message_drafts_guard()', 'T', true, true, true, true],
  ['public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)', 'B', false, true, true, true],
  ['public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', 'B', true, true, true, true],
  ['public.cancel_credit_action_approval(uuid,uuid,text)', 'B', true, true, true, true],
  ['public.canonical_decisions_append_only()', 'T', true, false, true, false],
  ['public.capability_audit_log_block_mutation()', 'T', true, true, true, true],
  ['public.claim_conversation_memory_rebuild_batch(integer)', 'B', false, true, true, true],
  ['public.claim_creator_execution_lock(uuid,text,integer,integer)', 'B', true, true, true, true],
  ['public.claim_job_execution(text,text,text,text,text,uuid,jsonb)', 'B', true, true, true, true],
  ['public.claim_lead_thread_recompute_batch(integer)', 'B', false, true, true, true],
  ['public.cleanup_lead_thread_recompute_queue_orphans()', 'B', false, true, true, true],
  ['public.content_publish_snapshots_guard_immutable()', 'T', false, true, true, true],
  ['public.create_organization_credits_on_company_insert()', 'T', false, true, true, true],
  ['public.creator_audit_log_immutable()', 'T', true, true, true, true],
  ['public.current_company_id()', 'A', false, true, true, true],
  ['public.enforce_community_ai_executor_writes()', 'T', true, true, true, true],
  ['public.engagement_messages_tenant_from_thread()', 'T', true, false, true, false],
  ['public.enhance_weekly_content_with_ai(uuid,integer,text)', 'B', true, true, true, true],
  ['public.expire_org_free_credits(uuid,integer,text)', 'B', true, true, true, true],
  ['public.extend_creator_execution_lock(uuid,text,integer)', 'B', true, true, true, true],
  ['public.finalize_weekly_content(uuid,integer,text,uuid)', 'B', true, true, true, true],
  ['public.free_credits_summary()', 'B', true, true, true, true],
  ['public.get_12_week_campaign_overview(uuid)', 'B', false, true, true, true],
  ['public.get_12_week_plan_overview(uuid)', 'B', false, true, true, true],
  ['public.get_campaign_progress(uuid)', 'B', false, true, true, true],
  ['public.get_day_detail_view(uuid,integer,character varying)', 'B', false, true, true, true],
  ['public.get_engagement_thread_message_distance(uuid,uuid)', 'B', false, true, true, true],
  ['public.get_engagement_thread_message_distance(uuid,uuid,integer)', 'B', false, true, true, true],
  ['public.get_lead_recompute_queue_approx_count()', 'B', false, true, true, true],
  ['public.get_week_detail_view(uuid,integer)', 'B', false, true, true, true],
  ['public.guard_approval_post_execute()', 'T', true, true, true, true],
  ['public.guard_bo_no_delete()', 'T', true, true, true, true],
  ['public.guard_contract_immutable_after_active()', 'T', true, true, true, true],
  ['public.guard_firebase_uid_immutable()', 'T', false, true, true, true],
  ['public.guard_invoice_line_items_frozen()', 'T', true, true, true, true],
  ['public.guard_jer_status_monotonic()', 'T', true, true, true, true],
  ['public.guard_render_queue_monotonic()', 'T', true, true, true, true],
  ['public.guard_render_state_monotonic()', 'T', true, true, true, true],
  ['public.guard_super_admin_membership_company()', 'T', false, false, true, false],
  ['public.increment_response_perf_followup(uuid,timestamp with time zone)', 'B', false, true, true, true],
  ['public.increment_response_perf_like(uuid)', 'B', false, true, true, true],
  ['public.increment_template_usage(uuid)', 'B', false, true, true, true],
  ['public.insert_engagement_signals_avoid_dupes(jsonb)', 'B', false, true, true, true],
  ['public.insert_thread_atomic(jsonb)', 'B', true, true, true, true],
  ['public.is_valid_creator_daily_content_payload(text,text,text)', 'A', true, true, true, true],
  ['public.is_valid_creator_platform_asset_combo(text,text,text)', 'A', true, true, true, true],
  ['public.lead_platform_increment_converted(uuid,text)', 'B', false, true, true, true],
  ['public.lead_platform_increment_signals(uuid,text)', 'B', false, true, true, true],
  ['public.lookup_fx_rate(text,text,timestamp with time zone)', 'B', true, true, true, true],
  ['public.match_clusters_by_embedding(extensions.vector,integer,timestamp with time zone)', 'B', false, true, true, true],
  ['public.merge_unified_persons(uuid,uuid,text,text)', 'B', true, true, true, true],
  ['public.omnivyra_log_decision_event()', 'T', true, true, true, true],
  ['public.omnivyra_prevent_decision_delete()', 'T', true, true, true, true],
  ['public.omnivyra_prevent_decision_overwrite()', 'T', true, true, true, true],
  ['public.omnivyra_touch_updated_at()', 'T', true, true, true, true],
  ['public.omnivyra_validate_decision_action()', 'T', true, true, true, true],
  ['public.omnivyra_validate_decision_object_entity()', 'T', true, true, true, true],
  ['public.pi_apply_canonical_decisions(uuid,text,uuid,text,timestamp with time zone,jsonb)', 'B', true, false, true, false],
  ['public.pi_canonical_attribute_allowlist(text)', 'B', true, false, true, false],
  ['public.pi_canonical_attribute_set(text[])', 'A', false, true, true, true],
  ['public.pi_prospect_alias_guard()', 'T', false, false, false, false],
  ['public.pi_relationship_clear_primary(uuid,uuid)', 'B', true, false, true, false],
  ['public.pi_relationship_end(uuid,uuid,uuid,timestamp with time zone)', 'B', true, false, true, false],
  ['public.pi_relationship_set_primary(uuid,uuid,uuid)', 'B', true, false, true, false],
  ['public.populate_daily_plans_from_weekly(uuid,integer)', 'B', true, true, true, true],
  ['public.populate_weekly_content_from_ai_plan(uuid,jsonb)', 'B', true, true, true, true],
  ['public.prevent_company_context_snapshot_mutation()', 'T', true, true, true, true],
  ['public.prospect_icp_versions_guard_immutable()', 'T', true, true, true, true],
  ['public.prospect_score_evaluations_immutable()', 'T', false, false, true, false],
  ['public.public_blogs_updated_at()', 'T', false, true, true, true],
  ['public.purge_expired_creator_execution_audit_logs()', 'B', true, true, true, true],
  ['public.purge_old_creator_render_metrics(integer)', 'B', true, true, true, true],
  ['public.purge_old_system_health_metrics()', 'B', true, true, true, true],
  ['public.raise_audit_immutable()', 'T', true, true, true, true],
  ['public.raise_ledger_immutable()', 'T', true, true, true, true],
  ['public.record_payment_provider_event(text,text,text,uuid,uuid,jsonb)', 'B', true, true, true, true],
  ['public.replace_thread_children(uuid,jsonb)', 'B', true, true, true, true],
  ['public.required_approvals_for_action(text,integer)', 'B', true, true, true, true],
  ['public.schedule_lead_thread_recompute(uuid,uuid)', 'B', false, true, true, true],
  ['public.set_opportunity_updated_at()', 'T', false, true, true, true],
  ['public.set_updated_at()', 'T', true, true, true, true],
  ['public.set_updated_at_timestamp()', 'T', false, true, true, true],
  ['public.sign_credit_action_approval(uuid,uuid,text,text)', 'B', true, true, true, true],
  ['public.source_assertions_relationship_guard()', 'T', true, false, true, false],
  ['public.sync_blog_likes_count()', 'T', false, true, true, true],
  ['public.sync_company_id_columns()', 'T', true, true, true, true],
  ['public.telemetry_events_reject_mutation()', 'T', true, true, true, true],
  ['public.tenant_sending_domains_identity_guard()', 'T', false, false, false, false],
  ['public.transition_campaign_stage(uuid,character varying,character varying,jsonb)', 'B', false, true, true, true],
  ['public.trg_cec_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_consent_records_append_only_update()', 'T', true, true, true, true],
  ['public.trg_consent_records_block_delete()', 'T', true, true, true, true],
  ['public.trg_contacts_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_curated_industry_sources_updated_at()', 'T', true, true, true, true],
  ['public.trg_governance_policy_protect_update()', 'T', true, true, true, true],
  ['public.trg_incident_timeline_block_mutation()', 'T', true, true, true, true],
  ['public.trg_lead_signals_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_marketplace_certs_block_mutation()', 'T', true, true, true, true],
  ['public.trg_phase0_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase10_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase11_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase12_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase2_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase3_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase4_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase5_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase6_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase7_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase8_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_phase9_set_updated_at()', 'T', true, true, true, true],
  ['public.trg_prospect_lifecycle_guard()', 'T', true, false, true, false],
  ['public.trg_safeguard_triggers_block_mutation()', 'T', true, true, true, true],
  ['public.trg_safety_rail_events_block_mutation()', 'T', true, true, true, true],
  ['public.trg_stab_events_block_mutation()', 'T', true, true, true, true],
  ['public.update_access_request_timestamp()', 'T', false, true, true, true],
  ['public.update_campaign_completion()', 'T', false, true, true, true],
  ['public.update_campaign_context_updated_at()', 'T', false, true, true, true],
  ['public.update_feature_completion_updated_at()', 'T', true, true, true, true],
  ['public.update_free_credit_profile_timestamp()', 'T', false, true, true, true],
  ['public.update_free_credit_unlock_timestamp()', 'T', true, true, true, true],
  ['public.update_org_controls_timestamp()', 'T', true, true, true, true],
  ['public.update_updated_at()', 'T', false, true, true, true],
  ['public.update_updated_at_column()', 'T', false, true, true, true],
  ['public.update_weekly_alignment(uuid,integer,character varying,text,uuid)', 'B', true, true, true, true],
  ['public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid)', 'B', false, true, true, true],
  ['public.upsert_engagement_thread_memory_locked(uuid,uuid,text,uuid,uuid)', 'B', false, true, true, true],
  ['public.worker_snapshot_shadow_telemetry_append_only()', 'T', false, true, true, true],
  ['public.ws3_protect_task_provenance()', 'T', true, true, true, true],
  ['public.ws3_reject_mutation()', 'T', true, true, true, true],
  ['public.ws3_suppression_guard()', 'T', true, true, true, true],
];

const MIGRATION = process.env.SEC_B_MIGRATION_FILE
  || path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20270111000003_function_execute_classwide_hardening.sql');

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);
const UNRESOLVABLE = 'public.get_engagement_thread_message_distance(uuid,uuid)';
const T = PROD.filter((r) => r[1] === 'T');
const B = PROD.filter((r) => r[1] === 'B');
const A = PROD.filter((r) => r[1] === 'A');

/** Run sql; return 'ok' or `${sqlstate}|${message}`. A savepoint keeps the txn usable. */
async function outcome(sql: string, params: unknown[] = []): Promise<string> {
  await q('SAVEPOINT secb');
  try {
    await q(sql, params);
    await q('RELEASE SAVEPOINT secb');
    return 'ok';
  } catch (e: any) {
    await q('ROLLBACK TO SAVEPOINT secb');
    return `${e.code}|${e.message}`;
  }
}

/** A call expression with typed NULL arguments: EXECUTE is checked before the body runs. */
function nullCall(sig: string): string {
  const m = /^(.*)\((.*)\)$/.exec(sig)!;
  const args = m[2].trim() === '' ? [] : m[2].split(',').map((t) => `NULL::${t.trim()}`);
  return `SELECT ${m[1]}(${args.join(', ')})`;
}

/** Step 1 + 2: production state for every listed function, then the migration. */
async function prodStateThenMigration(): Promise<void> {
  const emu: string[] = [];
  for (const [sig, , pin, anon, auth, pub] of PROD) {
    emu.push(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated`);
    const g = [pub && 'PUBLIC', anon && 'anon', auth && 'authenticated', 'service_role'].filter(Boolean);
    emu.push(`GRANT EXECUTE ON FUNCTION ${sig} TO ${g.join(', ')}`);
    // Every function this migration pins had NO proconfig in production.
    if (pin) emu.push(`ALTER FUNCTION ${sig} RESET search_path`);
  }
  await q(emu.join(';\n'));
  // Non-tautology: in the production state a client CAN execute these.
  const { rows } = await q(
    `SELECT count(*) FILTER (WHERE has_function_privilege('anon', s::regprocedure, 'EXECUTE')
                               OR has_function_privilege('authenticated', s::regprocedure, 'EXECUTE'))::int AS client_x
       FROM unnest($1::text[]) s`, [PROD.map((r) => r[0])]);
  expect(rows[0].client_x).toBe(PROD.filter((r) => r[3] || r[4] || r[5]).length);
  const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
  await q(sql);
}

/** Production table privileges for service_role (Supabase default) — inside the txn. */
async function serviceRoleTables(): Promise<void> {
  await q('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role');
}

/** Run body as role. On error the txn is aborted anyway (inRollback rolls it back), so the
 *  original error is rethrown rather than masked by a failing RESET ROLE. */
async function asRole<R>(role: string, body: () => Promise<R>): Promise<R> {
  await q(`SET LOCAL ROLE ${role}`);
  const r = await body();
  await q('RESET ROLE');
  return r;
}

/** A hostile schema whose objects shadow pg_catalog built-ins when placed FIRST on a session path. */
async function hostileSchema(): Promise<void> {
  await q('CREATE SCHEMA sec_b_hostile');
  await q(`CREATE FUNCTION sec_b_hostile.now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT '2000-01-01T00:00:00Z'::timestamptz $$`);
  await q(`CREATE FUNCTION sec_b_hostile.jsonb_array_length(jsonb) RETURNS integer LANGUAGE sql AS 'SELECT 0'`);
  await q(`CREATE FUNCTION sec_b_hostile.lower(text) RETURNS text LANGUAGE sql AS $$ SELECT 'linkedin'::text $$`);
  await q('GRANT USAGE ON SCHEMA sec_b_hostile TO PUBLIC');
  // Executable by everyone, so a mutant fails because the planted object WINS, not on a permission error.
  await q('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sec_b_hostile TO PUBLIC');
}
/** Set updated_at to 2001 WITHOUT firing the BEFORE UPDATE touch trigger (superuser, replica mode). */
async function backdate(table: string, id: string): Promise<void> {
  await q('SET LOCAL session_replication_role = replica');
  await q(`UPDATE public.${table} SET updated_at = '2001-01-01Z' WHERE id = $1`, [id]);
  await q('SET LOCAL session_replication_role = origin');
  const { rows } = await q(`SELECT updated_at < '2002-01-01Z' AS old FROM public.${table} WHERE id = $1`, [id]);
  expect(rows[0].old).toBe(true);
}
const HOSTILE_PATH = 'SET LOCAL search_path = sec_b_hostile, pg_catalog, public';

// ─────────────────────────────────────────────────────────────────────────────

describe('catalog end state after the migration (from the production state)', () => {
  it('class T + B: no PUBLIC, anon or authenticated EXECUTE on any of the 128 functions', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const { rows } = await q(
        `SELECT s FROM unnest($1::text[]) s
          WHERE has_function_privilege('anon', s::regprocedure, 'EXECUTE')
             OR has_function_privilege('authenticated', s::regprocedure, 'EXECUTE')
             OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                         WHERE p.oid = s::regprocedure AND x.grantee = 0)
          ORDER BY s`, [[...T, ...B].map((r) => r[0])]);
      expect(rows.map((r) => r.s)).toEqual([]);
      expect(T.length + B.length).toBe(128);
    });
  });

  it('class B: service_role and the owner keep EXECUTE', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const { rows } = await q(
        `SELECT s FROM unnest($1::text[]) s JOIN pg_proc p ON p.oid = s::regprocedure
          WHERE NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
             OR NOT has_function_privilege(p.proowner, p.oid, 'EXECUTE')`, [B.map((r) => r[0])]);
      expect(rows).toEqual([]);
    });
  });

  it('class A: explicit grants to anon, authenticated, service_role — and no PUBLIC', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const { rows } = await q(
        `SELECT s,
                has_function_privilege('anon', s::regprocedure, 'EXECUTE') AND
                has_function_privilege('authenticated', s::regprocedure, 'EXECUTE') AND
                has_function_privilege('service_role', s::regprocedure, 'EXECUTE') AS clients,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                         WHERE p.oid = s::regprocedure AND x.grantee = 0) AS public_grant
           FROM unnest($1::text[]) s ORDER BY s`, [A.map((r) => r[0])]);
      expect(rows).toEqual(A.map((r) => r[0]).sort().map((s) => ({ s, clients: true, public_grant: false })));
    });
  });

  it('every function the migration pins carries exactly search_path = pg_catalog, public', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const pinned = PROD.filter((r) => r[2]).map((r) => r[0]);
      expect(pinned.length).toBe(89);
      const { rows } = await q(
        `SELECT s, p.proconfig FROM unnest($1::text[]) s JOIN pg_proc p ON p.oid = s::regprocedure
          WHERE p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']`, [pinned]);
      expect(rows).toEqual([]);
    });
  });

  it('SECURITY DEFINER/INVOKER, owners and every other function are untouched', async () => {
    await inRollback(async () => {
      const snap = `SELECT p.oid::regprocedure::text AS f, p.prosecdef, p.proowner::regrole::text AS owner, p.prosrc
                      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1`;
      const before = (await q(snap)).rows;
      const otherAcl = `SELECT p.oid::regprocedure::text AS f, p.proacl::text AS acl, p.proconfig
                          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                           AND NOT (p.oid = ANY (SELECT s::regprocedure::oid FROM unnest($1::text[]) s)) ORDER BY 1`;
      const listed = PROD.map((r) => r[0]);
      const otherBefore = (await q(otherAcl, [listed])).rows;
      await prodStateThenMigration();
      expect((await q(snap)).rows).toEqual(before);
      expect((await q(otherAcl, [listed])).rows).toEqual(otherBefore);
    });
  });
});

describe('clients cannot invoke restricted functions', () => {
  it('every class-T trigger function: anon and authenticated get 42501 (not 0A000)', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const bad: string[] = [];
      for (const [sig] of T) {
        for (const role of ['anon', 'authenticated']) {
          const o = await asRole(role, () => outcome(nullCall(sig)));
          if (!o.startsWith('42501|permission denied for function')) bad.push(`${role} ${sig}: ${o}`);
        }
      }
      expect(bad).toEqual([]);
    });
  });

  it('every class-B function: anon and authenticated get 42501', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const bad: string[] = [];
      for (const [sig] of B.filter(([s]) => s !== UNRESOLVABLE)) {
        for (const role of ['anon', 'authenticated']) {
          const o = await asRole(role, () => outcome(nullCall(sig)));
          if (!o.startsWith('42501|permission denied for function')) bad.push(`${role} ${sig}: ${o}`);
        }
      }
      expect(bad).toEqual([]);
    });
  });

  // get_engagement_thread_message_distance(uuid,uuid) cannot be called by name by ANY role:
  // the (uuid,uuid,integer) overload has `p_threshold integer DEFAULT 5`, so every 2-argument
  // call is ambiguous (42725) before EXECUTE is even checked. Its client EXECUTE is therefore
  // proved only in the catalog (first describe block); here we pin the ambiguity itself.
  it('the 2-argument get_engagement_thread_message_distance overload is unresolvable for everyone (42725)', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const o = await asRole(role, () => outcome(nullCall(UNRESOLVABLE)));
        expect(`${role}:${o}`).toBe(`${role}:42725|function public.get_engagement_thread_message_distance(uuid, uuid) is not unique`);
      }
    });
  });

  it('even holding EXECUTE (test superuser), a trigger function cannot be called directly (0A000)', async () => {
    await inRollback(async () => {
      for (const sig of ['public.omnivyra_touch_updated_at()', 'public.raise_ledger_immutable()', 'public.set_updated_at()']) {
        expect(await outcome(`SELECT ${sig}`)).toBe('0A000|trigger functions can only be called as triggers');
      }
    });
  });
});

describe('triggers still fire (EXECUTE is not checked when a trigger fires)', () => {
  async function fixtures() {
    await seedTenants();
    const person = await newPerson(ORG_A);
    await backdate('unified_persons', person);
    const { rows: ae } = await q(`INSERT INTO public.audit_events (action, resource_type) VALUES ('sec-b', 'test') RETURNING id`);
    const { rows: cal } = await q(`INSERT INTO public.capability_audit_log (capability, decision) VALUES ('sec-b', 'allow') RETURNING id`);
    const { rows: te } = await q(`INSERT INTO public.telemetry_events (event_type, category, organization_id) VALUES ('sec-b', 'test', $1) RETURNING id`, [ORG_A]);
    const { rows: fx } = await q(
      `INSERT INTO public.currency_exchange_rates (source_currency, target_currency, rate, provider, effective_at)
       VALUES ('USD', 'EUR', 0.9, 'sec-b', '2026-01-01Z') RETURNING id`);
    const { rows: acd } = await q(
      `INSERT INTO public.analytics_competitor_domains (company_id, domain, updated_at) VALUES ($1, 'sec-b.example', '2001-01-01Z') RETURNING id`, [ORG_A]);
    await serviceRoleTables();
    return { person, audit: ae[0].id, cal: cal[0].id, tel: te[0].id, fx: fx[0].id, acd: acd[0].id };
  }

  async function assertFires(f: Awaited<ReturnType<typeof fixtures>>) {
    await asRole('service_role', async () => {
      // BEFORE UPDATE touch triggers (omnivyra_touch_updated_at, set_updated_at).
      expect(await outcome(`UPDATE public.unified_persons SET full_name = 'Sec B' WHERE id = $1`, [f.person])).toBe('ok');
      expect(await outcome(`UPDATE public.analytics_competitor_domains SET label = 'x' WHERE id = $1`, [f.acd])).toBe('ok');
      // Append-only guards on four different tables.
      expect(await outcome(`UPDATE public.audit_events SET action = 'x' WHERE id = $1`, [f.audit])).toMatch(/^P0001\|AUDIT_IMMUTABLE: UPDATE on audit_events/);
      expect(await outcome(`DELETE FROM public.capability_audit_log WHERE id = $1`, [f.cal])).toMatch(/^P0001\|capability_audit_log is append-only/);
      expect(await outcome(`UPDATE public.telemetry_events SET category = 'x' WHERE id = $1`, [f.tel])).toMatch(/^P0001\|telemetry_events is append-only; UPDATE/);
      expect(await outcome(`DELETE FROM public.currency_exchange_rates WHERE id = $1`, [f.fx])).toMatch(/^P0001\|.*IMMUTABLE/);
    });
    const { rows } = await q(
      `SELECT (SELECT updated_at > now() - interval '1 hour' FROM public.unified_persons WHERE id = $1) AS person_touched,
              (SELECT updated_at > now() - interval '1 hour' FROM public.analytics_competitor_domains WHERE id = $2) AS acd_touched,
              (SELECT action FROM public.audit_events WHERE id = $3) AS audit_action,
              (SELECT count(*)::int FROM public.capability_audit_log WHERE id = $4) AS cal_rows`,
      [f.person, f.acd, f.audit, f.cal]);
    expect(rows[0]).toEqual({ person_touched: true, acd_touched: true, audit_action: 'sec-b', cal_rows: 1 });
  }

  it('touch + append-only triggers on six tables behave as before for service_role', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      await assertFires(await fixtures());
    });
  });

  it('…and still hold with EXECUTE revoked from every role, the owner included', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const f = await fixtures();
      const fns = ['public.omnivyra_touch_updated_at()', 'public.set_updated_at()', 'public.raise_audit_immutable()',
        'public.capability_audit_log_block_mutation()', 'public.telemetry_events_reject_mutation()', 'public.raise_ledger_immutable()'];
      for (const fn of fns) await q(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon, authenticated, service_role, postgres, CURRENT_USER`);
      const { rows } = await q(
        `SELECT bool_or(has_function_privilege('service_role', s::regprocedure, 'EXECUTE')) AS any_exec FROM unnest($1::text[]) s`, [fns]);
      expect(rows[0].any_exec).toBe(false);
      await assertFires(f);
    });
  });

  it('a client write through RLS still fires the (now client-unexecutable) touch trigger', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      await seedTenants();
      const { rows } = await q(
        `INSERT INTO public.canonical_domains (company_id, primary_domain, updated_at) VALUES ($1, 'sec-b.example', '2001-01-01Z') RETURNING id`, [ORG_A]);
      await q('GRANT SELECT, UPDATE ON public.canonical_domains TO authenticated');
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', company_id: ORG_A })]);
      const r = await asRole('authenticated', () => outcome(`UPDATE public.canonical_domains SET verified = true WHERE id = $1`, [rows[0].id]));
      expect(r).toBe('ok');
      const { rows: after } = await q(`SELECT verified, updated_at > now() - interval '1 hour' AS touched FROM public.canonical_domains WHERE id = $1`, [rows[0].id]);
      expect(after[0]).toEqual({ verified: true, touched: true });
    });
  });
});

// ─── pi_apply_canonical_decisions ────────────────────────────────────────────

const NOW = '2026-03-01T00:00:00.000Z';
const HASH = 'b'.repeat(64);

async function canonicalFixture(org: string) {
  await seedTenants();
  const person = await newPerson(org);
  const { rows: acct } = await q(
    `INSERT INTO public.prospect_accounts (organization_id, source) VALUES ($1, 'w6') RETURNING id`, [org]);
  const { rows: sr } = await q(
    `INSERT INTO public.source_records (organization_id, provider, source_entity_type, source_record_id, payload_hash)
     VALUES ($1, 'alpha', 'person', 'SEC-B-1', $2) RETURNING id`, [org, HASH]);
  const ins = async (entity: string, col: string, id: string, attr: string, val: string) => (await q(
    `INSERT INTO public.source_assertions (organization_id, source_record_id, entity_type, ${col}, attribute,
       normalized_value, value_hash, provider, observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'alpha',$8) RETURNING id`, [org, sr[0].id, entity, id, attr, val, HASH, NOW])).rows[0].id;
  const pa = await ins('person', 'person_id', person, 'job_title', 'VP Sales');
  const aa = await ins('account', 'account_id', acct[0].id, 'industry', 'software');
  await serviceRoleTables();
  return { person, account: acct[0].id, pa, aa };
}
const applyCall = `SELECT public.pi_apply_canonical_decisions($1, $2, $3, 'alpha', $4, $5) AS n`;
const dec = (attribute: string, value: string, assertion_id: string) =>
  JSON.stringify([{ attribute, value, assertion_id, reason: 'single_uncontested_assertion' }]);

describe('pi_apply_canonical_decisions(uuid,text,uuid,text,timestamptz,jsonb)', () => {
  it('authenticated and anon are refused (42501)', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const f = await canonicalFixture(ORG_A);
      for (const role of ['authenticated', 'anon']) {
        const o = await asRole(role, () => outcome(applyCall, [ORG_A, 'person', f.person, NOW, dec('job_title', 'VP Sales', f.pa)]));
        expect(`${role}:${o}`).toMatch(new RegExp(`^${role}:42501\\|permission denied for function pi_apply_canonical_decisions`));
      }
    });
  });

  it('service_role: person + account writes, decision log, provenance stamp, allowlist and tenant refusals', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const f = await canonicalFixture(ORG_A);
      await asRole('service_role', async () => {
        expect((await q(applyCall, [ORG_A, 'person', f.person, NOW, dec('job_title', 'VP Sales', f.pa)])).rows[0].n).toBe(1);
        expect((await q(applyCall, [ORG_A, 'account', f.account, NOW, dec('industry', 'software', f.aa)])).rows[0].n).toBe(1);
        // allowlist: a non-attribute column never reaches the dynamic UPDATE
        expect(await outcome(applyCall, [ORG_A, 'person', f.person, NOW, dec('company_id', ORG_B, f.pa)]))
          .toMatch(/^P0001\|pi_apply_canonical_decisions: attribute company_id is not writable for entity type person$/);
        // tenant check: the same person under another tenant does not exist
        expect(await outcome(applyCall, [ORG_B, 'person', f.person, NOW, dec('job_title', 'VP Sales', f.pa)]))
          .toMatch(/^P0001\|pi_apply_canonical_decisions: no unified_persons row .* in tenant /);
      });
      const { rows } = await q(
        `SELECT (SELECT job_title FROM public.unified_persons WHERE id = $1) AS title,
                (SELECT attributes_source FROM public.unified_persons WHERE id = $1) AS src,
                (SELECT industry FROM public.prospect_accounts WHERE id = $2) AS industry,
                (SELECT count(*)::int FROM public.canonical_attribute_decisions WHERE organization_id = $3) AS decisions,
                (SELECT count(*)::int FROM public.source_assertions WHERE id IN ($4, $5) AND applied_to_canonical_at IS NOT NULL) AS stamped`,
        [f.person, f.account, ORG_A, f.pa, f.aa]);
      expect(rows[0]).toEqual({ title: 'VP Sales', src: 'alpha', industry: 'software', decisions: 2, stamped: 2 });
    });
  });

  it('pinned: a hostile session search_path cannot turn the write into a silent no-op', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const f = await canonicalFixture(ORG_A);
      await hostileSchema();
      await q(HOSTILE_PATH);
      const n = await asRole('service_role', async () =>
        (await q(applyCall, [ORG_A, 'person', f.person, NOW, dec('job_title', 'VP Sales', f.pa)])).rows[0].n);
      expect(n).toBe(1);
      const { rows } = await q('SELECT job_title FROM public.unified_persons WHERE id = $1', [f.person]);
      expect(rows[0].job_title).toBe('VP Sales');
    });
  });
});

// ─── merge_unified_persons ───────────────────────────────────────────────────

describe('merge_unified_persons(uuid,uuid,text,text)', () => {
  /** Two people in tenant A and a canonical_users row pointing at the loser (an FK the merge re-points). */
  async function mergeFixture() {
    await seedTenants();
    const winner = await newPerson(ORG_A);
    const loser = await newPerson(ORG_A);
    const { rows } = await q(
      `INSERT INTO public.canonical_users (company_id, user_type, device, unified_person_id)
       VALUES ($1, 'known', 'desktop', $2) RETURNING id`, [ORG_A, loser]);
    await serviceRoleTables();
    return { winner, loser, cu: rows[0].id };
  }
  const mergeCall = `SELECT public.merge_unified_persons($1, $2, 'sec-b duplicate', 'sec-b-actor')`;
  const state = async (f: Awaited<ReturnType<typeof mergeFixture>>) => (await q(
    `SELECT (SELECT count(*)::int FROM public.unified_persons WHERE id = $1) AS winner_rows,
            (SELECT count(*)::int FROM public.unified_persons WHERE id = $2) AS loser_rows,
            (SELECT unified_person_id = $1 FROM public.canonical_users WHERE id = $3) AS repointed`,
    [f.winner, f.loser, f.cu])).rows[0];

  it('anon and authenticated are refused (42501); nothing changes', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const f = await mergeFixture();
      for (const role of ['anon', 'authenticated']) {
        const o = await asRole(role, () => outcome(mergeCall, [f.winner, f.loser]));
        expect(`${role}:${o}`).toMatch(new RegExp(`^${role}:42501\\|permission denied for function merge_unified_persons`));
      }
      expect(await state(f)).toEqual({ winner_rows: 1, loser_rows: 1, repointed: false });
    });
  });

  // NOTE (pre-existing, not changed here): 20260924000000 (W5) gave
  // unified_person_merges.loser_person_id an ON DELETE CASCADE tenant FK, so the audit
  // row this function inserts is removed by its own final DELETE of the loser. That is
  // reported as a finding; this suite asserts only what the function demonstrably does.
  it('service_role: FKs re-pointed to the winner, loser deleted, self-merge still refused', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const f = await mergeFixture();
      await asRole('service_role', async () => {
        expect(await outcome(mergeCall, [f.winner, f.loser])).toBe('ok');
        expect(await outcome(mergeCall, [f.winner, f.winner])).toBe('P0001|merge_unified_persons: winner and loser cannot be the same id');
      });
      expect(await state(f)).toEqual({ winner_rows: 1, loser_rows: 0, repointed: true });
    });
  });

  it('pinned: a planted uuid `=` on the session path cannot turn the merge into a refusal or a no-op', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      const f = await mergeFixture();
      await q('CREATE SCHEMA sec_b_hostile_eq');
      await q(`CREATE FUNCTION sec_b_hostile_eq.never(uuid, uuid) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'`);
      await q('CREATE OPERATOR sec_b_hostile_eq.= (LEFTARG = uuid, RIGHTARG = uuid, FUNCTION = sec_b_hostile_eq.never)');
      await q('GRANT USAGE ON SCHEMA sec_b_hostile_eq TO PUBLIC');
      await q('GRANT EXECUTE ON FUNCTION sec_b_hostile_eq.never(uuid, uuid) TO PUBLIC');
      await q('SET LOCAL search_path = sec_b_hostile_eq, pg_catalog, public');
      const o = await asRole('service_role', () => outcome(mergeCall, [f.winner, f.loser]));
      await q('SET LOCAL search_path = public, extensions');
      expect(o).toBe('ok');
      expect(await state(f)).toEqual({ winner_rows: 1, loser_rows: 0, repointed: true });
    });
  });
});

// ─── search_path pinning, trigger + helper sample ────────────────────────────

describe('pinned search_path resists a hostile session path', () => {
  it('touch triggers (omnivyra_touch_updated_at, set_updated_at) use pg_catalog.now(), not a planted now()', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      await seedTenants();
      const person = await newPerson(ORG_A);
      await backdate('unified_persons', person);
      const { rows: acd } = await q(
        `INSERT INTO public.analytics_competitor_domains (company_id, domain, updated_at) VALUES ($1, 'hostile.example', '2001-01-01Z') RETURNING id`, [ORG_A]);
      await serviceRoleTables();
      await hostileSchema();
      await q(HOSTILE_PATH);
      await asRole('service_role', async () => {
        await q(`UPDATE public.unified_persons SET full_name = 'H' WHERE id = $1`, [person]);
        await q(`UPDATE public.analytics_competitor_domains SET label = 'h' WHERE id = $1`, [acd[0].id]);
      });
      const { rows } = await q(
        `SELECT (SELECT updated_at > '2020-01-01Z' FROM public.unified_persons WHERE id = $1) AS person_real_now,
                (SELECT updated_at > '2020-01-01Z' FROM public.analytics_competitor_domains WHERE id = $2) AS acd_real_now`,
        [person, acd[0].id]);
      expect(rows[0]).toEqual({ person_real_now: true, acd_real_now: true });
    });
  });

  it('class-A plpgsql validator is_valid_creator_platform_asset_combo ignores a planted lower()', async () => {
    await inRollback(async () => {
      await prodStateThenMigration();
      await hostileSchema();
      await q(HOSTILE_PATH);
      const r = await asRole('authenticated', () =>
        q(`SELECT public.is_valid_creator_platform_asset_combo('creator', 'tiktok', 'image') AS ok`));
      expect(r.rows[0].ok).toBe(false);
    });
  });
});

// ─── intentionally client-callable helpers stay callable ─────────────────────

describe('class A and the CHECK helper remain callable by clients', () => {
  it('current_company_id, the creator validators and pi_canonical_attribute_set work for anon and authenticated', async () => {
    await inRollback(async () => {
      // pi_authority_providers_ok is NOT listed by the migration. Production grants it to
      // authenticated (Supabase default privileges; evidence acl {postgres,authenticated,
      // service_role}); a replay has no default privileges, so emulate that first and prove
      // the migration leaves it alone.
      await q('GRANT EXECUTE ON FUNCTION public.pi_authority_providers_ok(text[]) TO authenticated, service_role');
      await prodStateThenMigration();
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ company_id: ORG_A })]);
      for (const role of ['anon', 'authenticated']) {
        const r = await asRole(role, () => q(
          `SELECT public.current_company_id() AS cid,
                  public.is_valid_creator_platform_asset_combo('creator', 'linkedin', 'image') AS combo,
                  public.is_valid_creator_daily_content_payload('campaign', NULL, NULL) AS payload,
                  public.pi_canonical_attribute_set(ARRAY['b', 'a', 'a']) AS attrs`));
        expect(r.rows[0]).toEqual({ cid: ORG_A, combo: true, payload: true, attrs: ['a', 'b'] });
      }
      const r2 = await asRole('authenticated', () => q(`SELECT public.pi_authority_providers_ok(ARRAY['apollo']) AS ok`));
      expect(r2.rows[0].ok).toBe(true);
    });
  });
});
