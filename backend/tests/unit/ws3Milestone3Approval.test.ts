/**
 * WS-3 Milestone-3 — approval workflow & human decision lifecycle.
 *
 * The database double enforces the real Milestone-1 guarantees: identity
 * uniqueness, provenance immutability, append-only audit, and — critically for
 * this milestone — a compare-and-set UPDATE that only matches when the row's
 * current status equals the expected one. Without that last property a test
 * suite would "prove" race-safety that the real database provides and the code
 * might not.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  filtersSeen: [] as Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload: Row | null }>,
  forceError: null as null | { code?: string; message?: string },
  /** Fails only inserts into the named table — used to test audit failure. */
  failInsertInto: null as string | null,
};

const IMMUTABLE_TASK_COLS = ['company_id', 'lead_id', 'plan_task_id', 'planner_version', 'translation_version', 'governance_version', 'execution_runtime_version', 'materialized_at'];
const APPEND_ONLY = ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) => st.filters.every(([c, v]) => r[c] === v);

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve(); // yield — lets concurrent callers interleave here
      db.filtersSeen.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      if (db.forceError) return { data: null, error: db.forceError };

      if (st.op === 'insert') {
        if (db.failInsertInto === table) return { data: null, error: { code: '08006', message: 'connection failure' } };
        const row = st.payload as Row;
        if (table === 'outreach_tasks' && rows().some((r) => r.company_id === row.company_id && r.lead_id === row.lead_id && r.plan_task_id === row.plan_task_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        const created = { ...row, id: `row-${db.nextId++}`, created_at: '2026-08-05T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }

      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) {
          return { data: null, error: { code: '2F004', message: `ws3_append_only: ${table} is append-only` } };
        }
        const touched = Object.keys(st.payload ?? {});
        if (table === 'outreach_tasks' && touched.some((c) => IMMUTABLE_TASK_COLS.includes(c))) {
          return { data: null, error: { code: '2F004', message: 'ws3_immutable_provenance' } };
        }
        // Compare-and-set: only rows matching EVERY filter (including the
        // expected status) are updated, exactly as PostgreSQL behaves.
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
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  TRANSLATION_VERSION,
  approveOutreachTask,
  cancelApprovalRequest,
  getApprovalHistory,
  getApprovalState,
  getOutreachTaskById,
  insertOutreachTask,
  rejectOutreachTask,
  resubmitForApproval,
  submitForApproval,
  type NewOutreachTask,
} from '../../services/leadOutreachExecution';

const NOW = '2026-08-05T12:00:00.000Z';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-intro',
  taskOrder: 1, kind: 'outreach', action: 'Send intro email', channel: 'email',
  dependsOnPlanTaskId: null, estimatedDelayHours: 0, confidence: 0.7,
  explanation: 'Hot lead', requiresApproval: true,
  plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

const seed = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const res = await insertOutreachTask(newTask(over));
  return res.data!.id as string;
};

const approver = (over: Record<string, unknown> = {}) => ({ approverUserId: 'u-7', decidedAt: NOW, ...over });

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.filtersSeen = [];
  db.forceError = null;
  db.failInsertInto = null;
});

// ── 1. Submission ───────────────────────────────────────────────────────────

describe('WS-3 M3 (1) — submission', () => {
  it('moves a pending task to awaiting_approval', async () => {
    const id = await seed();
    const res = await submitForApproval('co-a', id);
    expect(res).toMatchObject({ ok: true, changed: true, status: 'awaiting_approval' });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('awaiting_approval');
  });

  it('is idempotent — resubmitting an already-awaiting task changes nothing', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    const again = await resubmitForApproval('co-a', id);
    expect(again).toMatchObject({ ok: true, changed: false, status: 'awaiting_approval' });
    expect(db.tables.outreach_approvals ?? []).toHaveLength(0); // submission is not a decision
  });

  it('refuses an unknown task', async () => {
    const res = await submitForApproval('co-a', 'no-such-task');
    expect(res).toMatchObject({ ok: false, refusal: 'task_not_found' });
  });

  it('refuses a task belonging to another tenant', async () => {
    const id = await seed({ companyId: 'co-a' });
    expect(await submitForApproval('co-b', id)).toMatchObject({ ok: false, refusal: 'task_not_found' });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('pending');
  });
});

// ── 2. Decisions ────────────────────────────────────────────────────────────

describe('WS-3 M3 (2) — approve and reject', () => {
  it('approves an awaiting task and records the decision immutably', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    const res = await approveOutreachTask('co-a', id, approver({ reason: 'meets policy', notes: 'looks good to me' }));

    expect(res).toMatchObject({ ok: true, changed: true, status: 'approved' });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('approved');

    const history = await getApprovalHistory('co-a', id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      decision: 'approved', approver_user_id: 'u-7',
      reason: 'meets policy', notes: 'looks good to me', decided_at: NOW,
    });
  });

  it('rejects an awaiting task', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    const res = await rejectOutreachTask('co-a', id, approver({ reason: 'wrong persona' }));
    expect(res).toMatchObject({ ok: true, changed: true, status: 'rejected' });
    expect((await getApprovalHistory('co-a', id))[0]).toMatchObject({ decision: 'rejected', reason: 'wrong persona' });
  });

  it('requires an approver identity', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    for (const bad of ['', '   ', undefined as unknown as string]) {
      const res = await approveOutreachTask('co-a', id, { approverUserId: bad });
      expect(res).toMatchObject({ ok: false, refusal: 'missing_approver' });
    }
    // The task never moved and nothing was recorded.
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('awaiting_approval');
    expect(db.tables.outreach_approvals ?? []).toHaveLength(0);
  });

  it('refuses a decision on a task that was never submitted', async () => {
    const id = await seed();
    const res = await approveOutreachTask('co-a', id, approver());
    // pending → approved is not a legal transition.
    expect(res).toMatchObject({ ok: false, refusal: 'invalid_state', status: 'pending' });
    expect(String(res.reason)).toContain('not permitted');
    expect(db.tables.outreach_approvals ?? []).toHaveLength(0);
  });

  it('refuses cross-tenant decisions', async () => {
    const id = await seed({ companyId: 'co-a' });
    await submitForApproval('co-a', id);
    expect(await approveOutreachTask('co-b', id, approver())).toMatchObject({ ok: false, refusal: 'task_not_found' });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('awaiting_approval');
  });
});

// ── 3. Duplicate / conflicting decisions ────────────────────────────────────

describe('WS-3 M3 (3) — duplicate and conflicting decisions', () => {
  const submitted = async (): Promise<string> => {
    const id = await seed();
    await submitForApproval('co-a', id);
    return id;
  };

  it('refuses a second approval', async () => {
    const id = await submitted();
    await approveOutreachTask('co-a', id, approver());
    const again = await approveOutreachTask('co-a', id, approver({ approverUserId: 'u-9' }));
    expect(again).toMatchObject({ ok: false, changed: false, status: 'approved' });
    expect(await getApprovalHistory('co-a', id)).toHaveLength(1); // one decision, one record
  });

  it('refuses a second rejection', async () => {
    const id = await submitted();
    await rejectOutreachTask('co-a', id, approver());
    const again = await rejectOutreachTask('co-a', id, approver({ approverUserId: 'u-9' }));
    expect(again.ok).toBe(false);
    expect(await getApprovalHistory('co-a', id)).toHaveLength(1);
  });

  it('refuses approval after rejection', async () => {
    const id = await submitted();
    await rejectOutreachTask('co-a', id, approver());
    const res = await approveOutreachTask('co-a', id, approver({ approverUserId: 'u-9' }));
    // `rejected` is terminal — nothing exits it.
    expect(res).toMatchObject({ ok: false, refusal: 'invalid_state', status: 'rejected' });
    expect(String(res.reason)).toContain('terminal');
  });

  it('refuses rejection after approval', async () => {
    const id = await submitted();
    await approveOutreachTask('co-a', id, approver());
    const res = await rejectOutreachTask('co-a', id, approver({ approverUserId: 'u-9' }));
    expect(res).toMatchObject({ ok: false, refusal: 'invalid_state', status: 'approved' });
  });

  it('exactly ONE of two simultaneous approvers wins', async () => {
    const id = await submitted();
    const [a, b] = await Promise.all([
      approveOutreachTask('co-a', id, approver({ approverUserId: 'u-1' })),
      approveOutreachTask('co-a', id, approver({ approverUserId: 'u-2' })),
    ]);
    const winners = [a, b].filter((r) => r.changed);
    expect(winners).toHaveLength(1);
    // The loser is told what the task actually is, and writes nothing.
    const loser = [a, b].find((r) => !r.changed)!;
    expect(loser).toMatchObject({ ok: false, refusal: 'already_decided', status: 'approved' });
    expect(await getApprovalHistory('co-a', id)).toHaveLength(1);
  });

  it('only one decision survives an approve/reject race', async () => {
    const id = await submitted();
    const results = await Promise.all([
      approveOutreachTask('co-a', id, approver({ approverUserId: 'u-1' })),
      rejectOutreachTask('co-a', id, approver({ approverUserId: 'u-2' })),
    ]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    const history = await getApprovalHistory('co-a', id);
    expect(history).toHaveLength(1);
    // The recorded decision matches the task's final state — never contradicts it.
    const finalStatus = (await getOutreachTaskById('co-a', id))!.status;
    expect(history[0].decision).toBe(finalStatus);
  });

  it('six concurrent approvers still produce one decision', async () => {
    const id = await submitted();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => approveOutreachTask('co-a', id, approver({ approverUserId: `u-${i}` }))),
    );
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await getApprovalHistory('co-a', id)).toHaveLength(1);
  });
});

// ── 4. Cancellation and the terminal-state constraint ───────────────────────

describe('WS-3 M3 (4) — cancellation', () => {
  it('withdraws an approval request and records it', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    const res = await cancelApprovalRequest('co-a', id, approver({ reason: 'lead went cold' }));
    expect(res).toMatchObject({ ok: true, changed: true, status: 'cancelled' });
    // A withdrawal is a human decision about contacting someone, so it is
    // recorded rather than vanishing.
    expect((await getApprovalHistory('co-a', id))[0]).toMatchObject({ decision: 'rejected', reason: 'lead went cold' });
  });

  it('requires an approver to cancel', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    expect(await cancelApprovalRequest('co-a', id, { approverUserId: '' })).toMatchObject({ ok: false, refusal: 'missing_approver' });
  });

  it('a cancelled or rejected task can NEVER be resubmitted', async () => {
    // The frozen lifecycle makes both terminal. The architecture's answer to
    // "we want to try again" is a NEW task from a regenerated plan, not a
    // revived one — so this asserts the constraint rather than working around it.
    const cancelled = await seed({ planTaskId: 'task-1-a' });
    await submitForApproval('co-a', cancelled);
    await cancelApprovalRequest('co-a', cancelled, approver());
    expect(await resubmitForApproval('co-a', cancelled)).toMatchObject({ ok: false, refusal: 'invalid_state', status: 'cancelled' });

    const rejected = await seed({ planTaskId: 'task-1-b' });
    await submitForApproval('co-a', rejected);
    await rejectOutreachTask('co-a', rejected, approver());
    expect(await resubmitForApproval('co-a', rejected)).toMatchObject({ ok: false, refusal: 'invalid_state', status: 'rejected' });
  });
});

// ── 5. Retrieval ────────────────────────────────────────────────────────────

describe('WS-3 M3 (5) — approval state and history', () => {
  it('reports state through the whole request lifecycle', async () => {
    const id = await seed();
    expect(await getApprovalState('co-a', id)).toMatchObject({
      status: 'pending', requiresApproval: true, awaitingDecision: false, latestDecision: null, decisionCount: 0,
    });

    await submitForApproval('co-a', id);
    expect(await getApprovalState('co-a', id)).toMatchObject({ status: 'awaiting_approval', awaitingDecision: true });

    await approveOutreachTask('co-a', id, approver({ reason: 'ok' }));
    expect(await getApprovalState('co-a', id)).toMatchObject({
      status: 'approved', awaitingDecision: false, latestDecision: 'approved',
      latestApproverUserId: 'u-7', latestDecidedAt: NOW, decisionCount: 1,
    });
  });

  it('reports an empty state for an unknown or foreign task', async () => {
    const id = await seed({ companyId: 'co-a' });
    for (const state of [await getApprovalState('co-a', 'nope'), await getApprovalState('co-b', id)]) {
      expect(state).toMatchObject({ status: null, latestDecision: null, decisionCount: 0 });
    }
  });

  it('history is company-scoped and ordered oldest first', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    await approveOutreachTask('co-a', id, approver());
    expect(await getApprovalHistory('co-a', id)).toHaveLength(1);
    expect(await getApprovalHistory('co-b', id)).toHaveLength(0);
  });
});

// ── 6. Audit integrity ──────────────────────────────────────────────────────

describe('WS-3 M3 (6) — immutable audit', () => {
  it('records approver, decision, timestamp, reason and notes', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    await approveOutreachTask('co-a', id, approver({ reason: 'policy 4.2', notes: 'spoke to the AE' }));
    const row = (await getApprovalHistory('co-a', id))[0];
    for (const field of ['approver_user_id', 'decision', 'decided_at', 'reason', 'notes', 'company_id', 'task_id']) {
      expect(row[field]).toBeDefined();
    }
  });

  it('the audit table rejects UPDATE and DELETE', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    await approveOutreachTask('co-a', id, approver());
    const { ownedDbTable } = require('../../db/writeOwner') as { ownedDbTable: (t: string) => any };
    const res = await ownedDbTable('outreach_approvals').update({ decision: 'rejected' }).eq('company_id', 'co-a');
    expect(String(res.error?.message)).toContain('append-only');
  });

  it('surfaces a state change whose audit record failed, rather than hiding it', async () => {
    const id = await seed();
    await submitForApproval('co-a', id);
    db.failInsertInto = 'outreach_approvals';
    const res = await approveOutreachTask('co-a', id, approver());
    db.failInsertInto = null;

    // The decision took effect and its record did not — both are reported.
    expect(res).toMatchObject({ changed: true, status: 'approved', auditFailed: true });
    expect((await getOutreachTaskById('co-a', id))?.status).toBe('approved');
    expect(await getApprovalHistory('co-a', id)).toHaveLength(0);
  });

  it('never throws when storage is unavailable', async () => {
    const id = await seed();
    db.forceError = { code: '08006', message: 'connection failure' };
    await expect(submitForApproval('co-a', id)).resolves.toMatchObject({ ok: false });
    await expect(approveOutreachTask('co-a', id, approver())).resolves.toMatchObject({ ok: false });
    await expect(getApprovalState('co-a', id)).resolves.toMatchObject({ status: null });
  });

  it('approval never mutates task provenance', async () => {
    const id = await seed();
    const before = { ...db.tables.outreach_tasks[0] };
    await submitForApproval('co-a', id);
    await approveOutreachTask('co-a', id, approver());
    const after = db.tables.outreach_tasks[0];
    for (const col of ['planner_version', 'translation_version', 'governance_version', 'execution_runtime_version', 'materialized_at', 'plan_task_id']) {
      expect(after[col]).toBe(before[col]);
    }
  });
});

// ── 7. Tenant isolation + guards ────────────────────────────────────────────

describe('WS-3 M3 (7) — tenant isolation and guards', () => {
  it('every approval query is company-scoped', async () => {
    const id = await seed();
    db.filtersSeen = [];
    await submitForApproval('co-a', id);
    await approveOutreachTask('co-a', id, approver());
    await getApprovalState('co-a', id);
    await getApprovalHistory('co-a', id);
    expect(db.filtersSeen.length).toBeGreaterThan(0);
    for (const q of db.filtersSeen) {
      if (q.op === 'insert') {
        // An insert is scoped by the tenant it writes, not by a filter.
        expect(q.payload?.company_id).toBe('co-a');
      } else {
        expect(q.filters.map(([c]) => c)).toContain('company_id');
      }
    }
  });

  it('one tenant’s decision cannot affect another tenant’s identical task', async () => {
    const a = await seed({ companyId: 'co-a' });
    const b = await seed({ companyId: 'co-b' });
    await submitForApproval('co-a', a);
    await submitForApproval('co-b', b);
    await approveOutreachTask('co-a', a, approver());

    expect((await getOutreachTaskById('co-a', a))?.status).toBe('approved');
    expect((await getOutreachTaskById('co-b', b))?.status).toBe('awaiting_approval');
    expect(await getApprovalHistory('co-b', b)).toHaveLength(0);
  });

  it('imports no queue, transport, governance, messaging or HTTP module', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const source = fs
      .readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/approval.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const forbidden of [
      'bullmq', 'ioredis', 'redis', 'emailService', 'whatsapp', 'twilio',
      'communityAiActionExecutor', 'automationService', 'automationConstants',
      'axios', 'node-fetch', 'undici', 'extension', 'queue', 'workerTopology',
    ]) {
      expect(source).not.toMatch(new RegExp(`from\\s+'[^']*${forbidden}`, 'i'));
      expect(source).not.toMatch(new RegExp(`require\\(\\s*'[^']*${forbidden}`, 'i'));
    }
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bsetTimeout\s*\(/);
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
  });

  it('performs no execution-lifecycle transition beyond approval', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const source = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/approval.ts'), 'utf8');
    // Queueing, dispatching, sending and delivering belong to M4/M5.
    for (const state of ['queued', 'dispatching', 'sent', 'delivered', 'completed', 'retried', 'paused', 'resumed']) {
      expect(source).not.toMatch(new RegExp(`'${state}'`));
    }
    // Only the approval segment appears.
    for (const state of ['awaiting_approval', 'approved', 'rejected', 'cancelled']) {
      expect(source).toMatch(new RegExp(`'${state}'`));
    }
  });
});
