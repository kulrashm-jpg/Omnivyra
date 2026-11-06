/**
 * N2 — who resubmitted an approval, recorded in the EXISTING `audit_logs` trail, on REAL
 * PostgreSQL through the real journey → WS-3 path.
 *
 * Replaced: PostgREST (the pg transport, routed per session through AsyncLocalStorage so
 * the concurrency proof runs on separate PostgreSQL sessions), the Redis quota counter, the
 * logger and ONLY the signature check inside the WebAuthn ceremony.
 *
 * What is proved: an accepted resubmission appends exactly one row carrying the server-side
 * requester, tenant, task, the approval it supersedes, the verdict, both binding hashes and
 * a correlation id; a refusal (missing requester, other tenant, rejected / expired / revoked,
 * already awaiting) writes nothing; two sessions racing produce one transition and one row;
 * and a resubmission authorises nothing.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { Client } from 'pg';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
import { enableOutreach, enrol, emailStep, handoffTasks, newProspect, newUser, one, rows } from './helpers/journeyFixtures';

process.env.WEBAUTHN_RP_ID = 'localhost';
process.env.WEBAUTHN_RP_ORIGIN = 'http://localhost:3000';
process.env.SESSION_COOKIE_SECRET = 'n2-realschema-placeholder-secret-0123456789';

const mockAls = new AsyncLocalStorage<{ query: (sql: string, params?: unknown[]) => Promise<any> }>();
(global as any).__n2Client = () => mockAls.getStore();

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => (global as any).__n2Client() ?? require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => (global as any).__n2Client() ?? require('./setup').db;
  return {
    __esModule: true,
    supabase: {
      from: (t: string) => pgTable(client, t),
      rpc: pgRpc(client),
      functions: { invoke: async () => { throw new Error('N2 suite sends nothing'); } },
    },
  };
});
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const mockRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) + by; this.store.set(k, n); return n; },
  async decrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) - by; this.store.set(k, n); return n; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => mockRedis }));
jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual('@simplewebauthn/server'),
  verifyAuthenticationResponse: async (opts: { response: { response: { signature: string } } }) =>
    ({ verified: opts.response.response.signature === 'valid', authenticationInfo: { newCounter: 0 } }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const ws3 = require('../../services/leadOutreachExecution');
const { revokeOutreachApproval } = require('../../services/leadOutreachExecution/approvalRevocation');
const journeyApproval = require('../../services/orchestration/journeyApproval');
const approvalPasskey = require('../../services/leadOutreachExecution/approvalPasskey');
const approvalBinding = require('../../services/leadOutreachExecution/approvalBinding');
/* eslint-enable @typescript-eslint/no-var-requires */

const url = process.env.W6_DB_URL as string;
const ADDRESS = 'person@example.test';
const DAY = 24 * 3_600_000;
const provider = { name: 'supabase_edge_ses', async send() { throw new Error('N2 suite sends nothing'); } };
const adapter = () => createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
});
const sweep = () => advanceAndDispatchWorkflowExecution(ORG_A, { now: new Date().toISOString(), deps: { adapters: [adapter()] } });
const status = async (taskId: string) => String((await one('SELECT status FROM public.outreach_tasks WHERE id = $1', [taskId])).status);
const audits = (taskId: string | null = null) => rows(
  `SELECT actor_user_id::text actor, company_id::text company, action, metadata, created_at FROM public.audit_logs
    WHERE action = 'OUTREACH_APPROVAL_RESUBMITTED' AND ($1::text IS NULL OR metadata->>'task_id' = $1) ORDER BY created_at`, [taskId]);

async function handedOff(address: string = ADDRESS) {
  await seedTenants();
  await enableOutreach(ORG_A, ['email', 'internal']);
  const publisher = await newUser();
  const approver = await newUser();
  const { prospectId, personId } = await newProspect(ORG_A, { email: address });
  const { instanceId } = await enrol(ORG_A, publisher, prospectId, { steps: [emailStep('intro')] });
  await sweep();
  const [task] = await handoffTasks(instanceId);
  expect(task.status).toBe('awaiting_approval');
  for (const u of [publisher, approver]) {
    await db.query(`INSERT INTO public.webauthn_credentials (user_id, credential_id, public_key) VALUES ($1, $2, '\\x00')`, [u, `cred-${u}`]);
  }
  return { publisher, approver, prospectId, personId: String(personId), taskId: String(task.id) };
}
const assertion = (user: string, challenge: string) => ({
  id: `cred-${user}`, rawId: `cred-${user}`, type: 'public-key', clientExtensionResults: {},
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost:3000' })).toString('base64url'), signature: 'valid', authenticatorData: 'AA', userHandle: null },
});
async function tenantApprove(taskId: string, user: string) {
  const b = await journeyApproval.beginTenantJourneyApproval({ organizationId: ORG_A, taskId, approverUserId: user });
  expect(b.ok).toBe(true);
  return journeyApproval.approveTenantJourneyTask({
    organizationId: ORG_A, taskId, approverUserId: user, expectedContentHash: b.contentHash, passkey: assertion(user, String(b.passkeyOptions.challenge)),
  });
}
async function serviceApprove(taskId: string, user: string, extra: Record<string, unknown> = {}) {
  const task = await ws3.getOutreachTaskById(ORG_A, taskId);
  const binding = await approvalBinding.computeApprovalBinding(ORG_A, task);
  const ceremony = { userId: user, organizationId: ORG_A, taskId, action: 'approve', bindingHash: binding.hash };
  const opts = await approvalPasskey.beginApprovalPasskey(ceremony);
  const v = await approvalPasskey.verifyApprovalPasskey(ceremony, assertion(user, String(opts.challenge)));
  return ws3.approveOutreachTask(ORG_A, taskId, { approverUserId: user, ...extra, passkeyProof: v.proof });
}
/** The content changes after approval: the canonical person's name, which the email renders. */
const editContent = (personId: string) => db.query(`UPDATE public.unified_persons SET first_name = 'Renamed' WHERE id = $1`, [personId]);

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { mockRedis.store.clear(); });

describe('N2 — the resubmission audit row (real PostgreSQL)', () => {
  it('the trail exists with the columns the row needs (no new store)', async () => {
    const cols = await rows(`SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name IN ('actor_user_id', 'action', 'company_id', 'metadata', 'created_at') ORDER BY 1`);
    expect(cols.map((c) => [c.column_name, c.data_type])).toEqual([
      ['action', 'text'], ['actor_user_id', 'uuid'], ['company_id', 'uuid'], ['created_at', 'timestamp with time zone'], ['metadata', 'jsonb'],
    ]);
  });

  it('authorised requester, content revision changed: one row; the resubmission authorises nothing', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(s.taskId, s.approver)).toMatchObject({ ok: true });
      const approval = await one(`SELECT id::text id, approved_content_hash FROM public.outreach_approvals WHERE task_id = $1`, [s.taskId]);
      await editContent(s.personId);
      expect(await journeyApproval.resubmitTenantJourneyTask({ organizationId: ORG_A, taskId: s.taskId, approverUserId: s.approver, reason: 'name fixed' }))
        .toEqual({ ok: true, status: 'awaiting_approval' });
      expect(await status(s.taskId)).toBe('awaiting_approval');
      const found = await audits(s.taskId);
      expect(found).toHaveLength(1);
      const [row] = found;
      expect(row).toMatchObject({ actor: s.approver, company: ORG_A, action: 'OUTREACH_APPROVAL_RESUBMITTED' });
      expect(row.metadata).toMatchObject({
        schema: 'outreach.approval.resubmission.v1', task_id: s.taskId, requester_user_id: s.approver, tier: 'tenant',
        approval_id: approval.id, approval_decision: 'approved', previous_status: 'approved', new_status: 'awaiting_approval',
        previous_verdict: 'stale', previous_content_hash: approval.approved_content_hash, reason: 'name fixed', authorises_execution: false,
      });
      const meta = row.metadata as Record<string, unknown>;
      expect(meta.current_content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(meta.current_content_hash).not.toBe(approval.approved_content_hash);
      expect(meta.correlation_id).toEqual(expect.any(String));
      expect(JSON.stringify(row)).not.toMatch(/person@example|Renamed/);
      // Not an approval: the log still has the one approval, and the dispatch gate refuses.
      expect(Number((await one('SELECT count(*)::int n FROM public.outreach_approvals WHERE task_id = $1', [s.taskId])).n)).toBe(1);
      ws3.__clearTransportsForTests();
      ws3.registerDefaultTransports({ emailProvider: provider });
      const refused = await ws3.dispatchInternalOutreachTask(ORG_A, s.taskId, { recipient: ADDRESS });
      expect(refused.ok).toBe(false);
      expect(refused.governance?.blockingCondition).toBe('eligibility.not_approved');
      expect(Number((await one('SELECT count(*)::int n FROM public.outreach_attempts WHERE task_id = $1', [s.taskId])).n)).toBe(0);
      // Duplicate: the existing already-awaiting no-op, no second row.
      expect(await approvalBinding.requestFreshApproval(ORG_A, s.taskId, undefined, { userId: s.publisher }))
        .toEqual({ ok: true, status: 'awaiting_approval', reason: 'already awaiting approval' });
      expect(await audits(s.taskId)).toHaveLength(1);
    });
  });

  it('missing requester context and cross-tenant: refused, unchanged, nothing recorded', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect(await tenantApprove(s.taskId, s.approver)).toMatchObject({ ok: true });
      await editContent(s.personId);
      for (const requester of [undefined, { userId: '' }, { userId: 'not-a-uuid' }]) {
        expect(await approvalBinding.requestFreshApproval(ORG_A, s.taskId, undefined, requester))
          .toMatchObject({ ok: false, status: 'approved', reason: expect.stringMatching(/no attributable requester/) });
      }
      expect(await journeyApproval.resubmitTenantJourneyTask({ organizationId: ORG_B, taskId: s.taskId, approverUserId: s.approver }))
        .toMatchObject({ ok: false, code: 'task_not_found' });
      expect(await approvalBinding.requestFreshApproval(ORG_B, s.taskId, undefined, { userId: s.approver }))
        .toMatchObject({ ok: false, status: null });
      expect(await status(s.taskId)).toBe('approved');
      expect(await audits()).toHaveLength(0);
    });
  });

  it('after rejection, expiry and revocation the lifecycle refuses; nothing recorded', async () => {
    await inRollback(async () => {
      const rejected = await handedOff();
      expect((await ws3.rejectOutreachTask(ORG_A, rejected.taskId, { approverUserId: rejected.approver, reason: 'no' })).ok).toBe(true);
      expect(await journeyApproval.resubmitTenantJourneyTask({ organizationId: ORG_A, taskId: rejected.taskId, approverUserId: rejected.approver }))
        .toMatchObject({ ok: false, code: 'decision_refused', reason: expect.stringMatching(/"rejected" has no approval to resubmit/) });

      const lapsed = await handedOff('lapsed@example.test');
      expect((await serviceApprove(lapsed.taskId, lapsed.approver, { decidedAt: new Date(Date.now() - 8 * DAY).toISOString() })).ok).toBe(true);
      await editContent(lapsed.personId);
      expect(await journeyApproval.resubmitTenantJourneyTask({ organizationId: ORG_A, taskId: lapsed.taskId, approverUserId: lapsed.approver }))
        .toMatchObject({ ok: false, reason: expect.stringMatching(/is expired, not stale/) });
      expect(await status(lapsed.taskId)).toBe('approved');

      const revoked = await handedOff('revoked@example.test');
      expect(await tenantApprove(revoked.taskId, revoked.approver)).toMatchObject({ ok: true });
      expect((await revokeOutreachApproval(ORG_A, revoked.taskId, { approverUserId: revoked.approver, tier: 'tenant' })).ok).toBe(true);
      expect(await journeyApproval.resubmitTenantJourneyTask({ organizationId: ORG_A, taskId: revoked.taskId, approverUserId: revoked.approver }))
        .toMatchObject({ ok: false, reason: expect.stringMatching(/"cancelled" has no approval to resubmit/) });
      expect(await audits()).toHaveLength(0);
    });
  });
});

// ── concurrency: committed fixtures, one PostgreSQL session per requester ────

describe('N2 — concurrent resubmission on separate sessions: one transition, one row', () => {
  const ORG_N = '00000000-0000-4000-8000-0000000000c4';
  const sessions: Client[] = [];
  const made = { users: [] as string[], persons: [] as string[] };
  const autocommit = (c: Client) => ({
    query: (sql: string, params?: unknown[]) =>
      /^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/i.test(sql) ? Promise.resolve({ rows: [], rowCount: 0 }) : c.query(sql, params),
  });
  const waitingOnLock = async (c: Client) => {
    const pid = (c as any).processID;
    for (let i = 0; i < 200; i += 1) {
      const { rows: r } = await db.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
      if (r[0]?.wait_event_type === 'Lock') return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  };

  /** A committed internal task with a committed approval whose content then changed (stale). */
  async function committedStaleTask(): Promise<string> {
    await db.query('BEGIN');
    try {
      const { prospectId, personId } = await newProspect(ORG_N);
      made.persons.push(personId);
      const ins = await ws3.insertOutreachTask({
        companyId: ORG_N, leadId: prospectId, personId: null, planTaskId: `n2-${Date.now()}-${Math.random()}`, taskOrder: 1,
        kind: 'outreach', action: 'Call back', channel: 'internal', dependsOnPlanTaskId: null, estimatedDelayHours: 0,
        confidence: null, explanation: null, requiresApproval: true, plannerVersion: 'lie-2.1.0', translationVersion: ws3.TRANSLATION_VERSION,
        governanceVersion: ws3.GOVERNANCE_VERSION, executionRuntimeVersion: ws3.EXECUTION_RUNTIME_VERSION, materializedAt: new Date().toISOString(),
      });
      const taskId = String(ins.data.id);
      expect((await ws3.submitForApproval(ORG_N, taskId)).ok).toBe(true);
      expect((await ws3.approveOutreachTask(ORG_N, taskId, { approverUserId: made.users[0] })).ok).toBe(true);
      await db.query(`UPDATE public.outreach_tasks SET action = 'Call back about something else' WHERE id = $1`, [taskId]);
      await db.query('COMMIT');
      return taskId;
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  }

  beforeAll(async () => {
    for (let i = 0; i < 2; i += 1) {
      const c = new Client({ connectionString: url, application_name: `n2-resubmit-${i}` });
      await c.connect();
      sessions.push(c);
    }
    await db.query('BEGIN');
    await db.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'N2 concurrency') ON CONFLICT (id) DO NOTHING`, [ORG_N]);
    await enableOutreach(ORG_N, ['internal']);
    made.users.push(await newUser(), await newUser());
    await db.query('COMMIT');
  });
  afterAll(async () => {
    await Promise.all(sessions.map((c) => c.end().catch(() => undefined)));
    // The outreach logs are append-only by trigger; the disposable test database is cleaned as a replica.
    const c = new Client({ connectionString: url });
    await c.connect();
    // Tolerant: a table this base lacks must not mask the test result.
    const del = (sql: string, params: unknown[]) => c.query(sql, params).catch((e: Error) => console.warn(`n2 cleanup: ${e.message}`));
    try {
      await c.query(`SET session_replication_role = replica`);
      await del(`DELETE FROM public.audit_logs WHERE company_id = $1`, [ORG_N]);
      for (const t of ['outreach_decisions', 'outreach_approvals', 'outreach_attempts', 'outreach_internal_work_items']) {
        await del(`DELETE FROM public.${t} WHERE company_id = $1`, [ORG_N]);
      }
      await del(`DELETE FROM public.outreach_tasks WHERE company_id = $1`, [ORG_N]);
      await del(`DELETE FROM public.canonical_leads WHERE company_id = $1`, [ORG_N]);
      await del(`DELETE FROM public.canonical_users WHERE company_id = $1`, [ORG_N]);
      await del(`DELETE FROM public.unified_persons WHERE company_id = $1`, [ORG_N]);
      await del(`DELETE FROM public.outreach_governance_config WHERE company_id = $1`, [ORG_N]);
      await del(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [made.users]);
      await del(`DELETE FROM public.companies WHERE id = $1`, [ORG_N]);
    } finally {
      await c.end();
    }
  });

  it('session 1 holds its accepted transition uncommitted; session 2 blocks, then loses and records nothing', async () => {
    const taskId = await committedStaleTask();
    const [s1, s2] = sessions;
    const [u1, u2] = made.users;
    await s1.query('BEGIN');
    let second: Promise<any> | null = null;
    try {
      const first = await mockAls.run(s1, () => approvalBinding.requestFreshApproval(ORG_N, taskId, undefined, { userId: u1 }));
      expect(first).toMatchObject({ ok: true, status: 'awaiting_approval' });
      expect(first.auditFailed).toBeUndefined();
      second = mockAls.run(autocommit(s2), () => approvalBinding.requestFreshApproval(ORG_N, taskId, undefined, { userId: u2 }));
      expect(await waitingOnLock(s2)).toBe(true);
      await s1.query('COMMIT');
      expect(await second).toMatchObject({ ok: false, reason: 'task is no longer approved' });
    } finally {
      await s1.query('ROLLBACK').catch(() => undefined);
      if (second) await second.catch(() => undefined);
    }
    expect(await status(taskId)).toBe('awaiting_approval');
    const found = await audits(taskId);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ actor: u1, company: ORG_N });
  });

  it('unordered: both sessions fire together on fresh tasks; exactly one row per accepted transition', async () => {
    const [u1, u2] = made.users;
    for (let i = 0; i < 4; i += 1) {
      const taskId = await committedStaleTask();
      const results = await Promise.all([
        mockAls.run(autocommit(sessions[0]), () => approvalBinding.requestFreshApproval(ORG_N, taskId, undefined, { userId: u1 })),
        mockAls.run(autocommit(sessions[1]), () => approvalBinding.requestFreshApproval(ORG_N, taskId, undefined, { userId: u2 })),
      ]);
      const accepted = results.filter((r: any) => r.ok && r.reason !== 'already awaiting approval');
      expect(accepted).toHaveLength(1);
      expect(await status(taskId)).toBe('awaiting_approval');
      expect(await audits(taskId)).toHaveLength(1);
    }
  });
});
