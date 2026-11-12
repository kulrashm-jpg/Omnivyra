/**
 * Plan usage of a BROWSER-dispatched community send (e9 2026-11-12). The send finishes in the
 * extension's action-result route, which never metered it (plan usage under-counted every extension
 * send) and never released its A20 reservation (counted for 24 h; once metered it would count TWICE).
 *
 * Through the REAL route and the REAL settle / reservation code over the fake database:
 *   executed / sent_unverified -> metered ONCE, then its reservation released (meter BEFORE release);
 *   failed (nothing sent)      -> released, not metered;
 *   uncertain (post-submit)    -> neither: kept, it may have acted (its TTL bounds it);
 *   an idempotent REPLAY       -> nothing again.
 * The ledger / meter writers are observed (they are other services' writes).
 */
import { createHash } from 'crypto';
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
const mockCalls: string[] = [];
const mockFail = { reservationRead: false };
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => {
      if (t === 'usage_execution_reservations' && mockFail.reservationRead) {
        const chain: any = { select: () => chain, eq: () => chain, is: () => chain, maybeSingle: () => chain,
          then: (res: any) => Promise.resolve({ data: null, error: { message: 'statement timeout' } }).then(res) };
        return chain;
      }
      return mockDb.from(t);
    },
    rpc: async (name: string, args: any) => {
      if (name === 'usage_execution_release') {
        mockCalls.push(`release:${args.p_reservation_id}`);
        const r = mockDb.tables.usage_execution_reservations.find((x) => x.id === args.p_reservation_id && x.organization_id === args.p_org && x.released_at == null);
        if (!r) return { data: false, error: null };
        r.released_at = new Date().toISOString();
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
  },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDb.from(t) }));
jest.mock('../../services/usageMeterService', () => ({ incrementUsageMeter: async (p: any) => { mockCalls.push(`meter:${p.source_type}`); } }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: async (p: any) => { mockCalls.push(`ledger:${p.metadata?.action_id}`); } }));
let currentSession: { userId: string; orgId: string; hmacNonce: string } | null = null;
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => (currentSession ? { session: currentSession } : null),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false, recordOutcome: () => undefined }));
jest.mock('@/backend/services/engagementOutboundMirrorService', () => ({ mirrorOutboundDmAction: async () => ({ error: null, thread_id: null }) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const actionResultHandler = require('../../../pages/api/extension/action-result').default;
const { settleBrowserDispatchUsage } = require('../../services/communityExecutionUsage');
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
const row = (over: Record<string, any> = {}) => ({
  id: ID, tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'reply', target_id: 'urn:li:comment:1',
  suggested_text: 'hello', execution_mode: 'browser', status: 'pending', approved_at: '2026-10-01T00:00:00Z',
  requires_human_approval: false, risk_level: 'low', cancel_requested_at: null,
  dispatch_lease_id: 'lease-1', dispatch_lease_holder_id: HOLDER, dispatch_lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  dispatch_acknowledged_at: null, execution_correlation_id: null, command_chain: null, command_chain_index: 0,
  idempotency_key: null, execution_result: null, created_at: '2026-10-01T00:00:00Z', submit_attempted_at: null, ...over,
});
const liveReservation = () => mockDb.tables.usage_execution_reservations.find((r) => r.action_id === ID && r.released_at == null);

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockDb = createFakeDb({
    community_ai_actions: [row()], extension_sessions: [], community_ai_execution_metric_events: [],
    usage_execution_reservations: [{ id: 'res-1', organization_id: ORG, year: 2026, month: 11, action_id: ID, reserved_at: new Date().toISOString(), released_at: null }],
  });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockCalls.length = 0;
  mockFail.reservationRead = false;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('through the action-result route', () => {
  it.each([
    ['success, confirmed', { status: 'success', result: { confirmed: true } }, 'executed'],
    ['success, unconfirmed', { status: 'success', result: {} }, 'sent_unverified'],
  ])('%s -> %s: metered ONCE, THEN its reservation released', async (_l, report, expected) => {
    const res = await postResult({ commandId: ID, leaseId: 'lease-1', ...report });
    expect(res.statusCode).toBe(200);
    expect(mockDb.tables.community_ai_actions[0].status).toBe(expected);
    expect(mockCalls).toEqual([`ledger:${ID}`, 'meter:automation_execution', 'release:res-1']);
    expect(liveReservation()).toBeUndefined();
  });

  it('failed (nothing sent) -> released, NOT metered', async () => {
    await postResult({ commandId: ID, leaseId: 'lease-1', status: 'failed', result: { error_code: 'SELECTOR_NOT_FOUND' } });
    expect(mockDb.tables.community_ai_actions[0].status).toBe('failed');
    expect(mockCalls).toEqual(['release:res-1']);
  });

  it('a failure AFTER submit (uncertain) -> neither metered nor released: it may have acted', async () => {
    mockDb.tables.community_ai_actions[0].submit_attempted_at = new Date().toISOString();
    await postResult({ commandId: ID, leaseId: 'lease-1', status: 'failed', result: { error_code: 'TIMEOUT' } });
    expect(mockDb.tables.community_ai_actions[0].status).toBe('uncertain');
    expect(mockCalls).toEqual([]);
    expect(liveReservation()).toBeDefined();
  });

  it('an idempotent REPLAY of the result -> nothing metered or released again', async () => {
    await postResult({ commandId: ID, leaseId: 'lease-1', status: 'success', result: { confirmed: true }, idempotencyKey: 'k1' });
    mockCalls.length = 0;
    const again = await postResult({ commandId: ID, leaseId: 'lease-1', status: 'success', result: { confirmed: true }, idempotencyKey: 'k1' });
    expect(again.body).toMatchObject({ idempotent: true });
    expect(mockCalls).toEqual([]);
  });

  it('an intermediate chain step -> nothing yet (not terminal)', async () => {
    mockDb.tables.community_ai_actions[0].command_chain = [{ action_type: 'open' }, { action_type: 'send' }];
    await postResult({ commandId: ID, leaseId: 'lease-1', status: 'success', result: { confirmed: true } });
    expect(mockCalls).toEqual([]);
  });
});

describe('settleBrowserDispatchUsage directly', () => {
  it('no live reservation (e.g. the plan is unlimited) -> metered, nothing to release', async () => {
    mockDb.tables.usage_execution_reservations.length = 0;
    await settleBrowserDispatchUsage({ actionId: ID, organizationId: ORG, platform: 'linkedin', actionType: 'reply', finalStatus: 'executed' });
    expect(mockCalls).toEqual([`ledger:${ID}`, 'meter:automation_execution']);
  });

  it('the reservation read FAILS -> logged by name, never thrown (it runs after a real send)', async () => {
    mockFail.reservationRead = true;
    await expect(settleBrowserDispatchUsage({ actionId: ID, organizationId: ORG, platform: 'linkedin', actionType: 'reply', finalStatus: 'failed' }))
      .resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith('USAGE_RESERVATION_RELEASE_FAILED', expect.objectContaining({ action_id: ID }));
  });

  it('another organization\'s reservation for the same action id is never released', async () => {
    mockDb.tables.usage_execution_reservations[0].organization_id = '00000000-0000-0000-0000-0000000000ff';
    await settleBrowserDispatchUsage({ actionId: ID, organizationId: ORG, platform: 'linkedin', actionType: 'reply', finalStatus: 'failed' });
    expect(mockCalls).toEqual([]);
    expect(mockDb.tables.usage_execution_reservations[0].released_at).toBeNull();
  });
});
