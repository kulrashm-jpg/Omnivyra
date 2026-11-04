/**
 * RPA retry flush gates (H-2), on the W1 path kept under CR-X-01.
 *
 * Round 3 (451fc985c) gated the retry flush with checkRpaRetryAuthorised, an
 * unclaimed read that also re-ran `failed` rows. CR-X-01 keeps W1's path
 * instead: the flush claims the retry row AND the action row
 * (approved -> executing, tenant-scoped, not cancelled) and runs only what it
 * claimed, through the executor, which applies the approval of record. This
 * suite keeps round 3's intents against that path:
 *   - kill switch on: nothing claimed, run or touched;
 *   - an action not in `approved` (failed, pending, rejected, executed, ...):
 *     never run (round 3 re-ran `failed`);
 *   - action row missing or in another organization: never run;
 *   - action row unreadable: never run (fail closed);
 *   - approved action: run exactly once, retry row removed, a second flush
 *     runs nothing;
 *   - a claimed row reaches the executor as a persisting call bound to the
 *     claim, so the executor's approved_at gate (D-01) decides an unapproved
 *     row (covered in communityAiExecutionBoundary.test.ts).
 */

import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
let mockUnreadable: string | null = null;

// A table that fails every read and write, as an unreadable store would.
const failingTable = (): any => {
  const result = Promise.resolve({ data: null, error: { message: 'unreadable', code: '08006' } });
  const proxy: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? result.then.bind(result) : () => proxy),
    apply: () => proxy,
  });
  return proxy;
};
const mockFrom = (t: string) => (mockUnreadable === t ? failingTable() : mockDb.from(t));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockFrom(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockFrom(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
}));
jest.mock('../../queue/bullmqClient', () => ({ withHeavyJobSlot: (fn: () => any) => fn() }));
jest.mock('../../services/rpaWorker/rpaEnv', () => ({
  rpaEnvReady: jest.fn(async () => ({ ok: true })),
  assertRpaEnvReady: jest.fn(),
  isProbeFailure: (r: any) => r && r.ok === false,
}));
const mockPolicy = { execution_enabled: true };
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({ ...mockPolicy })),
}));
const mockExecuteAction = jest.fn();
jest.mock('../../services/communityAiActionExecutorRuntime', () => ({
  executeAction: (...a: any[]) => mockExecuteAction(...a),
}));

import { rpaSchedulerHooks } from '../../services/rpaWorker/rpaWorkerService';

const PAST = '2020-01-01T00:00:00.000Z';
const A1 = '00000000-0000-0000-0000-0000000000a1';

const actionRow = (over: Record<string, any> = {}) => ({
  id: A1, tenant_id: 't1', organization_id: 'o1', platform: 'linkedin', action_type: 'like',
  target_id: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', suggested_text: null,
  execution_mode: 'rpa', status: 'approved', cancel_requested_at: null, playbook_id: 'pb1',
  approved_at: PAST, ...over,
});
const retryRow = (over: Record<string, any> = {}) => ({
  id: 'r1', action_id: A1, organization_id: 'o1', platform: 'linkedin', action_type: 'like',
  target_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', text: null,
  attempts: 1, max_attempts: 5, next_retry_at: PAST, claim_token: null, claimed_at: null, ...over,
});

const seed = (action: Record<string, any> | null) => {
  mockDb = createFakeDb({ community_ai_actions: action ? [actionRow(action)] : [], rpa_retry_queue: [retryRow()] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockDb.unique.rpa_retry_queue = ['action_id'];
};
const flush = () => rpaSchedulerHooks.flushRetries({ limit_per_org: 10, max_orgs: 10 });

beforeEach(() => {
  seed({});
  mockUnreadable = null;
  mockPolicy.execution_enabled = true;
  mockExecuteAction.mockReset().mockImplementation(async () => {
    mockDb.tables.community_ai_actions[0].status = 'executed';
    return { ok: true, status: 'executed' };
  });
});

describe('RPA retry flush gates (H-2), W1 claimed path', () => {
  it('kill switch on: nothing is executed and the retry row is not touched', async () => {
    mockPolicy.execution_enabled = false;
    const out = await flush();
    expect(out.claimed).toBe(0);
    expect(mockExecuteAction).not.toHaveBeenCalled();
    expect(mockDb.tables.rpa_retry_queue).toEqual([retryRow()]);
    expect(mockDb.tables.community_ai_actions[0].status).toBe('approved');
  });

  it.each(['failed', 'pending', 'rejected', 'executed', 'sent_unverified', 'skipped', 'uncertain'])(
    'action in status %s: not executed (only an approved row can be claimed)',
    async (status) => {
      seed({ status });
      await flush();
      expect(mockExecuteAction).not.toHaveBeenCalled();
      expect(mockDb.tables.community_ai_actions[0].status).toBe(status);
    },
  );

  it('action row missing: not executed', async () => {
    seed(null);
    await flush();
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it('action row in another organization: not executed and left unchanged', async () => {
    seed({ organization_id: 'o-other' });
    await flush();
    expect(mockExecuteAction).not.toHaveBeenCalled();
    expect(mockDb.tables.community_ai_actions[0]).toMatchObject({ status: 'approved', organization_id: 'o-other' });
  });

  it('action row unreadable: not executed (fail closed)', async () => {
    mockUnreadable = 'community_ai_actions';
    await flush();
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it('approved action: executed exactly once, retry row removed, a second flush runs nothing', async () => {
    const first = await flush();
    expect(first.claimed).toBe(1);
    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
    expect(mockDb.tables.rpa_retry_queue).toHaveLength(0);
    await flush();
    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
  });

  it('the claimed row reaches the executor bound to the claim, with its approval of record', async () => {
    await flush();
    const [act, , opts] = mockExecuteAction.mock.calls[0];
    expect(act).toMatchObject({ id: A1, approved_at: PAST });
    expect(opts).toMatchObject({ persist: true, expected_from_statuses: ['executing'] });
  });
});
