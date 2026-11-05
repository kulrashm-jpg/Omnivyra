/**
 * C3 migrations 20270126000000-03: forward is idempotent, every rollback
 * refuses without its acknowledgement (changing nothing), refuses out of
 * order, and rollback + reapply restores the forward state. All inside
 * rolled-back transactions on the w3_c3 template.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { db, inRollback, effect, ORG_A } from './setup';
import { openTenant, approvedAction } from './helpers/c3ClaimFixtures';

const MIG = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const read = (f: string) => readFileSync(join(MIG, f), 'utf8');
const FWD = {
  policy: read('20270126000000_community_tenant_execution_policy.sql'),
  claim: read('20270126000001_community_action_approval_claim.sql'),
  refusal: read('20270126000002_community_execution_refusal_governance.sql'),
  od2: read('20270126000003_community_policy_two_person_override.sql'),
};
const RB = {
  policy: read('rollbacks/community_tenant_execution_policy_rollback.sql'),
  claim: read('rollbacks/community_action_approval_claim_rollback.sql'),
  refusal: read('rollbacks/community_execution_refusal_governance_rollback.sql'),
  od2: read('rollbacks/community_policy_two_person_override_rollback.sql'),
};
const PA = read('20270120000010_community_action_approved_by.sql');
const ACK = {
  policy: `SET LOCAL omnivyra.community_tenant_execution_policy_restore_open = 'i-accept-open-execution-defaults'`,
  claim: `SET LOCAL omnivyra.community_action_approval_claim_restore = 'i-accept-claims-without-policy-and-expiry'`,
  claimDrop: `SET LOCAL omnivyra.community_action_approval_claim_drop_evidence = 'i-accept-evidence-loss'`,
  od2: `SET LOCAL omnivyra.community_policy_two_person_drop = 'i-accept-single-operator-enable'`,
};

const fn = async (sig: string) => (await db.query(`SELECT to_regprocedure($1) IS NOT NULL AS x`, [sig])).rows[0].x as boolean;
const col = async (table: string, c: string) => (await db.query(
  `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [table, c])).rowCount === 1;
const trig = async (name: string) => (await db.query(`SELECT 1 FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`, [name])).rowCount === 1;
const browserSrc = async () => (await db.query(
  `SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)')`)).rows[0].prosrc as string;
const paBody = () => {
  const st = PA.indexOf('CREATE OR REPLACE FUNCTION public.claim_community_ai_browser_command(');
  const open = PA.indexOf('AS $$', st) + 'AS $$'.length;
  return PA.slice(open, PA.indexOf('$$;', open));
};

async function forwardState() {
  return {
    decision: await fn('public.community_execution_policy_decision(uuid,uuid)'),
    claim: await fn('public.claim_community_ai_action_for_execution(uuid,uuid,uuid,text,text,text)'),
    record: await fn('public.record_community_execution_refusal(uuid,uuid,uuid,text,text,uuid,jsonb)'),
    evidence: await fn('public.community_action_approval_evidence_code(public.community_ai_actions,timestamptz)'),
    policyOrg: await col('community_ai_platform_policy', 'organization_id'),
    requestedBy: await col('community_ai_platform_policy', 'requested_by'),
    hash: await col('community_ai_actions', 'approved_content_hash'),
    backstop: await trig('community_ai_actions_claim_requires_approval'),
    insertBackstop: await trig('community_ai_actions_x_insert_claim_requires_approval'),
    stamp: await trig('community_ai_actions_server_approved_at'),
    lock: await trig('community_ai_actions_content_lock'),
    od2: await trig('community_ai_platform_policy_two_person'),
  };
}
const ALL_ON = {
  decision: true, claim: true, record: true, evidence: true, policyOrg: true, requestedBy: true, hash: true,
  backstop: true, insertBackstop: true, stamp: true, lock: true, od2: true,
};

describe('C3 migrations: forward', () => {
  it('the template carries all four, and re-applying each is idempotent', async () => {
    await inRollback(async () => {
      expect(await forwardState()).toEqual(ALL_ON);
      for (const f of [FWD.policy, FWD.claim, FWD.refusal, FWD.od2]) await db.query(f);
      expect(await forwardState()).toEqual(ALL_ON);
    });
  });

  it('the policy migration refuses when two platform rows exist', async () => {
    await inRollback(async () => {
      await db.query(`DROP INDEX public.uq_community_ai_platform_policy_platform_row`);
      await db.query(`INSERT INTO public.community_ai_platform_policy (execution_enabled, auto_rules_enabled) VALUES (false, false), (false, false)`);
      expect(await effect(FWD.policy)).toBe('P0001');
    });
  });
});

describe('C3 migrations: each rollback', () => {
  it('20270126000003 OD-2: refuses without acknowledgement; rollback + reapply', async () => {
    await inRollback(async () => {
      expect(await effect(RB.od2)).toBe('P0001');
      expect(await forwardState()).toEqual(ALL_ON);
      await db.query(ACK.od2);
      await db.query(RB.od2);
      expect(await forwardState()).toEqual({ ...ALL_ON, od2: false, requestedBy: false });
      // without the trigger one operator can open a row (what the acknowledgement accepts)
      expect(await effect(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, true, true)`, [ORG_A])).toBe('ok');
      await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
      await db.query(FWD.od2);
      expect(await forwardState()).toEqual(ALL_ON);
    });
  });

  it('20270126000002 refusal governance: refuses while the claim uses it, and while policy refusals exist', async () => {
    await inRollback(async () => {
      expect(await effect(RB.refusal)).toBe('P0001'); // claim still present
      await db.query(ACK.claim);
      await db.query(RB.claim);
      const { id } = await approvedAction(db, { org: ORG_A, approver: null, hash: null, passkeyOffsetMs: null, log: false });
      await db.query(`INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
        VALUES ($1, $2, $2, 'skipped_due_to_platform_policy', '{}')`, [id, ORG_A]);
      expect(await effect(RB.refusal)).toBe('P0001'); // never deletes governance records
      await db.query(`DELETE FROM public.community_ai_action_logs WHERE action_id = $1`, [id]);
      await db.query(RB.refusal);
      expect(await fn('public.record_community_execution_refusal(uuid,uuid,uuid,text,text,uuid,jsonb)')).toBe(false);
      expect(await effect(`INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
        VALUES ($1, $2, $2, 'skipped_due_to_platform_policy', '{}')`, [id, ORG_A])).toBe('23514');
      await db.query(FWD.refusal);
      await db.query(FWD.claim);
      expect(await forwardState()).toEqual(ALL_ON);
    });
  });

  it('20270126000001 claim: refuses without acknowledgement; restores the P-A browser body verbatim; keeps evidence columns unless acknowledged and empty', async () => {
    await inRollback(async () => {
      expect(await effect(RB.claim)).toBe('P0001');
      expect(await forwardState()).toEqual(ALL_ON);
      await openTenant(db, ORG_A);
      await approvedAction(db, { org: ORG_A }); // carries evidence
      await db.query(ACK.claim);
      await db.query(ACK.claimDrop);
      expect(await effect(RB.claim)).toBe('P0001'); // evidence present: drop refused
      await db.query(`SET LOCAL omnivyra.community_action_approval_claim_drop_evidence = ''`);
      await db.query(RB.claim);
      expect(await browserSrc()).toBe(paBody());
      expect(await forwardState()).toEqual({ ...ALL_ON, claim: false, evidence: false, backstop: false, insertBackstop: false, stamp: false, lock: false });
      await db.query(FWD.claim);
      expect(await forwardState()).toEqual(ALL_ON);
      expect(await browserSrc()).toContain('community_action_approval_evidence_code');
    });
  });

  it('20270126000000 policy: refuses without acknowledgement, out of order, and while tenant rows exist; full chain rollback + reapply', async () => {
    await inRollback(async () => {
      expect(await effect(RB.policy)).toBe('P0001');
      await db.query(ACK.policy);
      expect(await effect(RB.policy)).toBe('P0001'); // claim + OD-2 still present
      await db.query(ACK.od2);
      await db.query(RB.od2);
      await db.query(ACK.claim);
      await db.query(RB.claim);
      await db.query(RB.refusal);
      await db.query(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, false, false)`, [ORG_A]);
      expect(await effect(RB.policy)).toBe('P0001'); // tenant row
      await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
      await db.query(RB.policy);
      // everything is gone except the evidence columns, kept without the drop acknowledgement
      expect(await forwardState()).toEqual({
        decision: false, claim: false, record: false, evidence: false, policyOrg: false, requestedBy: false,
        hash: true, backstop: false, insertBackstop: false, stamp: false, lock: false, od2: false,
      });
      const { rows: [d] } = await db.query(`SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'community_ai_platform_policy' AND column_name = 'execution_enabled'`);
      expect(d.column_default).toBe('true');
      expect(await browserSrc()).toBe(paBody());
      for (const f of [FWD.policy, FWD.claim, FWD.refusal, FWD.od2]) await db.query(f);
      expect(await forwardState()).toEqual(ALL_ON);
    });
  });
});
