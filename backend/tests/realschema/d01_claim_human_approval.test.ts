/**
 * P-A — the browser-extension claim requires a HUMAN approval, on REAL PostgreSQL.
 *
 * Migration under test: 20270120000010_community_action_approved_by.sql
 * (community_ai_actions.approved_by + claim_community_ai_browser_command with
 * no approval waiver). Rollback: rollbacks/community_action_approved_by_rollback.sql.
 *
 * The suite applies the migration itself (inside each rolled-back transaction),
 * so it proves the same thing whether or not the template database already
 * carries it. The concurrency block needs committed state: it installs the
 * migration only if absent and then restores the template state exactly.
 *
 * The end-to-end case drives the REAL approve and execute routes against the
 * schema (transport, auth/role resolution, the WebAuthn ceremony and side
 * channels replaced), which also shows the status a browser row holds when the
 * extension claims it.
 *
 * C3 (20270126000000-03) sits on top of P-A in the template. The P-A lifecycle
 * and P-A body cases below test P-A on its own base, so they first roll the
 * four C3 migrations back inside their rolled-back transaction (withoutC3);
 * the end-to-end and concurrency cases run on the full C3 schema (tenant
 * policy opened by the two-person path, complete approval evidence).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { db, inRollback, seedTenants, effect, ORG_A, ORG_B } from './setup';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const mockScope = { userId: '' };
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: jest.fn(async () => ({ tenantId: require('./setup').ORG_A, organizationId: require('./setup').ORG_A })),
  enforceActionRole: jest.fn(async () => ({ userId: mockScope.userId, role: 'COMPANY_ADMIN' })),
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: jest.fn() }));
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })),
}));
const PLAYBOOK = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Playbook', status: 'active', execution_modes: { browser: true } };
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => PLAYBOOK),
  listPlaybooks: jest.fn(async () => [PLAYBOOK]),
}));
jest.mock('../../services/playbooks/playbookEvaluator', () => ({
  evaluatePlaybookForEvent: jest.fn(() => ({ primary_playbook: PLAYBOOK, decision: { execution_mode: 'browser' } })),
}));
jest.mock('../../services/playbooks/playbookValidator', () => ({
  validateActionAgainstPlaybook: jest.fn(() => ({ allowed: true })),
}));
jest.mock('../../services/executionGuardrailService', () => ({
  canExecuteAction: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(),
  rpaResultMayHaveActed: () => true,
}));
jest.mock('../../services/communityAiNotificationService', () => ({ notifyCommunityAi: jest.fn(async () => undefined) }));
jest.mock('../../services/communityAiWebhookService', () => ({ sendCommunityAiWebhooks: jest.fn(async () => undefined) }));
jest.mock('../../services/leadOutreachExecution/approvalPasskey', () => ({
  beginApprovalPasskey: jest.fn(async () => ({ challenge: 'c' })),
  verifyApprovalPasskey: jest.fn(async () => ({ ok: true, proof: { p: 1 } })),
  redeemApprovalPasskeyProof: jest.fn(() => ({ ok: true, credentialId: 'cred-d01', verifiedAt: new Date().toISOString() })),
}));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: jest.fn(async () => true) }));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));

const MIG_DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const FORWARD = readFileSync(join(MIG_DIR, '20270120000010_community_action_approved_by.sql'), 'utf8');
const ROLLBACK = readFileSync(join(MIG_DIR, 'rollbacks', 'community_action_approved_by_rollback.sql'), 'utf8');
const PRIOR_MIGRATION = readFileSync(join(MIG_DIR, '20270111100012_extension_dispatch_safety.sql'), 'utf8');
const ACK_WAIVER = "SET LOCAL omnivyra.community_action_approved_by_restore_waiver = 'i-accept-unapproved-claims'";
const ACK_DROP = "SET LOCAL omnivyra.community_action_approved_by_drop_column = 'i-accept-approve-route-failure'";
const C3_FORWARD = [
  '20270126000000_community_tenant_execution_policy.sql', '20270126000001_community_action_approval_claim.sql',
  '20270126000002_community_execution_refusal_governance.sql', '20270126000003_community_policy_two_person_override.sql',
].map((f) => readFileSync(join(MIG_DIR, f), 'utf8'));
const C3_ROLLBACK = [
  ["SET LOCAL omnivyra.community_policy_two_person_drop = 'i-accept-single-operator-enable'", 'community_policy_two_person_override_rollback.sql'],
  ["SET LOCAL omnivyra.community_action_approval_claim_restore = 'i-accept-claims-without-policy-and-expiry'", 'community_action_approval_claim_rollback.sql'],
  ['', 'community_execution_refusal_governance_rollback.sql'],
  ["SET LOCAL omnivyra.community_tenant_execution_policy_restore_open = 'i-accept-open-execution-defaults'", 'community_tenant_execution_policy_rollback.sql'],
].map(([ack, f]) => [ack, readFileSync(join(MIG_DIR, 'rollbacks', f), 'utf8')] as const);
/** P-A on its own base: roll back C3 inside the caller's transaction (evidence columns kept). */
async function withoutC3(): Promise<void> {
  if (!(await db.query(`SELECT to_regprocedure('public.claim_community_ai_action_for_execution(uuid,uuid,uuid,text,text,text)') IS NOT NULL AS x`)).rows[0].x) return;
  for (const [ack, sql] of C3_ROLLBACK) {
    if (ack) await db.query(ack);
    await db.query(sql);
  }
}
async function withC3(): Promise<void> {
  for (const sql of C3_FORWARD) await db.query(sql);
}
const C3_REQUESTER = '00000000-0000-4000-8000-0000000000d1';
const C3_CONFIRMER = '00000000-0000-4000-8000-0000000000d2';
/** Open execution for org (platform + tenant rows) by request + a second operator's confirmation. */
async function openTenantPolicy(org: string, c: { query: Client['query'] } = db): Promise<void> {
  for (const o of [null, org]) {
    const where = o === null ? 'organization_id IS NULL' : 'organization_id = $1';
    const p = o === null ? [] : [o];
    if ((await c.query(`SELECT 1 FROM public.community_ai_platform_policy WHERE ${where}`, p)).rows.length === 0) {
      await c.query(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, false, false)`, [o]);
    }
    await c.query(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = true, requested_auto_rules_enabled = true, requested_by = $${p.length + 1} WHERE ${where}`, [...p, C3_REQUESTER]);
    await c.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, auto_rules_enabled = true, updated_by = $${p.length + 1} WHERE ${where}`, [...p, C3_CONFIRMER]);
  }
}

/** The 20261231000005 body of the claim function, as written in that migration. */
function priorClaimBody(): string {
  const start = PRIOR_MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.claim_community_ai_browser_command(');
  const open = PRIOR_MIGRATION.indexOf('AS $$', start) + 'AS $$'.length;
  const close = PRIOR_MIGRATION.indexOf('$$;', open);
  return PRIOR_MIGRATION.slice(open, close);
}
async function claimSource(c: { query: Client['query'] } = db): Promise<string> {
  const { rows } = await (c as Client).query(
    `SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)')`);
  return rows[0]?.prosrc ?? '';
}
const isPaInstalled = (src: string) => src.includes('community_ai_action_logs') || src.includes('community_action_approval_evidence_code');

const APPROVER = '00000000-0000-4000-8000-0000000000e1';
const OTHER_USER = '00000000-0000-4000-8000-0000000000e2';
const TARGET = 'https://www.linkedin.com/feed/update/urn:li:activity:7/';

async function newUser(id: string, c: Client = db): Promise<void> {
  await c.query(`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'pa-claim') ON CONFLICT (id) DO NOTHING`,
    [id, `pa-claim-${id.slice(-4)}@example.invalid`]);
}

type ActionOpts = { org?: string; tenant?: string; requiresHuman?: boolean | null; risk?: string | null; status?: string };
async function newAction(o: ActionOpts = {}, c: Client = db): Promise<string> {
  const org = o.org ?? ORG_A;
  const { rows } = await c.query(
    `INSERT INTO public.community_ai_actions
       (tenant_id, organization_id, platform, action_type, target_id, suggested_text, status, execution_mode,
        requires_human_approval, risk_level, playbook_id)
     VALUES ($1,$2,'linkedin','like',$3,NULL,$4,'browser',$5,$6,$7) RETURNING id`,
    [o.tenant ?? org, org, `${TARGET}${Math.random()}`, o.status ?? 'pending',
     o.requiresHuman === undefined ? true : o.requiresHuman, o.risk === undefined ? 'medium' : o.risk, PLAYBOOK.id]);
  return rows[0].id;
}

/** Stamp approval columns as approve.ts does. */
async function stampApproval(actionId: string, approver: string | null, at: string | null, c: Client = db): Promise<void> {
  await c.query(`SET LOCAL omnivyra.community_action_test_backdate = 'i-am-a-test-fixture'`);
  await c.query(
    `UPDATE public.community_ai_actions SET approved_at = $2, approved_by = $3,
            approved_content_hash = CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE repeat('ab', 32) END,
            passkey_credential_id = CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE 'cred-d01' END,
            passkey_verified_at = $2::timestamptz - interval '30 seconds'
      WHERE id = $1`, [actionId, at, approver]);
}
/** The approve route's server-recorded event (communityAiActionLogService shape). */
async function logApproval(actionId: string, o: { org?: string; tenant?: string; userId: string; at: string; eventType?: string },
  c: Client = db): Promise<void> {
  const org = o.org ?? ORG_A;
  await c.query(
    `INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload, created_at)
     VALUES ($1,$2,$3,$4,$5::jsonb, now())`,
    [actionId, o.tenant ?? org, org, o.eventType ?? 'approved',
     JSON.stringify({ approved: true, playbook_id: null, intent: null, user_id: o.userId, timestamp: o.at })]);
}
/**
 * Make the action's target this tenant's own published post, so the REAL L-3
 * recipient recheck (communityRecipientRecheck, step 3) resolves it as
 * own_content: a scheduled_posts row with platform_post_id = target_id on a
 * social account of this company. Runs the real recheck; nothing is stubbed.
 */
async function seedOwnPost(actionId: string, owner: string, org: string = ORG_A, c: Client = db): Promise<void> {
  const { rows: [action] } = await c.query(`SELECT target_id FROM public.community_ai_actions WHERE id = $1`, [actionId]);
  const { rows: [account] } = await c.query(
    `INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id)
     VALUES ($1, 'linkedin', $2, 'li', 't', $3) RETURNING id`, [owner, `pa-own-${actionId}`, org]);
  await c.query(
    `INSERT INTO public.scheduled_posts (user_id, social_account_id, platform, content_type, content, status, scheduled_for, platform_post_id)
     VALUES ($1, $2, 'linkedin', 'post', 'Own post', 'published', now(), $3)`, [owner, account.id, action.target_id]);
}
async function approve(actionId: string, approver: string, at: string, c: Client = db): Promise<void> {
  await stampApproval(actionId, approver, at, c);
  await logApproval(actionId, { userId: approver, at }, c);
}
async function claim(actionId: string, org: string = ORG_A, c: Client = db, lease = 'lease-1'): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT * FROM public.claim_community_ai_browser_command($1, $2, $3, 'holder-1', 60)`, [actionId, org, lease]);
  return rows.map((r: any) => r.id);
}

const AT = '2026-11-03T10:15:30.123Z';

async function installForward(): Promise<void> { await db.query(FORWARD); }

describe('migration lifecycle', () => {
  it('forward applies on the template, is idempotent, adds a nullable approved_by FK and the human-approval body', async () => {
    await inRollback(async () => {
      await withoutC3();
      await installForward();
      await installForward();
      const col = await db.query(
        `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='community_ai_actions' AND column_name='approved_by'`);
      expect(col.rows).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);
      const fk = await db.query(
        `SELECT confrelid::regclass::text AS ref, confdeltype FROM pg_constraint
          WHERE conname = 'community_ai_actions_approved_by_fkey'`);
      expect(fk.rows).toEqual([{ ref: 'users', confdeltype: 'n' }]);
      const src = await claimSource();
      expect(isPaInstalled(src)).toBe(true);
      expect(src).not.toMatch(/requires_human_approval|risk_level|v_require_human_approval/);
      const fn = await db.query(
        `SELECT prosecdef, proconfig, pg_get_function_result(oid) AS result, proacl::text AS acl
           FROM pg_proc WHERE oid = to_regprocedure('public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)')`);
      expect(fn.rows[0]).toMatchObject({
        prosecdef: true,
        proconfig: ['search_path=public, pg_temp'],
        result: 'TABLE(id uuid, dispatch_lease_expires_at timestamp with time zone)',
      });
      expect(fn.rows[0].acl).not.toMatch(/(^|[{,])=X|anon=|authenticated=/);
      expect(fn.rows[0].acl).toMatch(/service_role=X/);
    });
  });

  it('no backfill: a row approved before the column existed keeps approved_by NULL', async () => {
    await inRollback(async () => {
      await withoutC3();
      await seedTenants();
      await newUser(APPROVER);
      // Pre-migration state: column absent, prior claim body.
      await installForward();
      await db.query(ACK_WAIVER);
      await db.query(ACK_DROP);
      await db.query(ROLLBACK);
      const id = await newAction();
      await db.query(`UPDATE public.community_ai_actions SET approved_at = $2 WHERE id = $1`, [id, AT]);
      await logApproval(id, { userId: APPROVER, at: AT }); // even with a historical approval event
      await installForward();
      expect(await claim(id)).toEqual([]);
      const { rows } = await db.query(`SELECT approved_by FROM public.community_ai_actions WHERE id = $1`, [id]);
      expect(rows).toEqual([{ approved_by: null }]);
    });
  });

  it('rollback refuses without acknowledgement, changing nothing', async () => {
    await inRollback(async () => {
      await withoutC3();
      await installForward();
      const code = await effect(ROLLBACK);
      expect(code).toBe('P0001');
      expect(isPaInstalled(await claimSource())).toBe(true);
    });
  });

  it('rollback with acknowledgement restores the 20261231000005 body verbatim and keeps approved_by', async () => {
    await inRollback(async () => {
      await withoutC3();
      await installForward();
      await db.query(ACK_WAIVER);
      await db.query(ROLLBACK);
      expect(await claimSource()).toBe(priorClaimBody());
      const col = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='community_ai_actions' AND column_name='approved_by'`);
      expect(col.rowCount).toBe(1);
    });
  });

  it('rollback column drop refuses while an approver is recorded, and drops column + FK when none is', async () => {
    await inRollback(async () => {
      await withoutC3();
      await seedTenants();
      await installForward();
      await newUser(APPROVER);
      const id = await newAction();
      await approve(id, APPROVER, AT);
      await db.query(ACK_WAIVER);
      await db.query(ACK_DROP);
      expect(await effect(ROLLBACK)).toBe('P0001');
      expect(isPaInstalled(await claimSource())).toBe(true);
      await db.query(`UPDATE public.community_ai_actions SET approved_by = NULL WHERE id = $1`, [id]);
      expect(await effect(ROLLBACK)).toBe('ok');
      expect(await claimSource()).toBe(priorClaimBody());
      const col = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='community_ai_actions' AND column_name='approved_by'`);
      expect(col.rowCount).toBe(0);
    });
  });

  it('the prior body (control) DID claim the waived and timestamp-only rows the new body refuses', async () => {
    await inRollback(async () => {
      await withoutC3();
      await seedTenants();
      await installForward();
      await db.query('DELETE FROM public.community_ai_platform_policy');
      const waived = await newAction({ requiresHuman: false, risk: 'low' });
      const bareTs = await newAction();
      await db.query(`UPDATE public.community_ai_actions SET approved_at = $2 WHERE id = $1`, [bareTs, AT]);
      expect(await claim(waived)).toEqual([]);
      expect(await claim(bareTs)).toEqual([]);
      await db.query(ACK_WAIVER);
      await db.query(ROLLBACK);
      expect(await claim(waived)).toEqual([waived]);
      expect(await claim(bareTs)).toEqual([bareTs]);
    });
  });
});

describe('claim requires a human approval', () => {
  async function setup(): Promise<void> {
    await withoutC3();
    await seedTenants();
    await installForward();
    await db.query('DELETE FROM public.community_ai_platform_policy');
    await newUser(APPROVER);
    await newUser(OTHER_USER);
  }

  it('(a) approved by a user with the matching server-recorded approval: claimed, lease stamped', async () => {
    await inRollback(async () => {
      await setup();
      const id = await approvedAction();
      expect(await claim(id)).toEqual([id]);
      const { rows } = await db.query(
        `SELECT dispatch_lease_id, dispatch_lease_holder_id, status FROM public.community_ai_actions WHERE id = $1`, [id]);
      expect(rows).toEqual([{ dispatch_lease_id: 'lease-1', dispatch_lease_holder_id: 'holder-1', status: 'pending' }]);
      expect(await claim(id, ORG_A, db, 'lease-2')).toEqual([]); // never re-offered
    });
  });

  async function approvedAction(o: ActionOpts = {}): Promise<string> {
    const id = await newAction(o);
    await approve(id, APPROVER, AT);
    return id;
  }

  it('(b) unapproved: not claimed', async () => {
    await inRollback(async () => {
      await setup();
      expect(await claim(await newAction())).toEqual([]);
    });
  });

  it('(c) legacy: approved_at set, approved_by NULL (even with an approval log): not claimed', async () => {
    await inRollback(async () => {
      await setup();
      const id = await newAction();
      await stampApproval(id, null, AT);
      await logApproval(id, { userId: APPROVER, at: AT });
      expect(await claim(id)).toEqual([]);
    });
  });

  it('approved_by set, approved_at NULL: not claimed', async () => {
    await inRollback(async () => {
      await setup();
      const id = await newAction();
      await stampApproval(id, APPROVER, null);
      await logApproval(id, { userId: APPROVER, at: AT });
      expect(await claim(id)).toEqual([]);
    });
  });

  describe('(d) approved_by set but no matching server-recorded approval', () => {
    const cases: Array<[string, (id: string) => Promise<void>]> = [
      ['no log row at all', async () => undefined],
      ['log by a different user', async (id) => logApproval(id, { userId: OTHER_USER, at: AT })],
      ['log with a different timestamp', async (id) => logApproval(id, { userId: APPROVER, at: '2026-11-03T10:15:30.124Z' })],
      ['log of another event type', async (id) => logApproval(id, { userId: APPROVER, at: AT, eventType: 'executed' })],
      ['log in another organization', async (id) => logApproval(id, { userId: APPROVER, at: AT, org: ORG_B, tenant: ORG_A })],
      ['log under another tenant id', async (id) => logApproval(id, { userId: APPROVER, at: AT, tenant: ORG_B })],
      ['log for another action', async () => {
        const other = await newAction();
        await logApproval(other, { userId: APPROVER, at: AT });
      }],
    ];
    it.each(cases)('%s: not claimed', async (_label, addLog) => {
      await inRollback(async () => {
        await setup();
        const id = await newAction();
        await stampApproval(id, APPROVER, AT);
        await addLog(id);
        expect(await claim(id)).toEqual([]);
      });
    });
  });

  it('(e) AI / risk / policy metadata never stands in for a human approval', async () => {
    await inRollback(async () => {
      await setup();
      await db.query(`INSERT INTO public.community_ai_platform_policy (execution_enabled, auto_rules_enabled, require_human_approval)
        VALUES (true, true, false)`);
      const low = await newAction({ requiresHuman: false, risk: 'low' });
      const nullRisk = await newAction({ requiresHuman: null, risk: null });
      const tsOnly = await newAction({ requiresHuman: false, risk: 'low' });
      await db.query(`UPDATE public.community_ai_actions SET approved_at = $2 WHERE id = $1`, [tsOnly, AT]);
      for (const id of [low, nullRisk, tsOnly]) expect(await claim(id)).toEqual([]);
      // ...while a human-approved row under the same policy IS claimable,
      // whatever its own AI metadata says.
      const human = await approvedAction({ requiresHuman: false, risk: 'low' });
      expect(await claim(human)).toEqual([human]);
    });
  });

  it('(f) cross-tenant: an approved action of org A is not claimable as org B', async () => {
    await inRollback(async () => {
      await setup();
      const id = await approvedAction();
      expect(await claim(id, ORG_B)).toEqual([]);
      expect(await claim(id, ORG_A)).toEqual([id]);
    });
  });

  it('existing conditions are kept: status, mode, lease, cancel, kill switch', async () => {
    await inRollback(async () => {
      await setup();
      const approvedStatus = await approvedAction({ status: 'approved' });
      const api = await approvedAction();
      await db.query(`UPDATE public.community_ai_actions SET execution_mode = 'api' WHERE id = $1`, [api]);
      const leased = await approvedAction();
      await db.query(`UPDATE public.community_ai_actions SET dispatch_lease_id = 'other' WHERE id = $1`, [leased]);
      const cancelled = await approvedAction();
      await db.query(`UPDATE public.community_ai_actions SET cancel_requested_at = now() WHERE id = $1`, [cancelled]);
      for (const id of [approvedStatus, api, leased, cancelled]) expect(await claim(id)).toEqual([]);
      const ok = await approvedAction();
      await db.query(`INSERT INTO public.community_ai_platform_policy (execution_enabled, auto_rules_enabled, require_human_approval)
        VALUES (false, false, true)`);
      expect(await claim(ok)).toEqual([]);
    });
  });

  it('deleting the approver nulls approved_by (FK not armed) and the row is no longer claimable', async () => {
    await inRollback(async () => {
      await setup();
      const id = await approvedAction();
      expect(await effect(`DELETE FROM public.users WHERE id = $1`, [APPROVER])).toBe('ok');
      const { rows } = await db.query(`SELECT approved_by FROM public.community_ai_actions WHERE id = $1`, [id]);
      expect(rows).toEqual([{ approved_by: null }]);
      expect(await claim(id)).toEqual([]);
    });
  });

  it('approved_by must reference a real user (FK)', async () => {
    await inRollback(async () => {
      await setup();
      const id = await newAction();
      expect(await effect(`UPDATE public.community_ai_actions SET approved_by = $2 WHERE id = $1`,
        [id, '00000000-0000-4000-8000-0000000000ff'])).toBe('23503');
    });
  });
});

describe('real approve + execute routes, then the claim', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const approveRoute = () => require('../../../pages/api/community-ai/actions/approve').default;
  const executeRoute = () => require('../../../pages/api/community-ai/actions/execute').default;
  /* eslint-enable @typescript-eslint/no-var-requires */
  function call(handler: any, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const res: any = {
        statusCode: 200,
        status(c: number) { this.statusCode = c; return this; },
        json(b: any) { resolve({ status: this.statusCode, body: b }); return this; },
        setHeader() { return this; },
      };
      Promise.resolve(handler({ method: 'POST', headers: {}, query: {}, body }, res)).catch(reject);
    });
  }

  it('without the column the approve route fails; with it, approve -> execute(browser) -> claim succeeds', async () => {
    await inRollback(async () => {
      await seedTenants();
      await newUser(APPROVER);
      mockScope.userId = APPROVER;
      await withoutC3();
      await db.query('DELETE FROM public.community_ai_platform_policy');
      // Template state before this migration (column absent, prior body).
      await installForward();
      await db.query(ACK_WAIVER);
      await db.query(ACK_DROP);
      await db.query(ROLLBACK);
      const before = await newAction();
      const failed = await call(approveRoute(), { tenant_id: ORG_A, organization_id: ORG_A, action_id: before, passkey: {} });
      expect(failed.status).toBe(500);
      expect(failed.body).toEqual({ error: 'FAILED_TO_APPROVE' });

      await installForward();
      await withC3();
      await openTenantPolicy(ORG_A);
      const id = await newAction();
      await seedOwnPost(id, APPROVER);
      const approved = await call(approveRoute(), { tenant_id: ORG_A, organization_id: ORG_A, action_id: id, passkey: {} });
      expect(approved.status).toBe(200);
      expect(approved.body).toMatchObject({ id, status: 'approved', approved_by: APPROVER });
      const logs = await db.query(
        `SELECT event_payload->>'user_id' AS user_id, event_payload->>'timestamp' AS ts
           FROM public.community_ai_action_logs WHERE action_id = $1 AND event_type = 'approved'`, [id]);
      expect(logs.rows).toEqual([{ user_id: APPROVER, ts: approved.body.approved_at }]);
      // Approved but not yet dispatched: status 'approved' is not a claimable state.
      expect(await claim(id)).toEqual([]);

      const executed = await call(executeRoute(), {
        tenant_id: ORG_A, organization_id: ORG_A, action_id: id, approved: true, execution_mode: 'browser',
      });
      expect(executed.status).toBe(200);
      expect(mockConnector).not.toHaveBeenCalled();
      const row = await db.query(`SELECT status, approved_by, approved_at FROM public.community_ai_actions WHERE id = $1`, [id]);
      // FINDING: a dispatched browser row is back in 'pending' when the extension claims it.
      expect(row.rows[0]).toMatchObject({ status: 'pending', approved_by: APPROVER });
      expect(await claim(id)).toEqual([id]);
    });
  });
});

describe('concurrency (committed fixtures, separate sessions)', () => {
  const url = process.env.W6_DB_URL as string;
  let installedHere = false;
  const ids: string[] = [];

  beforeAll(async () => {
    await seedTenants();
    if (!isPaInstalled(await claimSource())) {
      await db.query('BEGIN');
      await db.query(FORWARD);
      await db.query('COMMIT');
      installedHere = true;
    }
    await newUser(APPROVER);
    hadPlatformRow = (await db.query(`SELECT 1 FROM public.community_ai_platform_policy WHERE organization_id IS NULL`)).rows.length > 0;
    await db.query('BEGIN');
    await openTenantPolicy(ORG_A);
    await db.query('COMMIT');
  });
  let hadPlatformRow = false;
  const approveCommitted = async (id: string) => {
    await db.query('BEGIN');
    await approve(id, APPROVER, AT);
    await db.query('COMMIT');
  };

  afterAll(async () => {
    await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
    if (!hadPlatformRow) await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id IS NULL`);
    if (ids.length) {
      await db.query(`DELETE FROM public.community_ai_action_logs WHERE action_id = ANY($1::uuid[])`, [ids]);
      await db.query(`DELETE FROM public.community_ai_actions WHERE id = ANY($1::uuid[])`, [ids]);
    }
    await db.query(`DELETE FROM public.users WHERE id = $1`, [APPROVER]);
    if (installedHere) {
      await db.query('BEGIN');
      await db.query(ACK_WAIVER);
      await db.query(ACK_DROP);
      await db.query(ROLLBACK);
      await db.query('COMMIT');
      expect(await claimSource()).toBe(priorClaimBody());
    }
  });

  it('(g) two sessions claim the same approved action at once: exactly one wins', async () => {
    const id = await newAction();
    ids.push(id);
    await approveCommitted(id);
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      // Deterministic: c1 holds its claim uncommitted while c2's claim is issued.
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      const r1 = await claim(id, ORG_A, c1, 'lease-c1');
      let settled = false;
      const p2 = claim(id, ORG_A, c2, 'lease-c2').then((r) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 400));
      const blocked = !settled;
      await c1.query('COMMIT');
      const r2 = await p2;
      await c2.query('COMMIT');
      expect(r1).toEqual([id]);
      expect(r2).toEqual([]);
      expect(blocked).toBe(true);
      const { rows } = await db.query(`SELECT dispatch_lease_id FROM public.community_ai_actions WHERE id = $1`, [id]);
      expect(rows).toEqual([{ dispatch_lease_id: 'lease-c1' }]);

      // Unordered: both fire together on fresh rows; exactly one claim per row.
      for (let i = 0; i < 5; i += 1) {
        const rid = await newAction();
        ids.push(rid);
        await approveCommitted(rid);
        const [a, b] = await Promise.all([claim(rid, ORG_A, c1, `la-${i}`), claim(rid, ORG_A, c2, `lb-${i}`)]);
        expect(a.length + b.length).toBe(1);
      }
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });
});
