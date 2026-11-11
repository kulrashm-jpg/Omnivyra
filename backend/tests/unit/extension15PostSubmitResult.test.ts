/**
 * Extension 1.5 post-submit truthful state in /api/extension/action-result
 * (EXTENSION-1.5.0-CONTRACT.md §5.4; conditions agreed with Orchestration):
 *   1. a failure WITHOUT submit_attempted_at stays plain 'failed' (every 1.4 row);
 *   2. a failure AFTER submit_attempted_at is 'uncertain' with error_code
 *      'post_submit_failure' (a new code, not a reaper code) and is never retried;
 *   3. a later report for that row goes through the existing late-result path:
 *      appended as evidence, status unchanged, never revived.
 * Harness: the same in-memory PostgREST fake and real result persistence as
 * extensionDispatchSafety.routes.test.ts.
 */
import { createHash } from 'crypto';
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
function rpcLate(a: any) {
  const row = mockDb.tables.community_ai_actions.find((r) =>
    r.id === a.p_action_id && r.organization_id === a.p_organization_id && r.status === 'uncertain'
    && r.dispatch_lease_id === a.p_lease_id && r.dispatch_lease_holder_id === a.p_holder_id);
  if (!row) return { data: 'not_matched', error: null };
  row.execution_result = { ...(row.execution_result || {}), late_results: [...(row.execution_result?.late_results || []), a.p_report] };
  return { data: 'recorded', error: null };
}
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: async (name: string, args: any) => (name === 'record_community_ai_late_dispatch_result'
      ? rpcLate(args) : { data: null, error: { message: `unknown rpc ${name}` } }),
  },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDb.from(t) }));
let currentSession: { userId: string; orgId: string; hmacNonce: string } | null = null;
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => (currentSession ? { session: currentSession } : null),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false, recordOutcome: () => undefined }));
jest.mock('@/backend/services/engagementOutboundMirrorService', () => ({ mirrorOutboundDmAction: async () => ({ error: null, thread_id: null }) }));
// Run BOTH persist implementations: the production barrel (the runtime copy) and the
// lightweight result service the other route tests use, so they cannot drift apart.
const impl = { which: 'runtime' as 'runtime' | 'service' };
jest.mock('@/backend/services/communityAiActionExecutor', () => {
  const runtime = jest.requireActual('../../services/communityAiActionExecutorRuntime');
  const service = jest.requireActual('../../services/communityAiExecutionResultService');
  return { ...runtime, persistExecutionResult: (i: unknown) => (impl.which === 'runtime' ? runtime : service).persistExecutionResult(i) };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const actionResultHandler = require('../../../pages/api/extension/action-result').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-0000-0000-00000000000a';
const SESSION = { userId: 'user_a', orgId: ORG, hmacNonce: 'nonce-A' };
const HOLDER = createHash('sha256').update(`lease-holder:${SESSION.userId}:${SESSION.orgId}:${SESSION.hmacNonce}`).digest('hex').slice(0, 32);
const ID = '00000000-0000-0000-0000-0000000000c1';

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
async function postResult(body: Record<string, unknown>) {
  currentSession = SESSION;
  const res = mockRes();
  await actionResultHandler({ method: 'POST', headers: {}, body }, res);
  return res;
}
function row(over: Record<string, any> = {}) {
  return {
    id: ID, tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:comment:1',
    suggested_text: 'hello', execution_mode: 'browser', status: 'pending', approved_at: '2026-10-01T00:00:00Z',
    requires_human_approval: false, risk_level: 'low', cancel_requested_at: null,
    dispatch_lease_id: 'lease-1', dispatch_lease_holder_id: HOLDER, dispatch_lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    dispatch_acknowledged_at: null, execution_correlation_id: null, command_chain: null, command_chain_index: 0,
    idempotency_key: null, execution_result: null, created_at: '2026-10-01T00:00:00Z', submit_attempted_at: null,
    ...over,
  };
}
const current = () => mockDb.tables.community_ai_actions.find((r) => r.id === ID)!;

describe.each(['runtime', 'service'] as const)('persist implementation: %s', (which) => {
beforeEach(() => {
  impl.which = which;
  mockDb = createFakeDb({ community_ai_actions: [], extension_sessions: [], community_ai_execution_metric_events: [] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
});

it('1. a failure WITHOUT submit_attempted_at stays plain failed (the 1.4 behaviour)', async () => {
  mockDb.tables.community_ai_actions.push(row());
  const res = await postResult({ commandId: ID, leaseId: 'lease-1', status: 'failed', result: { error_code: 'SELECTOR_NOT_FOUND' } });
  expect(res.statusCode).toBe(200);
  expect(current().status).toBe('failed');
  expect(current().execution_result?.error_code ?? current().execution_result?.response?.error_code).not.toBe('post_submit_failure');
});

it('2. a failure AFTER submit_attempted_at is uncertain with post_submit_failure, never failed', async () => {
  mockDb.tables.community_ai_actions.push(row({ submit_attempted_at: new Date().toISOString() }));
  const res = await postResult({ commandId: ID, leaseId: 'lease-1', status: 'failed', result: { error_code: 'TIMEOUT' } });
  expect(res.statusCode).toBe(200);
  expect(current().status).toBe('uncertain');
  const er = current().execution_result ?? {};
  expect(JSON.stringify(er)).toContain('post_submit_failure');
  expect(JSON.stringify(er)).not.toMatch(/DISPATCH_LEASE_EXPIRED/);
  expect(er.error_code).toBe('post_submit_failure');
  // N2: the lease is retained (as the reaper leaves it) and the row is not claimable
  // again: the claim requires status 'pending' AND dispatch_lease_id IS NULL.
  expect(current().dispatch_lease_id).toBe('lease-1');
  expect(current().dispatch_lease_holder_id).toBe(HOLDER);
  expect(current().status === 'pending' && current().dispatch_lease_id == null).toBe(false);
});

it('3b. a later FAILED report after uncertain is likewise only appended; status unchanged', async () => {
  mockDb.tables.community_ai_actions.push(row({ submit_attempted_at: new Date().toISOString() }));
  await postResult({ commandId: ID, leaseId: 'lease-1', status: 'failed', result: { error_code: 'TIMEOUT' } });
  const res = await postResult({ commandId: ID, leaseId: 'lease-1', status: 'failed', result: { error_code: 'TAB_CLOSED' } });
  expect(current().status).toBe('uncertain');
  expect(res.body).toMatchObject({ status: 'uncertain' });
  expect(current().execution_result?.late_results).toHaveLength(1);
});

it('3. a later success report for that row is only appended as evidence; the row is never revived', async () => {
  mockDb.tables.community_ai_actions.push(row({ submit_attempted_at: new Date().toISOString() }));
  await postResult({ commandId: ID, leaseId: 'lease-1', status: 'failed', result: { error_code: 'TIMEOUT' } });
  expect(current().status).toBe('uncertain');
  const res = await postResult({ commandId: ID, leaseId: 'lease-1', status: 'success', result: { confirmed: true, platform_id: 'urn:li:comment:9' } });
  expect(current().status).toBe('uncertain');
  expect(res.body).toMatchObject({ status: 'uncertain' });
  expect(current().execution_result?.late_results).toHaveLength(1);
});

it('a confirmed success after submit is executed; an unconfirmed one stays sent_unverified', async () => {
  mockDb.tables.community_ai_actions.push(row({ submit_attempted_at: new Date().toISOString() }));
  await postResult({ commandId: ID, leaseId: 'lease-1', status: 'success', result: { confirmed: true } });
  expect(current().status).toBe('executed');
  mockDb = createFakeDb({ community_ai_actions: [row({ submit_attempted_at: new Date().toISOString() })], extension_sessions: [], community_ai_execution_metric_events: [] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  await postResult({ commandId: ID, leaseId: 'lease-1', status: 'success', result: {} });
  expect(current().status).toBe('sent_unverified');
});
});
