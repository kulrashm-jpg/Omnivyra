/**
 * PI-OUTREACH-ANCHOR-005 — the A3 person anchor is populated at materialisation.
 *
 * 004 established that `outreach_tasks.person_id` — a `uuid` column with a
 * composite tenant-safe foreign key to `unified_persons (id, company_id)`,
 * applied in production since 20261011000000 — was never written by any
 * production code path, so anchor step 2 was dead and every governance
 * evaluation fell through to step 3. This suite proves the writer exists and,
 * just as importantly, that adding it changed nothing else.
 *
 * ─── WHY A BEHAVIOURAL DOUBLE AND NOT MOCKED PORTS ────────────────────────
 * The claims under test are database-shaped: which column holds what, whether a
 * cross-tenant person can be written, whether `lead_id` was touched, and whether
 * two later PI consumers can now find the row through `person_id`. Mocking
 * `setOutreachTaskPersonId` would assert that this file calls a function; it
 * would prove nothing about the row. So the double stores rows and enforces the
 * three constraints that matter here, exactly as PostgreSQL does:
 *   - `(company_id, lead_id, plan_task_id)` uniqueness          → 23505
 *   - the provenance immutability trigger                       → 2F004
 *   - `outreach_tasks_person_tenant_fk`                         → 23503
 * A test that could write a cross-tenant person and still pass would be worse
 * than no test.
 *
 * ─── WHY A LITERAL PLAN ───────────────────────────────────────────────────
 * `ws3Milestone2Translation.test.ts` drives a REAL WS-2 plan through the real
 * engines, because the identity contract depends on how the planner derives
 * `task-<order>-<slug>`. That contract is already pinned there and is untouched
 * by 005. What 005 changes is what happens AFTER a row exists, which is
 * independent of how the plan was derived — so this uses a small literal plan
 * and keeps the suite fast and readable.
 */

type Row = Record<string, unknown>;

const IMMUTABLE_TASK_COLS = [
  'company_id', 'lead_id', 'plan_task_id', 'planner_version',
  'translation_version', 'governance_version', 'execution_runtime_version', 'materialized_at',
];

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  /** Forces the `leads` read to fail — CASE C, an infrastructure fault. */
  leadsReadError: null as null | { code?: string; message?: string },
  /** Forces the anchor UPDATE to fail, independently of the insert. */
  anchorWriteError: null as null | { code?: string; message?: string },
  ops: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]> }>,
};

jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select',
      filters: [] as Array<[string, unknown]>,
      ins: [] as Array<[string, unknown[]]>,
      payload: null as Row | null,
    };
    const rows = (t = table) => (db.tables[t] ??= []);
    const matches = (r: Row) =>
      st.filters.every(([c, v]) => r[c] === v) && st.ins.every(([c, vs]) => vs.includes(r[c] as never));

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.ops.push({ table, op: st.op, filters: [...st.filters] });

      if (table === 'leads' && st.op === 'select' && db.leadsReadError) {
        return { data: null, error: db.leadsReadError };
      }

      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (
          table === 'outreach_tasks' &&
          rows().some((r) => r.company_id === row.company_id && r.lead_id === row.lead_id && r.plan_task_id === row.plan_task_id)
        ) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates outreach_tasks_identity_unique' } };
        }
        const created = { ...row, id: `task-${db.nextId++}`, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        const payload = st.payload ?? {};
        if (table === 'outreach_tasks' && db.anchorWriteError) return { data: null, error: db.anchorWriteError };
        if (table === 'outreach_tasks' && Object.keys(payload).some((c) => IMMUTABLE_TASK_COLS.includes(c))) {
          return { data: null, error: { code: '2F004', message: 'ws3_immutable_provenance' } };
        }
        const target = rows().filter(matches);
        // `outreach_tasks_person_tenant_fk` — the composite key. A person that
        // does not exist IN THIS TENANT is refused by the database, which is the
        // only thing standing between a bad lead link and a cross-tenant anchor.
        if (table === 'outreach_tasks' && 'person_id' in payload && payload.person_id !== null) {
          for (const r of target) {
            const ok = rows('unified_persons').some((p) => p.id === payload.person_id && p.company_id === r.company_id);
            if (!ok) return { data: null, error: { code: '23503', message: 'insert or update violates foreign key constraint "outreach_tasks_person_tenant_fk"' } };
          }
        }
        for (const r of target) Object.assign(r, payload);
        return { data: target.map((r) => ({ id: r.id })), error: null };
      }

      const found = rows().filter(matches);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (row: Row) => { st.op = 'insert'; st.payload = row; return b; },
      update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      in: (c: string, vs: unknown[]) => { st.ins.push([c, vs]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

import type { AutomationSummary } from '../../services/automationExecution/types';
import { materializeAutomationPlan } from '../../services/leadOutreachExecution/materialization';
import { resolvePersonAnchor } from '../../services/leadOutreachExecution/personAnchor';
import { projectOutreachActivity } from '../../services/prospectLifecycle/lifecycleReader';
import { defaultProspectOutcomePorts } from '../../services/prospectOutcomes/corpus';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const PERSON = '00000000-0000-4000-8000-0000000000c1';
const FOREIGN_PERSON = '00000000-0000-4000-8000-0000000000c2';
const LEAD = 'L1';
const PROSPECT = '00000000-0000-4000-8000-0000000000d1';
const NOW = '2026-09-01T12:00:00.000Z';

/** A minimal but structurally valid WS-2 plan — see the header on why literal. */
const plan = (taskCount = 2): AutomationSummary => ({
  leadId: LEAD,
  status: 'ready',
  statusReasons: [],
  executionTimeline: [],
  tasks: Array.from({ length: taskCount }, (_, i) => ({
    id: `task-${i + 1}-intro`,
    order: i + 1,
    kind: 'outreach',
    action: `Send message ${i + 1}`,
    channel: 'internal',
    dependsOn: null,
    estimatedDelayHours: 0,
    confidence: 0.7,
    explanation: 'x',
  })),
  channelSequence: [],
  review: { reviewRequired: true },
  confidence: 0.7,
  generatedAt: NOW,
} as unknown as AutomationSummary);

const ctx = (over: Record<string, unknown> = {}) => ({
  companyId: ORG_A, leadId: LEAD, plannerVersion: 'lie-2.1.0', materializedAt: NOW, ...over,
} as never);

/** A tenant whose lead resolves to a person that exists in the same tenant. */
const seedResolvable = (): void => {
  db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: PERSON }];
  db.tables.unified_persons = [{ id: PERSON, company_id: ORG_A }];
  db.tables.canonical_leads = [{ id: PROSPECT, company_id: ORG_A, unified_person_id: PERSON }];
};

const taskRows = (): Row[] => db.tables.outreach_tasks ?? [];
const readsOf = (table: string): number => db.ops.filter((o) => o.table === table && o.op === 'select').length;

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.ops = [];
  db.leadsReadError = null;
  db.anchorWriteError = null;
});

// ── A. Materialisation with a person ────────────────────────────────────────

describe('005 (A) — a resolvable lead anchors every task it materialises', () => {
  it('stores the resolved person on every created task', async () => {
    seedResolvable();
    const res = await materializeAutomationPlan(plan(2), ctx());

    expect(res.created).toBe(2);
    expect(res.personAnchored).toBe(2);
    for (const r of res.results) expect(r.personAnchor).toBe('stored');
    for (const row of taskRows()) expect(row.person_id).toBe(PERSON);
  });

  it('the returned task carries the stored anchor without a re-read', async () => {
    seedResolvable();
    const res = await materializeAutomationPlan(plan(1), ctx());
    expect(res.results[0].task?.personId).toBe(PERSON);
  });

  it('leaves lead_id — and every other provenance field — exactly as written', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(2), ctx());
    for (const row of taskRows()) {
      expect(row.lead_id).toBe(LEAD);
      expect(row.company_id).toBe(ORG_A);
      expect(row.planner_version).toBe('lie-2.1.0');
      expect(row.materialized_at).toBe(NOW);
    }
    // The double refuses an UPDATE touching an immutable column with 2F004. The
    // anchor write completed, so it demonstrably touched none of them.
    expect(taskRows().every((r) => r.person_id === PERSON)).toBe(true);
  });

  it('resolves the person ONCE per plan, not once per task', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(3), ctx());
    expect(readsOf('leads')).toBe(1);
  });

  it('reads nothing at all when the caller asked for a preview', async () => {
    seedResolvable();
    const res = await materializeAutomationPlan(plan(2), ctx(), { previewOnly: true });
    expect(res.created).toBe(0);
    expect(readsOf('leads')).toBe(0);
    expect(taskRows()).toHaveLength(0);
  });
});

// ── B. Tenant safety ────────────────────────────────────────────────────────

describe('005 (B) — tenant safety', () => {
  it('the lead lookup is tenant-scoped, company_id FIRST', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(1), ctx());
    const leadRead = db.ops.find((o) => o.table === 'leads' && o.op === 'select');
    expect(leadRead?.filters[0][0]).toBe('company_id');
    expect(leadRead?.filters[0][1]).toBe(ORG_A);
  });

  it("another tenant's lead resolves to nothing, not to their person", async () => {
    seedResolvable();                                    // the lead belongs to ORG_A
    const res = await materializeAutomationPlan(plan(1), ctx({ companyId: ORG_B }));

    expect(res.created).toBe(1);                         // still materialised
    expect(res.results[0].personAnchor).toBe('absent');
    expect(res.personAnchored).toBe(0);
    expect(taskRows()[0].person_id).toBeNull();
  });

  it('a cross-tenant person is REFUSED by the composite FK and never stored', async () => {
    // A lead pointing at a person that does not exist in its own tenant — the
    // shape a data defect would produce. The database must be what stops it.
    db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: FOREIGN_PERSON }];
    db.tables.unified_persons = [{ id: FOREIGN_PERSON, company_id: ORG_B }];

    const res = await materializeAutomationPlan(plan(1), ctx());

    expect(res.created).toBe(1);                         // the task survives
    expect(res.results[0].personAnchor).toBe('anchor_write_failed');
    // The storage layer translates the composite FK's 23503 into the tenant
    // error it actually is, rather than surfacing a raw SQLSTATE — so the
    // refusal arrives as a tenancy statement, which is what a reader needs.
    expect(String(res.results[0].personAnchorError)).toContain('no such person in this tenant');
    expect(taskRows()[0].person_id).toBeNull();
    expect(res.personAnchored).toBe(0);
  });

  it('two tenants materialising the same plan anchor independently', async () => {
    seedResolvable();
    db.tables.leads.push({ id: LEAD, company_id: ORG_B, unified_person_id: FOREIGN_PERSON });
    db.tables.unified_persons.push({ id: FOREIGN_PERSON, company_id: ORG_B });

    await materializeAutomationPlan(plan(1), ctx());
    await materializeAutomationPlan(plan(1), ctx({ companyId: ORG_B }));

    const a = taskRows().filter((r) => r.company_id === ORG_A);
    const b = taskRows().filter((r) => r.company_id === ORG_B);
    expect(a.every((r) => r.person_id === PERSON)).toBe(true);
    expect(b.every((r) => r.person_id === FOREIGN_PERSON)).toBe(true);
  });
});

// ── C. Genuine absence ──────────────────────────────────────────────────────

describe('005 (C) — genuine absence never blocks materialisation', () => {
  it('a lead with no unified_person_id still materialises, unanchored', async () => {
    db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: null }];
    const res = await materializeAutomationPlan(plan(2), ctx());

    expect(res.created).toBe(2);
    expect(res.failed).toBe(0);
    for (const r of res.results) expect(r.personAnchor).toBe('absent');
    for (const row of taskRows()) expect(row.person_id).toBeNull();
  });

  it('no lead row at all is absence, not failure', async () => {
    const res = await materializeAutomationPlan(plan(1), ctx());
    expect(res.created).toBe(1);
    expect(res.results[0].personAnchor).toBe('absent');
  });

  it('the step-3 fallback remains available for an unanchored task', async () => {
    db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: null }];
    await materializeAutomationPlan(plan(1), ctx());
    // Anchor order on the row as materialised: no stored person, lead present
    // but not canonicalised → degraded, NOT a block.
    const anchor = await resolvePersonAnchor(ORG_A, { leadId: LEAD, personId: null }, null);
    expect(anchor).toMatchObject({ ok: true, personId: null, source: 'none', degraded: true });
    expect(anchor.reason).toBe('lead_absent_or_not_canonicalised');
  });
});

// ── D. Read failure ─────────────────────────────────────────────────────────

describe('005 (D) — a read failure is never converted into absence', () => {
  it('reports unresolved_read_failure, distinctly from absence', async () => {
    db.leadsReadError = { code: '08006', message: 'connection failure' };
    const res = await materializeAutomationPlan(plan(2), ctx());

    expect(res.created).toBe(2);                         // materialisation unaffected
    expect(res.failed).toBe(0);
    for (const r of res.results) expect(r.personAnchor).toBe('unresolved_read_failure');
    expect(res.results[0].personAnchor).not.toBe('absent');
    for (const row of taskRows()) expect(row.person_id).toBeNull();
  });

  it('the governance layer still fails CLOSED on that same read failure', async () => {
    db.leadsReadError = { code: '08006', message: 'connection failure' };
    await materializeAutomationPlan(plan(1), ctx());
    // The task is unanchored, so evaluation falls to step 3 — which re-reads and
    // reports the failure as ok:false. That is what `resolveCanonicalGovernance`
    // turns into `governance_person_resolution_failed_failclosed`.
    const anchor = await resolvePersonAnchor(ORG_A, { leadId: LEAD, personId: null }, null);
    expect(anchor.ok).toBe(false);
    expect(anchor.reason).toBe('lead_person_resolution_failed');
  });

  it('an anchor WRITE failure leaves the task standing and unanchored', async () => {
    seedResolvable();
    db.anchorWriteError = { code: '08006', message: 'connection failure' };
    const res = await materializeAutomationPlan(plan(1), ctx());

    expect(res.created).toBe(1);
    expect(res.results[0].personAnchor).toBe('anchor_write_failed');
    expect(taskRows()[0].person_id).toBeNull();
  });

  it('a failed INSERT never attempts an anchor', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(1), ctx());     // creates task-1-intro
    db.ops = [];
    const again = await materializeAutomationPlan(plan(1), ctx());
    expect(again.duplicates).toBe(1);
    expect(again.results[0].personAnchor).toBeUndefined();
    expect(readsOf('leads')).toBe(0);
  });
});

// ── E. Anchor precedence is unchanged ───────────────────────────────────────

describe('005 (E) — the frozen anchor order is unchanged, and step 2 now fires', () => {
  it('a materialised task resolves through step 2, no longer step 3', async () => {
    seedResolvable();
    const res = await materializeAutomationPlan(plan(1), ctx());
    const task = res.results[0].task!;

    db.ops = [];
    const anchor = await resolvePersonAnchor(ORG_A, { leadId: task.leadId, personId: task.personId }, null);
    expect(anchor).toMatchObject({ ok: true, personId: PERSON, source: 'task', degraded: false });
    // The whole point of Contract 12: no per-evaluation `leads` read.
    expect(readsOf('leads')).toBe(0);
  });

  it('an explicit caller id still outranks the stored anchor', async () => {
    seedResolvable();
    const res = await materializeAutomationPlan(plan(1), ctx());
    const task = res.results[0].task!;
    const anchor = await resolvePersonAnchor(ORG_A, { leadId: task.leadId, personId: task.personId }, 'explicit-person');
    expect(anchor).toMatchObject({ personId: 'explicit-person', source: 'explicit' });
  });

  it('step 3 still serves a task that has no stored anchor', async () => {
    seedResolvable();
    const anchor = await resolvePersonAnchor(ORG_A, { leadId: LEAD, personId: null }, null);
    expect(anchor).toMatchObject({ ok: true, personId: PERSON, source: 'lead', degraded: false });
  });

  it('a task with no lead id is still degraded, not blocked', async () => {
    const anchor = await resolvePersonAnchor(ORG_A, { leadId: '', personId: null }, null);
    expect(anchor).toMatchObject({ ok: true, source: 'none', degraded: true, reason: 'task_has_no_lead_id' });
  });
});

// ── F. WS-C lifecycle projection ────────────────────────────────────────────

describe('005 (F) — the WS-C outreach-activity projection can now see the task', () => {
  it('projects an anchored task through (company_id, person_id)', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(2), ctx());

    const projection = await projectOutreachActivity(ORG_A, PROSPECT);
    expect(projection).toEqual({ outreachActive: true, activeTaskCount: 2, personId: PERSON, unavailable: null });
  });

  it('an UNANCHORED task stays invisible to it — the pre-005 behaviour', async () => {
    // Recorded, not endorsed: the projection joins only the foreign-keyed edge,
    // so a task without a person anchor cannot be seen. That is exactly why 005
    // exists, and it is why an unanchored row is a real (if safe) gap.
    db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: null }];
    db.tables.canonical_leads = [{ id: PROSPECT, company_id: ORG_A, unified_person_id: PERSON }];
    await materializeAutomationPlan(plan(2), ctx());

    const projection = await projectOutreachActivity(ORG_A, PROSPECT);
    expect(projection.outreachActive).toBe(false);
    expect(projection.activeTaskCount).toBe(0);
  });

  it('a prospect with no person still abstains rather than answering false', async () => {
    db.tables.canonical_leads = [{ id: PROSPECT, company_id: ORG_A, unified_person_id: null }];
    const projection = await projectOutreachActivity(ORG_A, PROSPECT);
    expect(projection.unavailable).toBe('no_person_anchor');
  });

  it('the projection does not leak across tenants', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(2), ctx());
    db.tables.canonical_leads.push({ id: PROSPECT, company_id: ORG_B, unified_person_id: PERSON });
    const projection = await projectOutreachActivity(ORG_B, PROSPECT);
    expect(projection.activeTaskCount).toBe(0);
  });
});

// ── G. WS-9 outcome attribution ─────────────────────────────────────────────

describe('005 (G) — WS-9 outcome attribution can now associate the task', () => {
  it('loadTasks finds the anchored tasks by person, never by lead', async () => {
    seedResolvable();
    const res = await materializeAutomationPlan(plan(2), ctx());
    const created = res.results.map((r) => r.task!.id).sort();

    const tasks = await defaultProspectOutcomePorts.loadTasks(ORG_A, PERSON);
    expect(tasks.map((t) => t.id).sort()).toEqual(created);
  });

  it('loadProspect resolves the prospect to the same person the task carries', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(1), ctx());
    const prospect = await defaultProspectOutcomePorts.loadProspect(ORG_A, PROSPECT);
    expect(prospect?.unified_person_id).toBe(PERSON);
    expect(taskRows()[0].person_id).toBe(prospect?.unified_person_id);
  });

  it('finds nothing for that person under another tenant', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(2), ctx());
    expect(await defaultProspectOutcomePorts.loadTasks(ORG_B, PERSON)).toEqual([]);
  });

  it('an unanchored task is not attributed to anyone', async () => {
    db.tables.leads = [{ id: LEAD, company_id: ORG_A, unified_person_id: null }];
    await materializeAutomationPlan(plan(2), ctx());
    expect(await defaultProspectOutcomePorts.loadTasks(ORG_A, PERSON)).toEqual([]);
  });
});

// ── H. What 005 must NOT have changed ───────────────────────────────────────

describe('005 (H) — the surrounding contracts are untouched', () => {
  it('task identity is still (company_id, lead_id, plan_task_id)', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(1), ctx());
    const again = await materializeAutomationPlan(plan(1), ctx());
    expect(again.duplicates).toBe(1);
    expect(again.created).toBe(0);
    expect(taskRows()).toHaveLength(1);
  });

  it('a duplicate is NOT re-anchored — the existing row is left alone', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(1), ctx());
    const before = { ...taskRows()[0] };
    await materializeAutomationPlan(plan(1), ctx());
    expect(taskRows()[0]).toEqual(before);
  });

  it('the per-lead grouping key is still lead_id, unchanged by the anchor', async () => {
    seedResolvable();
    await materializeAutomationPlan(plan(2), ctx());
    // This is the column `loadRateUsage` and `readDurableUsage` group on. The
    // anchor added a person; it did not move the quota key onto it.
    expect(taskRows().every((r) => r.lead_id === LEAD)).toBe(true);
    expect(new Set(taskRows().map((r) => r.lead_id)).size).toBe(1);
  });

  it('lead_id is still an opaque text key, never coerced to the person or a uuid', async () => {
    db.tables.leads = [{ id: 'not-a-uuid', company_id: ORG_A, unified_person_id: PERSON }];
    db.tables.unified_persons = [{ id: PERSON, company_id: ORG_A }];
    const res = await materializeAutomationPlan(plan(1), ctx({ leadId: 'not-a-uuid' }));
    expect(res.results[0].personAnchor).toBe('stored');
    expect(taskRows()[0].lead_id).toBe('not-a-uuid');
    expect(taskRows()[0].person_id).toBe(PERSON);
  });

  it('materialisation still never throws, whatever the database does', async () => {
    db.leadsReadError = { code: '08006', message: 'down' };
    db.anchorWriteError = { code: '08006', message: 'down' };
    await expect(materializeAutomationPlan(plan(2), ctx())).resolves.toBeDefined();
  });

  it('the anchor is written through the storage layer, never by raw SQL', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'backend/services/leadOutreachExecution/materialization.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).toContain('setOutreachTaskPersonId');
    expect(src).toContain('resolveLeadPersonId');
    // No second writer and no second lookup were introduced.
    expect(src).not.toMatch(/ownedDbTable\s*\(/);
    expect(src).not.toMatch(/from\s+'[^']*supabaseClient/);
  });
});
