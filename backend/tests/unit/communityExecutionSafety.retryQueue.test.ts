/**
 * Community execution safety — durable RPA retry queue (rpa_retry_queue).
 *
 *   - two workers racing for one row: exactly one claims and runs it;
 *   - the action row must ALSO be claimed (approved -> executing, tenant
 *     scoped, not cancelled) or nothing runs;
 *   - crash / throw / ledger-write failure after the claim: the claim is kept,
 *     never re-claimed, and surfaced by listStaleRpaRetryClaims;
 *   - deferral re-queues with backoff and releases the claim;
 *   - exhausted rows (attempts >= max_attempts) are never re-run;
 *   - the production wiring re-runs through the executor with a CAS terminal
 *     write, and the platform kill switch stops the flush before any claim.
 */

import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => mockDb.from(t),
  ownedDbRpc: jest.fn(async () => ({ data: null, error: null })),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => mockDb.from(t), rpc: jest.fn(async () => ({ data: null, error: null })) },
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

import {
  enqueueRpaRetry,
  flushRpaRetryQueueForOrg,
  listStaleRpaRetryClaims,
} from '../../services/rpaWorker/rpaRetryQueue';
import { rpaSchedulerHooks } from '../../services/rpaWorker/rpaWorkerService';

const NOW = new Date('2026-10-28T12:00:00Z');
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

let tok = 0;
const flush = (runAction: any, extra: Record<string, any> = {}) =>
  flushRpaRetryQueueForOrg({ organization_id: 'o1', runAction, now: () => NOW, newClaimToken: () => `tok-${++tok}`, ...extra });

const setActionStatus = (s: string) => { mockDb.tables.community_ai_actions[0].status = s; };

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [actionRow()], rpa_retry_queue: [retryRow()] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  mockDb.unique.rpa_retry_queue = ['action_id'];
  mockPolicy.execution_enabled = true;
  mockExecuteAction.mockReset();
});

describe('rpa_retry_queue flush — claims', () => {
  it('two workers racing for one row: exactly one runs it', async () => {
    const run = jest.fn(async () => { await new Promise((r) => setImmediate(r)); setActionStatus('executed'); return { ok: true, status: 'executed' }; });
    const [a, b] = await Promise.all([flush(run), flush(run)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a.claimed + b.claimed).toBe(1);
    expect((a.lost ?? 0) + (b.lost ?? 0)).toBe(1);
    expect(mockDb.tables.rpa_retry_queue).toHaveLength(0);
  });

  it('runs the action only after claiming it approved -> executing', async () => {
    const run = jest.fn(async (a: any) => { expect(a.status).toBe('executing'); return { ok: true, status: 'executed' }; });
    await flush(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockDb.tables.community_ai_actions[0].status).toBe('executing'); // run() is mocked; the executor would finalise
  });

  it('action already claimed elsewhere (scheduler / manual / orchestration): nothing runs, row dropped', async () => {
    setActionStatus('executing');
    const run = jest.fn();
    const out = await flush(run);
    expect(run).not.toHaveBeenCalled();
    expect(out.obsolete).toBe(1);
    expect(mockDb.tables.rpa_retry_queue).toHaveLength(0);
    expect(mockDb.tables.community_ai_actions[0].status).toBe('executing');
  });

  it('cancelled or uncertain action: nothing runs', async () => {
    mockDb.tables.community_ai_actions[0].cancel_requested_at = PAST;
    const run = jest.fn();
    await flush(run);
    expect(run).not.toHaveBeenCalled();

    mockDb = createFakeDb({ community_ai_actions: [actionRow({ status: 'uncertain' })], rpa_retry_queue: [retryRow()] });
    await flush(run);
    expect(run).not.toHaveBeenCalled();
  });

  it('tenant / organization mismatch: the action is never loaded or run', async () => {
    mockDb = createFakeDb({
      community_ai_actions: [actionRow({ organization_id: 'o-other' })],
      rpa_retry_queue: [retryRow()],
    });
    const run = jest.fn();
    const out = await flush(run);
    expect(run).not.toHaveBeenCalled();
    expect(out.obsolete).toBe(1);
    expect(mockDb.tables.community_ai_actions[0].status).toBe('approved');
  });

  it('exhausted rows (attempts >= max_attempts) are never re-run', async () => {
    mockDb.tables.rpa_retry_queue[0].attempts = 5;
    const run = jest.fn();
    const out = await flush(run);
    expect(run).not.toHaveBeenCalled();
    expect(out.claimed).toBe(0);
  });
});

describe('rpa_retry_queue flush — may-have-acted is never re-run', () => {
  it('crash/throw after claim: claim kept, next flush does not run it, surfaced as stale', async () => {
    const run = jest.fn(async () => { throw new Error('worker died'); });
    const first = await flush(run);
    expect(first.errors).toBe(1);
    expect(mockDb.tables.rpa_retry_queue[0].claim_token).toBe('tok-' + tok);
    const second = await flush(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(second.claimed).toBe(0);
    const stale = await listStaleRpaRetryClaims({ olderThanMs: 60_000, now: () => new Date(NOW.getTime() + 3_600_000) });
    expect(stale.map((r) => r.id)).toEqual(['r1']);
  });

  it('expired claim is never auto-reclaimed', async () => {
    mockDb.tables.rpa_retry_queue[0].claim_token = 'old';
    mockDb.tables.rpa_retry_queue[0].claimed_at = '2026-10-01T00:00:00Z';
    const run = jest.fn();
    await flush(run);
    expect(run).not.toHaveBeenCalled();
    expect(await listStaleRpaRetryClaims({ now: () => NOW })).toHaveLength(1);
  });

  it('ledger write failure: claim kept for review, not re-run', async () => {
    const run = jest.fn(async () => ({ ok: false, status: 'uncertain', response: { persist_error: 'STATE_MISMATCH' } }));
    await flush(run);
    await flush(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockDb.tables.rpa_retry_queue[0].claim_token).not.toBeNull();
  });

  it('uncertain outcome: counted, retry row removed (the action row carries uncertain)', async () => {
    const run = jest.fn(async () => { setActionStatus('uncertain'); return { ok: false, status: 'uncertain' }; });
    const out = await flush(run);
    expect(out.uncertain).toBe(1);
    expect(mockDb.tables.rpa_retry_queue).toHaveLength(0);
    await flush(run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('rpa_retry_queue flush — deferral', () => {
  it('re-deferral re-queues with backoff and releases the claim; not due again immediately', async () => {
    const run = jest.fn(async (a: any) => {
      await enqueueRpaRetry({ tenant_id: a.tenant_id, organization_id: a.organization_id, platform: a.platform,
        action_type: a.action_type, target_url: a.target_id, text: null, action_id: a.id }, { error: 'RPA_ENV_NOT_READY:x', delaySeconds: 120 });
      setActionStatus('approved');
      return { ok: false, status: 'deferred' };
    });
    const realNow = { now: () => new Date() };
    const out = await flush(run, realNow);
    expect(out.deferred).toBe(1);
    const r = mockDb.tables.rpa_retry_queue[0];
    expect(r.claim_token).toBeNull();
    expect(r.claimed_at).toBeNull();
    expect(r.attempts).toBe(2);
    expect(new Date(r.next_retry_at).getTime()).toBeGreaterThan(Date.now() + 3 * 60_000); // 2^2 min backoff
    await flush(run, realNow);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses to re-queue past max_attempts', async () => {
    mockDb.tables.rpa_retry_queue[0].attempts = 4;
    const q = await enqueueRpaRetry({ tenant_id: 't1', organization_id: 'o1', platform: 'linkedin', action_type: 'like',
      target_url: 'https://www.linkedin.com/x', text: null, action_id: A1 }, { error: 'x' });
    expect(q).toMatchObject({ queued: false, error: 'MAX_ATTEMPTS_EXCEEDED' });
  });
});

describe('production wiring (rpaSchedulerHooks.flushRetries)', () => {
  it('re-runs through the executor with a CAS terminal write and the deferred source', async () => {
    mockDb.tables.community_ai_actions[0].execution_result = { response: { deferred_source: 'manual' } };
    mockExecuteAction.mockResolvedValue({ ok: true, status: 'executed' });
    const out = await rpaSchedulerHooks.flushRetries({ limit_per_org: 10, max_orgs: 10 });
    expect(out.claimed).toBe(1);
    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
    const [act, approved, opts] = mockExecuteAction.mock.calls[0];
    expect(act).toMatchObject({ id: A1, tenant_id: 't1', organization_id: 'o1', execution_mode: 'rpa' });
    expect(approved).toBe(true);
    expect(opts).toMatchObject({ persist: true, expected_from_statuses: ['executing'], source: 'manual' });
  });

  it('kill switch: nothing claimed, nothing run', async () => {
    mockPolicy.execution_enabled = false;
    const out = await rpaSchedulerHooks.flushRetries({ limit_per_org: 10, max_orgs: 10 });
    expect(out.claimed).toBe(0);
    expect(mockExecuteAction).not.toHaveBeenCalled();
    expect(mockDb.tables.rpa_retry_queue[0].claim_token).toBeNull();
    expect(mockDb.tables.community_ai_actions[0].status).toBe('approved');
  });
});
