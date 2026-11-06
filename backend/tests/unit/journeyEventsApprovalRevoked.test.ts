/**
 * Contract 0.3.0 — `approval.revoked`, produced by the journey event VIEW from the
 * append-only `outreach_approvals` row that revocation already writes. No new store.
 *
 * Pure: every store the view reads is replaced by an in-memory table that honours the
 * columns selected and the tenant filters, so the test also proves what the view reads.
 * The real-schema proof is realschema/orch_c4_approval_revoked.test.ts.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
const mockReads: Array<{ table: string; columns: string }> = [];
const mockFail = { table: null as string | null };

jest.mock('../../db/writeOwner', () => {
  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let columns = '*';
    let max = Infinity;
    const q = {
      select(c: string) { columns = c; mockReads.push({ table, columns: c }); return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
      gte(c: string, v: string) { filters.push((r) => String(r[c]) >= v); return q; },
      limit(n: number) { max = n; return q; },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        if (mockFail.table === table) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve);
        const cols = columns.split(',').map((c) => c.trim());
        const data = (mockTables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, max)
          .map((r) => (columns === '*' ? { ...r } : Object.fromEntries(cols.map((c) => [c, r[c]]))));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  };
  return { __esModule: true, ownedDbTable: (t: string) => builder(t) };
});

const ORG = '00000000-0000-4000-8000-00000000000a';
const OTHER_ORG = '00000000-0000-4000-8000-00000000000b';
const RUN = '00000000-0000-4000-8000-0000000000a1';
const EXEC_TASK = '00000000-0000-4000-8000-0000000000e1';
const OUTREACH_TASK = '00000000-0000-4000-8000-0000000000f1';
const APPROVER = '00000000-0000-4000-8000-0000000000c1';

jest.mock('../../services/executionInstances/executionInstanceStore', () => ({
  EXECUTION_INSTANCES_TABLE: 'execution_instances',
  getExecutionInstance: jest.fn(async (org: string, id: string) => (org === ORG && id === RUN
    ? { id: RUN, subjectKind: 'lead', subjectId: 'lead-1', lifecycleState: 'active', createdAt: '2030-01-01T00:00:00.000Z', updatedAt: '2030-01-01T00:00:00.000Z' }
    : null)),
}));
jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  listInstanceTasks: jest.fn(async () => [{ id: EXEC_TASK, planStepId: 'step-1', channel: 'email' }]),
}));
jest.mock('../../services/outreachBridge/outreachBridgeStore', () => ({
  listInstanceHandoffs: jest.fn(async () => [{ executionTaskId: EXEC_TASK, outreachTaskId: OUTREACH_TASK }]),
}));
jest.mock('../../services/leadOutreachExecution/personAnchor', () => ({
  resolveSubjectPersonId: jest.fn(async () => ({ ok: false })),
}));
jest.mock('../../services/orchestration/journeyDecisionLog', () => ({ listJourneyDecisions: jest.fn(async () => []) }));
jest.mock('../../services/orchestration/journeyResponses', () => ({ durableJourneyResponsePort: { whatsappReply: async () => null } }));

import { readJourneyEvents } from '../../services/orchestration/journeyEvents';
import { JOURNEY_EVENT_TYPES, type JourneyEvent } from '../../services/orchestration/executionContract';

const approval = (id: string, decision: string, decidedAt: string, extra: Row = {}): Row => ({
  id, company_id: ORG, task_id: OUTREACH_TASK, decision, decided_at: decidedAt,
  approver_user_id: APPROVER, tier: 'tenant', reason: 'FREE TEXT the approver typed', notes: 'NOTE CONTENT', ...extra,
});
const read = async (opts: Parameters<typeof readJourneyEvents>[2] = {}) => {
  const page = await readJourneyEvents(ORG, RUN, opts);
  if (page === null) throw new Error('run not found');
  return page;
};
const approvalEvents = (events: readonly JourneyEvent[]) => events.filter((e) => e.type.startsWith('approval.'));

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockReads.length = 0;
  mockFail.table = null;
  mockTables.outreach_approvals = [
    approval('a-1', 'approved', '2030-01-02T00:00:00.000Z'),
    approval('a-2', 'revoked', '2030-01-03T00:00:00.000Z'),
  ];
});

describe('approval.revoked is produced from the revocation row', () => {
  it('approved then revoked reads as granted then revoked; never as rejected', async () => {
    const page = await read();
    expect(approvalEvents(page.events).map((e) => [e.type, e.code])).toEqual([
      ['approval.granted', 'approved'], ['approval.revoked', 'revoked'],
    ]);
    expect(JOURNEY_EVENT_TYPES).toContain('approval.revoked');
  });

  it('every stored decision value is mapped deliberately; a withdrawal before a decision stays rejected', async () => {
    mockTables.outreach_approvals = [
      approval('a-1', 'rejected', '2030-01-02T00:00:00.000Z', { reason: 'approval request cancelled' }),
      approval('a-2', 'approved', '2030-01-03T00:00:00.000Z'),
      approval('a-3', 'revoked', '2030-01-04T00:00:00.000Z'),
      approval('a-4', 'not_a_decision', '2030-01-05T00:00:00.000Z'),
    ];
    expect(approvalEvents((await read()).events).map((e) => e.type)).toEqual([
      'approval.rejected', 'approval.granted', 'approval.revoked',
      // Outside the CHECK, so unstorable; were one read, it is never a grant.
      'approval.rejected',
    ]);
  });

  it('the event carries the context of its step, the actor and tier, and no free text', async () => {
    const page = await read();
    const revoked = page.events.find((e) => e.type === 'approval.revoked')!;
    expect(revoked).toEqual({
      eventId: expect.stringMatching(/^[0-9a-f]{32}$/),
      eventVersion: 1,
      type: 'approval.revoked',
      organizationId: ORG,
      executionInstanceId: RUN,
      subject: { kind: 'lead', id: 'lead-1' },
      engine: 'ws3',
      channel: 'email',
      idempotencyKey: `task:${EXEC_TASK}`,
      correlationId: `journey:${RUN}/step:step-1`,
      occurredAt: '2030-01-03T00:00:00.000Z',
      source: { table: 'outreach_approvals', id: 'a-2' },
      code: 'revoked',
      positiveEngagement: false,
      actor: { kind: 'user', id: APPROVER, tier: 'tenant' },
    });
    const text = JSON.stringify(page);
    expect(text).not.toContain('FREE TEXT');
    expect(text).not.toContain('NOTE CONTENT');
    // The view selects only what it exposes, tenant-scoped.
    expect(mockReads.find((r) => r.table === 'outreach_approvals')?.columns).toBe('id, decision, decided_at, approver_user_id, tier');
  });

  it('a row naming no approver has no actor field at all; a pre-D-02 row has a null tier', async () => {
    mockTables.outreach_approvals = [
      approval('a-1', 'approved', '2030-01-02T00:00:00.000Z', { tier: null }),
      approval('a-2', 'revoked', '2030-01-03T00:00:00.000Z', { approver_user_id: null }),
    ];
    const [granted, revoked] = approvalEvents((await read()).events);
    expect(granted!.actor).toEqual({ kind: 'user', id: APPROVER, tier: null });
    expect('actor' in revoked!).toBe(false);
  });

  it('non-approval events never carry an actor', async () => {
    const page = await read();
    for (const e of page.events) if (!e.type.startsWith('approval.')) expect('actor' in e).toBe(false);
  });
});

describe('a consumer of approval.revoked', () => {
  it('duplicate delivery: re-reading gives the same eventId for the same row', async () => {
    const a = await read();
    const b = await read();
    expect(b.events).toEqual(a.events);
    const ids = a.events.map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the eventId is a function of (table, id, type) only: not of the time or the row order', async () => {
    const before = (await read()).events.find((e) => e.type === 'approval.revoked')!.eventId;
    mockTables.outreach_approvals = [...mockTables.outreach_approvals!].reverse();
    mockTables.outreach_approvals[0] = { ...mockTables.outreach_approvals[0]!, decided_at: '2030-01-09T00:00:00.000Z' };
    expect(mockTables.outreach_approvals[0]!.id).toBe('a-2');
    expect((await read()).events.find((e) => e.type === 'approval.revoked')!.eventId).toBe(before);
  });

  it('out of order rows: the view sorts by (occurredAt, eventId), and a cursor walks every event once', async () => {
    mockTables.outreach_approvals = [
      approval('a-3', 'revoked', '2030-01-03T00:00:00.000Z'),
      approval('a-1', 'approved', '2030-01-02T00:00:00.000Z'),
      // Same instant as the revocation: the eventId breaks the tie, deterministically.
      approval('a-2', 'rejected', '2030-01-03T00:00:00.000Z'),
    ];
    const all = (await read()).events;
    const sorted = [...all].sort((x, y) => x.occurredAt.localeCompare(y.occurredAt) || x.eventId.localeCompare(y.eventId));
    expect(all).toEqual(sorted);
    const walked: string[] = [];
    let after: string | undefined;
    for (let i = 0; i < 20; i += 1) {
      const p = await read({ limit: 1, ...(after === undefined ? {} : { after }) });
      walked.push(...p.events.map((e) => e.eventId));
      if (!p.hasMore) break;
      after = p.cursor!;
    }
    expect(walked).toEqual(all.map((e) => e.eventId));
  });

  it('consumer retry: a failed read throws and returns nothing partial; the retry gives the same events', async () => {
    const good = await read();
    mockFail.table = 'outreach_approvals';
    await expect(readJourneyEvents(ORG, RUN)).rejects.toMatchObject({ code: 'journey_events_unreadable' });
    mockFail.table = null;
    expect((await read()).events).toEqual(good.events);
  });

  it('another tenant gets nothing: the run is not found, and no approval row is read', async () => {
    expect(await readJourneyEvents(OTHER_ORG, RUN)).toBeNull();
    expect(mockReads.filter((r) => r.table === 'outreach_approvals')).toHaveLength(0);
  });

  it("another tenant's revocation row on the same task id is not read into this run", async () => {
    mockTables.outreach_approvals!.push({ ...approval('x-1', 'revoked', '2030-01-04T00:00:00.000Z'), company_id: OTHER_ORG });
    expect(approvalEvents((await read()).events).map((e) => e.source.id)).toEqual(['a-1', 'a-2']);
  });
});
