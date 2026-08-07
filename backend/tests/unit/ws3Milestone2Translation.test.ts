/**
 * WS-3 Milestone-2 — AutomationTask → OutreachTask translation (dry-run).
 *
 * Translation is driven by a REAL WS-2 plan built through the actual planning
 * and automation engines, not a hand-written fixture. That matters: the
 * identity contract depends on how the planner derives `task-<order>-<slug>`,
 * so a fixture that merely imitates that shape would prove nothing about the
 * real system.
 *
 * The database double mirrors the Milestone-1 constraints (identity uniqueness,
 * append-only, provenance immutability) so a violation fails here exactly as it
 * does in PostgreSQL.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  filtersSeen: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]> }>,
  forceError: null as null | { code?: string; message?: string },
};

const IMMUTABLE_TASK_COLS = ['company_id', 'lead_id', 'plan_task_id', 'planner_version', 'translation_version', 'governance_version', 'execution_runtime_version', 'materialized_at'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) => st.filters.every(([c, v]) => r[c] === v);

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.filtersSeen.push({ table, op: st.op, filters: st.filters });
      if (db.forceError) return { data: null, error: db.forceError };

      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'outreach_tasks' && rows().some((r) => r.company_id === row.company_id && r.lead_id === row.lead_id && r.plan_task_id === row.plan_task_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates outreach_tasks_identity_unique' } };
        }
        const created = { ...row, id: `row-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z', updated_at: '2026-08-05T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const touched = Object.keys(st.payload ?? {});
        if (table === 'outreach_tasks' && touched.some((c) => IMMUTABLE_TASK_COLS.includes(c))) {
          return { data: null, error: { code: '2F004', message: 'ws3_immutable_provenance' } };
        }
        for (const r of rows()) if (matches(r)) Object.assign(r, st.payload);
        return { data: null, error: null };
      }
      const found = rows().filter(matches);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import {
  assembleLeadCaptureSnapshot,
  analyzeBehavior,
  classifyPersona,
  computeIntentIntelligence,
  defaultEngineConfig,
} from '../../services/leadIntelligenceEngine';
import { buildQualificationPlanningSummary } from '../../services/qualificationPlanning';
import { buildAutomationSummary } from '../../services/automationExecution';
import type { AutomationSummary } from '../../services/automationExecution/types';
import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  TRANSLATION_VERSION,
  getOutreachTask,
  listOutreachTasksForLead,
  materializeAutomationPlan,
  setOutreachTaskState,
  translateAutomationPlan,
  type TranslationContext,
} from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';
const PLANNER_VERSION = 'lie-2.1.0';

/** A real WS-2 plan for an engaged, well-qualified lead. */
function realPlan(over: { pages?: string[]; jobTitle?: string } = {}): AutomationSummary {
  const pages = over.pages ?? ['/pricing', '/demo', '/security', '/case-studies/a', '/enterprise'];
  const snapshot = assembleLeadCaptureSnapshot({
    leadRow: {
      id: 'L1', company_id: 'co-a', email: 'cto@bigcorp.com', created_at: '2026-08-04T09:00:00.000Z',
      visitor_session_id: 'vs-1',
      metadata: { job_title: over.jobTitle ?? 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
    },
    trackingEventRows: pages.map((p, i) => ({
      id: `e${i}`, event_name: 'page_view', page_url: `https://x.test${p}`,
      visitor_session_id: 'vs-1', occurred_at: `2026-08-04T08:0${i}:00.000Z`, metadata: { scroll_depth: 90 },
    })),
    visitorSessionRows: [{
      id: 'vs-1', started_at: '2026-08-04T08:00:00.000Z', last_seen_at: '2026-08-04T08:30:00.000Z',
      metadata: { visitor: { visit_count: 3, returning_visitor: true, first_visit_at: '2026-07-20T09:00:00.000Z' } },
    }],
    touchpointRows: [],
    now: NOW,
  });
  const behavior = analyzeBehavior(snapshot, defaultEngineConfig);
  const intent = computeIntentIntelligence(snapshot, defaultEngineConfig, behavior);
  const persona = classifyPersona(snapshot, defaultEngineConfig, behavior);
  const planning = buildQualificationPlanningSummary({ snapshot, intent, persona });
  return buildAutomationSummary({ summary: planning });
}

const ctx = (over: Partial<TranslationContext> = {}): TranslationContext => ({
  companyId: 'co-a',
  leadId: 'L1',
  plannerVersion: PLANNER_VERSION,
  ...over,
});

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.filtersSeen = [];
  db.forceError = null;
});

// ── 1. Translation correctness ──────────────────────────────────────────────

describe('WS-3 M2 (1) — translation correctness', () => {
  it('translates every plan task, preserving its structural shape', () => {
    const plan = realPlan();
    expect(plan.tasks.length).toBeGreaterThan(0);

    const result = translateAutomationPlan(plan, ctx());
    expect(result.tasks).toHaveLength(plan.tasks.length);

    for (const [i, planTask] of plan.tasks.entries()) {
      const task = result.tasks[i];
      expect(task.planTaskId).toBe(planTask.id);
      expect(task.taskOrder).toBe(planTask.order);
      expect(task.kind).toBe(planTask.kind);
      expect(task.action).toBe(planTask.action);
      expect(task.channel).toBe(planTask.channel);
      expect(task.dependsOnPlanTaskId).toBe(planTask.dependsOn);
      expect(task.estimatedDelayHours).toBe(planTask.estimatedDelayHours);
      expect(task.confidence).toBe(planTask.confidence);
      expect(task.explanation).toBe(planTask.explanation);
      expect(task.companyId).toBe('co-a');
      expect(task.leadId).toBe('L1');
    }
  });

  it('NEVER mutates the AutomationTask it reads', () => {
    const plan = realPlan();
    const before = JSON.stringify(plan);
    translateAutomationPlan(plan, ctx());
    translateAutomationPlan(plan, ctx({ companyId: 'co-b' }));
    expect(JSON.stringify(plan)).toBe(before);
  });

  it('stamps requiresApproval from the plan’s own review assessment', () => {
    const plan = realPlan();
    const result = translateAutomationPlan(plan, ctx());
    // A field copy, not approval routing — every task inherits the plan-level
    // review requirement, and nothing is routed or transitioned.
    for (const t of result.tasks) expect(t.requiresApproval).toBe(plan.review.reviewRequired);
  });

  it('materialises every task as `pending` — no lifecycle transition occurs', async () => {
    const plan = realPlan();
    await materializeAutomationPlan(plan, ctx());
    // Moving a task to awaiting_approval is a TRANSITION, and transitions are
    // Milestone-3's job. M2 only creates.
    for (const row of db.tables.outreach_tasks) expect(row.status).toBe('pending');
  });

  it('skips a task with no usable id rather than fabricating a key', () => {
    const plan = realPlan();
    const broken = { ...plan, tasks: [{ ...plan.tasks[0], id: '   ' }] } as AutomationSummary;
    const result = translateAutomationPlan(broken, ctx());
    expect(result.tasks).toHaveLength(0);
    expect(result.outcomes[0].skippedReason).toContain('no usable id');
  });

  it('skips everything when the context has no tenant or lead', () => {
    const plan = realPlan();
    for (const bad of [{ companyId: '' }, { leadId: '' }]) {
      const result = translateAutomationPlan(plan, ctx(bad));
      expect(result.tasks).toHaveLength(0);
      expect(result.outcomes.every((o) => o.skippedReason !== null)).toBe(true);
    }
  });

  it('collapses a duplicate plan id inside one plan instead of colliding', () => {
    const plan = realPlan();
    const dup = { ...plan, tasks: [plan.tasks[0], { ...plan.tasks[0] }] } as AutomationSummary;
    const result = translateAutomationPlan(dup, ctx());
    expect(result.tasks).toHaveLength(1);
    expect(result.outcomes[1].skippedReason).toContain('duplicate plan task id');
  });

  it('refuses to stamp a fabricated instant when the plan has no generatedAt', () => {
    const plan = { ...realPlan(), generatedAt: '' } as AutomationSummary;
    const result = translateAutomationPlan(plan, ctx());
    expect(result.tasks).toHaveLength(0);
    expect(result.outcomes.every((o) => String(o.skippedReason).includes('generatedAt'))).toBe(true);
  });
});

// ── 2. Determinism ──────────────────────────────────────────────────────────

describe('WS-3 M2 (2) — deterministic, side-effect-free translation', () => {
  it('identical input yields byte-identical output', () => {
    const a = translateAutomationPlan(realPlan(), ctx());
    const b = translateAutomationPlan(realPlan(), ctx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('repeated translation of the SAME plan object is identical', () => {
    const plan = realPlan();
    const runs = Array.from({ length: 5 }, () => JSON.stringify(translateAutomationPlan(plan, ctx())));
    expect(new Set(runs).size).toBe(1);
  });

  it('is identical under concurrent translation', async () => {
    const plan = realPlan();
    const hashes = await Promise.all(Array.from({ length: 16 }, async () => {
      await Promise.resolve();
      return JSON.stringify(translateAutomationPlan(plan, ctx()));
    }));
    expect(new Set(hashes).size).toBe(1);
  });

  it('reads no clock: materializedAt comes from the plan, not from now', () => {
    const plan = realPlan();
    const result = translateAutomationPlan(plan, ctx());
    expect(result.materializedAt).toBe(plan.generatedAt);
    // Translating the same plan a moment later must not change the stamp.
    expect(translateAutomationPlan(plan, ctx()).materializedAt).toBe(plan.generatedAt);
  });

  it('honours an explicitly injected instant', () => {
    const plan = realPlan();
    const result = translateAutomationPlan(plan, ctx({ materializedAt: '2026-09-01T00:00:00.000Z' }));
    expect(result.materializedAt).toBe('2026-09-01T00:00:00.000Z');
    for (const t of result.tasks) expect(t.materializedAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

// ── 3. Identity contract ────────────────────────────────────────────────────

describe('WS-3 M2 (3) — identity contract', () => {
  it('identical AutomationTask → identical OutreachTask identity', () => {
    const a = translateAutomationPlan(realPlan(), ctx());
    const b = translateAutomationPlan(realPlan(), ctx());
    expect(a.tasks.map((t) => t.planTaskId)).toEqual(b.tasks.map((t) => t.planTaskId));
  });

  it('a CHANGED plan produces a NEW identity', () => {
    // The planner derives ids as `task-<order>-<slug(action)>`, so different
    // recommended actions genuinely yield different identities — the identity
    // contract is anchored in plan content, not in a counter.
    const base = realPlan();
    const different = realPlan({ pages: ['/'], jobTitle: 'Intern' });
    const baseIds = translateAutomationPlan(base, ctx()).tasks.map((t) => t.planTaskId);
    const otherIds = translateAutomationPlan(different, ctx()).tasks.map((t) => t.planTaskId);
    expect(JSON.stringify(baseIds)).not.toBe(JSON.stringify(otherIds));
  });

  it('identity is scoped per tenant and per lead', () => {
    const plan = realPlan();
    const a = translateAutomationPlan(plan, ctx());
    const b = translateAutomationPlan(plan, ctx({ companyId: 'co-b' }));
    const c = translateAutomationPlan(plan, ctx({ leadId: 'L2' }));
    // Same plan id, different owners — three distinct durable identities.
    expect(a.tasks[0].planTaskId).toBe(b.tasks[0].planTaskId);
    expect(a.tasks[0].companyId).not.toBe(b.tasks[0].companyId);
    expect(a.tasks[0].leadId).not.toBe(c.tasks[0].leadId);
  });
});

// ── 4. Materialisation + duplicate detection ────────────────────────────────

describe('WS-3 M2 (4) — dry-run materialisation and duplicate detection', () => {
  it('creates durable tasks and reports what happened to each', async () => {
    const plan = realPlan();
    const res = await materializeAutomationPlan(plan, ctx());
    expect(res.created).toBe(plan.tasks.length);
    expect(res.duplicates).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.results.every((r) => r.status === 'created')).toBe(true);
    expect(db.tables.outreach_tasks).toHaveLength(plan.tasks.length);
  });

  it('re-materialising a regenerated plan creates NOTHING new', async () => {
    const first = await materializeAutomationPlan(realPlan(), ctx());
    const second = await materializeAutomationPlan(realPlan(), ctx());
    // Plans regenerate on every WS-2 generation, so this is the normal path.
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(first.created);
    expect(db.tables.outreach_tasks).toHaveLength(first.created);
  });

  it('duplicate detection preserves the ORIGINAL provenance and state', async () => {
    await materializeAutomationPlan(realPlan(), ctx({ materializedAt: '2026-08-01T00:00:00.000Z' }));
    const original = { ...db.tables.outreach_tasks[0] };
    // Advance the task, then re-materialise with a different stamp.
    await setOutreachTaskState('co-a', original.id as string, { status: 'queued' });
    await materializeAutomationPlan(realPlan(), ctx({ materializedAt: '2026-09-09T00:00:00.000Z' }));

    const after = db.tables.outreach_tasks[0];
    expect(after.materialized_at).toBe('2026-08-01T00:00:00.000Z'); // untouched
    expect(after.planner_version).toBe(original.planner_version);
    expect(after.status).toBe('queued');                             // progress kept
  });

  it('is idempotent across many repetitions', async () => {
    const plan = realPlan();
    for (let i = 0; i < 6; i += 1) await materializeAutomationPlan(plan, ctx());
    expect(db.tables.outreach_tasks).toHaveLength(plan.tasks.length);
  });

  it('a changed plan ADDS tasks without disturbing the existing ones', async () => {
    const first = await materializeAutomationPlan(realPlan(), ctx());
    const changed = await materializeAutomationPlan(realPlan({ pages: ['/'], jobTitle: 'Intern' }), ctx());
    expect(changed.created).toBeGreaterThan(0);
    expect(db.tables.outreach_tasks.length).toBe(first.created + changed.created);
  });

  it('previewOnly writes nothing at all', async () => {
    const res = await materializeAutomationPlan(realPlan(), ctx(), { previewOnly: true });
    expect(res.previewOnly).toBe(true);
    expect(res.created).toBe(0);
    expect(db.tables.outreach_tasks ?? []).toHaveLength(0);
    expect(res.results.every((r) => r.reason === 'preview only — nothing written')).toBe(true);
  });

  it('one failing task does not prevent the rest of the plan materialising', async () => {
    const plan = realPlan();
    let calls = 0;
    const original = db.tables;
    // Fail only the first insert.
    Object.defineProperty(db, 'forceError', {
      configurable: true,
      get: () => (++calls === 1 ? { code: '08006', message: 'connection failure' } : null),
      set: () => undefined,
    });
    const res = await materializeAutomationPlan(plan, ctx());
    delete (db as { forceError?: unknown }).forceError;
    db.forceError = null;
    db.tables = original;

    expect(res.failed).toBe(1);
    expect(res.created).toBe(plan.tasks.length - 1);
  });

  it('never throws when storage is entirely unavailable', async () => {
    db.forceError = { code: '08006', message: 'connection failure' };
    const res = await materializeAutomationPlan(realPlan(), ctx());
    expect(res.failed).toBeGreaterThan(0);
    expect(res.created).toBe(0);
  });
});

// ── 5. Versioning + immutability ────────────────────────────────────────────

describe('WS-3 M2 (5) — version stamping and immutability', () => {
  it('stamps all five immutable fields on every materialised task', async () => {
    await materializeAutomationPlan(realPlan(), ctx());
    for (const row of db.tables.outreach_tasks) {
      expect(row.planner_version).toBe(PLANNER_VERSION);
      expect(row.translation_version).toBe(TRANSLATION_VERSION);
      expect(row.governance_version).toBe(GOVERNANCE_VERSION);
      expect(row.execution_runtime_version).toBe(EXECUTION_RUNTIME_VERSION);
      expect(typeof row.materialized_at).toBe('string');
      expect(String(row.materialized_at).length).toBeGreaterThan(0);
    }
  });

  it('materializedAt survives the storage round-trip as canonical ISO-8601', async () => {
    const plan = realPlan();
    await materializeAutomationPlan(plan, ctx());
    const read = await getOutreachTask('co-a', 'L1', plan.tasks[0].id);
    // `timestamptz` returns `2026-08-05 12:00:00+00` — the same instant in a
    // different representation. The model declares ISO-8601, so the read path
    // canonicalises it; without that, comparing a read-back stamp against the
    // plan's generatedAt by string equality would fail on equal values.
    expect(read?.materializedAt).toBe(new Date(plan.generatedAt).toISOString());
    expect(Date.parse(read!.materializedAt)).toBe(Date.parse(plan.generatedAt));
  });

  it('carries the planner version of the envelope that produced the plan', () => {
    // Never the current build's constant — the correct value is the one that
    // generated THIS plan, so it is supplied by the caller.
    const result = translateAutomationPlan(realPlan(), ctx({ plannerVersion: 'lie-2.0.0' }));
    for (const t of result.tasks) expect(t.plannerVersion).toBe('lie-2.0.0');
  });

  it('the storage layer still refuses to rewrite provenance', async () => {
    await materializeAutomationPlan(realPlan(), ctx());
    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => any };
    const res = await ownedDbTable('outreach_tasks').update({ planner_version: 'HACKED' }).eq('company_id', 'co-a');
    expect(String(res.error?.message)).toContain('ws3_immutable_provenance');
  });
});

// ── 6. Storage integration + tenant isolation ───────────────────────────────

describe('WS-3 M2 (6) — storage integration and tenant isolation', () => {
  it('materialised tasks are readable through the M1 storage layer', async () => {
    const plan = realPlan();
    await materializeAutomationPlan(plan, ctx());
    const listed = await listOutreachTasksForLead('co-a', 'L1');
    expect(listed).toHaveLength(plan.tasks.length);
    const one = await getOutreachTask('co-a', 'L1', plan.tasks[0].id);
    expect(one?.action).toBe(plan.tasks[0].action);
    expect(one?.status).toBe('pending');
  });

  it('the same plan materialises independently for two tenants', async () => {
    const plan = realPlan();
    await materializeAutomationPlan(plan, ctx({ companyId: 'co-a' }));
    const other = await materializeAutomationPlan(plan, ctx({ companyId: 'co-b' }));
    expect(other.created).toBe(plan.tasks.length);
    expect(await listOutreachTasksForLead('co-a', 'L1')).toHaveLength(plan.tasks.length);
    expect(await listOutreachTasksForLead('co-b', 'L1')).toHaveLength(plan.tasks.length);
  });

  it('every write carries its tenant, and cross-tenant reads find nothing', async () => {
    await materializeAutomationPlan(realPlan(), ctx({ companyId: 'co-a' }));
    for (const row of db.tables.outreach_tasks) expect(row.company_id).toBe('co-a');
    expect(await listOutreachTasksForLead('co-zzz', 'L1')).toEqual([]);
  });
});

// ── 7. Guards: no execution capability ──────────────────────────────────────

describe('WS-3 M2 (7) — guards against premature capability', () => {
  const moduleSource = (): string => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    return fs
      .readdirSync(dir)
      .map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
      // Comments explain the boundary by naming what must not appear, so the
      // guard must inspect code rather than prose.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  };

  it('imports no queue, transport, messaging, HTTP or community-runtime module', () => {
    const source = moduleSource();
    for (const forbidden of [
      'bullmq', 'ioredis', 'redis',
      'emailService', 'whatsapp', 'twilio',
      'communityAiActionExecutor', 'automationService', 'automationConstants',
      'axios', 'node-fetch', 'undici',
      'extension', 'queue', 'workerTopology', 'schedulingService',
    ]) {
      expect(source).not.toMatch(new RegExp(`from\\s+'[^']*${forbidden}`, 'i'));
      expect(source).not.toMatch(new RegExp(`require\\(\\s*'[^']*${forbidden}`, 'i'));
    }
  });

  it('performs no network or scheduling calls', () => {
    const source = moduleSource();
    expect(source).not.toMatch(/\bfetch\s*\(/);
    /**
     * WS-3 M5B tightening. A transport needs ONE timer — its own request
     * timeout, without which a silent provider holds a task in `dispatching`
     * forever. That is permitted in the email transport and nowhere else, so a
     * retry scheduler or polling loop still cannot appear anywhere in WS-3.
     */
    const fs2 = require('fs') as typeof import('fs');
    const path2 = require('path') as typeof import('path');
    const dir2 = path2.join(process.cwd(), 'backend/services/leadOutreachExecution');
    for (const file of fs2.readdirSync(dir2)) {
      if (file === 'emailTransport.ts') continue;
      const body = fs2.readFileSync(path2.join(dir2, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(body).not.toMatch(/\bsetTimeout\s*\(/);
      expect(body).not.toMatch(/\bsetInterval\s*\(/);
    }
    // Even there, only a timeout — never a repeating timer.
    expect(fs2.readFileSync(path2.join(dir2, 'emailTransport.ts'), 'utf8')).not.toMatch(/\bsetInterval\s*\(/);
    expect(source).not.toMatch(/\.enqueue\s*\(/);
    expect(source).not.toMatch(/\.add\s*\(\s*'/);
  });

  it('reads the WS-2 plan model as TYPES ONLY', () => {
    const source = moduleSource();
    const imports = [...source.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+'([^']*automationExecution[^']*)'/g)];
    expect(imports.length).toBeGreaterThan(0); // translation must read the model
    for (const [, isType, specifier] of imports) {
      // A value import would let this runtime EXECUTE WS-2 planning, breaching
      // the frozen ownership boundary.
      expect(isType).toBeTruthy();
      expect(specifier).toMatch(/\/types$/);
    }
    expect(source).not.toMatch(/from\s+'[^']*qualificationPlanning/);
  });

  it('exposes no dispatch, governance-evaluation or retry surface', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    const exported: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)) exported.push(m[1]);
    }
    /**
     * WS-3 M3 tightening, NOT loosening. Approval orchestration is now IN
     * scope, so banning `approve*` no longer expresses the rule — it would
     * forbid the milestone's own deliverable. Everything that remains out of
     * scope is still banned, and the list gained `suppress`/`killSwitch`/
     * `region` so M4's governance vocabulary cannot leak in early either.
     */
    // Case-SENSITIVE camelCase verb prefixes, so this bans an ACTION
    // (`deliverOutreach`, `dispatchTask`) without banning the delivery MODEL
    // M1 legitimately owns (`DELIVERY_STATUSES`, `appendDeliveryEvidence`) —
    // recording that something was delivered is not delivering it.
    /**
     * WS-3 M5A tightening. INTERNAL dispatch is now the deliverable, so a
     * blanket ban on `dispatch*` would forbid it. The rule narrows to what
     * still must not exist: any dispatch or send that is not explicitly
     * internal, plus the verbs belonging to later milestones.
     */
    const bannedVerb = /^(enqueue|deliver|retry|schedule|execute|transmit)[A-Z]|^(dispatch|send)(?!.*Internal)[A-Z]/;
    /**
     * WS-3 M4 tightening, NOT loosening. Governance EVALUATION is now in scope,
     * so `evaluateGovernance` is the milestone's deliverable rather than a
     * violation. What stays banned is ACTING on governance — applying or
     * enforcing a verdict is dispatch's job, and dispatch does not exist yet.
     */
    const bannedGovernanceAction = /^(apply|enforce|consume|reserve)[A-Z].*(Governance|RateLimit|Suppression|KillSwitch)/;
    const banned = exported.filter((k) => bannedVerb.test(k) || bannedGovernanceAction.test(k));
    expect(banned).toEqual([]);
  });
});
