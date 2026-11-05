/**
 * Wave 1 — community single-execution claim, on REAL PostgreSQL.
 *
 * One approved community action is offered at the same time to every path that
 * can execute it — the manual execute route, the auto-rule service, the
 * community scheduler, the RPA retry flush and the browser-extension claim — and
 * at most ONE external execution happens (connector call, or a browser lease
 * handed to the extension). The guarantee is the atomic conditional UPDATE
 * approved -> executing (claimCommunityActionForExecution, the single claim; the RPA flush uses it too)
 * and, for the browser, claim_community_ai_browser_command; the tests count
 * calls on a stub connector.
 *
 *   - interleaved invocations on one connection (inside a rolled-back
 *     transaction), several rounds with the path order rotated;
 *   - the same race with every path on its OWN connection (committed fixtures,
 *     removed afterwards), several rounds;
 *   - two sessions issuing the claim against one row: the second blocks on the
 *     first's row lock and, once it commits, gets nothing back;
 *   - a refusal after the claim (L-3 recipient recheck) ends 'skipped', and the
 *     lease reaper leaves it alone; an unclaimed 'executing' control is reaped;
 *   - an unapproved / legacy / cancelled / other-tenant / dispatched row cannot
 *     be claimed by any path;
 *   - a lost claim makes no connector call and writes no action log;
 *   - the browser path is unchanged: an executed browser action is written back
 *     'pending' and the extension claims it exactly once.
 *
 * Replaced: playbook lookup/evaluation/validation, the guardrail, the usage gate
 * and ledger, notifications/webhooks, the platform policy service (auto-rules
 * on), the token service, the RPA worker (it pulls in the Redis client), the
 * L-3 recipient recheck (allowed unless a test refuses it) and the LinkedIn
 * connector (counted).
 */

import { AsyncLocalStorage } from 'async_hooks';
import { Client } from 'pg';
import { db, inRollback, ORG_A, ORG_B } from './setup';
import { bindingHashOf } from './helpers/c3ClaimFixtures';
import { randomUUID } from 'crypto';

const mockAls = new AsyncLocalStorage<{ query: (sql: string, params?: unknown[]) => Promise<any> }>();
(global as any).__w1CommunityClient = () => mockAls.getStore();

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => (global as any).__w1CommunityClient() ?? require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => (global as any).__w1CommunityClient() ?? require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: jest.fn(async () => undefined) }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn(async () => ({ access_token: 'tok' })) }));
const PLAYBOOK = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Playbook', status: 'active', execution_modes: { api: true, browser: true } };
jest.mock('../../services/playbooks/playbookService', () => ({
  getPlaybookById: jest.fn(async () => PLAYBOOK),
  listPlaybooks: jest.fn(async () => [PLAYBOOK]),
}));
jest.mock('../../services/playbooks/playbookEvaluator', () => ({
  evaluatePlaybookForEvent: jest.fn(() => ({
    primary_playbook: PLAYBOOK,
    decision: { execution_mode: 'api', tone: { style: 'friendly' } },
  })),
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
// L-3: allowed unless a test refuses it. requireActual keeps
// isRecipientRecheckRefusal (the executor's guard) defined.
const mockRecheck = jest.fn();
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: (...a: any[]) => mockRecheck(...a),
}));
const mockConnector = jest.fn();
jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...a: any[]) => mockConnector(...a),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const mockScope = { org: '' };
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: jest.fn(async () => ({ tenantId: mockScope.org, organizationId: mockScope.org })),
  enforceActionRole: jest.fn(async () => ({ userId: 'human-1' })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { executeAction, claimCommunityActionForExecution } = require('../../services/communityAiActionExecutor');
const { evaluateAutoRules } = require('../../services/communityAiAutoRuleService');
const { runCommunityAiScheduler } = require('../../services/communityAiScheduler');
const { flushRpaRetryQueueForOrg } = require('../../services/rpaWorker/rpaRetryQueue');
const executeHandler = require('../../../pages/api/community-ai/actions/execute').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const url = process.env.W6_DB_URL as string;
const ORG_C = '00000000-0000-4000-8000-0000000000c7'; // committed fixtures only
const TEXT = 'Thanks for sharing';
const ALLOWED = { ok: true, basis: 'recipient_allowed', recipient: null };
const REFUSED = { ok: false, code: 'RECIPIENT_RESTRICTED', reason: 'opted out after approval' };
const ROUNDS = 6;

let seq = 0;
const nextTarget = () => `https://www.linkedin.com/feed/update/urn:li:activity:w1-${process.pid}-${++seq}/`;

beforeEach(() => {
  mockConnector.mockReset();
  mockConnector.mockResolvedValue({ success: true, platform_id: 'urn:li:comment:1' });
  mockRecheck.mockReset();
  mockRecheck.mockResolvedValue(ALLOWED);
});

// ── fixtures ────────────────────────────────────────────────────────────────

type Q = { query: (sql: string, params?: unknown[]) => Promise<any> };

/** The human approver of every seeded approved row (P-A: approved_by is a real user). */
const APPROVER = '00000000-0000-4000-8000-0000000000e7';

async function seedAction(c: Q, org: string, over: Record<string, unknown> = {}): Promise<{ id: string; target: string }> {
  const target = (over.target_id as string) ?? nextTarget();
  const { withoutApprovalEvidence, ...rest } = over as Record<string, unknown> & { withoutApprovalEvidence?: boolean };
  const v = {
    status: 'approved', execution_mode: 'api', approved_at: new Date().toISOString(), cancel_requested_at: null,
    tenant_id: org, ...rest,
  } as Record<string, unknown>;
  // A row with approved_at carries the approval approve.ts records (P-A +
  // C3): approved_by, content hash, passkey evidence, and the 'approved'
  // action log with user_id = approved_by and timestamp = the STORED
  // approved_at (the server stamps it; ISO, ms, UTC). A row seeded with
  // approved_at null, or withoutApprovalEvidence (legacy: approved_at only),
  // carries none of it.
  const evidence = !!v.approved_at && !withoutApprovalEvidence;
  if (evidence) {
    await c.query(`INSERT INTO public.users (id, email, name) VALUES ($1, 'w1-approver@example.invalid', 'w1-approver')
                   ON CONFLICT (id) DO NOTHING`, [APPROVER]);
  }
  const newId = randomUUID();
  const hash = evidence ? bindingHashOf({ id: newId, tenant_id: v.tenant_id as string, organization_id: org, platform: 'linkedin',
    action_type: 'reply', target_id: target, suggested_text: TEXT, playbook_id: PLAYBOOK.id }) : null;
  const { rows } = await c.query(
    `INSERT INTO public.community_ai_actions
       (tenant_id, organization_id, platform, action_type, target_id, suggested_text, status, execution_mode,
        requires_human_approval, risk_level, playbook_id, playbook_name, tone_used, approved_at, scheduled_at,
        cancel_requested_at, approved_by, approved_content_hash, passkey_credential_id, passkey_verified_at, id)
     VALUES ($1,$2,'linkedin','reply',$3,$4,$5,$6,true,'low',$7,'Playbook','friendly',$8,$10,$9,
             $11, $12, $13, CASE WHEN $13::text IS NULL THEN NULL ELSE clock_timestamp() - interval '30 seconds' END, $14)
     RETURNING id, to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS approved_at_iso`,
    // scheduled_at is a timestamp WITHOUT time zone that the scheduler compares
    // with a UTC ISO cutoff: store the UTC wall clock.
    // 'executing' is reached after the approval log exists (the INSERT backstop
    // judges the row as written), as a claim would.
    [v.tenant_id, org, target, TEXT, v.status === 'executing' ? 'approved' : v.status, v.execution_mode, PLAYBOOK.id, v.approved_at, v.cancel_requested_at,
      new Date(Date.now() - 60_000).toISOString(),
      evidence ? APPROVER : null, hash, evidence ? 'cred-w1' : null, newId],
  );
  if (evidence) {
    await c.query(
      `INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
       VALUES ($1, $2, $3, 'approved', $4::jsonb)`,
      [rows[0].id, v.tenant_id, org,
        JSON.stringify({ approved: true, playbook_id: PLAYBOOK.id, intent: null, user_id: APPROVER, timestamp: rows[0].approved_at_iso })],
    );
  }
  if (v.status === 'executing') {
    await c.query(`UPDATE public.community_ai_actions SET status = 'executing' WHERE id = $1`, [rows[0].id]);
  }
  return { id: rows[0].id, target };
}

/** Open execution (platform + tenant rows) through the two-person path; committed. */
const W1_REQUESTER = '00000000-0000-4000-8000-0000000000f1';
const W1_CONFIRMER = '00000000-0000-4000-8000-0000000000f2';
async function openPolicyRow(org: string | null) {
  const where = org === null ? 'organization_id IS NULL' : 'organization_id = $1';
  const p = org === null ? [] : [org];
  if ((await db.query(`SELECT 1 FROM public.community_ai_platform_policy WHERE ${where}`, p)).rows.length === 0) {
    await db.query(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled)
                    VALUES ($1, $1, false, false)`, [org]);
  }
  const n = p.length;
  await db.query(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = true, requested_auto_rules_enabled = true,
                  requested_by = $${n + 1} WHERE ${where}`, [...p, W1_REQUESTER]);
  await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, auto_rules_enabled = true,
                  updated_by = $${n + 1} WHERE ${where}`, [...p, W1_CONFIRMER]);
}
let w1HadPlatformRow = false;
beforeAll(async () => {
  w1HadPlatformRow = (await db.query(`SELECT 1 FROM public.community_ai_platform_policy WHERE organization_id IS NULL`)).rows.length > 0;
  for (const org of [null, ORG_A, ORG_B, ORG_C]) await openPolicyRow(org);
});
afterAll(async () => {
  // Own connection: the harness connection may already be closed by setup's afterAll.
  const c = new Client({ connectionString: process.env.W6_DB_URL as string });
  await c.connect();
  try {
    await c.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = ANY($1::uuid[])`, [[ORG_A, ORG_B, ORG_C]]);
    if (!w1HadPlatformRow) await c.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id IS NULL`);
  } finally {
    await c.end();
  }
});

async function seedRetryRow(c: Q, org: string, actionId: string, target: string) {
  await c.query(
    `INSERT INTO public.rpa_retry_queue (action_id, organization_id, platform, action_type, target_url, text, next_retry_at)
     VALUES ($1,$2,'linkedin','reply',$3,$4, now() - interval '1 minute')`,
    [actionId, org, target, TEXT],
  );
}

async function seedRule(c: Q, org: string) {
  await c.query(
    `INSERT INTO public.community_ai_auto_rules (tenant_id, organization_id, rule_name, condition, action_type, max_risk_level, is_active)
     VALUES ($1,$1,'auto-reply','{}'::jsonb,'reply','medium',true)`, [org]);
}

const rowOf = async (id: string) =>
  (await db.query('SELECT * FROM public.community_ai_actions WHERE id = $1', [id])).rows[0];
const logsOf = async (id: string) =>
  (await db.query('SELECT event_type FROM public.community_ai_action_logs WHERE action_id = $1 ORDER BY created_at', [id])).rows
    .map((r: any) => r.event_type as string);
const connectorCallsFor = (id: string) => mockConnector.mock.calls.filter((c) => c[0]?.id === id).length;

/** Which path performed the one execution, read from the trail it leaves. */
const winners: Record<string, Record<string, number>> = {};
function recordWinner(suite: string, logs: string[]) {
  const w = logs.includes('auto_executed') ? 'autoRule'
    : logs.includes('approved') ? 'manual'
    : logs.includes('executed') ? 'scheduler'
    : 'retry';
  winners[suite] = winners[suite] || {};
  winners[suite][w] = (winners[suite][w] || 0) + 1;
}
afterAll(() => { console.log('w1 single-execution winners: ' + JSON.stringify(winners)); });

// ── the execution paths ─────────────────────────────────────────────────────

const mockRes = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
};

/** pages/api/community-ai/actions/execute (the human "Execute" button). */
async function manualExecute(org: string, id: string, mode = 'api') {
  mockScope.org = org;
  const res = mockRes();
  await executeHandler({ method: 'POST', headers: {}, body: { action_id: id, approved: true, execution_mode: mode } }, res);
  return res;
}

/**
 * communityAiAutoRuleService for a suggestion matching an active rule, on the
 * ingestion worker path (CR-X-01: without autoExecute: true round 3's read
 * path defers before the claim under test).
 */
function autoRule(org: string, target: string) {
  return evaluateAutoRules({
    autoExecute: true,
    tenant_id: org, organization_id: org, platform: 'linkedin',
    suggested_actions: [{
      platform: 'linkedin', action_type: 'reply', target_id: target, suggested_text: TEXT,
      risk_level: 'low', requires_human_approval: false, intent_scores: { question: 0.9 },
    }],
    context: { intent_scores: { question: 0.9 } },
  });
}

/** communityAiScheduler (cron). */
const scheduler = () => runCommunityAiScheduler(new Date(Date.now() + 60_000));

/**
 * The RPA retry flush, with the runner rpaWorkerService.runClaimedRetryAction
 * uses (that module is replaced here because it loads the Redis client): the
 * claimed row through the executor, terminal write compare-and-set from
 * 'executing'.
 */
function retryFlush(org: string) {
  return flushRpaRetryQueueForOrg({
    organization_id: org,
    runAction: (row: Record<string, any>, ctx?: { correlationId: string }) => executeAction({
      id: row.id, tenant_id: row.tenant_id, organization_id: row.organization_id, platform: row.platform,
      action_type: row.action_type, target_id: row.target_id, suggested_text: row.final_text ?? row.suggested_text ?? null,
      playbook_id: row.playbook_id ?? null, requires_human_approval: row.requires_human_approval ?? null,
      risk_level: row.risk_level ?? null, execution_mode: row.execution_mode ?? null, tone_used: row.tone_used ?? null,
      approved_at: row.approved_at ?? null,
    }, true, {
      source: 'scheduler', persist: true, expected_from_statuses: ['executing'],
      // As the real runner: the flush's claim id proves the claim is held (F3).
      correlation_id: ctx?.correlationId, notify: true, webhook: true,
    }),
  });
}

/** The extension's claim (pages/api/extension/commands). */
async function browserClaim(c: Q, org: string, id: string, n: number): Promise<number> {
  const r = await c.query(
    `SELECT * FROM public.claim_community_ai_browser_command($1, $2, $3, $4, 60)`, [id, org, `lease-${n}`, `holder-${n}`]);
  return r.rows.length;
}

type PathName = 'manual' | 'manual2' | 'autoRule' | 'scheduler' | 'retry';
const ALL_PATHS: PathName[] = ['manual', 'manual2', 'autoRule', 'scheduler', 'retry'];
function runPath(p: PathName, org: string, a: { id: string; target: string }): Promise<unknown> {
  switch (p) {
    case 'manual':
    case 'manual2': return manualExecute(org, a.id);
    case 'autoRule': return autoRule(org, a.target);
    case 'scheduler': return scheduler();
    case 'retry': return retryFlush(org);
  }
}
const rotate = <T,>(xs: T[], k: number) => xs.map((_, i) => xs[(i + k) % xs.length]);

/**
 * Race rounds: each path in turn leads, and the others start 0, 5 or 40 ms
 * later, so every path both wins and loses, and losers arrive at every stage
 * of the winner's run (before its claim, during its connector call, after its
 * terminal write).
 */
const LEADERS: PathName[] = ['manual', 'autoRule', 'scheduler', 'retry'];
const STAGGERS_MS = [0, 5, 40];
const RACE_ROUNDS = STAGGERS_MS.flatMap((stagger) => LEADERS.map((leader) => ({ leader, stagger })));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function race(
  round: { leader: PathName; stagger: number },
  start: (p: PathName, i: number) => Promise<unknown>,
): Promise<unknown[]> {
  const others = ALL_PATHS.filter((p) => p !== round.leader);
  const order = [round.leader, ...rotate(others, round.stagger)];
  return Promise.all(order.map(async (p, i) => {
    if (i > 0 && round.stagger > 0) await sleep(round.stagger);
    return start(p, i);
  }));
}

// ── 1. interleaved on one connection ────────────────────────────────────────

describe('single-execution claim: every path at once, interleaved (one connection, rolled back)', () => {
  it.each(RACE_ROUNDS)('leader $leader, others +$stagger ms: exactly one connector call', async (round) => {
    await inRollback(async () => {
      await seedRule(db, ORG_A);
      const a = await seedAction(db, ORG_A);
      await seedRetryRow(db, ORG_A, a.id, a.target);
      await race(round, (p) => runPath(p, ORG_A, a));

      expect(connectorCallsFor(a.id)).toBe(1);
      const row = await rowOf(a.id);
      expect(row.status).toBe('executed');
      const logs = await logsOf(a.id);
      // At most one success trail (the retry flush writes no action log).
      expect(logs.filter((e) => e === 'executed' || e === 'auto_executed').length).toBeLessThanOrEqual(1);
      expect(logs.filter((e) => e === 'failed' || e === 'skipped')).toEqual([]);
      recordWinner('one-connection', logs);
    });
  });
});

// ── 2. every path on its own connection ─────────────────────────────────────

const autocommit = (c: Client): Q => ({
  // The transport wraps each statement in a savepoint for the shared harness
  // transaction; on an autocommit session each statement is its own transaction.
  query: (sql: string, params?: unknown[]) =>
    /^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/i.test(sql) ? Promise.resolve({ rows: [], rowCount: 0 }) : c.query(sql, params),
});

async function cleanupCommitted() {
  await db.query('DELETE FROM public.rpa_retry_queue WHERE organization_id = $1', [ORG_C]);
  await db.query('DELETE FROM public.community_ai_action_logs WHERE organization_id = $1', [ORG_C]);
  await db.query('DELETE FROM public.community_ai_execution_metric_events WHERE organization_id = $1', [ORG_C]);
  await db.query('DELETE FROM public.community_ai_auto_rules WHERE organization_id = $1', [ORG_C]);
  await db.query('DELETE FROM public.community_ai_actions WHERE organization_id = $1', [ORG_C]);
  await db.query('DELETE FROM public.users WHERE id = $1', [APPROVER]);
}

describe('single-execution claim: every path on its own PostgreSQL session (committed fixtures)', () => {
  const sessions: Client[] = [];
  beforeAll(async () => {
    for (let i = 0; i < ALL_PATHS.length + 1; i++) {
      const c = new Client({ connectionString: url, application_name: `w1-community-${i}` });
      await c.connect();
      sessions.push(c);
    }
  });
  afterAll(async () => { await Promise.all(sessions.map((c) => c.end())); });
  beforeEach(cleanupCommitted);
  afterEach(cleanupCommitted);

  it.each(RACE_ROUNDS)('leader $leader, others +$stagger ms: exactly one connector call across sessions', async (round) => {
    await seedRule(db, ORG_C);
    const a = await seedAction(db, ORG_C);
    await seedRetryRow(db, ORG_C, a.id, a.target);
    await race(round, (p, i) => mockAls.run(autocommit(sessions[i]), () => runPath(p, ORG_C, a)));

    expect(connectorCallsFor(a.id)).toBe(1);
    expect((await rowOf(a.id)).status).toBe('executed');
    const logs = await logsOf(a.id);
    expect(logs.filter((e) => e === 'executed' || e === 'auto_executed').length).toBeLessThanOrEqual(1);
    expect(logs.filter((e) => e === 'failed' || e === 'skipped')).toEqual([]);
    recordWinner('own-sessions', logs);
  });

  it('the claim blocks on a concurrent claimant\'s row lock and, once it commits, returns nothing', async () => {
    const a = await seedAction(db, ORG_C);
    const [s1, s2] = sessions;
    await s1.query('BEGIN');
    try {
      const first = await mockAls.run(s1, () =>
        claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_C, organizationId: ORG_C, claimPoint: 'manual' }));
      expect(first).toMatchObject({ claimed: true });
      let settled = false;
      const second = mockAls.run(autocommit(s2), () =>
        claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_C, organizationId: ORG_C, claimPoint: 'manual' }))
        .then((r: unknown) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      const blocked = !settled; // reported, not asserted (timing)
      await s1.query('COMMIT');
      expect(await second).toMatchObject({ claimed: false, code: 'CLAIM_CONFLICT' });
      console.log(`w1 claim race: second claimant blocked on the row lock = ${blocked}`);
    } finally {
      await s1.query('ROLLBACK').catch(() => undefined);
    }
    expect((await rowOf(a.id)).status).toBe('executing');
  });

  it('if the first claimant rolls back, the blocked claim takes the row (one winner either way)', async () => {
    const a = await seedAction(db, ORG_C);
    const [s1, s2] = sessions;
    await s1.query('BEGIN');
    const first = await mockAls.run(s1, () =>
      claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_C, organizationId: ORG_C, claimPoint: 'manual' }));
    expect(first).toMatchObject({ claimed: true });
    const second = mockAls.run(autocommit(s2), () =>
      claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_C, organizationId: ORG_C, claimPoint: 'manual' }));
    await new Promise((r) => setTimeout(r, 200));
    await s1.query('ROLLBACK');
    expect(await second).toMatchObject({ claimed: true });
  });
});

// ── 3. refusal after the claim ──────────────────────────────────────────────

describe('a refusal after the claim ends terminal \'skipped\', never \'executing\' / \'uncertain\'', () => {
  async function reapAfterBackdate(ids: string[]) {
    await db.query(`UPDATE public.community_ai_actions SET updated_at = now() - interval '1 day' WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query('SELECT public.reap_community_ai_action_leases()');
  }

  it.each(['manual', 'scheduler', 'retry', 'autoRule'] as PathName[])('%s: L-3 refuses -> skipped, no connector, not reaped', async (p) => {
    await inRollback(async () => {
      mockRecheck.mockResolvedValue(REFUSED);
      await seedRule(db, ORG_A);
      const a = await seedAction(db, ORG_A);
      if (p === 'retry') await seedRetryRow(db, ORG_A, a.id, a.target);
      // Control: a row a worker left in 'executing' IS reaped to 'uncertain'.
      const control = await seedAction(db, ORG_A, { status: 'executing' });

      await runPath(p, ORG_A, a);

      expect(mockConnector).not.toHaveBeenCalled();
      const after = await rowOf(a.id);
      expect(after.status).toBe('skipped');
      expect(after.execution_result).toMatchObject({ status: 'skipped', reason: 'RECIPIENT_RESTRICTED', may_have_acted: false });
      await reapAfterBackdate([a.id, control.id]);
      expect((await rowOf(a.id)).status).toBe('skipped');
      expect((await rowOf(control.id)).status).toBe('uncertain');
    });
  });
});

// ── 4. what cannot be claimed ───────────────────────────────────────────────

describe('an unapproved, legacy, cancelled, foreign or dispatched action cannot be claimed', () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ['legacy approved row without approved_at', { status: 'approved', approved_at: null }],
    ['pending, never approved', { status: 'pending', approved_at: null }],
    ['pending WITH approved_at (a browser dispatch)', { status: 'pending', execution_mode: 'browser' }],
    ['cancel requested', { cancel_requested_at: new Date().toISOString() }],
    ['already executing (another worker\'s claim)', { status: 'executing' }],
    ['uncertain', { status: 'uncertain' }],
  ];

  it.each(CASES)('%s: both claim statements refuse; no path calls the connector; the row is unchanged', async (_l, over) => {
    await inRollback(async () => {
      await seedRule(db, ORG_A);
      const a = await seedAction(db, ORG_A, over);
      await seedRetryRow(db, ORG_A, a.id, a.target);
      const before = await rowOf(a.id);

      expect(await claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_A, organizationId: ORG_A, claimPoint: 'manual' }))
        .toMatchObject({ claimed: false });
      expect(await claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_A, organizationId: ORG_A, claimPoint: 'rpa_retry' }))
        .toMatchObject({ claimed: false });

      await Promise.all(ALL_PATHS.map((p) => runPath(p, ORG_A, a)));
      expect(connectorCallsFor(a.id)).toBe(0);
      expect(await rowOf(a.id)).toEqual(before);
    });
  });

  it('another tenant\'s scope cannot claim the row', async () => {
    await inRollback(async () => {
      const a = await seedAction(db, ORG_A);
      expect(await claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_B, organizationId: ORG_B, claimPoint: 'manual' }))
        .toMatchObject({ claimed: false, code: 'TENANT_SCOPE_VIOLATION' });
      expect(await claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_B, organizationId: ORG_B, claimPoint: 'rpa_retry' }))
        .toMatchObject({ claimed: false, code: 'TENANT_SCOPE_VIOLATION' });
      const res = await manualExecute(ORG_B, a.id);
      expect(res.statusCode).toBe(403);
      expect(connectorCallsFor(a.id)).toBe(0);
      expect((await rowOf(a.id)).status).toBe('approved');
    });
  });

  it('only \'approved\' is claimable: any other from-status is refused before the UPDATE', async () => {
    await inRollback(async () => {
      const a = await seedAction(db, ORG_A, { status: 'pending' });
      expect(await claimCommunityActionForExecution({ actionId: a.id, tenantId: ORG_A, organizationId: ORG_A, claimPoint: 'manual', fromStatuses: ['pending'] }))
        .toMatchObject({ claimed: false, code: 'CLAIM_STATUS_UNSUPPORTED' });
      expect((await rowOf(a.id)).status).toBe('pending');
    });
  });
});

// ── 5. a lost claim ─────────────────────────────────────────────────────────

describe('a claim lost to another worker: no connector call, no action log, row untouched', () => {
  it('the executor (self-claiming caller) returns CLAIM_LOST and writes nothing to the row or the action log', async () => {
    await inRollback(async () => {
      const a = await seedAction(db, ORG_A, { status: 'executing' });
      const before = await rowOf(a.id);
      const logsBefore = await logsOf(a.id);
      expect(logsBefore).toEqual(['approved']); // the seeded approval of record only
      const r = await executeAction({
        id: a.id, tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin', action_type: 'reply',
        target_id: a.target, suggested_text: TEXT, playbook_id: PLAYBOOK.id, execution_mode: 'api',
        requires_human_approval: true, risk_level: 'low', approved_at: before.approved_at,
      }, true, { source: 'auto', persist: true });
      expect(r).toMatchObject({ ok: false, status: 'skipped', reason: 'CLAIM_LOST', may_have_acted: false });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await rowOf(a.id)).toEqual(before);
      expect(await logsOf(a.id)).toEqual(logsBefore);
      const { rows } = await db.query(
        `SELECT event_type FROM public.community_ai_execution_metric_events WHERE action_id = $1 AND event_type <> 'execution_started'`, [a.id]);
      expect(rows).toEqual([]);
    });
  });

  it('the auto-rule service loses the race to a manual execute: one connector call, no auto_executed log', async () => {
    await inRollback(async () => {
      await seedRule(db, ORG_A);
      const a = await seedAction(db, ORG_A);
      const [manual, rule] = await Promise.all([manualExecute(ORG_A, a.id), autoRule(ORG_A, a.target)]);
      expect(connectorCallsFor(a.id)).toBe(1);
      const logs = await logsOf(a.id);
      const ruleWon = rule.autoExecuted === 1;
      expect((manual as any).statusCode === 200).toBe(!ruleWon);
      expect(logs.filter((e) => e === 'auto_executed')).toHaveLength(ruleWon ? 1 : 0);
      expect(logs.filter((e) => e === 'executed')).toHaveLength(ruleWon ? 0 : 1);
    });
  });

  // Deterministic interleavings, driven from inside the replaced guardrail
  // (which the auto-rule service calls after it has read the row 'approved').
  const guardrail = () => jest.requireMock('../../services/executionGuardrailService').canExecuteAction as jest.Mock;

  it('auto-rule read the row approved, a manual execute then ran it to completion: the rule\'s claim is lost', async () => {
    await inRollback(async () => {
      await seedRule(db, ORG_A);
      const a = await seedAction(db, ORG_A);
      let manual: any;
      guardrail().mockImplementationOnce(async () => { manual = await manualExecute(ORG_A, a.id); return { allowed: true }; });
      const rule = await autoRule(ORG_A, a.target);
      expect(manual.statusCode).toBe(200);
      expect(connectorCallsFor(a.id)).toBe(1);
      expect(rule.autoExecuted).toBe(0);
      expect(rule.actions[0]).toMatchObject({ blocked_reason: 'Action is not awaiting execution' });
      const logs = await logsOf(a.id);
      expect(logs.filter((e) => e === 'auto_executed')).toEqual([]);
      expect(logs.filter((e) => e === 'executed')).toHaveLength(1);
      expect((await rowOf(a.id)).status).toBe('executed');
    });
  });

  it('auto-rule refuses (guardrail) while a manual execute holds the claim mid-connector: the refusal never overwrites it', async () => {
    await inRollback(async () => {
      await seedRule(db, ORG_A);
      const a = await seedAction(db, ORG_A);
      let release!: () => void;
      const inConnector = new Promise<void>((resolveIn) => {
        mockConnector.mockImplementationOnce(async () => {
          resolveIn();
          await new Promise<void>((r) => { release = r; });
          return { success: true, platform_id: 'urn:li:comment:1' };
        });
      });
      let manualRun: Promise<any> | null = null;
      guardrail().mockImplementationOnce(async () => {
        manualRun = manualExecute(ORG_A, a.id);
        await inConnector; // the manual execute now holds 'executing'
        return { allowed: false, reason: 'RATE_LIMIT' };
      });
      const rule = await autoRule(ORG_A, a.target);
      expect(rule.actions[0]).toMatchObject({ blocked_reason: 'RATE_LIMIT' });
      expect((await rowOf(a.id)).status).toBe('executing');
      release();
      const manual = await manualRun!;
      expect(manual.statusCode).toBe(200);
      expect(connectorCallsFor(a.id)).toBe(1);
      expect((await rowOf(a.id)).status).toBe('executed');
    });
  });

  it('a pre-claim refusal by a self-claiming caller never overwrites a row another worker is executing', async () => {
    await inRollback(async () => {
      mockRecheck.mockResolvedValue(REFUSED);
      const a = await seedAction(db, ORG_A, { status: 'executing' });
      const before = await rowOf(a.id);
      await executeAction({
        id: a.id, tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin', action_type: 'reply',
        target_id: a.target, suggested_text: TEXT, playbook_id: PLAYBOOK.id, execution_mode: 'api',
        requires_human_approval: true, risk_level: 'low', approved_at: before.approved_at,
      }, true, { source: 'auto', persist: true });
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await rowOf(a.id)).toEqual(before);
    });
  });

  it('a pre-claim refusal by a self-claiming caller never overwrites a browser row the extension holds', async () => {
    await inRollback(async () => {
      mockRecheck.mockResolvedValue(REFUSED);
      const a = await seedAction(db, ORG_A, { status: 'pending', execution_mode: 'browser' });
      expect(await browserClaim(db, ORG_A, a.id, 1)).toBe(1);
      const before = await rowOf(a.id);
      await executeAction({
        id: a.id, tenant_id: ORG_A, organization_id: ORG_A, platform: 'linkedin', action_type: 'reply',
        target_id: a.target, suggested_text: TEXT, playbook_id: PLAYBOOK.id, execution_mode: 'browser',
        requires_human_approval: true, risk_level: 'low', approved_at: before.approved_at,
      }, true, { source: 'auto', persist: true });
      expect(await rowOf(a.id)).toEqual(before);
    });
  });
});

// ── 6. the browser path ─────────────────────────────────────────────────────

describe('the browser path is unchanged', () => {
  it('an executed browser action is written back pending (unleased, approved) and the extension claims it once', async () => {
    await inRollback(async () => {
      const a = await seedAction(db, ORG_A, { execution_mode: 'browser' });
      const res = await manualExecute(ORG_A, a.id, 'browser');
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ status: 'pending' });
      const row = await rowOf(a.id);
      expect(row).toMatchObject({ status: 'pending', execution_mode: 'browser', dispatch_lease_id: null });
      expect(row.approved_at).not.toBeNull();
      expect(mockConnector).not.toHaveBeenCalled();
      expect(await browserClaim(db, ORG_A, a.id, 1)).toBe(1);
      expect(await browserClaim(db, ORG_A, a.id, 2)).toBe(0);
    });
  });

  it('legacy: a pending browser row with approved_at but no approved_by and no approval log is never claimed by the extension', async () => {
    await inRollback(async () => {
      const a = await seedAction(db, ORG_A, { status: 'pending', execution_mode: 'browser', withoutApprovalEvidence: true });
      const row = await rowOf(a.id);
      expect(row.approved_at).not.toBeNull();
      expect(row.approved_by).toBeNull();
      expect(await logsOf(a.id)).toEqual([]);
      expect(await browserClaim(db, ORG_A, a.id, 1)).toBe(0);
      expect((await rowOf(a.id)).dispatch_lease_id).toBeNull();
    });
  });

  it('a dispatched row held by the extension cannot be executed again by the manual route', async () => {
    await inRollback(async () => {
      const a = await seedAction(db, ORG_A, { status: 'pending', execution_mode: 'browser' });
      expect(await browserClaim(db, ORG_A, a.id, 1)).toBe(1);
      const res = await manualExecute(ORG_A, a.id, 'api');
      expect(res.statusCode).toBe(409);
      expect(mockConnector).not.toHaveBeenCalled();
      expect((await rowOf(a.id))).toMatchObject({ status: 'pending', dispatch_lease_id: 'lease-1' });
    });
  });

  it.each(Array.from({ length: ROUNDS }, (_, i) => i))(
    'round %i: concurrent manual executes (browser, browser, api) then two extension polls: one external execution',
    async (round) => {
      await inRollback(async () => {
        const a = await seedAction(db, ORG_A, { execution_mode: 'browser' });
        const modes = rotate(['browser', 'browser', 'api'], round);
        await Promise.all(modes.map((m) => manualExecute(ORG_A, a.id, m)));
        const leases = (await browserClaim(db, ORG_A, a.id, 1)) + (await browserClaim(db, ORG_A, a.id, 2));
        expect(connectorCallsFor(a.id) + leases).toBe(1);
      });
    },
  );
});
