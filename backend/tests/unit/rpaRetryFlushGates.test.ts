/**
 * H-2: the RPA retry flush (cron `rpaRetryQueueFlush`) must honour the
 * platform kill switch and require an approval of record before it
 * re-executes a deferred action. Uses the real flushRpaRetryQueueRoundRobin
 * over an in-memory table double; only the Playwright runner is stubbed.
 */

type Row = Record<string, any>;
const tables: Record<string, Row[]> = { rpa_retry_queue: [], community_ai_actions: [] };
let actionReadFails = false;

function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'delete' | 'update' = 'select';
  let patch: Row = {};
  let countMode = false;
  let single = false;
  const run = () => {
    const rows = tables[table] || [];
    const matched = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'delete') {
      tables[table] = rows.filter((r) => !matched.includes(r));
      return { data: null, error: null };
    }
    if (op === 'update') {
      matched.forEach((r) => Object.assign(r, patch));
      return { data: null, error: null };
    }
    if (table === 'community_ai_actions' && actionReadFails) {
      return { data: null, error: { code: '57014' } };
    }
    if (countMode) return { data: null, count: matched.length, error: null };
    if (single) return { data: matched[0] ?? null, error: null };
    return { data: matched.map((r) => ({ ...r })), error: null };
  };
  const q: any = {
    select: (_cols?: string, opts?: { count?: string }) => {
      if (opts?.count) countMode = true;
      return q;
    },
    delete: () => {
      op = 'delete';
      return q;
    },
    update: (p: Row) => {
      op = 'update';
      patch = p;
      return q;
    },
    insert: () => Promise.resolve({ error: null }),
    eq: (k: string, v: unknown) => {
      filters.push((r) => r[k] === v);
      return q;
    },
    lte: (k: string, v: string) => {
      filters.push((r) => String(r[k]) <= v);
      return q;
    },
    lt: (k: string, v: number) => {
      filters.push((r) => Number(r[k]) < v);
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: () => {
      single = true;
      return Promise.resolve(run());
    },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn((t: string) => makeQuery(t)), rpc: jest.fn() },
}));

const policy = { execution_enabled: true, auto_rules_enabled: true, require_human_approval: false };
jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({ ...policy, updated_at: null, updated_by: null })),
}));

jest.mock('../../services/rpaWorker/rpaEnv', () => ({
  rpaEnvReady: jest.fn(async () => ({ ok: true })),
  assertRpaEnvReady: jest.fn(async () => undefined),
  isProbeFailure: jest.fn(() => false),
}));
jest.mock('../../services/rpaWorker/rpaTaskQueue', () => ({
  enqueueRpaTask: jest.fn(),
  startRpaWorker: jest.fn(),
}));
jest.mock('../../services/rpaWorker/rpaQueueState', () => ({
  admitRpaTask: jest.fn(async () => ({ admit: true })),
  observeAllActiveOrgs: jest.fn(async () => undefined),
}));
jest.mock('../../services/rpaWorker/rpaPlatformScripts', () => ({
  buildScript: jest.fn(() => ({ targetUrl: 'https://www.linkedin.com/feed/update/urn:1', steps: [] })),
}));
jest.mock('../../services/rpaWorker/rpaPlaywrightRunner', () => ({
  runRpaScript: jest.fn(async () => ({ success: true, platform_id: 'p-1' })),
}));
jest.mock('../../queue/bullmqClient', () => ({
  withHeavyJobSlot: jest.fn((fn: () => unknown) => fn()),
}));

import { rpaSchedulerHooks } from '../../services/rpaWorker/rpaWorkerService';
import { runRpaScript } from '../../services/rpaWorker/rpaPlaywrightRunner';

const ORG = 'org-1';
const past = new Date(Date.now() - 60_000).toISOString();

function seed(action: Row | null) {
  tables.rpa_retry_queue = [
    {
      id: 'rq-1',
      action_id: 'act-1',
      organization_id: ORG,
      platform: 'linkedin',
      action_type: 'like',
      target_url: 'https://www.linkedin.com/feed/update/urn:1',
      text: null,
      attempts: 1,
      max_attempts: 5,
      next_retry_at: past,
    },
  ];
  tables.community_ai_actions = action ? [{ id: 'act-1', organization_id: ORG, ...action }] : [];
}

describe('RPA retry flush gates (H-2)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    (runRpaScript as jest.Mock).mockClear();
    policy.execution_enabled = true;
    actionReadFails = false;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('kill switch on: nothing is executed and the retry row is not touched', async () => {
    seed({ status: 'failed', approved_at: '2026-11-01T00:00:00Z' });
    policy.execution_enabled = false;
    const out = await rpaSchedulerHooks.flushRetries({ limit_per_org: 10, max_orgs: 10 });
    expect(runRpaScript).not.toHaveBeenCalled();
    expect(out.claimed).toBe(0);
    expect(tables.rpa_retry_queue[0].attempts).toBe(1);
  });

  it('unapproved action (no approval of record): not executed', async () => {
    seed({ status: 'failed', approved_at: null });
    const out = await rpaSchedulerHooks.flushRetries();
    expect(runRpaScript).not.toHaveBeenCalled();
    expect(out.succeeded).toBe(0);
    expect(tables.rpa_retry_queue[0].last_error).toBe('RPA_RETRY_NOT_APPROVED');
  });

  it.each([
    ['rejected', 'RPA_RETRY_ACTION_NOT_RETRYABLE'],
    ['executed', 'RPA_RETRY_ACTION_NOT_RETRYABLE'],
    ['pending', 'RPA_RETRY_ACTION_NOT_RETRYABLE'],
  ])('action in status %s: not executed', async (status, reason) => {
    seed({ status, approved_at: '2026-11-01T00:00:00Z' });
    await rpaSchedulerHooks.flushRetries();
    expect(runRpaScript).not.toHaveBeenCalled();
    expect(tables.rpa_retry_queue[0].last_error).toBe(reason);
  });

  it('action row missing or in another organization: not executed', async () => {
    seed(null);
    tables.community_ai_actions = [
      { id: 'act-1', organization_id: 'org-2', status: 'failed', approved_at: '2026-11-01T00:00:00Z' },
    ];
    await rpaSchedulerHooks.flushRetries();
    expect(runRpaScript).not.toHaveBeenCalled();
    expect(tables.rpa_retry_queue[0].last_error).toBe('RPA_RETRY_ACTION_NOT_FOUND');
  });

  it('action row unreadable: not executed (fail closed)', async () => {
    seed({ status: 'failed', approved_at: '2026-11-01T00:00:00Z' });
    actionReadFails = true;
    await rpaSchedulerHooks.flushRetries();
    expect(runRpaScript).not.toHaveBeenCalled();
    expect(tables.rpa_retry_queue[0].last_error).toBe('RPA_RETRY_ACTION_UNREADABLE');
  });

  it('approved action: executed exactly once, retry row removed, a second flush runs nothing', async () => {
    seed({ status: 'failed', approved_at: '2026-11-01T00:00:00Z' });
    const first = await rpaSchedulerHooks.flushRetries();
    expect(first.succeeded).toBe(1);
    expect(runRpaScript).toHaveBeenCalledTimes(1);
    expect(tables.rpa_retry_queue).toHaveLength(0);
    await rpaSchedulerHooks.flushRetries();
    expect(runRpaScript).toHaveBeenCalledTimes(1);
  });
});
