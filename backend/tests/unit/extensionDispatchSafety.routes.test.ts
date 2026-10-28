/**
 * Extension dispatch safety — /api/extension/commands, /api/extension/action-result,
 * the lease reaper outcome, and the never-revive persist guard.
 *
 * Defects covered (each test names the defect it pins):
 *   D1  a lapsed claim must become 'uncertain' (never 'failed'), its late
 *       result must be RECORDED (not rejected-and-forgotten), and a terminal
 *       row must never be revived to 'pending'.
 *   D2  a lapsed lease is never re-offered — to a legacy client (no
 *       x-omnivyra-dispatch-renewal header) or to anyone else.
 *   D3  the claim enforces cancellation, the platform kill switch and
 *       approval, atomically (also when they change between read and claim).
 *
 * The database is the in-memory PostgREST fake (helpers/communityExecutionFakeDb).
 * The three SQL functions of 20261231000005 are emulated below with exactly the
 * predicates the migration contract test pins (extensionDispatchSafety.migration).
 */
import { createHash } from 'crypto';
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
const policy = { execution_enabled: true, require_human_approval: false };
/** Hook run inside the claim RPC before its predicate is evaluated (race injection). */
let beforeClaim: ((args: any) => void) | null = null;
/** Hook run before the action-result persist (reaper race injection). */
let beforePersist: (() => void) | null = null;
const rpcCalls: string[] = [];

function nowIso() { return new Date().toISOString(); }

/** Emulates claim_community_ai_browser_command (one atomic UPDATE ... RETURNING). */
function rpcClaim(a: any) {
  if (beforeClaim) beforeClaim(a);
  if (!policy.execution_enabled) return { data: [], error: null };
  const row = mockDb.tables.community_ai_actions.find((r) =>
    r.id === a.p_action_id
    && r.organization_id === a.p_organization_id
    && r.status === 'pending'
    && r.execution_mode === 'browser'
    && (r.dispatch_lease_id ?? null) === null
    && (r.cancel_requested_at ?? null) === null
    && (r.approved_at != null
      || (r.requires_human_approval !== true && (r.risk_level ?? '') !== 'high' && !policy.require_human_approval)));
  if (!row) return { data: [], error: null };
  row.dispatch_lease_id = a.p_lease_id;
  row.dispatch_lease_holder_id = a.p_holder_id;
  row.dispatch_lease_expires_at = new Date(Date.now() + a.p_lease_ttl_seconds * 1000).toISOString();
  return { data: [{ id: row.id, dispatch_lease_expires_at: row.dispatch_lease_expires_at }], error: null };
}

/** Emulates record_community_ai_late_dispatch_result (status never changes). */
function rpcLate(a: any) {
  const row = mockDb.tables.community_ai_actions.find((r) =>
    r.id === a.p_action_id && r.organization_id === a.p_organization_id && r.status === 'uncertain'
    && r.dispatch_lease_id === a.p_lease_id && r.dispatch_lease_holder_id === a.p_holder_id
    && ((r.execution_result?.late_results ?? []).length < 20));
  if (!row) return { data: 'not_matched', error: null };
  const er = { ...(row.execution_result || {}) };
  er.late_results = [...(er.late_results || []), { ...a.p_report, received_at: nowIso() }];
  row.execution_result = er;
  return { data: 'recorded', error: null };
}

/** Emulates the reaper's lease phases (uncertain; lease id/holder kept). */
function reap() {
  for (const r of mockDb.tables.community_ai_actions) {
    const expired = r.dispatch_lease_expires_at != null && r.dispatch_lease_expires_at < nowIso();
    if ((r.status === 'pending' && r.execution_mode === 'browser' && expired)
      || (['dispatched', 'acknowledged'].includes(r.status) && expired)) {
      r.execution_result = {
        source: 'lease_reaper', status: 'uncertain', may_have_acted: true,
        error_code: r.status === 'pending' ? 'DISPATCH_LEASE_EXPIRED' : 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT',
        prior_status: r.status,
      };
      r.status = 'uncertain';
    }
  }
}

jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: async (name: string, args: any) => {
      rpcCalls.push(name);
      if (name === 'claim_community_ai_browser_command') return rpcClaim(args);
      if (name === 'record_community_ai_late_dispatch_result') return rpcLate(args);
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
  },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const q = mockDb.from(t);
    if (t !== 'community_ai_actions' || !beforePersist) return q;
    const origUpdate = q.update;
    q.update = (p: any) => { const hook = beforePersist; beforePersist = null; if (hook) hook(); return origUpdate(p); };
    return q;
  },
}));

let currentSession: { userId: string; orgId: string; hmacNonce: string } | null = null;
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => (currentSession ? { session: currentSession } : null),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'browser' }),
  CAPABILITY_MAP_VERSION: 'cap-v1',
}));
jest.mock('@/backend/services/extensionReliabilityService', () => ({
  isCurrentlyDisabled: () => false,
  recordOutcome: () => undefined,
}));
jest.mock('@/backend/services/extensionCommandSchema', () => ({
  validateCommandPayload: (_p: string, _a: string, payload: unknown) => ({ ok: true, payload }),
  COMMAND_SCHEMA_VERSION: 1,
}));
jest.mock('@/backend/services/rpaWorker/rpaAccountTier', () => ({ resolveAccountTier: async () => null }));
jest.mock('@/backend/services/engagementOutboundMirrorService', () => ({
  mirrorOutboundDmAction: async () => ({ error: null, thread_id: null }),
}));
// action-result persists through the executor barrel; the lightweight result
// service has the identical persist contract (and the same never-revive guard).
jest.mock('@/backend/services/communityAiActionExecutor', () =>
  jest.requireActual('../../services/communityAiExecutionResultService'));

/* eslint-disable @typescript-eslint/no-var-requires */
const commandsHandler = require('../../../pages/api/extension/commands').default;
const actionResultHandler = require('../../../pages/api/extension/action-result').default;
const { persistExecutionResult } = require('../../services/communityAiExecutionResultService');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';
const SESSION_A = { userId: 'user_a', orgId: ORG, hmacNonce: 'nonce-A' };
const SESSION_B = { userId: 'user_b', orgId: ORG, hmacNonce: 'nonce-B' };
const holderFor = (s: { userId: string; orgId: string; hmacNonce: string }) =>
  createHash('sha256').update(`lease-holder:${s.userId}:${s.orgId}:${s.hmacNonce}`).digest('hex').slice(0, 32);

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}

async function poll(session = SESSION_A, headers: Record<string, string> = {}) {
  currentSession = session;
  const res = mockRes();
  await commandsHandler({ method: 'GET', headers: { 'x-omnivyra-capability-version': 'cap-v1', ...headers }, body: {} }, res);
  return res;
}

async function postResult(body: Record<string, unknown>, session = SESSION_A) {
  currentSession = session;
  const res = mockRes();
  await actionResultHandler({ method: 'POST', headers: {}, body }, res);
  return res;
}

function actionRow(over: Record<string, any> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000c1',
    tenant_id: ORG, organization_id: ORG,
    platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:comment:1',
    suggested_text: 'hello', execution_mode: 'browser', status: 'pending',
    approved_at: '2026-10-01T00:00:00Z', requires_human_approval: false, risk_level: 'low',
    cancel_requested_at: null,
    dispatch_lease_id: null, dispatch_lease_holder_id: null, dispatch_lease_expires_at: null,
    dispatch_acknowledged_at: null, execution_correlation_id: null,
    command_chain: null, command_chain_index: 0,
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const rowById = (id = '00000000-0000-0000-0000-0000000000c1') =>
  mockDb.tables.community_ai_actions.find((r) => r.id === id)!;
const past = (ms = 60_000) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [], extension_sessions: [], community_ai_execution_metric_events: [] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  policy.execution_enabled = true;
  policy.require_human_approval = false;
  beforeClaim = null;
  beforePersist = null;
  rpcCalls.length = 0;
  currentSession = null;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D2 — a claimed command is never re-offered, to any client', () => {
  it('claims a never-claimed command through the atomic claim RPC', async () => {
    mockDb.tables.community_ai_actions.push(actionRow());
    const res = await poll();
    expect(res.statusCode).toBe(200);
    expect(res.body.commands).toHaveLength(1);
    expect(rpcCalls).toEqual(['claim_community_ai_browser_command']);
    expect(rowById().dispatch_lease_holder_id).toBe(holderFor(SESSION_A));
  });

  it('old client WITHOUT the renewal header: a lapsed lease is not re-offered', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({
      dispatch_lease_id: 'lease-old', dispatch_lease_holder_id: holderFor(SESSION_A), dispatch_lease_expires_at: past(),
    }));
    const res = await poll(SESSION_B);           // no x-omnivyra-dispatch-renewal
    expect(res.body.commands).toHaveLength(0);
    expect(rowById().dispatch_lease_holder_id).toBe(holderFor(SESSION_A));
  });

  it('renewal-capable client: same rule', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({
      dispatch_lease_id: 'lease-old', dispatch_lease_holder_id: holderFor(SESSION_A), dispatch_lease_expires_at: past(),
    }));
    const res = await poll(SESSION_B, { 'x-omnivyra-dispatch-renewal': '1' });
    expect(res.body.commands).toHaveLength(0);
  });

  it('extension worst case (96s) outliving the 90s lease: polled for 15 minutes → exactly one claim', async () => {
    mockDb.tables.community_ai_actions.push(actionRow());
    let claims = 0;
    for (let i = 0; i < 15; i++) {
      const res = await poll(i % 2 ? SESSION_B : SESSION_A);
      claims += res.body.commands.length;
      // the lease lapses between polls (no renewal, no result)
      rowById().dispatch_lease_expires_at = past(1_000);
      if (i === 3) reap();
    }
    expect(claims).toBe(1);
    expect(rowById().status).toBe('uncertain');
  });

  it('a claim race: two sessions polling concurrently → one claim', async () => {
    mockDb.tables.community_ai_actions.push(actionRow());
    const [a, b] = await Promise.all([poll(SESSION_A), poll(SESSION_B)]);
    expect(a.body.commands.length + b.body.commands.length).toBe(1);
  });

  it('another tenant\'s command is never offered', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({ organization_id: OTHER_ORG, tenant_id: OTHER_ORG }));
    expect((await poll()).body.commands).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D3 — cancellation, kill switch and approval are enforced at the claim', () => {
  it('a cancelled command is not offered', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({ cancel_requested_at: past() }));
    expect((await poll()).body.commands).toHaveLength(0);
    expect(rowById().dispatch_lease_id).toBeNull();
  });

  it('cancellation race: cancelled after the read, before the claim → not claimed', async () => {
    mockDb.tables.community_ai_actions.push(actionRow());
    beforeClaim = () => { rowById().cancel_requested_at = nowIso(); };
    expect((await poll()).body.commands).toHaveLength(0);
    expect(rowById().dispatch_lease_id).toBeNull();
  });

  it('kill switch on → nothing is claimed', async () => {
    mockDb.tables.community_ai_actions.push(actionRow());
    policy.execution_enabled = false;
    expect((await poll()).body.commands).toHaveLength(0);
    expect(rowById().dispatch_lease_id).toBeNull();
  });

  it('kill switch activated between read and claim → not claimed', async () => {
    mockDb.tables.community_ai_actions.push(actionRow());
    beforeClaim = () => { policy.execution_enabled = false; };
    expect((await poll()).body.commands).toHaveLength(0);
  });

  it('approval required but missing → not claimed', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({ requires_human_approval: true, approved_at: null }));
    expect((await poll()).body.commands).toHaveLength(0);
  });

  it('approval revoked between read and claim → not claimed', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({ requires_human_approval: true }));
    beforeClaim = () => { rowById().approved_at = null; };
    expect((await poll()).body.commands).toHaveLength(0);
  });

  it('high-risk without approval, and global require_human_approval without approval → not claimed', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({ risk_level: 'high', approved_at: null }));
    expect((await poll()).body.commands).toHaveLength(0);
    rowById().risk_level = 'low';
    policy.require_human_approval = true;
    expect((await poll()).body.commands).toHaveLength(0);
    rowById().approved_at = nowIso();
    expect((await poll()).body.commands).toHaveLength(1);
  });

  it('a claim RPC error fails closed (nothing offered)', async () => {
    mockDb.tables.community_ai_actions.push(actionRow());
    beforeClaim = () => { throw new Error('rpc down'); };
    const res = await poll();
    expect(res.statusCode).toBe(500);
    expect(rowById().dispatch_lease_id).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D1 — expired lease / crash / timeout: uncertain, recorded, never revived', () => {
  async function claimOne() {
    mockDb.tables.community_ai_actions.push(actionRow());
    const res = await poll();
    return res.body.commands[0] as { id: string; lease: { id: string } };
  }

  it('crash: no result arrives, lease lapses, reaper → uncertain with lease id/holder kept', async () => {
    await claimOne();
    rowById().dispatch_lease_expires_at = past();
    reap();
    const r = rowById();
    expect(r.status).toBe('uncertain');
    expect(r.execution_result).toMatchObject({ may_have_acted: true, error_code: 'DISPATCH_LEASE_EXPIRED' });
    expect(r.dispatch_lease_holder_id).toBe(holderFor(SESSION_A));
    expect((await poll(SESSION_B)).body.commands).toHaveLength(0);
  });

  it('late result AFTER the reaper is recorded (reconciliation), status stays uncertain', async () => {
    const cmd = await claimOne();
    rowById().dispatch_lease_expires_at = past();
    reap();
    const res = await postResult({ commandId: cmd.id, leaseId: cmd.lease.id, status: 'success', result: { success: true, confirmed: true, platform_id: 'urn:li:comment:99' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'uncertain', reconciliation: 'recorded', review_required: true });
    const r = rowById();
    expect(r.status).toBe('uncertain');
    expect(r.execution_result.late_results).toHaveLength(1);
    expect(r.execution_result.late_results[0]).toMatchObject({ reported_status: 'success', confirmed: true, platform_id: 'urn:li:comment:99' });
  });

  it('late result from a different holder is refused and nothing is recorded', async () => {
    const cmd = await claimOne();
    rowById().dispatch_lease_expires_at = past();
    reap();
    const res = await postResult({ commandId: cmd.id, leaseId: cmd.lease.id, status: 'success', result: { confirmed: true } }, SESSION_B);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('LEASE_HOLDER_MISMATCH');
    expect(rowById().execution_result.late_results).toBeUndefined();
  });

  it('late result after lease expiry but BEFORE the reaper is accepted (never re-offered ⇒ only this holder acted)', async () => {
    const cmd = await claimOne();
    rowById().dispatch_lease_expires_at = past();
    const res = await postResult({ commandId: cmd.id, leaseId: cmd.lease.id, status: 'success', result: { confirmed: true } });
    expect(res.statusCode).toBe(200);
    expect(rowById().status).toBe('executed');
  });

  it('reaper wins the race between the result read and its write → recorded as late result', async () => {
    const cmd = await claimOne();
    rowById().dispatch_lease_expires_at = past();
    beforePersist = () => reap();
    const res = await postResult({ commandId: cmd.id, leaseId: cmd.lease.id, status: 'failed', result: { error_code: 'TIMEOUT' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.reconciliation).toBe('recorded');
    expect(rowById().status).toBe('uncertain');
    expect(rowById().execution_result.late_results[0]).toMatchObject({ reported_status: 'failed', error_code: 'TIMEOUT' });
  });

  it('chain intermediate success on a reaped row does NOT revive it to pending', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({
      action_type: 'dm', command_chain: [{ action_type: 'open_thread' }, { action_type: 'continue_thread' }], command_chain_index: 0,
    }));
    const cmd = (await poll()).body.commands[0];
    rowById().dispatch_lease_expires_at = past();
    reap();
    const res = await postResult({ commandId: cmd.id, leaseId: cmd.lease.id, status: 'success', result: { confirmed: true } });
    expect(res.statusCode).toBe(200);
    expect(rowById().status).toBe('uncertain');
    expect(rowById().command_chain_index).toBe(0);
    expect((await poll(SESSION_B)).body.commands).toHaveLength(0);
  });

  it('terminal rows (incl. uncertain) are never revived by a persist without an expected state', async () => {
    for (const status of ['failed', 'uncertain', 'executed', 'skipped', 'blocked', 'sent_unverified']) {
      mockDb = createFakeDb({ community_ai_actions: [actionRow({ status })] });
      const out = await persistExecutionResult({
        actionId: rowById().id, organizationId: ORG, correlationId: 'c1',
        result: { ok: true, status: 'dispatched', execution_mode: 'browser' },
        rowHint: { platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:comment:1' },
      });
      expect(out.ok).toBe(false);
      expect(rowById().status).toBe(status);
    }
  });

  it('pre-claim failure write never overwrites a row another session claimed meanwhile', async () => {
    mockDb.tables.community_ai_actions.push(actionRow({ dispatch_lease_id: 'lease-X', dispatch_lease_holder_id: 'h' }));
    const out = await persistExecutionResult({
      actionId: rowById().id, organizationId: ORG, correlationId: 'c1',
      result: { ok: false, status: 'failed', error: 'INVALID_COMMAND_PAYLOAD' },
      expectedFromStatuses: ['pending'], requireUnleased: true,
    });
    expect(out.ok).toBe(false);
    expect(rowById().status).toBe('pending');
    expect(rowById().dispatch_lease_id).toBe('lease-X');
  });
});
