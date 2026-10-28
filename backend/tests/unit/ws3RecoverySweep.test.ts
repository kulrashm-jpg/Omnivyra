/**
 * WS-3 — scheduled recovery sweep for tasks an earlier dispatch returned to `queued`.
 *
 * End to end through the REAL path: sweep → dispatchApprovedOutreachForLead →
 * dispatchInternalOutreachTask → governance / quota / claim / transport, over
 * the same strict database double as the dispatch suites (compare-and-set
 * updates, append-only audit, unique attempt numbers, one work item per attempt).
 * Only the lead-intelligence read port and the logger are stubbed; neither is on
 * the dispatch path.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
  queries: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload: Row | null }>,
};

const APPEND_ONLY = ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null; limit: number | null } = { op: 'select', filters: [], payload: null, limit: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) =>
      st.filters.every(([c, v]) => {
        if (c.startsWith('__gte__')) return String(r[c.slice(7)] ?? '') >= String(v);
        if (c.startsWith('__is__')) return (r[c.slice(6)] ?? null) === v;
        return r[c] === v;
      });

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve(); // yield — concurrent sweeps genuinely interleave
      db.queries.push({ table, op: st.op, filters: [...st.filters], payload: st.payload });
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };

      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'outreach_attempts' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
          return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
        }
        if (table === 'outreach_internal_work_items' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_id === row.attempt_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate work item for attempt' } };
        }
        const created = { ...row, id: `${table}-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z', updated_at: `2026-08-05T00:00:${String(db.nextId).padStart(2, '0')}.000Z` };
        rows().push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) return { data: null, error: { code: '2F004', message: `ws3_append_only: ${table} is append-only; UPDATE is not permitted` } };
        const affected = rows().filter(matches);
        for (const r of affected) Object.assign(r, st.payload);
        return { data: affected.map((r) => ({ id: r.id })), error: null };
      }

      const found = rows().filter(matches);
      const bounded = st.limit === null ? found : found.slice(0, st.limit);
      return mode === 'many' ? { data: bounded, error: null } : { data: bounded[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      gte: (c: string, v: unknown) => { st.filters.push([`__gte__${c}`, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([`__is__${c}`, v]); return b; },
      order: () => b,
      limit: (n: number) => { st.limit = n; return exec('many'); },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

const fakeRedis = {
  store: new Map<string, number>(),
  async incrby(key: string, by: number) { const n = (this.store.get(key) ?? 0) + by; this.store.set(key, n); return n; },
  async decrby(key: string, by: number) { const n = (this.store.get(key) ?? 0) - by; this.store.set(key, n); return n; },
  async get(key: string) { const v = this.store.get(key); return v === undefined ? null : String(v); },
  async set(key: string, v: string) { this.store.set(key, Number(v)); return 'OK'; },
  async expire() { return 1; },
};

jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => fakeRedis }));
jest.mock('../../services/leadIntelligenceOrchestration/readIntegration', () => ({ getPersistedLeadIntelligence: async () => null }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { registry } from '../../observability/registry';
import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  INTERNAL_CHANNEL,
  TRANSLATION_VERSION,
  __clearTransportsForTests,
  __resetQuotaRedisForTests,
  approveOutreachTask,
  getOutreachTaskById,
  insertOutreachTask,
  listAttempts,
  listDecisions,
  listInternalWorkItems,
  setOutreachTaskState,
  submitForApproval,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';
import * as activation from '../../services/leadOutreachActivation';
import {
  RECOVERY_SWEEP_ENABLED_ENV,
  isRecoverySweepEnabled,
  runOutreachDispatchRecoverySweep,
} from '../../services/leadOutreachRecoverySweep';

const NOW = '2026-08-05T12:00:00.000Z';
const KILL_ENV = 'LEAD_OUTREACH_EXECUTION_DISABLED';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-assign-sdr', taskOrder: 1,
  kind: 'human', action: 'Assign SDR', channel: INTERNAL_CHANNEL, dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Hot lead needs an owner',
  requiresApproval: true, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

const configureTenant = (companyId = 'co-a') => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: companyId, enabled: true, kill_switch: false,
    enabled_channels: [INTERNAL_CHANNEL], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null,
  });
};

const approvedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const companyId = over.companyId ?? 'co-a';
  const id = (await insertOutreachTask(newTask(over))).data!.id as string;
  expect((await submitForApproval(companyId, id)).ok).toBe(true);
  expect((await approveOutreachTask(companyId, id, { approverUserId: 'approver-1' })).ok).toBe(true);
  return id;
};

/** What a quota deferral after the claim leaves: approved on record, back in `queued`, no attempt. */
const requeuedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const id = await approvedTask(over);
  await setOutreachTaskState(over.companyId ?? 'co-a', id, { status: 'queued' });
  return id;
};

const status = async (id: string, companyId = 'co-a') => (await getOutreachTaskById(companyId, id))?.status;
const sweep = (opts = {}) => runOutreachDispatchRecoverySweep({ ...opts });

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.queries = [];
  fakeRedis.store.clear();
  registry.reset();
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  process.env[RECOVERY_SWEEP_ENABLED_ENV] = 'true';
  delete process.env[KILL_ENV];
  delete process.env.LEAD_OUTREACH_EMAIL_ENABLED;
  jest.restoreAllMocks();
});

afterAll(() => {
  delete process.env[RECOVERY_SWEEP_ENABLED_ENV];
});

describe('WS-3 recovery sweep (1) — disabled by default', () => {
  it.each([undefined, '', 'false', '1', 'yes', 'on'])('flag %p leaves the sweep inert and reads nothing', async (value) => {
    configureTenant();
    const id = await requeuedTask();
    if (value === undefined) delete process.env[RECOVERY_SWEEP_ENABLED_ENV];
    else process.env[RECOVERY_SWEEP_ENABLED_ENV] = value;
    db.queries = [];

    expect(isRecoverySweepEnabled()).toBe(false);
    const report = await sweep();
    expect(report).toMatchObject({ enabled: false, skipped: 'disabled', scanned: 0, sent: 0 });
    expect(db.queries).toHaveLength(0);
    expect(await status(id)).toBe('queued');
  });

  it('the global kill switch stops the sweep before it reads anything', async () => {
    configureTenant();
    await requeuedTask();
    process.env[KILL_ENV] = 'true';
    db.queries = [];

    const report = await sweep();
    expect(report).toMatchObject({ enabled: true, skipped: 'kill_switch', scanned: 0 });
    expect(db.queries).toHaveLength(0);
  });
});

describe('WS-3 recovery sweep (2) — recovers only what governance and history permit', () => {
  it('sends an approved, requeued internal task through the existing dispatch path', async () => {
    configureTenant();
    const id = await requeuedTask();

    const report = await sweep();
    expect(report).toMatchObject({ enabled: true, skipped: null, scanned: 1, recoverable: 1, unrecoverable: 0, leadsProcessed: 1, sent: 1 });
    expect(report.outcomes).toEqual({ sent: 1 });
    expect(await status(id)).toBe('sent');
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(1);
  });

  it('a queued task with NO approval on record is refused by governance, never attempted', async () => {
    configureTenant();
    const id = (await insertOutreachTask(newTask())).data!.id as string;
    await setOutreachTaskState('co-a', id, { status: 'queued' }); // pending → queued, no human

    const report = await sweep();
    expect(report.sent).toBe(0);
    expect(report.outcomes).toEqual({ blocked_governance: 1 });
    expect(await listAttempts('co-a', id)).toHaveLength(0);
    expect(await status(id)).toBe('queued');
  });

  it('never touches a lead\'s other approved (not queued) tasks', async () => {
    configureTenant();
    const queued = await requeuedTask({ planTaskId: 'task-1-a' });
    const approvedOnly = await approvedTask({ planTaskId: 'task-2-b' });

    await sweep();
    expect(await status(queued)).toBe('sent');
    expect(await status(approvedOnly)).toBe('approved');
    expect(await listAttempts('co-a', approvedOnly)).toHaveLength(0);
  });

  it('does not widen channels: a queued email task is left alone and never attempted', async () => {
    configureTenant();
    const id = await requeuedTask({ channel: 'email' });

    const report = await sweep();
    expect(report.outcomes).toEqual({ channel_not_permitted: 1 });
    expect(await listAttempts('co-a', id)).toHaveLength(0);
    expect(await status(id)).toBe('queued');
  });
});

describe('WS-3 recovery sweep (3) — never re-sends a possibly delivered message', () => {
  it.each(['timeout', 'provider_error', 'transport_error'])('an email (external) %s attempt is reported as needing a human and never dispatched', async (ambiguous) => {
    configureTenant();
    const id = await requeuedTask({ channel: 'email' });
    (db.tables.outreach_attempts ??= []).push({ id: 'att-1', company_id: 'co-a', task_id: id, attempt_number: 1 });
    (db.tables.outreach_delivery_evidence ??= []).push({ id: 'ev-1', company_id: 'co-a', task_id: id, attempt_id: 'att-1', transport_response: { outcome: ambiguous } });
    const decisionsBefore = (await listDecisions('co-a', id)).length;

    const report = await sweep();
    expect(report).toMatchObject({ recoverable: 0, unrecoverable: 1, leadsProcessed: 0, sent: 0 });
    expect(report.unrecoverableTasks[0]).toMatchObject({ companyId: 'co-a', taskId: id });
    expect(report.unrecoverableTasks[0].reason).toMatch(/may have sent it/);
    // Skipped before dispatch: governance is not re-run and no decision row is appended per sweep.
    expect((await listDecisions('co-a', id)).length).toBe(decisionsBefore);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
    expect(await status(id)).toBe('queued');
  });

  it('an attempt with no evidence, or an unreadable history, is never dispatched', async () => {
    configureTenant();
    const orphan = await requeuedTask({ planTaskId: 'task-1-a' });
    (db.tables.outreach_attempts ??= []).push({ id: 'att-x', company_id: 'co-a', task_id: orphan, attempt_number: 1 });
    const report = await sweep();
    expect(report).toMatchObject({ unrecoverable: 1, sent: 0 });
    expect(await listInternalWorkItems('co-a', orphan)).toHaveLength(0);

    db.failTable = 'outreach_delivery_evidence';
    const blind = await sweep();
    db.failTable = null;
    expect(blind).toMatchObject({ recoverable: 0, sent: 0 });
    expect(blind.unrecoverableTasks[0].reason).toMatch(/unreadable/);
  });
});

describe('WS-3 recovery sweep (4) — tenant isolation', () => {
  it('each tenant is governed by its own configuration; every dispatch query is company-scoped', async () => {
    configureTenant('co-a'); // co-b has no governance configuration: not enabled
    const a = await requeuedTask({ companyId: 'co-a', leadId: 'LA' });
    const b = await requeuedTask({ companyId: 'co-b', leadId: 'LB' });
    db.queries = [];

    const report = await sweep();
    expect(report.leadsProcessed).toBe(2);
    expect(await status(a, 'co-a')).toBe('sent');
    expect(await status(b, 'co-b')).toBe('queued');
    expect(await listInternalWorkItems('co-b', b)).toHaveLength(0);

    // The one unscoped read is the queued-task scan; every other query names a tenant.
    const scoped = (q: (typeof db.queries)[number]) =>
      q.op === 'insert' ? typeof q.payload?.company_id === 'string' : q.filters.some(([c]) => c === 'company_id');
    const unscoped = db.queries.filter((q) => !scoped(q));
    expect(unscoped.length).toBeGreaterThan(0);
    for (const q of unscoped) expect(q).toMatchObject({ table: 'outreach_tasks', op: 'select', filters: [['status', 'queued']] });
    // No tenant's task is ever read or written under another tenant's id.
    const touchedB = db.queries.filter((q) => q.filters.some(([c, v]) => (c === 'id' || c === 'task_id') && v === b) || q.payload?.task_id === b);
    expect(touchedB.length).toBeGreaterThan(0);
    for (const q of touchedB) {
      if (q.op === 'insert') expect(q.payload?.company_id).toBe('co-b');
      else expect(q.filters).toContainEqual(['company_id', 'co-b']);
    }
  });
});

describe('WS-3 recovery sweep (5) — repeat, concurrency, bounds and failure isolation', () => {
  it('a repeated sweep sends nothing more', async () => {
    configureTenant();
    const id = await requeuedTask();
    expect((await sweep()).sent).toBe(1);

    const again = await sweep();
    expect(again).toMatchObject({ scanned: 0, sent: 0 });
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(1);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
  });

  it('three concurrent sweeps send each task exactly once', async () => {
    configureTenant();
    const ids = [await requeuedTask({ planTaskId: 'task-1-a', leadId: 'L1' }), await requeuedTask({ planTaskId: 'task-1-b', leadId: 'L2' })];

    const reports = await Promise.all([sweep(), sweep(), sweep()]);
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(2);
    for (const id of ids) {
      expect(await status(id)).toBe('sent');
      expect(await listInternalWorkItems('co-a', id)).toHaveLength(1);
      expect(await listAttempts('co-a', id)).toHaveLength(1);
    }
  });

  it('caps leads per run and defers the rest to a later run', async () => {
    configureTenant();
    const first = await requeuedTask({ planTaskId: 'task-1-a', leadId: 'L1' });
    const second = await requeuedTask({ planTaskId: 'task-1-b', leadId: 'L2' });

    const report = await sweep({ maxLeads: 1 });
    expect(report).toMatchObject({ recoverable: 2, leadsProcessed: 1, leadsDeferred: 1, sent: 1 });
    expect([await status(first), await status(second)].sort()).toEqual(['queued', 'sent']);
    expect((await sweep({ maxLeads: 1 })).sent).toBe(1);
  });

  it('starts no new lead once the time budget is spent', async () => {
    configureTenant();
    await requeuedTask({ planTaskId: 'task-1-a', leadId: 'L1' });
    await requeuedTask({ planTaskId: 'task-1-b', leadId: 'L2' });
    let t = 0;
    const report = await sweep({ timeBudgetMs: 10, clock: () => (t += 6) });
    expect(report).toMatchObject({ leadsProcessed: 1, leadsDeferred: 1 });
  });

  it('bounds the scan', async () => {
    configureTenant();
    for (let i = 0; i < 4; i++) await requeuedTask({ planTaskId: `task-${i}-x`, leadId: `L${i}` });
    const report = await sweep({ scanLimit: 3 });
    expect(report.scanned).toBe(3);
  });

  it('one lead failing is recorded and the run continues', async () => {
    configureTenant();
    const bad = await requeuedTask({ planTaskId: 'task-1-a', leadId: 'L-bad' });
    const good = await requeuedTask({ planTaskId: 'task-1-b', leadId: 'L-good' });
    const real = activation.dispatchApprovedOutreachForLead;
    jest.spyOn(activation, 'dispatchApprovedOutreachForLead').mockImplementation(async (companyId, leadId, options) => {
      if (leadId === 'L-bad') throw new Error('simulated lead failure');
      return real(companyId, leadId, options);
    });

    const report = await sweep();
    expect(report.failures).toEqual([{ companyId: 'co-a', leadId: 'L-bad', error: 'simulated lead failure' }]);
    expect(report.sent).toBe(1);
    expect(await status(good)).toBe('sent');
    expect(await status(bad)).toBe('queued');
  });

  it('a failed queued-task read is an error, not "nothing to recover"', async () => {
    configureTenant();
    await requeuedTask();
    db.failTable = 'outreach_tasks';
    await expect(sweep()).rejects.toThrow(/could not be read/);
  });
});

describe('WS-3 recovery sweep (6) — dry run for non-production validation', () => {
  it('reports what a run would dispatch and dispatches nothing, even with the flag off', async () => {
    configureTenant();
    const recoverable = await requeuedTask({ planTaskId: 'task-1-a', leadId: 'L1' });
    const blocked = await requeuedTask({ planTaskId: 'task-1-b', leadId: 'L2', channel: 'email' });
    (db.tables.outreach_attempts ??= []).push({ id: 'att-1', company_id: 'co-a', task_id: blocked, attempt_number: 1 });
    (db.tables.outreach_delivery_evidence ??= []).push({ id: 'ev-1', company_id: 'co-a', task_id: blocked, attempt_id: 'att-1', transport_response: { outcome: 'timeout' } });
    delete process.env[RECOVERY_SWEEP_ENABLED_ENV];
    const decisionsBefore = (db.tables.outreach_decisions ?? []).length;
    const writesBefore = db.queries.filter((q) => q.op !== 'select').length;

    const report = await sweep({ dryRun: true });
    expect(report).toMatchObject({ enabled: false, dryRun: true, skipped: null, scanned: 2, recoverable: 1, unrecoverable: 1, sent: 0 });
    expect(report.wouldDispatch).toEqual([{ companyId: 'co-a', leadId: 'L1', taskIds: [recoverable] }]);
    expect(report.outcomes).toEqual({});
    // Nothing was written: no decision, claim, attempt, work item or state change.
    expect(db.queries.filter((q) => q.op !== 'select').length).toBe(writesBefore);
    expect((db.tables.outreach_decisions ?? []).length).toBe(decisionsBefore);
    expect(await status(recoverable)).toBe('queued');
    expect(await listInternalWorkItems('co-a', recoverable)).toHaveLength(0);
  });

  it('honours the lead cap like a real run', async () => {
    configureTenant();
    await requeuedTask({ planTaskId: 'task-1-a', leadId: 'L1' });
    await requeuedTask({ planTaskId: 'task-1-b', leadId: 'L2' });
    const report = await sweep({ dryRun: true, maxLeads: 1 });
    expect(report.wouldDispatch).toHaveLength(1);
    expect(report.leadsDeferred).toBe(1);
  });

  it('the global kill switch stops a dry run too', async () => {
    configureTenant();
    await requeuedTask();
    process.env[KILL_ENV] = 'true';
    db.queries = [];
    const report = await sweep({ dryRun: true });
    expect(report).toMatchObject({ dryRun: true, skipped: 'kill_switch', scanned: 0 });
    expect(db.queries).toHaveLength(0);
  });
});
