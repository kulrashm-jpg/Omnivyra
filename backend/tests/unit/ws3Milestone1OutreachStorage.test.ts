/**
 * WS-3 Milestone-1 — durable execution model & storage.
 *
 * Covers persistence, immutable provenance, append-only audit, lifecycle
 * validation, the two-axis outcome model, tenant scoping, schema alignment with
 * the migration, and — importantly — that NO execution capability exists.
 *
 * The database double below mirrors the real constraints (unique identity,
 * append-only triggers, status CHECK) so a violation fails here exactly as it
 * does in PostgreSQL, rather than passing silently.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  /** Every table name the storage layer touched — proves company scoping. */
  filtersSeen: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]> }>,
  forceError: null as null | { code?: string; message?: string },
};

const TASK_STATUSES = [
  'pending', 'awaiting_approval', 'approved', 'rejected', 'queued', 'dispatching',
  'sent', 'delivered', 'completed', 'failed', 'retried', 'paused', 'resumed',
  'escalated', 'reassigned', 'cancelled', 'expired',
];
const APPEND_ONLY = ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions'];
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
        // Real constraint: status CHECK
        if (table === 'outreach_tasks' && row.status && !TASK_STATUSES.includes(String(row.status))) {
          return { data: null, error: { code: '23514', message: 'violates check constraint outreach_tasks_status_valid' } };
        }
        // Real constraint: identity uniqueness
        if (table === 'outreach_tasks' && rows().some((r) => r.company_id === row.company_id && r.lead_id === row.lead_id && r.plan_task_id === row.plan_task_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates outreach_tasks_identity_unique' } };
        }
        // Real constraint: outcome idempotency key
        if (table === 'outreach_outcomes' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.outcome_type === row.outcome_type && r.occurred_at === row.occurred_at)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates outreach_outcomes_idempotent' } };
        }
        const created = { ...row, id: `row-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z', updated_at: '2026-08-05T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        // Real trigger: append-only tables reject UPDATE
        if (APPEND_ONLY.includes(table)) {
          return { data: null, error: { code: '2F004', message: `ws3_append_only: ${table} is append-only; UPDATE is not permitted` } };
        }
        // Real trigger: provenance columns are immutable
        const touched = Object.keys(st.payload ?? {});
        const violation = touched.find((c) => IMMUTABLE_TASK_COLS.includes(c));
        if (table === 'outreach_tasks' && violation) {
          return { data: null, error: { code: '2F004', message: 'ws3_immutable_provenance: identity and version fields are immutable' } };
        }
        for (const r of rows()) if (matches(r)) Object.assign(r, st.payload);
        return { data: null, error: null };
      }

      const found = rows().filter(matches);
      if (mode === 'many') return { data: found, error: null };
      return { data: found[0] ?? null, error: null };
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
  ALLOWED_TRANSITIONS,
  ALLOWED_DELIVERY_TRANSITIONS,
  BUSINESS_OUTCOME_TYPES,
  DELIVERY_STATUSES,
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  OUTREACH_TASK_STATUSES,
  TERMINAL_STATUSES,
  TRANSIENT_STATUSES,
  TRANSLATION_VERSION,
  appendApproval,
  appendAttempt,
  appendDecision,
  appendDeliveryEvidence,
  appendOutcome,
  explainTransition,
  getOutreachTask,
  insertOutreachTask,
  isDeliveryTransitionAllowed,
  isTerminalStatus,
  isTransientStatus,
  isTransitionAllowed,
  listApprovals,
  listOutreachTasksForLead,
  outcomeTypesFor,
  rowToOutreachTask,
  setOutreachTaskState,
  UNOBSERVABLE_BUSINESS_OUTCOMES,
  DERIVED_BUSINESS_OUTCOMES,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';
import * as runtime from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a',
  leadId: 'L1',
  planTaskId: 'task-1-intro',
  taskOrder: 1,
  kind: 'outreach',
  action: 'Send intro email',
  channel: 'email',
  dependsOnPlanTaskId: null,
  estimatedDelayHours: 0,
  confidence: 0.7,
  explanation: 'Hot lead with pricing intent',
  requiresApproval: false,
  plannerVersion: 'lie-2.1.0',
  translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION,
  executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW,
  ...over,
});

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.filtersSeen = [];
  db.forceError = null;
});

// ── 1. Task persistence + idempotency ───────────────────────────────────────

describe('WS-3 M1 (1) — OutreachTask persistence', () => {
  it('persists a materialised task with its full provenance', async () => {
    const res = await insertOutreachTask(newTask());
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-intro',
      channel: 'email', status: 'pending', deliveryStatus: null,
      plannerVersion: 'lie-2.1.0',
      translationVersion: TRANSLATION_VERSION,
      governanceVersion: GOVERNANCE_VERSION,
      executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
      materializedAt: NOW,
    });
  });

  it('rejects a duplicate materialisation as `duplicate`, not as a failure', async () => {
    await insertOutreachTask(newTask());
    const again = await insertOutreachTask(newTask());
    // A regenerated plan revisiting the same logical task is EXPECTED — this
    // is the mechanism that stops re-sending completed work.
    expect(again).toMatchObject({ ok: false, duplicate: true });
    expect(db.tables.outreach_tasks).toHaveLength(1);
  });

  it('treats the same plan_task_id under a different lead or tenant as distinct', async () => {
    await insertOutreachTask(newTask());
    expect((await insertOutreachTask(newTask({ leadId: 'L2' }))).ok).toBe(true);
    expect((await insertOutreachTask(newTask({ companyId: 'co-b' }))).ok).toBe(true);
    expect(db.tables.outreach_tasks).toHaveLength(3);
  });

  it('reads back by identity and lists per lead', async () => {
    await insertOutreachTask(newTask());
    await insertOutreachTask(newTask({ planTaskId: 'task-2-followup', taskOrder: 2 }));
    expect((await getOutreachTask('co-a', 'L1', 'task-1-intro'))?.action).toBe('Send intro email');
    expect(await listOutreachTasksForLead('co-a', 'L1')).toHaveLength(2);
  });

  it('never throws when the database fails', async () => {
    db.forceError = { code: '08006', message: 'connection failure' };
    await expect(insertOutreachTask(newTask())).resolves.toMatchObject({ ok: false });
    await expect(getOutreachTask('co-a', 'L1', 'task-1-intro')).resolves.toBeNull();
    await expect(listOutreachTasksForLead('co-a', 'L1')).resolves.toEqual([]);
  });

  it('maps a malformed row to null rather than a half-built task', () => {
    expect(rowToOutreachTask({})).toBeNull();
    expect(rowToOutreachTask({ company_id: 'co-a', lead_id: 'L1' })).toBeNull();
    expect(rowToOutreachTask(null)).toBeNull();
  });
});

// ── 2. Immutability ─────────────────────────────────────────────────────────

describe('WS-3 M1 (2) — immutable provenance and append-only audit', () => {
  it('offers NO storage surface that can mutate provenance or audit history', () => {
    // The absence of an update/delete path is part of the design, so it is
    // asserted — on the public surface AND on every export in the module
    // directory, since an unexported-from-index helper is still reachable.
    expect(Object.keys(runtime).filter((k) => /update|mutate|delete|remove/i.test(k))).toEqual([]);

    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    const exported: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/g)) exported.push(m[1]);
    }
    // `setOutreachTaskState` is the one deliberate writer, and it can only
    // reach status/deliveryStatus — never identity, provenance or an audit row.
    expect(exported.filter((k) => /update|mutate|delete|remove/i.test(k))).toEqual([]);
  });

  it('the only writable task fields are status and deliveryStatus', async () => {
    const created = await insertOutreachTask(newTask());
    const id = created.data!.id as string;
    const res = await setOutreachTaskState('co-a', id, { status: 'awaiting_approval', deliveryStatus: null });
    expect(res.ok).toBe(true);
    const stored = db.tables.outreach_tasks[0];
    expect(stored.status).toBe('awaiting_approval');
    // Provenance survived a state change untouched.
    expect(stored.planner_version).toBe('lie-2.1.0');
    expect(stored.materialized_at).toBe(NOW);
  });

  it('the database rejects any attempt to rewrite provenance', async () => {
    await insertOutreachTask(newTask());
    // Simulates a caller reaching past the narrow API — the trigger still wins.
    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => any };
    const res = await ownedDbTable('outreach_tasks').update({ planner_version: 'HACKED' }).eq('company_id', 'co-a');
    expect(String(res.error?.message)).toContain('immutable');
  });

  it('audit tables reject UPDATE', async () => {
    const t = await insertOutreachTask(newTask());
    await appendApproval({ companyId: 'co-a', taskId: t.data!.id as string, decision: 'approved', approverUserId: 'u1', reason: null, notes: null, missingInformation: [], decidedAt: NOW });
    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => any };
    for (const table of ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions']) {
      const res = await ownedDbTable(table).update({ decision: 'rejected' }).eq('company_id', 'co-a');
      expect(String(res.error?.message)).toContain('append-only');
    }
  });
});

// ── 3. Audit persistence ────────────────────────────────────────────────────

describe('WS-3 M1 (3) — append-only audit persistence', () => {
  const taskId = async () => (await insertOutreachTask(newTask())).data!.id as string;

  it('persists approvals with approver identity and missing information', async () => {
    const id = await taskId();
    expect(await appendApproval({ companyId: 'co-a', taskId: id, decision: 'approved', approverUserId: 'u-7', reason: 'reviewed', notes: null, missingInformation: ['jobTitle'], decidedAt: NOW })).toMatchObject({ ok: true });
    const rows = await listApprovals('co-a', id);
    expect(rows[0]).toMatchObject({ decision: 'approved', approver_user_id: 'u-7', missing_information: ['jobTitle'] });
  });

  it('persists attempts with the governance version in force AT THAT ATTEMPT', async () => {
    const id = await taskId();
    await appendAttempt({ companyId: 'co-a', taskId: id, attemptNumber: 1, channel: 'email', transport: 'emailService', governanceVersion: 'gov-1.0.0', outcome: null, error: null, startedAt: NOW, completedAt: null });
    await appendAttempt({ companyId: 'co-a', taskId: id, attemptNumber: 2, channel: 'email', transport: 'emailService', governanceVersion: 'gov-1.1.0', outcome: null, error: null, startedAt: NOW, completedAt: null });
    const rows = db.tables.outreach_attempts;
    // Attempt-level governance is deliberately distinct from the task's
    // materialisation version, so tightening a rule never appears retroactive.
    expect(rows.map((r) => r.governance_version)).toEqual(['gov-1.0.0', 'gov-1.1.0']);
    expect(db.tables.outreach_tasks[0].governance_version).toBe(GOVERNANCE_VERSION);
  });

  it('persists delivery evidence and governance decisions', async () => {
    const id = await taskId();
    expect(await appendDeliveryEvidence({ companyId: 'co-a', taskId: id, attemptId: null, deliveryStatus: 'confirmed', transportResponse: { ok: true }, observedAt: NOW })).toMatchObject({ ok: true });
    expect(await appendDecision({ companyId: 'co-a', taskId: id, gate: 'rate_limit', decision: 'denied', reason: 'per-lead cap', scope: 'lead', limiterLayer: 'redis', governanceVersion: 'gov-1.0.0', decidedAt: NOW })).toMatchObject({ ok: true });
    expect(db.tables.outreach_decisions[0]).toMatchObject({ gate: 'rate_limit', decision: 'denied', limiter_layer: 'redis' });
  });
});

// ── 4. Outcome model ────────────────────────────────────────────────────────

describe('WS-3 M1 (4) — two-axis outcome model', () => {
  it('delivery and business outcomes are independent, not one field', async () => {
    const t = await insertOutreachTask(newTask());
    const id = t.data!.id as string;
    await setOutreachTaskState('co-a', id, { deliveryStatus: 'confirmed' });
    await appendOutcome({ companyId: 'co-a', taskId: id, outcomeType: 'no_response', derived: true, evidence: {}, occurredAt: NOW });

    // The most operationally meaningful combination in outreach: we definitely
    // sent it, and they definitely did not reply.
    expect(db.tables.outreach_tasks[0].delivery_status).toBe('confirmed');
    expect(await outcomeTypesFor('co-a', id)).toEqual(['no_response']);
  });

  it('honours the feedback idempotency key under at-least-once delivery', async () => {
    const id = (await insertOutreachTask(newTask())).data!.id as string;
    const outcome = { companyId: 'co-a', taskId: id, outcomeType: 'replied' as const, derived: false, evidence: {}, occurredAt: NOW };
    expect(await appendOutcome(outcome)).toMatchObject({ ok: true });
    // A redelivered emission must be absorbed, not double-recorded or failed.
    expect(await appendOutcome(outcome)).toMatchObject({ ok: true, duplicate: true });
    expect(db.tables.outreach_outcomes).toHaveLength(1);
  });

  it('accumulates multiple business outcomes for one task', async () => {
    const id = (await insertOutreachTask(newTask())).data!.id as string;
    for (const [type, at] of [['opened', '2026-08-05T10:00:00.000Z'], ['clicked', '2026-08-05T11:00:00.000Z'], ['replied', '2026-08-05T12:00:00.000Z']] as const) {
      await appendOutcome({ companyId: 'co-a', taskId: id, outcomeType: type, derived: false, evidence: {}, occurredAt: at });
    }
    expect(await outcomeTypesFor('co-a', id)).toEqual(['clicked', 'opened', 'replied']);
  });

  it('marks the outcomes no transport can observe today', () => {
    expect([...UNOBSERVABLE_BUSINESS_OUTCOMES].sort()).toEqual(['clicked', 'meeting_booked', 'opened']);
    expect(DERIVED_BUSINESS_OUTCOMES).toEqual(['no_response']);
    for (const t of [...UNOBSERVABLE_BUSINESS_OUTCOMES, ...DERIVED_BUSINESS_OUTCOMES]) {
      expect(BUSINESS_OUTCOME_TYPES).toContain(t);
    }
  });
});

// ── 5. Lifecycle validation ─────────────────────────────────────────────────

describe('WS-3 M1 (5) — lifecycle model', () => {
  it('declares all 17 states', () => {
    expect(OUTREACH_TASK_STATUSES).toHaveLength(17);
    for (const s of ['pending', 'awaiting_approval', 'approved', 'rejected', 'queued', 'dispatching', 'sent', 'delivered', 'completed', 'failed', 'cancelled', 'paused', 'resumed', 'retried', 'escalated', 'reassigned', 'expired'] as const) {
      expect(OUTREACH_TASK_STATUSES).toContain(s);
    }
  });

  it('nothing exits a terminal state', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(['cancelled', 'completed', 'expired', 'rejected']);
    for (const t of TERMINAL_STATUSES) {
      expect(ALLOWED_TRANSITIONS[t]).toEqual([]);
      expect(isTerminalStatus(t)).toBe(true);
      for (const other of OUTREACH_TASK_STATUSES) expect(isTransitionAllowed(t, other)).toBe(false);
    }
  });

  it('transient states resolve to exactly one successor', () => {
    expect([...TRANSIENT_STATUSES].sort()).toEqual(['reassigned', 'resumed', 'retried']);
    expect(ALLOWED_TRANSITIONS.retried).toEqual(['queued']);
    expect(ALLOWED_TRANSITIONS.resumed).toEqual(['queued']);
    // Reassignment may return a task to the start of the flow or straight to the queue.
    expect(ALLOWED_TRANSITIONS.reassigned).toEqual(['pending', 'queued']);
    for (const s of TRANSIENT_STATUSES) expect(isTransientStatus(s)).toBe(true);
  });

  it('permits the approval path and forbids skipping it', () => {
    expect(isTransitionAllowed('pending', 'awaiting_approval')).toBe(true);
    expect(isTransitionAllowed('awaiting_approval', 'approved')).toBe(true);
    expect(isTransitionAllowed('approved', 'queued')).toBe(true);
    // An awaiting-approval task cannot jump to dispatch.
    expect(isTransitionAllowed('awaiting_approval', 'queued')).toBe(false);
    expect(isTransitionAllowed('awaiting_approval', 'dispatching')).toBe(false);
    expect(isTransitionAllowed('pending', 'sent')).toBe(false);
  });

  it('every declared transition target is itself a declared state', () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      expect(OUTREACH_TASK_STATUSES).toContain(from);
      for (const t of targets) expect(OUTREACH_TASK_STATUSES).toContain(t);
    }
  });

  it('explains why a transition was refused', () => {
    expect(explainTransition('pending', 'awaiting_approval')).toContain('permitted');
    expect(explainTransition('completed', 'queued')).toContain('terminal');
    expect(explainTransition('queued', 'delivered')).toContain('not permitted');
  });

  it('the delivery axis is monotonic', () => {
    expect(isDeliveryTransitionAllowed('queued', 'dispatched')).toBe(true);
    expect(isDeliveryTransitionAllowed('dispatched', 'confirmed')).toBe(true);
    expect(isDeliveryTransitionAllowed('confirmed', 'delivered')).toBe(true);
    // Never backwards.
    expect(isDeliveryTransitionAllowed('delivered', 'dispatched')).toBe(false);
    expect(isDeliveryTransitionAllowed('confirmed', 'queued')).toBe(false);
    for (const terminal of ['delivered', 'bounced', 'failed', 'suppressed', 'expired'] as const) {
      expect(ALLOWED_DELIVERY_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('rejects a status the schema does not declare', async () => {
    const res = await insertOutreachTask({ ...newTask(), status: 'teleported' as never });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain('check constraint');
  });
});

// ── 6. Tenant isolation ─────────────────────────────────────────────────────

describe('WS-3 M1 (6) — tenant isolation', () => {
  it('every read and write is company-scoped', async () => {
    const id = (await insertOutreachTask(newTask())).data!.id as string;
    db.filtersSeen = [];
    await getOutreachTask('co-a', 'L1', 'task-1-intro');
    await listOutreachTasksForLead('co-a', 'L1');
    await setOutreachTaskState('co-a', id, { status: 'queued' });
    await listApprovals('co-a', id);
    await outcomeTypesFor('co-a', id);

    expect(db.filtersSeen.length).toBeGreaterThan(0);
    for (const q of db.filtersSeen) {
      expect(q.filters.map(([c]) => c)).toContain('company_id');
    }
  });

  it('a tenant cannot read another tenant’s task', async () => {
    await insertOutreachTask(newTask({ companyId: 'co-a' }));
    expect(await getOutreachTask('co-b', 'L1', 'task-1-intro')).toBeNull();
    expect(await listOutreachTasksForLead('co-b', 'L1')).toEqual([]);
  });

  it('a state write scoped to the wrong tenant changes nothing', async () => {
    const id = (await insertOutreachTask(newTask({ companyId: 'co-a' }))).data!.id as string;
    await setOutreachTaskState('co-b', id, { status: 'completed' });
    expect(db.tables.outreach_tasks[0].status).toBe('pending');
  });

  it('writes carry company_id so the row is scoped at rest', async () => {
    const id = (await insertOutreachTask(newTask())).data!.id as string;
    await appendApproval({ companyId: 'co-a', taskId: id, decision: 'approved', approverUserId: null, reason: null, notes: null, missingInformation: [], decidedAt: NOW });
    await appendDecision({ companyId: 'co-a', taskId: id, gate: 'approval', decision: 'allowed', reason: null, scope: null, limiterLayer: null, governanceVersion: null, decidedAt: NOW });
    for (const table of ['outreach_tasks', 'outreach_approvals', 'outreach_decisions']) {
      for (const row of db.tables[table]) expect(row.company_id).toBe('co-a');
    }
  });
});

// ── 7. Schema alignment + no execution capability ───────────────────────────

describe('WS-3 M1 (7) — schema alignment and absence of execution', () => {
  const migration = (): string => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    return fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql'), 'utf8');
  };

  /**
   * The CHECK constraint in force after the whole WS-3 migration set has run.
   *
   * A later milestone may legitimately REPLACE a constraint (M7 extends the
   * business-outcome vocabulary), so reading only the M1 file would assert a
   * rule the database no longer has. Taking the LAST definition in filename
   * order — rather than concatenating every file and searching the union —
   * keeps the assertion honest: a value removed from the current constraint
   * still fails even though an earlier migration mentions it.
   */
  const currentCheck = (constraintName: string): string => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f: string) => /_ws3_.*\.sql$/.test(f)).sort();
    // Balanced-paren scan rather than a regex: a CHECK body contains its own
    // parentheses, and a lazy regex would stop at the first inner `)`.
    const bodyAfter = (sql: string, from: number): string => {
      const open = sql.indexOf('(', from);
      if (open < 0) return '';
      let depth = 0;
      for (let i = open; i < sql.length; i += 1) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') {
          depth -= 1;
          if (depth === 0) return sql.slice(open + 1, i);
        }
      }
      return '';
    };

    let found = '';
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      const marker = `CONSTRAINT ${constraintName} CHECK`;
      let at = sql.indexOf(marker);
      while (at >= 0) {
        found = bodyAfter(sql, at + marker.length);
        at = sql.indexOf(marker, at + marker.length);
      }
    }
    expect(found).not.toBe('');
    return found;
  };

  it('the code’s state vocabulary matches the migration CHECK constraints', () => {
    const statusCheck = currentCheck('outreach_tasks_status_valid');
    for (const s of OUTREACH_TASK_STATUSES) expect(statusCheck).toContain(`'${s}'`);

    const deliveryCheck = currentCheck('outreach_tasks_delivery_status_valid');
    for (const d of DELIVERY_STATUSES) expect(deliveryCheck).toContain(`'${d}'`);

    const outcomeCheck = currentCheck('outreach_outcomes_type_valid');
    for (const o of BUSINESS_OUTCOME_TYPES) expect(outcomeCheck).toContain(`'${o}'`);
  });

  it('the migration enforces immutability and append-only in the DATABASE', () => {
    const sql = migration();
    expect(sql).toContain('ws3_protect_task_provenance');
    expect(sql).toContain('ws3_reject_mutation');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('outreach_tasks_identity_unique');
    expect(sql).toContain('outreach_outcomes_idempotent');
  });

  it('creates no execution, dispatch, queue or transport capability', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const dir = path.join(process.cwd(), 'backend/services/leadOutreachExecution');
    // Strip comments first: this guard must assert what the CODE does, not what
    // the documentation says. The headers deliberately name the capabilities
    // that must not appear, in order to explain the boundary.
    const source = fs
      .readdirSync(dir)
      .map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // Storage and translation only. Any of these appearing in an import means a
    // later milestone's capability has leaked in early. Matched ANYWHERE in the
    // module specifier — a relative path like '../emailService' must fail too.
    for (const forbidden of ['bullmq', 'communityAiActionExecutor', 'automationService', 'emailService', 'whatsapp', 'axios', 'node-fetch']) {
      expect(source).not.toMatch(new RegExp(`from\\s+'[^']*${forbidden}`, 'i'));
      expect(source).not.toMatch(new RegExp(`require\\(\\s*'[^']*${forbidden}`, 'i'));
    }
    expect(source).not.toMatch(/\bfetch\s*\(/);

    /**
     * WS-3 M2 tightening, NOT loosening. Translation legitimately reads the
     * WS-2 plan model, so a blanket ban on `automationExecution` no longer
     * expresses the rule. The real rule is narrower and stronger: the WS-2
     * plan model may be imported as TYPES ONLY, from its types module only.
     * A value import would let this runtime EXECUTE WS-2 planning, which would
     * breach the ownership boundary the architecture freezes.
     */
    const automationImports = [...source.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+'([^']*automationExecution[^']*)'/g)];
    for (const [, isType, specifier] of automationImports) {
      expect(isType).toBeTruthy();          // must be `import type`
      expect(specifier).toMatch(/\/types$/); // must be the types module
    }
    // And it must never import the WS-2 planning layer at all.
    expect(source).not.toMatch(/from\s+'[^']*qualificationPlanning/);
  });

  it('declares runtime versions for the immutable contract', () => {
    expect(EXECUTION_RUNTIME_VERSION).toBe('lor-1.0.0');
    expect(TRANSLATION_VERSION).toBe('tr-1.0.0');
    expect(GOVERNANCE_VERSION).toBe('gov-1.0.0');
  });
});
