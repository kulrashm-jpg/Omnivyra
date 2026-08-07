/**
 * WS-3 Milestone-5A — Internal Task Dispatch Runtime.
 *
 * The first executable runtime, so the tests concentrate on the failure that
 * actually matters: executing twice, or executing something governance refused.
 *
 * The database double enforces the real constraints — compare-and-set updates,
 * append-only audit, unique attempt numbers, and the unique work-item-per-
 * attempt anchor — so a duplicate-execution bug fails here exactly as it would
 * in PostgreSQL. A fake Redis models the fast path, including being absent.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
  filtersSeen: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload: Row | null }>,
};

const APPEND_ONLY = ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) =>
      st.filters.every(([c, v]) => {
        if (c.startsWith('__gte__')) return String(r[c.slice(7)] ?? '') >= String(v);
        if (c.startsWith('__is__')) return (r[c.slice(6)] ?? null) === v;
        return r[c] === v;
      });

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve(); // yield — concurrent dispatchers genuinely interleave
      db.filtersSeen.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };

      if (st.op === 'insert') {
        const row = st.payload as Row;
        // Unique attempt number per task.
        if (table === 'outreach_attempts' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
          return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
        }
        // One work item per dispatch attempt — the transport-level anchor.
        if (table === 'outreach_internal_work_items' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_id === row.attempt_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate work item for attempt' } };
        }
        const created = { ...row, id: `${table}-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z' };
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
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      gte: (c: string, v: unknown) => { st.filters.push([`__gte__${c}`, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([`__is__${c}`, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

/** Fake Redis. `available=false` models the fast path being absent. */
const fakeRedis = {
  available: true,
  store: new Map<string, number>(),
  async incrby(key: string, by: number) { const n = (this.store.get(key) ?? 0) + by; this.store.set(key, n); return n; },
  async decrby(key: string, by: number) { const n = (this.store.get(key) ?? 0) - by; this.store.set(key, n); return n; },
  async get(key: string) { const v = this.store.get(key); return v === undefined ? null : String(v); },
  async set(key: string, v: string) { this.store.set(key, Number(v)); return 'OK'; },
  async expire() { return 1; },
};

jest.mock('../../queue/bullmqClient', () => ({
  getSharedRedisClient: () => (fakeRedis.available ? fakeRedis : null),
}));

import { registry } from '../../observability/registry';
import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  INTERNAL_CHANNEL,
  OUTREACH_METRICS,
  TRANSLATION_VERSION,
  __resetQuotaRedisForTests,
  __clearTransportsForTests,
  registerDefaultTransports,
  dispatchInternalBatch,
  dispatchInternalOutreachTask,
  getOutreachTaskById,
  insertOutreachTask,
  listAttempts,
  listDeliveryEvidence,
  listInternalWorkItems,
  readDurableUsage,
  reconcileQuota,
  reserveQuota,
  setOutreachTaskState,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-assign-sdr', taskOrder: 1,
  kind: 'human', action: 'Assign SDR', channel: INTERNAL_CHANNEL, dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Hot lead needs an owner',
  requiresApproval: false, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

const configureTenant = (over: Row = {}) => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: 'co-a', enabled: true, kill_switch: false,
    enabled_channels: [INTERNAL_CHANNEL, 'email'], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null, ...over,
  });
};

const approvedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const res = await insertOutreachTask(newTask(over));
  const id = res.data!.id as string;
  await setOutreachTaskState('co-a', id, { status: 'approved' });
  return id;
};

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.filtersSeen = [];
  fakeRedis.available = true;
  fakeRedis.store.clear();
  registry.reset();
  __resetQuotaRedisForTests();
  // WS-3 M5B: transports are registered explicitly so an import can never
  // silently make a channel sendable. The email provider is stubbed and the
  // transport stays flag-disabled, so nothing external can be reached here.
  __clearTransportsForTests();
  registerDefaultTransports({ emailProvider: { name: 'stub', async send() { throw new Error('email must not be called in the M5A suite'); } } });
});

// ── 1. Internal dispatch ────────────────────────────────────────────────────

describe('WS-3 M5A (1) — internal dispatch', () => {
  it('dispatches an approved internal task end to end', async () => {
    configureTenant();
    const id = await approvedTask();
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    expect(res).toMatchObject({ ok: true, outcome: 'sent', status: 'sent', attemptNumber: 1 });
    expect(res.workItemId).toBeTruthy();
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('sent');

    const items = await listInternalWorkItems('co-a', id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Assign SDR', lead_id: 'L1', company_id: 'co-a' });
  });

  it('records an attempt with full provenance', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    const attempts = await listAttempts('co-a', id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attempt_number: 1,
      channel: INTERNAL_CHANNEL,
      transport: 'internal_work_item',
      governance_version: GOVERNANCE_VERSION,
      execution_runtime_version: EXECUTION_RUNTIME_VERSION,
      started_at: NOW,
    });
    expect(['redis', 'db']).toContain(String(attempts[0].limiter_layer));
  });

  it('records delivery evidence as confirmed, tied to the attempt', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    const evidence = await listDeliveryEvidence('co-a', id);
    expect(evidence).toHaveLength(1);
    // An internal work item is a platform-confirmed write, not an unverified send.
    expect(evidence[0]).toMatchObject({ delivery_status: 'confirmed' });
    expect(evidence[0].attempt_id).toBe((await listAttempts('co-a', id))[0].id);
  });

  it('refuses a channel with no registered transport', async () => {
    configureTenant();
    // A channel WS-3 has deliberately not built a transport for. Stronger than
    // naming a supported one: it proves the unsupported channels stay
    // undispatchable purely because nothing serves them.
    const id = await approvedTask({ planTaskId: 'task-2-linkedin', channel: 'linkedin' });
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    expect(res).toMatchObject({ ok: false, outcome: 'skipped_no_transport' });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('approved'); // untouched
    expect(db.tables.outreach_attempts ?? []).toHaveLength(0);
    expect(db.tables.outreach_internal_work_items ?? []).toHaveLength(0);
  });

  it('refuses an unknown or foreign task', async () => {
    configureTenant();
    const id = await approvedTask();
    expect(await dispatchInternalOutreachTask('co-a', 'nope', { now: NOW })).toMatchObject({ outcome: 'skipped_not_found' });
    expect(await dispatchInternalOutreachTask('co-b', id, { now: NOW })).toMatchObject({ outcome: 'skipped_not_found' });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('approved');
  });
});

// ── 2. Governance gating ────────────────────────────────────────────────────

describe('WS-3 M5A (2) — governance always precedes dispatch', () => {
  it('never dispatches when the tenant is unconfigured', async () => {
    const id = await approvedTask(); // no configureTenant()
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    expect(res).toMatchObject({ outcome: 'blocked_governance' });
    expect(res.governance?.blockingCondition).toBe('tenant.enablement');
    // Nothing was touched: no state change, no attempt, no work item.
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('approved');
    expect(db.tables.outreach_attempts ?? []).toHaveLength(0);
    expect(db.tables.outreach_internal_work_items ?? []).toHaveLength(0);
  });

  it('never dispatches when a kill switch is engaged', async () => {
    configureTenant({ kill_switch: true });
    const id = await approvedTask();
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(res.outcome).toBe('blocked_governance');
    expect(res.governance?.blockedBy).toBe('kill_switch');
    expect(db.tables.outreach_internal_work_items ?? []).toHaveLength(0);
  });

  it('never dispatches a suppressed recipient', async () => {
    configureTenant();
    (db.tables.outreach_suppressions ??= []).push({ company_id: 'co-a', scope: 'lead', value: 'L1', revoked_at: null });
    const id = await approvedTask();
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(res.outcome).toBe('blocked_governance');
    expect(res.governance?.blockingCondition).toBe('suppression.lead');
  });

  it('never dispatches a task that is not approved', async () => {
    configureTenant();
    const res = await insertOutreachTask(newTask()); // left `pending`
    const out = await dispatchInternalOutreachTask('co-a', res.data!.id as string, { now: NOW });
    expect(out.outcome).toBe('blocked_governance');
    expect(out.governance?.blockingCondition).toBe('eligibility.not_approved');
  });

  it('a DEFERRED governance verdict does not dispatch', async () => {
    configureTenant({ daily_limit_tenant: 0 });
    const id = await approvedTask();
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(res.outcome).toBe('deferred_governance');
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('approved');
    expect(db.tables.outreach_internal_work_items ?? []).toHaveLength(0);
  });

  it('governance is evaluated BEFORE any lifecycle change', async () => {
    configureTenant({ kill_switch: true });
    const id = await approvedTask();
    db.filtersSeen = [];
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    // No update to outreach_tasks was ever issued.
    expect(db.filtersSeen.filter((q) => q.table === 'outreach_tasks' && q.op === 'update')).toHaveLength(0);
  });
});

// ── 3. Idempotency and concurrency ──────────────────────────────────────────

describe('WS-3 M5A (3) — dispatch idempotency', () => {
  it('a second dispatch of the same task does NOT execute again', async () => {
    configureTenant();
    const id = await approvedTask();
    const first = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    const second = await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    expect(first.outcome).toBe('sent');
    // The task is no longer `approved`, so the claim fails — governance refuses
    // it first, which is the same protection arriving one gate earlier.
    expect(second.ok).toBe(false);
    expect(['skipped_already_dispatched', 'blocked_governance']).toContain(second.outcome);
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(1);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
  });

  it('exactly ONE of five concurrent dispatchers executes', async () => {
    configureTenant();
    const id = await approvedTask();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => dispatchInternalOutreachTask('co-a', id, { now: NOW })),
    );
    expect(results.filter((r) => r.outcome === 'sent')).toHaveLength(1);
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(1);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('sent');
  });

  it('the transport itself refuses to act twice for one attempt', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    const attemptId = (await listAttempts('co-a', id))[0].id as string;

    const { dispatchInternalTask } = require('../../services/leadOutreachExecution') as typeof import('../../services/leadOutreachExecution');
    const task = await getOutreachTaskById('co-a', id);
    const again = await dispatchInternalTask(task!, attemptId);
    // Independent of the lifecycle guard above it.
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(1);
  });

  it('dispatches distinct tasks independently', async () => {
    configureTenant();
    const a = await approvedTask({ planTaskId: 'task-1-a' });
    const b = await approvedTask({ planTaskId: 'task-2-b' });
    const results = await dispatchInternalBatch('co-a', [a, b], { now: NOW });
    expect(results.every((r) => r.outcome === 'sent')).toBe(true);
    expect(db.tables.outreach_internal_work_items).toHaveLength(2);
  });
});

// ── 4. Lifecycle ────────────────────────────────────────────────────────────

describe('WS-3 M5A (4) — lifecycle transitions', () => {
  it('walks approved → queued → dispatching → sent', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('sent');
  });

  it('returns the task to queued when quota defers it mid-dispatch', async () => {
    configureTenant({ daily_limit_tenant: 1 });
    const a = await approvedTask({ planTaskId: 'task-1-a' });
    const b = await approvedTask({ planTaskId: 'task-2-b' });
    expect((await dispatchInternalOutreachTask('co-a', a, { now: NOW })).outcome).toBe('sent');

    // The second is refused by the quota RESERVATION, after the claim.
    const second = await dispatchInternalOutreachTask('co-a', b, { now: NOW });
    expect(['deferred_quota', 'deferred_governance']).toContain(second.outcome);
    // Deferred, not failed — it stays dispatchable later.
    expect(['queued', 'approved']).toContain((await getOutreachTaskById('co-a', b))?.status);
    expect(await listInternalWorkItems('co-a', b)).toHaveLength(0);
  });

  it('implements NO transition beyond sent', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/dispatch.ts'), 'utf8');
    for (const later of ["'delivered'", "'completed'", "'retried'", "'paused'", "'resumed'", "'escalated'"]) {
      expect(src).not.toContain(later);
    }
  });

  it('rolls the task back to queued when the transport fails', async () => {
    configureTenant();
    const id = await approvedTask();
    db.failTable = 'outreach_internal_work_items';
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    db.failTable = null;

    expect(res.outcome).toBe('failed');
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('queued');
    // The attempt survives: evidence that something was tried.
    expect(await listAttempts('co-a', id)).toHaveLength(1);
  });
});

// ── 5. Durable quota ────────────────────────────────────────────────────────

describe('WS-3 M5A (5) — durable rate limiter', () => {
  it('reads durable usage from recorded attempts', async () => {
    configureTenant();
    const id = await approvedTask();
    expect(await readDurableUsage('co-a', 'L1', NOW)).toMatchObject({ tenantCount: 0, leadCount: 0, ok: true });
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(await readDurableUsage('co-a', 'L1', NOW)).toMatchObject({ tenantCount: 1, leadCount: 1, ok: true });
  });

  it('grants a reservation within limits and reports the layer', async () => {
    const r = await reserveQuota({ companyId: 'co-a', leadId: 'L1', at: NOW, dailyLimitTenant: 10, dailyLimitLead: 5 });
    expect(r).toMatchObject({ granted: true, layer: 'redis' });
  });

  it('falls back to the database when Redis is unavailable', async () => {
    fakeRedis.available = false;
    __resetQuotaRedisForTests();
    const r = await reserveQuota({ companyId: 'co-a', leadId: 'L1', at: NOW, dailyLimitTenant: 10, dailyLimitLead: 5 });
    // Correctness is unchanged; only the layer differs.
    expect(r).toMatchObject({ granted: true, layer: 'db' });
  });

  it('refuses a reservation over the limit and RELEASES what it took', async () => {
    const r = await reserveQuota({ companyId: 'co-a', leadId: 'L1', at: NOW, dailyLimitTenant: 0, dailyLimitLead: null });
    expect(r).toMatchObject({ granted: false });
    // The reservation must not leak — the counter is back where it started.
    expect(fakeRedis.store.get('ws3:quota:tenant:co-a') ?? 0).toBe(0);
  });

  it('REFUSES rather than assuming capacity when durable usage is unreadable', async () => {
    db.failTable = 'outreach_attempts';
    const r = await reserveQuota({ companyId: 'co-a', leadId: 'L1', at: NOW, dailyLimitTenant: 10, dailyLimitLead: 5 });
    db.failTable = null;
    expect(r).toMatchObject({ granted: false, layer: 'db' });
    expect(r.reason).toContain('refusing rather than assuming');
  });

  it('the database wins when Redis under-reports', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW }); // 1 durable attempt
    fakeRedis.store.set('ws3:quota:tenant:co-a', 0); // Redis reset / expired

    const r = await reserveQuota({ companyId: 'co-a', leadId: 'L1', at: NOW, dailyLimitTenant: 1, dailyLimitLead: null });
    // An optimization must never authorize what the truth refuses.
    expect(r.granted).toBe(false);
  });

  it('reconciles Redis to the durable count and reports drift', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    fakeRedis.store.set('ws3:quota:tenant:co-a', 99); // artificial drift
    const rec = await reconcileQuota('co-a', 'L1', NOW);
    expect(rec).toMatchObject({ reconciled: true, tenantCount: 1 });
    expect(rec.drift).toBe(98);
    // SET to the truth, never adjusted by a delta.
    expect(fakeRedis.store.get('ws3:quota:tenant:co-a')).toBe(1);
  });

  it('dispatch reconciles the fast path to the truth', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(fakeRedis.store.get('ws3:quota:tenant:co-a')).toBe(1);
  });
});

// ── 6. Observability ────────────────────────────────────────────────────────

describe('WS-3 M5A (6) — observability', () => {
  const of = (name: string) => registry.counterEntries().filter((c) => c.name === name);

  it('records dispatch outcomes and quota activity', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    const outcomes = of(OUTREACH_METRICS.dispatch.outcome).map((c) => String((c.labels ?? {}).outcome));
    expect(outcomes).toEqual(expect.arrayContaining(['started', 'sent']));
    expect(of(OUTREACH_METRICS.quota.reserved).length).toBeGreaterThan(0);
    expect(of(OUTREACH_METRICS.quota.reconciled).length).toBeGreaterThan(0);
  });

  it('records blocked and deferred distinctly', async () => {
    configureTenant({ kill_switch: true });
    await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    expect(of(OUTREACH_METRICS.dispatch.outcome).some((c) => (c.labels ?? {}).outcome === 'blocked')).toBe(true);
  });

  it('keeps cardinality bounded and leaks no identifiers', async () => {
    configureTenant();
    for (let i = 0; i < 20; i += 1) {
      const id = await approvedTask({ planTaskId: `task-${i}-x` });
      await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    }
    const series = registry.counterEntries().filter((c) => c.name.startsWith('outreach.'));
    // dispatch 6 + quota (2×2 + 2×2) + governance 24 → comfortably bounded.
    expect(series.length).toBeLessThanOrEqual(40);
    for (const s of series) {
      const labels = JSON.stringify(s.labels ?? {});
      expect(labels).not.toContain('co-a');
      expect(labels).not.toContain('L1');
    }
  });
});

// ── 7. Tenant isolation, immutability and guards ────────────────────────────

describe('WS-3 M5A (7) — isolation, immutability and guards', () => {
  it('every dispatch query is company-scoped', async () => {
    configureTenant();
    const id = await approvedTask();
    db.filtersSeen = [];
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    for (const q of db.filtersSeen) {
      if (q.op === 'insert') expect(q.payload?.company_id).toBe('co-a');
      else expect(q.filters.map(([c]) => c.replace(/^__\w+__/, ''))).toContain('company_id');
    }
  });

  it('attempts, evidence and work items are append-only', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => any };
    for (const table of ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_internal_work_items']) {
      const res = await ownedDbTable(table).update({ outcome: 'tampered' }).eq('company_id', 'co-a');
      expect(String(res.error?.message)).toContain('append-only');
    }
  });

  it('never mutates task provenance', async () => {
    configureTenant();
    const id = await approvedTask();
    const before = { ...db.tables.outreach_tasks[0] };
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    const after = db.tables.outreach_tasks[0];
    for (const col of ['planner_version', 'translation_version', 'governance_version', 'execution_runtime_version', 'materialized_at', 'plan_task_id']) {
      expect(after[col]).toBe(before[col]);
    }
  });

  it('has NO email, WhatsApp, LinkedIn, SMS, HTTP or third-party SDK anywhere', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    const src = fs.readdirSync(dir)
      .map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const forbidden of [
      'emailService', 'nodemailer', 'sendgrid', 'resend', 'postmark',
      'whatsapp', 'twilio', 'linkedin',
      'axios', 'node-fetch', 'undici', 'got',
      'communityAiActionExecutor', 'automationService', 'extension',
    ]) {
      expect(src).not.toMatch(new RegExp(`from\\s+'[^']*${forbidden}`, 'i'));
      expect(src).not.toMatch(new RegExp(`require\\(\\s*'[^']*${forbidden}`, 'i'));
    }
    expect(src).not.toMatch(/\bfetch\s*\(/);
    // WS-3 M5B: the ONE permitted timer is the email transport's request
    // timeout; a repeating timer (a retry loop or poller) is still banned.
    expect(src).not.toMatch(/\bsetInterval\s*\(/);
  });

  it('touches the queue package ONLY for the shared Redis client', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    const src = fs.readdirSync(dir).map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    for (const [, specifier] of src.matchAll(/from\s+'([^']*\/queue\/[^']*)'/g)) {
      expect(specifier).toMatch(/\/queue\/bullmqClient$/);
    }
    // Reusing the shared client is permitted; submitting work to a queue is not.
    expect(src).not.toMatch(/new\s+Queue\s*\(/);
    expect(src).not.toMatch(/\.add\s*\(\s*'/);
  });

  it('creates no business outcome and emits no feedback', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(db.tables.outreach_outcomes ?? []).toHaveLength(0);
  });
});
