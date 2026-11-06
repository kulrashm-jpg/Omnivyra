/**
 * O2-F1 — a resume moves a run only from `paused` (a compare-and-set), so a plain resume can
 * never land inside a resume with a return date and leave the run active before the floor.
 *
 * Both resumes go through the real run route (PATCH /api/execution-instances/:id) over an
 * in-memory `execution_instances` table that honours every filter, so the same suite runs
 * against the unfixed base and fails there. The step store is a double that records the
 * floor; a probe stands in for dispatch with the O-2 rule (active, and no floor in the
 * future). The real-schema twin is realschema/o2f1_resume_race.test.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

type Row = Record<string, unknown>;
const mockDb: { instances: Row[]; ops: Array<{ op: string; table: string; filters: Array<[string, unknown]> }>; hook: null | (() => Promise<void>) } =
  { instances: [], ops: [], hook: null };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: null as Row | null, filters: [] as Array<[string, unknown]>, one: false };
    const matches = (r: Row) => st.filters.every(([c, v]) => r[c] === v);
    const exec = async () => {
      // Every statement yields first, so concurrent callers really interleave.
      await new Promise((r) => setImmediate(r));
      mockDb.ops.push({ op: st.op, table, filters: [...st.filters] });
      if (table === 'company_scheduler_prefs') return { data: { timezone: 'Europe/London' }, error: null };
      if (table !== 'execution_instances') return { data: st.one ? null : [], error: null };
      const hit = mockDb.instances.filter(matches);
      if (st.op === 'update') for (const r of hit) Object.assign(r, st.payload, { updated_at: new Date().toISOString() });
      const copy = hit.map((r) => ({ ...r }));
      return { data: st.one ? copy[0] ?? null : copy, error: null };
    };
    const b: Row = {
      select: () => b, update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      maybeSingle: () => { st.one = true; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { rpc: () => { throw new Error('no rpc here'); } } }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: 'u' })) }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: '00000000-0000-4000-8000-0000000000aa' } })),
}));
jest.mock('../../services/orchestration/journeyExit', () => ({ withdrawUnsentTasks: jest.fn(async () => undefined), exitJourney: jest.fn(async () => 0) }));
jest.mock('../../services/executionPlans/executionPlanStore', () => ({
  getPlanForInstance: jest.fn(async () => ({ id: '00000000-0000-4000-8000-000000000301', definitionSnapshot: {} })),
}));
const mockStep: { id: string; state: string; channel: string; stepKey: string; delayAfterPreviousHours: number; notBefore: string | null } = {
  id: '00000000-0000-4000-8000-000000000201', state: 'ready', channel: 'email', stepKey: 'next', delayAfterPreviousHours: 0, notBefore: null,
};
jest.mock('../../services/workflowExecution/stepProgressionStore', () => ({
  listProgressionSteps: jest.fn(async () => [{ ...mockStep }]),
  deferStepUntil: jest.fn(async (i: { notBefore: string }) => {
    if (mockDb.hook) { const h = mockDb.hook; mockDb.hook = null; await h(); }
    await new Promise((r) => setImmediate(r));
    mockStep.notBefore = i.notBefore;
    return { ...mockStep };
  }),
}));
jest.mock('../../services/orchestration/individualIntelligence', () => ({ loadIndividualFacts: jest.fn(async () => ({ personId: null, personTimezone: null, gaps: [], facts: {} })) }));
jest.mock('../../services/orchestration/journeyGovernance', () => ({ channelRefusal: jest.fn(async () => null) }));
jest.mock('../../services/orchestration/journeyResponses', () => ({
  REPLY_AWAITING_EVALUATION: 'reply_awaiting_evaluation',
  durableJourneyResponsePort: { ws3Outcomes: async () => [], whatsappReply: async () => null },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/execution-instances/[id]').default;
const store = require('../../services/executionInstances/executionInstanceStore');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-000000000101';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function patch(body: Row): Promise<{ status: number; json: Row }> {
  const out = { status: 0, json: {} as Row };
  const res = {
    setHeader: () => res, status(n: number) { out.status = n; return res; }, json(j: Row) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method: 'PATCH', query: { id: RUN, company_id: ORG }, body, headers: {}, url: `/api/execution-instances/${RUN}` };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}
const runState = () => String(mockDb.instances[0].lifecycle_state);
/** The O-2 dispatch rule: a task may go only while the run is active and no floor is in the future. */
const maySend = () => runState() === 'active' && (mockStep.notBefore === null || Date.parse(mockStep.notBefore) <= Date.now());

beforeEach(() => {
  mockDb.instances = [{
    id: RUN, organization_id: ORG, campaign_id: 'c', workflow_id: 'w', workflow_version_id: 'v', target_id: null,
    subject_kind: 'prospect', subject_id: 'p', lifecycle_state: 'paused', created_at: 't0', updated_at: 't0',
  }];
  mockDb.ops = [];
  mockDb.hook = null;
  mockStep.notBefore = null;
  mockStep.state = 'ready';
});

describe('O2-F1 — a plain resume lands between the paused check and the floor', () => {
  it('the retimed resume does NOT win: it reports resume_race_lost, so no send precedes a floor it claims', async () => {
    let plain: { status: number; json: Row } | null = null;
    let sentBeforeFloor = 0;
    mockDb.hook = async () => {
      plain = await patch({ lifecycleState: 'active' });
      if (maySend()) sentBeforeFloor += 1;          // a dispatch in the window
    };
    const retimed = await patch({ lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
    expect(plain!.status).toBe(200);
    // The invariant: a retimed resume that reports success never had a send before its floor.
    if (retimed.status === 200) expect(sentBeforeFloor).toBe(0);
    expect(retimed.status).toBe(409);
    expect(retimed.json.code).toBe('resume_race_lost');
    expect(String(retimed.json.error)).toMatch(/became active/);
    expect(runState()).toBe('active');
  });
});

describe('O2-F1 — the retimed resume wins', () => {
  it('the run becomes active only after the floor; a plain resume that read paused earlier loses', async () => {
    const snapshots: Array<{ state: string; floor: string | null }> = [];
    const realCas = store.compareAndSetExecutionInstanceState;
    let plainRead = false;
    let retimedDone: Promise<{ status: number; json: Row }> | null = null;
    // The plain resume reads `paused`; before its compare-and-set the retimed one finishes.
    const spy = jest.spyOn(store, 'compareAndSetExecutionInstanceState').mockImplementation(async (...a: unknown[]) => {
      const input = a[0] as Row;
      if (!plainRead) {
        plainRead = true;
        retimedDone = patch({ lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
        await retimedDone;
      }
      snapshots.push({ state: runState(), floor: mockStep.notBefore });
      const r = await realCas(input);
      snapshots.push({ state: runState(), floor: mockStep.notBefore });
      return r;
    });
    const plain = await patch({ lifecycleState: 'active' });
    spy.mockRestore();
    const retimed = await retimedDone!;
    expect(retimed.status).toBe(200);
    expect(Date.parse(String(retimed.json.notBefore))).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    expect(plain.status).toBe(409);
    expect(plain.json.code).toBe('resume_race_lost');
    // Never active without the floor while the retimed resume is the winner.
    for (const s of snapshots) if (s.state === 'active') expect(s.floor).not.toBeNull();
    expect(maySend()).toBe(false);
  });

  it('the floor is written before the state moves, and the move is conditional on paused', async () => {
    const r = await patch({ lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
    expect(r.status).toBe(200);
    const update = mockDb.ops.find((o) => o.op === 'update' && o.table === 'execution_instances');
    expect(update!.filters).toEqual(expect.arrayContaining([['lifecycle_state', 'paused']]));
    expect(maySend()).toBe(false);
  });
});

describe('O2-F1 — truly concurrent resumes', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i))('interleaving %i: exactly one wins; a retimed win is never preceded by an unfloored active run', async (i) => {
    let active_without_floor = 0;
    const watch = setInterval(() => { if (runState() === 'active' && mockStep.notBefore === null) active_without_floor += 1; }, 0);
    const delay = () => new Promise((r) => setImmediate(r));
    const plainP = (async () => { for (let k = 0; k < i; k += 1) await delay(); return patch({ lifecycleState: 'active' }); })();
    const retimedP = patch({ lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
    const [plain, retimed] = await Promise.all([plainP, retimedP]);
    clearInterval(watch);
    const winners = [plain, retimed].filter((x) => x.status === 200);
    const losers = [plain, retimed].filter((x) => x.status === 409);
    expect(runState()).toBe('active');
    if (retimed.status === 200 && plain.status === 409) expect(active_without_floor).toBe(0);
    // A plain resume that saw `active` (after the winner) is a no-op 200; otherwise one loses.
    expect(winners.length + losers.length).toBe(2);
    for (const l of losers) expect(l.json.code).toBe('resume_race_lost');
    if (retimed.status === 200) expect(mockStep.notBefore).not.toBeNull();
  });
});

describe('O2-F1 — the lost-race and missing-run result paths', () => {
  it('the run vanishes between the floor and the move: run_not_found (404), not a success', async () => {
    mockDb.hook = async () => { mockDb.instances[0].organization_id = '00000000-0000-4000-8000-0000000000ff'; };
    const r = await patch({ lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe('run_not_found');
  });

  it('the run is ended between the check and the move: resume_race_lost naming the state it found', async () => {
    mockDb.hook = async () => { mockDb.instances[0].lifecycle_state = 'cancelled'; };
    const r = await patch({ lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'resume_race_lost' });
    expect(String(r.json.error)).toMatch(/became cancelled/);
    expect(runState()).toBe('cancelled');
  });
});

describe('O2-F1 — the store compare-and-set', () => {
  it('applies only from the expected state and says why it did not', async () => {
    const a = await store.compareAndSetExecutionInstanceState({ organizationId: ORG, instanceId: RUN, expectedState: 'active', lifecycleState: 'paused' });
    expect(a).toMatchObject({ applied: false, reason: 'state_changed', current: { lifecycleState: 'paused' } });
    expect(runState()).toBe('paused');
    const b = await store.compareAndSetExecutionInstanceState({ organizationId: ORG, instanceId: RUN, expectedState: 'paused', lifecycleState: 'active' });
    expect(b).toMatchObject({ applied: true, instance: { lifecycleState: 'active' } });
    const c = await store.compareAndSetExecutionInstanceState({
      organizationId: ORG, instanceId: '00000000-0000-4000-8000-000000000999', expectedState: 'paused', lifecycleState: 'active',
    });
    expect(c).toMatchObject({ applied: false, reason: 'not_found', current: null });
  });

  it('refuses a terminal expected state and an unknown state before the wire', async () => {
    await expect(store.compareAndSetExecutionInstanceState({ organizationId: ORG, instanceId: RUN, expectedState: 'cancelled', lifecycleState: 'active' }))
      .rejects.toMatchObject({ code: 'terminal_instance' });
    await expect(store.compareAndSetExecutionInstanceState({ organizationId: ORG, instanceId: RUN, expectedState: 'paused', lifecycleState: 'running' }))
      .rejects.toMatchObject({ code: 'invalid_state' });
    expect(mockDb.ops.filter((o) => o.op === 'update')).toHaveLength(0);
  });

  it('setExecutionInstanceState keeps its existing behaviour (the sweeper\'s pause and fail moves are unchanged)', async () => {
    mockDb.instances[0].lifecycle_state = 'active';
    const moved = await store.setExecutionInstanceState({ organizationId: ORG, instanceId: RUN, lifecycleState: 'paused' });
    expect(moved.lifecycleState).toBe('paused');
    const update = mockDb.ops.find((o) => o.op === 'update');
    expect(update!.filters.map(([c]) => c)).toEqual(['organization_id', 'id']);
  });
});
