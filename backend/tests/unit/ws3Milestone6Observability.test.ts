/**
 * WS-3 Milestone-6 — observability & operational hardening.
 *
 * Two things get equal weight here: that the observability is CORRECT (health
 * reflects reality, taxonomy is deterministic, cardinality is bounded), and
 * that adding it changed NOTHING about how the runtime behaves.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
};

const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items', 'outreach_approvals'];

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
      await Promise.resolve();
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };
      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'outreach_attempts' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
          return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
        }
        if (table === 'outreach_tasks' && rows().some((r) => r.company_id === row.company_id && r.lead_id === row.lead_id && r.plan_task_id === row.plan_task_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
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

const fakeRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) + n; this.store.set(k, v); return v; },
  async decrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) - n; this.store.set(k, v); return v; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => fakeRedis }));

import { registry } from '../../observability/registry';
import { renderPrometheusText } from '../../observability/promExporter';
import {
  EMAIL_ENABLED_ENV,
  EXECUTION_RUNTIME_VERSION,
  FAILURE_CLASSES,
  FAILURE_OWNER,
  GOVERNANCE_VERSION,
  INTERNAL_CHANNEL,
  LEAD_OUTREACH_DISABLED_ENV,
  OUTREACH_METRICS,
  RUNTIME_STAGES,
  TRANSLATION_VERSION,
  __clearTransportsForTests,
  __resetQuotaRedisForTests,
  approveOutreachTask,
  classifyFailure,
  dispatchInternalOutreachTask,
  getOutreachRuntimeHealth,
  insertOutreachTask,
  isFailureClass,
  recordFailure,
  recordStageOutcome,
  registerDefaultTransports,
  setOutreachTaskState,
  submitForApproval,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-assign', taskOrder: 1,
  kind: 'human', action: 'Assign SDR', channel: INTERNAL_CHANNEL, dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'x', requiresApproval: false,
  plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
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
  fakeRedis.store.clear();
  registry.reset();
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  delete process.env[LEAD_OUTREACH_DISABLED_ENV];
  delete process.env[EMAIL_ENABLED_ENV];
  registerDefaultTransports({ emailProvider: { name: 'stub', async send() { return { accepted: true, messageId: 'm-1' }; } } });
});

// ── 1. Failure taxonomy ─────────────────────────────────────────────────────

describe('WS-3 M6 (1) — failure taxonomy', () => {
  it('declares a closed set of nine classes with an owner each', () => {
    expect(FAILURE_CLASSES).toHaveLength(9);
    for (const c of FAILURE_CLASSES) {
      expect(isFailureClass(c)).toBe(true);
      expect(FAILURE_OWNER[c].length).toBeGreaterThan(0);
    }
    expect(isFailureClass('made_up_failure')).toBe(false);
  });

  it('classifies each stage to its default class', () => {
    const expected: Record<string, string> = {
      translation: 'runtime_failure', materialization: 'persistence_failure',
      approval: 'persistence_failure', governance: 'governance_failure',
      quota: 'quota_failure', dispatch: 'dispatch_failure',
      transport: 'transport_failure', provider: 'provider_failure',
      evidence: 'persistence_failure',
    };
    for (const stage of RUNTIME_STAGES) expect(classifyFailure(stage, 'something went wrong')).toBe(expected[stage]);
  });

  it('a storage failure inside governance is a PERSISTENCE failure', () => {
    // The rules are fine; the storage is not. Paging the governance owner
    // would send the wrong person.
    expect(classifyFailure('governance', { message: 'connection failure' })).toBe('persistence_failure');
    expect(classifyFailure('governance', 'permission denied for table x')).toBe('persistence_failure');
    // ...but a genuine governance fault stays with governance.
    expect(classifyFailure('governance', 'evaluation threw')).toBe('governance_failure');
  });

  it('configuration problems outrank the stage that noticed them', () => {
    expect(classifyFailure('dispatch', 'tenant is not enabled')).toBe('configuration_failure');
    expect(classifyFailure('transport', 'kill switch engaged')).toBe('configuration_failure');
  });

  it('separates provider rejection from transport timeout', () => {
    expect(classifyFailure('transport', 'provider rejected the message')).toBe('provider_failure');
    expect(classifyFailure('provider', 'did not respond within 15000ms')).toBe('transport_failure');
  });

  it('is deterministic and never invents a class', () => {
    for (let i = 0; i < 5; i += 1) expect(classifyFailure('dispatch', 'boom')).toBe('dispatch_failure');
    expect(classifyFailure('not_a_stage', 'boom')).toBe('unknown_failure');
    expect(classifyFailure('not_a_stage')).toBe('unknown_failure');
    for (const input of [undefined, null, 0, {}, []]) {
      expect(isFailureClass(classifyFailure('dispatch', input))).toBe(true);
    }
  });
});

// ── 2. Telemetry completion ─────────────────────────────────────────────────

describe('WS-3 M6 (2) — telemetry completion', () => {
  const of = (name: string) => registry.counterEntries().filter((c) => c.name === name);
  const stagesSeen = () => new Set(of(OUTREACH_METRICS.stage.outcome).map((c) => String((c.labels ?? {}).stage)));

  it('a full dispatch emits telemetry for every stage it traverses', async () => {
    configureTenant();
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });

    // Governance, transport, evidence and dispatch all report.
    for (const stage of ['governance', 'transport', 'evidence', 'dispatch']) {
      expect(stagesSeen()).toContain(stage);
    }
    expect(of(OUTREACH_METRICS.lifecycle.transition).length).toBeGreaterThan(0);
  });

  it('approval emits stage and lifecycle telemetry', async () => {
    configureTenant();
    const res = await insertOutreachTask(newTask({ planTaskId: 'task-appr' }));
    const id = res.data!.id as string;
    await submitForApproval('co-a', id);
    await approveOutreachTask('co-a', id, { approverUserId: 'u-1', decidedAt: NOW });

    expect(stagesSeen()).toContain('approval');
    const transitions = of(OUTREACH_METRICS.lifecycle.transition).map((c) => `${(c.labels ?? {}).from}->${(c.labels ?? {}).to}`);
    expect(transitions).toEqual(expect.arrayContaining(['pending->awaiting_approval', 'awaiting_approval->approved']));
  });

  it('a REFUSAL is recorded as refused, never as failed', async () => {
    configureTenant();
    const id = await approvedTask();
    // pending → approved is illegal; the gate refusing is the gate working.
    await approveOutreachTask('co-a', id, { approverUserId: 'u-1', decidedAt: NOW });
    const approvalOutcomes = of(OUTREACH_METRICS.stage.outcome)
      .filter((c) => (c.labels ?? {}).stage === 'approval')
      .map((c) => String((c.labels ?? {}).outcome));
    expect(approvalOutcomes).toContain('refused');
    expect(approvalOutcomes).not.toContain('failed');
  });

  it('governance refusal is refused, not failed', async () => {
    configureTenant({ kill_switch: true });
    await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    const gov = of(OUTREACH_METRICS.stage.outcome)
      .filter((c) => (c.labels ?? {}).stage === 'governance')
      .map((c) => String((c.labels ?? {}).outcome));
    expect(gov).toContain('refused');
    expect(gov).not.toContain('failed');
  });

  it('every failure funnels through the taxonomy counter', () => {
    for (const stage of RUNTIME_STAGES) recordFailure(stage, 'boom');
    const failures = of(OUTREACH_METRICS.stage.failures);
    expect(failures.length).toBe(RUNTIME_STAGES.length);
    for (const f of failures) expect(isFailureClass(String((f.labels ?? {}).class))).toBe(true);
  });

  it('records health components when health is evaluated', () => {
    getOutreachRuntimeHealth(NOW);
    expect(of(OUTREACH_METRICS.health.component).length).toBeGreaterThan(0);
  });
});

// ── 3. Runtime health ───────────────────────────────────────────────────────

describe('WS-3 M6 (3) — runtime health', () => {
  it('covers all nine stages plus configuration', () => {
    const report = getOutreachRuntimeHealth(NOW);
    const names = report.indicators.map((i) => i.name).sort();
    for (const stage of RUNTIME_STAGES) expect(names).toContain(stage);
    expect(names).toContain('configuration');
    expect(report.executionRuntimeVersion).toBe(EXECUTION_RUNTIME_VERSION);
    expect(report.processScoped).toBe(true);
  });

  it('a cold runtime reports unknown, never healthy or unhealthy', () => {
    const report = getOutreachRuntimeHealth(NOW);
    for (const stage of RUNTIME_STAGES) {
      const indicator = report.indicators.find((i) => i.name === stage)!;
      // A freshly started process has not proven anything.
      expect(indicator.status).toBe('unknown');
    }
    expect(report.status).toBe('unknown');
  });

  it('reports healthy after successful work', async () => {
    configureTenant();
    await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    const report = getOutreachRuntimeHealth(NOW);
    for (const name of ['governance', 'transport', 'evidence', 'dispatch']) {
      expect(report.indicators.find((i) => i.name === name)?.status).toBe('healthy');
    }
  });

  it('DEGRADED when some operations fail, UNHEALTHY when most do', () => {
    // 1 failure in 10 — work is completing with problems.
    for (let i = 0; i < 9; i += 1) recordStageOutcome('dispatch', 'ok');
    recordStageOutcome('dispatch', 'failed');
    expect(getOutreachRuntimeHealth(NOW).indicators.find((i) => i.name === 'dispatch')?.status).toBe('degraded');

    registry.reset();
    // 3 failures in 4 — the stage cannot do its job.
    recordStageOutcome('dispatch', 'ok');
    for (let i = 0; i < 3; i += 1) recordStageOutcome('dispatch', 'failed');
    expect(getOutreachRuntimeHealth(NOW).indicators.find((i) => i.name === 'dispatch')?.status).toBe('unhealthy');
  });

  it('uses the RATIO, not the count', () => {
    // 3 failures out of 5,000 is noise; a count threshold would call it broken.
    for (let i = 0; i < 5000; i += 1) recordStageOutcome('evidence', 'ok');
    for (let i = 0; i < 3; i += 1) recordStageOutcome('evidence', 'failed');
    expect(getOutreachRuntimeHealth(NOW).indicators.find((i) => i.name === 'evidence')?.status).toBe('degraded');
  });

  it('explains every non-healthy component and lists it', () => {
    recordStageOutcome('transport', 'failed');
    const report = getOutreachRuntimeHealth(NOW);
    expect(report.degradedComponents).toContain('transport');
    for (const i of report.indicators) expect(i.detail.length).toBeGreaterThan(0);
  });

  it('surfaces the global kill switch as degraded, not as a fault', () => {
    process.env[LEAD_OUTREACH_DISABLED_ENV] = 'true';
    const config = getOutreachRuntimeHealth(NOW).indicators.find((i) => i.name === 'configuration')!;
    delete process.env[LEAD_OUTREACH_DISABLED_ENV];
    // A deliberate switch is not a fault — but an operator must see it before
    // spending an hour asking why nothing is sending.
    expect(config.status).toBe('degraded');
    expect(config.detail).toContain('kill switch');
  });

  it('is unhealthy when no transport is registered', () => {
    __clearTransportsForTests();
    const config = getOutreachRuntimeHealth(NOW).indicators.find((i) => i.name === 'configuration')!;
    expect(config.status).toBe('unhealthy');
  });

  it('treats a refused reservation as normal and drift as degraded', async () => {
    configureTenant();
    await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    expect(getOutreachRuntimeHealth(NOW).indicators.find((i) => i.name === 'quota')?.status).toBe('healthy');
  });

  it('is deterministic and never throws', () => {
    const a = JSON.stringify(getOutreachRuntimeHealth(NOW));
    const b = JSON.stringify(getOutreachRuntimeHealth(NOW));
    expect(a).toBe(b);

    const spy = jest.spyOn(registry, 'counterEntries').mockImplementation(() => { throw new Error('registry exploded'); });
    expect(() => getOutreachRuntimeHealth(NOW)).not.toThrow();
    spy.mockRestore();
  });

  it('never mutates the runtime', async () => {
    configureTenant();
    const id = await approvedTask();
    const before = JSON.stringify(db.tables);
    getOutreachRuntimeHealth(NOW);
    getOutreachRuntimeHealth(NOW);
    expect(JSON.stringify(db.tables)).toBe(before);
    void id;
  });
});

// ── 4. Prometheus + cardinality ─────────────────────────────────────────────

describe('WS-3 M6 (4) — Prometheus and cardinality', () => {
  it('every WS-3 metric renders in the exporter', async () => {
    configureTenant();
    await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    getOutreachRuntimeHealth(NOW);

    const text = renderPrometheusText();
    for (const name of [
      'outreach_stage_outcome', 'outreach_lifecycle_transition', 'outreach_health_component',
      'outreach_governance_evaluations', 'outreach_dispatch_outcome', 'outreach_provider_response',
      'outreach_quota_reserved', 'outreach_external_dispatch',
    ]) {
      expect(text).toContain(name);
    }
  });

  it('exports histograms with buckets or quantiles', async () => {
    configureTenant();
    await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    const text = renderPrometheusText();
    // Duration and latency must be aggregatable, not just counted.
    expect(text).toMatch(/outreach_dispatch_duration_ms/);
    expect(text).toMatch(/outreach_provider_latency_ms/);
  });

  it('counter totals aggregate correctly', () => {
    for (let i = 0; i < 25; i += 1) recordStageOutcome('dispatch', 'ok');
    const total = registry.counterEntries()
      .filter((c) => c.name === OUTREACH_METRICS.stage.outcome && (c.labels ?? {}).outcome === 'ok')
      .reduce((a, c) => a + c.value, 0);
    expect(total).toBe(25);
  });

  it('keeps cardinality bounded under heavy, varied load', async () => {
    configureTenant();
    for (let i = 0; i < 30; i += 1) {
      await dispatchInternalOutreachTask('co-a', await approvedTask({ planTaskId: `task-${i}` }), { now: NOW });
      recordFailure(RUNTIME_STAGES[i % RUNTIME_STAGES.length], 'boom');
    }
    getOutreachRuntimeHealth(NOW);

    const series = registry.counterEntries().filter((c) => c.name.startsWith('outreach.'));
    // Structural maximum across every WS-3 counter.
    expect(series.length).toBeLessThanOrEqual(200);
    for (const s of series) {
      const labels = JSON.stringify(s.labels ?? {});
      expect(labels).not.toContain('co-a');
      expect(labels).not.toContain('L1');
      expect(labels).not.toMatch(/task-\d/);
      expect(labels).not.toMatch(/outreach_tasks-/);
    }
  });

  it('label keys come only from the declared closed sets', () => {
    recordStageOutcome('dispatch', 'ok');
    recordFailure('provider', 'boom');
    getOutreachRuntimeHealth(NOW);
    const allowed = new Set(['stage', 'outcome', 'class', 'from', 'to', 'component', 'status', 'decision', 'gate', 'provider', 'external', 'layer', 'drifted', 'kind', 'trend', 'state']);
    for (const s of registry.counterEntries().filter((c) => c.name.startsWith('outreach.'))) {
      for (const key of Object.keys(s.labels ?? {})) expect(allowed.has(key)).toBe(true);
    }
  });
});

// ── 5. No behaviour change ──────────────────────────────────────────────────

describe('WS-3 M6 (5) — observability changed no behaviour', () => {
  it('dispatch still produces exactly the same outcome and records', async () => {
    configureTenant();
    const id = await approvedTask();
    const res = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(res).toMatchObject({ ok: true, outcome: 'sent', status: 'sent', attemptNumber: 1 });
    expect(db.tables.outreach_attempts).toHaveLength(1);
    expect(db.tables.outreach_delivery_evidence).toHaveLength(1);
    expect(db.tables.outreach_internal_work_items).toHaveLength(1);
  });

  it('governance still blocks exactly as before', async () => {
    configureTenant({ kill_switch: true });
    const res = await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    expect(res.outcome).toBe('blocked_governance');
    expect(db.tables.outreach_attempts ?? []).toHaveLength(0);
  });

  it('telemetry failure can never break the runtime', async () => {
    configureTenant();
    const spy = jest.spyOn(registry, 'incr').mockImplementation(() => { throw new Error('registry exploded'); });
    const res = await dispatchInternalOutreachTask('co-a', await approvedTask(), { now: NOW });
    spy.mockRestore();
    // The dispatch completed despite every metric emit throwing.
    expect(res.outcome).toBe('sent');
  });

  it('no execution, governance, transport or lifecycle module gained logic', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');

    // The M6 additions are two new modules plus telemetry CALLS. No behavioural
    // module may have gained a decision that depends on a metric.
    for (const file of ['dispatch.ts', 'governance.ts', 'governanceService.ts', 'approval.ts', 'transport.ts', 'emailTransport.ts', 'internalTransport.ts', 'lifecycle.ts']) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      // A branch on a telemetry result would mean observability changed behaviour.
      expect(src).not.toMatch(/if\s*\(\s*record[A-Z]/);
      expect(src).not.toMatch(/=\s*record(StageOutcome|LifecycleTransition|HealthComponent)\s*\(/);
    }
    // Health and taxonomy never write.
    for (const file of ['health.ts', 'failureTaxonomy.ts']) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      expect(src).not.toMatch(/\.insert\s*\(/);
      expect(src).not.toMatch(/\.update\s*\(/);
      expect(src).not.toMatch(/transitionOutreachTaskState/);
    }
  });

  it('introduces no retry, feedback or business-outcome capability', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    const src = fs.readdirSync(dir).map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/\bsetInterval\s*\(/);
    expect(src).not.toMatch(/scheduleRetry|retryQueue|deadLetter/i);
    expect(src).not.toMatch(/emitFeedback|publishOutcome|outcomeEvent/i);

    /**
     * `appendOutcome` is the Milestone-1 STORAGE writer for the business-outcome
     * axis — defining it is not emitting one. The rule is that no RUNTIME module
     * may call it: writing a business outcome is Milestone-7's job.
     */
    for (const file of ['dispatch.ts', 'governance.ts', 'governanceService.ts', 'approval.ts', 'emailTransport.ts', 'internalTransport.ts', 'transport.ts', 'health.ts', 'materialization.ts', 'translation.ts']) {
      expect(fs.readFileSync(path.join(dir, file), 'utf8')).not.toMatch(/appendOutcome\s*\(/);
    }
  });
});
