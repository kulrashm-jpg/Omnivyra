/**
 * WS-3 Milestone-4 — governance evaluation engine.
 *
 * The pure evaluator is tested directly with constructed context (no I/O), and
 * the service is tested against a database double that mirrors the real
 * constraints. Fail-closed behaviour gets particular attention: a governance
 * layer that permits when it cannot read its own rules is worse than no
 * governance layer, because it looks like one.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  filtersSeen: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload: Row | null }>,
  /** Fails reads/writes for one specific table — used for fail-closed tests. */
  failTable: null as string | null,
};

const APPEND_ONLY = ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions'];

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
      db.filtersSeen.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };

      if (st.op === 'insert') {
        const created = { ...(st.payload as Row), id: `row-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        // Message mirrors the real trigger verbatim, so assertions written
        // against the double hold against PostgreSQL too.
        if (APPEND_ONLY.includes(table)) {
          return { data: null, error: { code: '2F004', message: `ws3_append_only: ${table} is append-only; UPDATE is not permitted` } };
        }
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

import { registry } from '../../observability/registry';
import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  LEAD_OUTREACH_DISABLED_ENV,
  OUTREACH_METRICS,
  TRANSLATION_VERSION,
  evaluateBatchGovernance,
  evaluateEligibility,
  evaluateGovernance,
  evaluateKillSwitch,
  evaluateRateLimit,
  evaluateRegion,
  evaluateSuppression,
  evaluateTaskGovernance,
  getGovernanceHistory,
  getLatestGovernanceDecision,
  insertOutreachTask,
  isLeadOutreachGloballyDisabled,
  loadSuppressionMatches,
  loadTenantGovernanceConfig,
  setOutreachTaskState,
  type GovernanceEvaluationInput,
  type NewOutreachTask,
  type OutreachTask,
} from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';

const task = (over: Partial<OutreachTask> = {}): OutreachTask => ({
  id: 'task-uuid-1', companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-intro',
  taskOrder: 1, kind: 'outreach', action: 'Send intro', channel: 'email',
  dependsOnPlanTaskId: null, estimatedDelayHours: 0, confidence: 0.7, explanation: 'x',
  status: 'approved', deliveryStatus: null, requiresApproval: true,
  plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, createdAt: NOW, updatedAt: NOW, ...over,
});

const input = (over: Partial<GovernanceEvaluationInput> = {}): GovernanceEvaluationInput => ({
  task: task(),
  config: {
    companyId: 'co-a', configured: true, enabled: true, killSwitch: false,
    enabledChannels: ['email', 'internal'], restrictedRegions: [],
    dailyLimitTenant: null, dailyLimitLead: null,
  },
  suppressions: { task: false, lead: false, channel: false, recipient: false },
  usage: { tenantCount: 0, leadCount: 0, windowHours: 24, layer: 'db' },
  globalKillSwitch: false,
  region: null,
  evaluatedAt: NOW,
  ...over,
});

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-intro', taskOrder: 1,
  kind: 'outreach', action: 'Send intro', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.7, explanation: 'x', requiresApproval: true,
  plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

const configureTenant = (over: Row = {}) => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: 'co-a', enabled: true, kill_switch: false,
    enabled_channels: ['email', 'internal'], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null, ...over,
  });
};

const seedApprovedTask = async (): Promise<string> => {
  const res = await insertOutreachTask(newTask());
  const id = res.data!.id as string;
  await setOutreachTaskState('co-a', id, { status: 'approved' });
  return id;
};

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.filtersSeen = [];
  db.failTable = null;
  registry.reset();
  delete process.env[LEAD_OUTREACH_DISABLED_ENV];
});

// ── 1. Individual gates ─────────────────────────────────────────────────────

describe('WS-3 M4 (1) — kill switch and tenant enablement', () => {
  it('blocks on the global kill switch', () => {
    const r = evaluateKillSwitch(input({ globalKillSwitch: true }));
    expect(r).toMatchObject({ decision: 'blocked', rule: 'global.kill_switch', scope: 'global' });
    expect(r.reason).toContain('global');
  });

  it('blocks on the tenant kill switch', () => {
    const r = evaluateKillSwitch(input({ config: { ...input().config, killSwitch: true } }));
    expect(r).toMatchObject({ decision: 'blocked', rule: 'tenant.kill_switch', scope: 'tenant' });
  });

  it('blocks an UNCONFIGURED tenant — restrictive by default', () => {
    // Failing open here would let a tenant nobody set up contact people.
    const r = evaluateKillSwitch(input({ config: { ...input().config, configured: false, enabled: false } }));
    expect(r).toMatchObject({ decision: 'blocked', rule: 'tenant.enablement' });
    expect(r.evidence).toMatchObject({ configured: false });
  });

  it('blocks a configured-but-disabled tenant', () => {
    const r = evaluateKillSwitch(input({ config: { ...input().config, enabled: false } }));
    expect(r).toMatchObject({ decision: 'blocked', rule: 'tenant.enablement' });
  });

  it('allows an enabled tenant with no switch engaged', () => {
    expect(evaluateKillSwitch(input())).toMatchObject({ decision: 'allowed' });
  });

  it('uses a kill switch INDEPENDENT of the community runtime', () => {
    process.env.GLOBAL_AUTOMATION_DISABLED = 'true';
    expect(isLeadOutreachGloballyDisabled()).toBe(false); // community switch does not govern outreach
    process.env[LEAD_OUTREACH_DISABLED_ENV] = 'true';
    expect(isLeadOutreachGloballyDisabled()).toBe(true);
    delete process.env.GLOBAL_AUTOMATION_DISABLED;
  });
});

describe('WS-3 M4 (2) — suppression', () => {
  it('blocks a suppressed recipient first — the compliance case', () => {
    const r = evaluateSuppression(input({ suppressions: { task: true, lead: true, channel: true, recipient: true } }));
    expect(r).toMatchObject({ decision: 'blocked', rule: 'suppression.recipient', scope: 'recipient' });
  });

  it.each([
    ['lead', { task: false, lead: true, channel: false, recipient: false }, 'suppression.lead'],
    ['task', { task: true, lead: false, channel: false, recipient: false }, 'suppression.task'],
    ['channel', { task: false, lead: false, channel: true, recipient: false }, 'suppression.channel'],
  ])('blocks a suppressed %s', (_label, suppressions, rule) => {
    expect(evaluateSuppression(input({ suppressions }))).toMatchObject({ decision: 'blocked', rule });
  });

  it('blocks a channel the tenant has not enabled', () => {
    const r = evaluateSuppression(input({ task: task({ channel: 'linkedin' }) }));
    expect(r).toMatchObject({ decision: 'blocked', rule: 'suppression.channel_not_enabled', scope: 'channel' });
    expect(r.evidence).toMatchObject({ enabledChannels: ['email', 'internal'] });
  });

  it('allows when nothing is suppressed and the channel is enabled', () => {
    expect(evaluateSuppression(input())).toMatchObject({ decision: 'allowed', rule: 'suppression.none' });
  });

  it('never records a suppression VALUE in evidence', () => {
    // The value is exactly the personal data the suppression protects.
    const r = evaluateSuppression(input({ suppressions: { task: false, lead: false, channel: false, recipient: true } }));
    expect(JSON.stringify(r.evidence)).not.toMatch(/@/);
  });
});

describe('WS-3 M4 (3) — regional compliance', () => {
  it('blocks a restricted region', () => {
    const r = evaluateRegion(input({ region: 'de', config: { ...input().config, restrictedRegions: ['DE', 'FR'] } }));
    expect(r).toMatchObject({ decision: 'blocked', rule: 'region.restricted', scope: 'region' });
    expect(r.evidence).toMatchObject({ region: 'DE' }); // normalized
  });

  it('allows a permitted region', () => {
    expect(evaluateRegion(input({ region: 'US', config: { ...input().config, restrictedRegions: ['DE'] } })))
      .toMatchObject({ decision: 'allowed', rule: 'region.permitted' });
  });

  it('an UNKNOWN region does not block', () => {
    // Missing evidence is not evidence of a violation. Blocking here would
    // silently halt all outreach for any tenant with a restriction list
    // whenever geo data is absent.
    const r = evaluateRegion(input({ region: null, config: { ...input().config, restrictedRegions: ['DE'] } }));
    expect(r).toMatchObject({ decision: 'allowed', rule: 'region.unknown' });
  });

  it('ignores a malformed region rather than trusting it', () => {
    expect(evaluateRegion(input({ region: 'NOT_A_REGION', config: { ...input().config, restrictedRegions: ['DE'] } })))
      .toMatchObject({ decision: 'allowed', rule: 'region.unknown' });
  });
});

describe('WS-3 M4 (4) — task eligibility', () => {
  it('allows an approved task', () => {
    expect(evaluateEligibility(input())).toMatchObject({ decision: 'allowed', rule: 'eligibility.approved' });
  });

  it.each(['pending', 'awaiting_approval', 'rejected', 'cancelled', 'expired', 'completed'] as const)(
    'blocks a task in %s',
    (status) => {
      const r = evaluateEligibility(input({ task: task({ status }) }));
      expect(r).toMatchObject({ decision: 'blocked', rule: 'eligibility.not_approved' });
      expect(r.evidence).toMatchObject({ status });
    },
  );
});

describe('WS-3 M4 (5) — durable rate limiter (evaluation only)', () => {
  it('allows when usage is within limits', () => {
    const r = evaluateRateLimit(input({
      config: { ...input().config, dailyLimitTenant: 100, dailyLimitLead: 5 },
      usage: { tenantCount: 10, leadCount: 1, windowHours: 24, layer: 'db' },
    }));
    expect(r).toMatchObject({ decision: 'allowed', limiterLayer: 'db' });
  });

  it('DEFERS rather than blocks when the lead limit is reached', () => {
    // Rate limiting is backpressure — a deferred task proceeds later untouched.
    const r = evaluateRateLimit(input({
      config: { ...input().config, dailyLimitLead: 3 },
      usage: { tenantCount: 0, leadCount: 3, windowHours: 24, layer: 'db' },
    }));
    expect(r).toMatchObject({ decision: 'deferred', rule: 'rate_limit.lead', scope: 'lead' });
    expect(r.reason).toContain('3-per-24h');
  });

  it('defers when the tenant limit is reached', () => {
    const r = evaluateRateLimit(input({
      config: { ...input().config, dailyLimitTenant: 20 },
      usage: { tenantCount: 20, leadCount: 0, windowHours: 24, layer: 'db' },
    }));
    expect(r).toMatchObject({ decision: 'deferred', rule: 'rate_limit.tenant', scope: 'tenant' });
  });

  it('applies no limit when none is configured', () => {
    expect(evaluateRateLimit(input({ usage: { tenantCount: 9999, leadCount: 9999, windowHours: 24, layer: 'db' } })))
      .toMatchObject({ decision: 'allowed' });
  });

  it('reports which durable layer answered', () => {
    expect(evaluateRateLimit(input()).limiterLayer).toBe('db');
  });
});

// ── 2. The engine ───────────────────────────────────────────────────────────

describe('WS-3 M4 (6) — engine: ordering, short-circuit, determinism', () => {
  it('allows a clean task and evaluates every gate', () => {
    const r = evaluateGovernance(input());
    expect(r.decision).toBe('allowed');
    expect(r.blockedBy).toBeNull();
    expect(r.gates.map((g) => g.gate)).toEqual(['kill_switch', 'suppression', 'region', 'approval', 'rate_limit']);
    expect(r.governanceVersion).toBe(GOVERNANCE_VERSION);
    expect(r.evaluatedAt).toBe(NOW);
  });

  it('short-circuits at the FIRST refusal', () => {
    const r = evaluateGovernance(input({ globalKillSwitch: true }));
    expect(r.decision).toBe('blocked');
    expect(r.blockedBy).toBe('kill_switch');
    expect(r.gates).toHaveLength(1); // nothing after the refusal is evaluated
  });

  it('never spends the rate limiter on an already-refused task', () => {
    // The frozen ordering exists precisely so quota is not consumed by a task
    // another gate would have blocked.
    const r = evaluateGovernance(input({
      task: task({ status: 'pending' }),
      config: { ...input().config, dailyLimitTenant: 0 },
    }));
    expect(r.blockedBy).toBe('approval');
    expect(r.gates.some((g) => g.gate === 'rate_limit')).toBe(false);
  });

  it('evaluates gates in the frozen dispatch order', () => {
    const order = ['kill_switch', 'suppression', 'region', 'approval', 'rate_limit'];
    for (let i = 0; i < order.length; i += 1) {
      // Refuse only at position i and confirm exactly i+1 gates ran.
      const refusals: Partial<GovernanceEvaluationInput>[] = [
        { globalKillSwitch: true },
        { suppressions: { task: true, lead: false, channel: false, recipient: false } },
        { region: 'DE', config: { ...input().config, restrictedRegions: ['DE'] } },
        { task: task({ status: 'pending' }) },
        { config: { ...input().config, dailyLimitTenant: 0 } },
      ];
      const r = evaluateGovernance(input(refusals[i]));
      expect(r.gates).toHaveLength(i + 1);
      expect(r.blockedBy).toBe(order[i]);
    }
  });

  it('is deterministic — identical input yields byte-identical output', () => {
    const a = evaluateGovernance(input());
    const b = evaluateGovernance(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is deterministic under concurrency and reads no clock', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, async () => {
      await Promise.resolve();
      return JSON.stringify(evaluateGovernance(input()));
    }));
    expect(new Set(results).size).toBe(1);
    expect(evaluateGovernance(input()).evaluatedAt).toBe(NOW);
  });

  it('never mutates its input', () => {
    const i = input();
    const before = JSON.stringify(i);
    evaluateGovernance(i);
    evaluateGovernance(i);
    expect(JSON.stringify(i)).toBe(before);
  });

  it('propagates a deferred verdict as the overall decision', () => {
    const r = evaluateGovernance(input({
      config: { ...input().config, dailyLimitTenant: 1 },
      usage: { tenantCount: 5, leadCount: 0, windowHours: 24, layer: 'db' },
    }));
    expect(r.decision).toBe('deferred');
    expect(r.blockedBy).toBe('rate_limit');
  });
});

// ── 3. Explainability ───────────────────────────────────────────────────────

describe('WS-3 M4 (7) — explainability', () => {
  it('every gate exposes rule, decision, reason and evidence', () => {
    for (const g of evaluateGovernance(input()).gates) {
      expect(g.rule.length).toBeGreaterThan(0);
      expect(['allowed', 'blocked', 'deferred']).toContain(g.decision);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(typeof g.evidence).toBe('object');
    }
  });

  it('a refusal names the blocking condition and explains it', () => {
    const r = evaluateGovernance(input({ suppressions: { task: false, lead: false, channel: false, recipient: true } }));
    expect(r.blockedBy).toBe('suppression');
    expect(r.blockingCondition).toBe('suppression.recipient');
    expect(r.reasoning).toContain('suppression.recipient');
    expect(r.reasoning).toContain('do-not-contact');
  });

  it('an allowed evaluation still explains itself', () => {
    expect(evaluateGovernance(input()).reasoning).toContain('none refused');
  });
});

// ── 4. Service surface ──────────────────────────────────────────────────────

describe('WS-3 M4 (8) — service, persistence and fail-closed behaviour', () => {
  it('evaluates a real task and records the decision immutably', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    const res = await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });

    expect(res.ok).toBe(true);
    expect(res.evaluation?.decision).toBe('allowed');
    expect(res.recorded).toBe(true);

    const history = await getGovernanceHistory('co-a', id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ decision: 'allowed', gate: 'rate_limit', governance_version: GOVERNANCE_VERSION });
  });

  it('records a refusal with its gate and reason', async () => {
    configureTenant({ kill_switch: true });
    const id = await seedApprovedTask();
    await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    const latest = await getLatestGovernanceDecision('co-a', id);
    expect(latest).toMatchObject({ decision: 'denied', gate: 'kill_switch' });
    expect(String(latest!.reason)).toContain('tenant.kill_switch');
  });

  it('blocks when the tenant has NO configuration row', async () => {
    const id = await seedApprovedTask(); // no configureTenant()
    const res = await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    expect(res.evaluation).toMatchObject({ decision: 'blocked', blockingCondition: 'tenant.enablement' });
  });

  it('FAILS CLOSED when the suppression list cannot be read', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    db.failTable = 'outreach_suppressions';
    const res = await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    db.failTable = null;
    // Treating an unreadable suppression list as "nobody is suppressed" would
    // contact people who asked not to be — the worst failure this system has.
    expect(res.evaluation?.decision).toBe('blocked');
    expect(res.evaluation?.blockedBy).toBe('suppression');
  });

  it('FAILS CLOSED when the tenant configuration cannot be read', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    db.failTable = 'outreach_governance_config';
    const res = await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    db.failTable = null;
    expect(res.evaluation?.decision).toBe('blocked');
    expect(res.evaluation?.blockingCondition).toBe('tenant.enablement');
  });

  it('DEFERS when usage cannot be read', async () => {
    configureTenant({ daily_limit_tenant: 10 });
    const id = await seedApprovedTask();
    db.failTable = 'outreach_attempts';
    const res = await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    db.failTable = null;
    expect(res.evaluation?.decision).toBe('deferred');
  });

  it('refuses an unknown or foreign task without evaluating', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    expect(await evaluateTaskGovernance('co-a', 'nope', { evaluatedAt: NOW })).toMatchObject({ ok: false, evaluation: null });
    expect(await evaluateTaskGovernance('co-b', id, { evaluatedAt: NOW })).toMatchObject({ ok: false, evaluation: null });
  });

  it('can evaluate without recording', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    const res = await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW, recordDecision: false });
    expect(res.ok).toBe(true);
    expect(res.recorded).toBe(false);
    expect(await getGovernanceHistory('co-a', id)).toHaveLength(0);
  });

  it('history accumulates and is append-only', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    await evaluateTaskGovernance('co-a', id, { evaluatedAt: '2026-08-06T12:00:00.000Z' });
    expect(await getGovernanceHistory('co-a', id)).toHaveLength(2);

    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => any };
    const upd = await ownedDbTable('outreach_decisions').update({ decision: 'allowed' }).eq('company_id', 'co-a');
    expect(String(upd.error?.message)).toContain('append-only');
  });

  it('evaluates a batch independently', async () => {
    configureTenant();
    const a = await seedApprovedTask();
    const bRes = await insertOutreachTask(newTask({ planTaskId: 'task-2-followup' }));
    const b = bRes.data!.id as string; // left in `pending`

    const results = await evaluateBatchGovernance('co-a', [a, b, 'missing'], { evaluatedAt: NOW });
    expect(results).toHaveLength(3);
    expect(results[0].evaluation?.decision).toBe('allowed');
    expect(results[1].evaluation?.blockingCondition).toBe('eligibility.not_approved');
    expect(results[2].ok).toBe(false); // one failure does not stop the batch
  });

  it('reads suppression and config in a company-scoped way', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    db.filtersSeen = [];
    await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    for (const q of db.filtersSeen) {
      if (q.op === 'insert') expect(q.payload?.company_id).toBe('co-a');
      else expect(q.filters.map(([c]) => c.replace(/^__\w+__/, ''))).toContain('company_id');
    }
  });

  it('resolves suppression matches from stored rows, ignoring revoked ones', async () => {
    (db.tables.outreach_suppressions ??= []).push(
      { company_id: 'co-a', scope: 'recipient', value: 'CTO@bigcorp.com', revoked_at: null },
      { company_id: 'co-a', scope: 'channel', value: 'email', revoked_at: '2026-08-01T00:00:00.000Z' },
    );
    const matches = await loadSuppressionMatches('co-a', task(), 'cto@bigcorp.com');
    expect(matches.recipient).toBe(true);  // case-insensitive
    expect(matches.channel).toBe(false);   // revoked suppressions do not apply
  });

  it('loads tenant configuration faithfully', async () => {
    configureTenant({ enabled: true, restricted_regions: ['DE'], daily_limit_lead: 3 });
    const cfg = await loadTenantGovernanceConfig('co-a');
    expect(cfg).toMatchObject({ configured: true, enabled: true, restrictedRegions: ['DE'], dailyLimitLead: 3 });
    expect(await loadTenantGovernanceConfig('co-unknown')).toMatchObject({ configured: false, enabled: false });
  });
});

// ── 5. Observability ────────────────────────────────────────────────────────

describe('WS-3 M4 (9) — observability', () => {
  const counters = (name: string) => registry.counterEntries().filter((c) => c.name === name);

  it('records the overall decision and every gate verdict', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });

    expect(counters(OUTREACH_METRICS.governance.evaluations).some((c) => (c.labels ?? {}).decision === 'allowed')).toBe(true);
    expect(counters(OUTREACH_METRICS.governance.gate).length).toBe(5); // one per gate
  });

  it('records a failure distinctly from a block', async () => {
    // A broken governance layer must not look like a quiet one.
    await evaluateTaskGovernance('co-a', 'no-such-task', { evaluatedAt: NOW });
    expect(counters(OUTREACH_METRICS.governance.failures).length).toBeGreaterThan(0);
  });

  it('keeps cardinality bounded and leaks no identifiers', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    for (let i = 0; i < 50; i += 1) await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });

    const series = registry.counterEntries().filter((c) => c.name.startsWith('outreach.governance.'));
    // 3 decisions + (6 gates × 3 decisions) + 3 failure stages = 24 max.
    expect(series.length).toBeLessThanOrEqual(24);
    for (const s of series) {
      // Keys are sorted, so the gate series reads "decision,gate".
      expect(Object.keys(s.labels ?? {}).sort().join(',')).toMatch(/^(decision|decision,gate|stage)$/);
      expect(JSON.stringify(s.labels)).not.toContain('co-a');
      expect(JSON.stringify(s.labels)).not.toContain(id);
    }
  });
});

// ── 6. Guards ───────────────────────────────────────────────────────────────

describe('WS-3 M4 (10) — guards against premature capability', () => {
  const source = (): string => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    return fs.readdirSync(dir)
      .map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  };

  it('imports no external transport, HTTP client, scheduler or community-runtime module', () => {
    const src = source();
    for (const forbidden of [
      'emailService', 'whatsapp', 'twilio', 'sendgrid', 'resend', 'nodemailer',
      'communityAiActionExecutor', 'automationService', 'automationConstants',
      'axios', 'node-fetch', 'undici', 'extension', 'workerTopology',
      'schedulingService', 'cron', 'ioredis',
    ]) {
      expect(src).not.toMatch(new RegExp(`from\\s+'[^']*${forbidden}`, 'i'));
      expect(src).not.toMatch(new RegExp(`require\\(\\s*'[^']*${forbidden}`, 'i'));
    }

    /**
     * WS-3 M5A: the durable limiter's Redis fast path is now in scope, and the
     * architecture requires reusing the platform's SHARED client rather than
     * constructing one. So the queue package may be imported for exactly that
     * — `bullmqClient` — and for nothing else. Submitting work to a BullMQ
     * queue remains out of scope until a milestone that needs it.
     */
    const queueImports = [...src.matchAll(/from\s+'([^']*\/queue\/[^']*)'/g)].map((m) => m[1]);
    for (const specifier of queueImports) expect(specifier).toMatch(/\/queue\/bullmqClient$/);
    expect(src).not.toMatch(/new\s+Queue\s*\(/);
    expect(src).not.toMatch(/\.add\s*\(\s*'/);
  });

  it('creates no timer, scheduler or network call', () => {
    const src = source();
    expect(src).not.toMatch(/\bfetch\s*\(/);
    // WS-3 M5B: the email transport owns exactly one timer — its request
    // timeout. Governance itself must still contain none.
    const govSrc = (require('fs') as typeof import('fs')).readFileSync(
      (require('path') as typeof import('path')).join(process.cwd(), 'backend/services/leadOutreachExecution/governance.ts'), 'utf8',
    ) + (require('fs') as typeof import('fs')).readFileSync(
      (require('path') as typeof import('path')).join(process.cwd(), 'backend/services/leadOutreachExecution/governanceService.ts'), 'utf8',
    );
    expect(govSrc).not.toMatch(/\bsetTimeout\s*\(/);
    expect(govSrc).not.toMatch(/\bsetInterval\s*\(/);
    expect(src).not.toMatch(/\.enqueue\s*\(/);
  });

  it('the pure evaluator performs no I/O at all', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const pure = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/governance.ts'), 'utf8');
    for (const io of ['ownedDbTable', 'supabase', 'fetch(', 'Date.now', 'new Date(']) {
      expect(pure).not.toContain(io);
    }
  });

  it('creates no execution attempt or delivery evidence', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    expect(db.tables.outreach_attempts ?? []).toHaveLength(0);
    expect(db.tables.outreach_delivery_evidence ?? []).toHaveLength(0);
    expect(db.tables.outreach_outcomes ?? []).toHaveLength(0);
  });

  it('never changes a task’s status', async () => {
    configureTenant();
    const id = await seedApprovedTask();
    await evaluateTaskGovernance('co-a', id, { evaluatedAt: NOW });
    // Evaluation is a statement about eligibility, not an action on the task.
    expect(db.tables.outreach_tasks[0].status).toBe('approved');
  });
});
