/**
 * Follow-up D (owner GO 2026-11-09): the frequency policy's read counts an UNCERTAIN
 * communication — an engine request settled `uncertain`, which may have reached the person —
 * as contact, across all of the person's journeys. It never reads it as sent or delivered.
 *
 * The REAL `lastContactActionAtForSubject` (orchestration/journeyFrequency.ts) and the REAL,
 * unchanged `lastCompletedActionAtForSubject` it reuses, on the fake database (helpers/fakeWhatsappDb.ts).
 * The fake proves the query's control flow; the real schema is exercised by
 * backend/tests/realschema/orch_engines_real.test.ts (Follow-up D cases).
 */
// The fake ignores column lists; this records them, so the suite can prove WHICH column is read.
const mockSelects: string[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const b = require('../helpers/fakeWhatsappDb').fakeTable(t);
    const select = b.select;
    b.select = (cols?: string, o?: unknown) => { mockSelects.push(`${t}:${cols ?? ''}`); return select(cols, o); };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t),
    rpc: (fn: string, args: Record<string, unknown>) => require('../helpers/fakeWhatsappDb').fakeRpc(fn, args),
  },
}));

import { fakeDb, failNext, resetFakeDb } from '../helpers/fakeWhatsappDb';
import { lastCompletedActionAtForSubject } from '../../services/executionPlans/executionPlanStore';
import { lastContactActionAtForSubject } from '../../services/orchestration/journeyFrequency';

const ORG = '0c000000-0000-4000-8000-000000000001';
const OTHER_ORG = '0c000000-0000-4000-8000-000000000002';
const SUBJECT = '0d000000-0000-4000-8000-000000000001';
const T = (h: number) => new Date(Date.UTC(2026, 10, 9, 0, 0, 0) + h * 3600_000).toISOString();

let n = 0;
/** One task of the subject, its plan step and (optionally) its engine request. */
function task(opts: {
  org?: string; channel?: string; subject?: string; completedAt?: string | null;
  // D-2: `updatedAt` is the queue time (queued_at) unless `queuedAt` says otherwise (null = missing).
  request?: { state: string; updatedAt: string; queuedAt?: string | null } | null;
}): string {
  n += 1;
  const org = opts.org ?? ORG;
  const id = `task-${n}`;
  fakeDb.tables.execution_tasks.push({ id, organization_id: org, subject_kind: 'prospect', subject_id: opts.subject ?? SUBJECT, plan_step_id: `step-${n}`, channel: opts.channel ?? 'whatsapp' });
  fakeDb.tables.execution_plan_steps.push({ id: `step-${n}`, organization_id: org, completed_at: opts.completedAt ?? null });
  if (opts.request) {
    const queuedAt = opts.request.queuedAt === undefined ? opts.request.updatedAt : opts.request.queuedAt;
    fakeDb.tables.execution_engine_requests.push({ id: `req-${n}`, organization_id: org, execution_task_id: id, engine: 'whatsapp', state: opts.request.state, updated_at: opts.request.updatedAt, queued_at: queuedAt });
  }
  return id;
}
const read = (options?: { excludeTaskId?: string }) => lastContactActionAtForSubject(ORG, 'prospect', SUBJECT, options);

beforeEach(() => {
  mockSelects.length = 0;
  n = 0;
  resetFakeDb({ execution_tasks: [], execution_plan_steps: [], execution_engine_requests: [] });
});

describe('Follow-up D: what counts as contact', () => {
  it('no history → null', async () => {
    expect(await read()).toBeNull();
  });

  it('a completed contact step counts, as before, and is confirmed', async () => {
    task({ completedAt: T(1) });
    expect(await read()).toEqual({ at: T(1), unconfirmed: false, basis: 'completed' });
  });

  it('an uncertain communication counts, at the moment it was settled, and is unconfirmed', async () => {
    task({ request: { state: 'uncertain', updatedAt: T(2) } });
    expect(await read()).toEqual({ at: T(2), unconfirmed: true, basis: 'uncertain' });
  });

  it.each(['failed', 'skipped', 'requested', 'completed'])(
    'a request in state %s does not count as possible contact (a confirmed outcome, or nothing created)',
    async (state) => {
      task({ request: { state, updatedAt: T(3) } });
      expect(await read()).toBeNull();
    },
  );

  it('the later of completed and uncertain wins', async () => {
    task({ completedAt: T(1) });
    task({ request: { state: 'uncertain', updatedAt: T(5) } });
    expect(await read()).toEqual({ at: T(5), unconfirmed: true, basis: 'uncertain' });
    task({ completedAt: T(7) });
    expect(await read()).toEqual({ at: T(7), unconfirmed: false, basis: 'completed' });
  });

  it('one communication seen both ways (a step settled completed over its uncertain request) is one contact, never two', async () => {
    task({ completedAt: T(4), request: { state: 'uncertain', updatedAt: T(4) } });
    expect(await read()).toEqual({ at: T(4), unconfirmed: false, basis: 'completed' });
  });

  it('several uncertain requests: only the latest, once', async () => {
    task({ request: { state: 'uncertain', updatedAt: T(1) } });
    task({ request: { state: 'uncertain', updatedAt: T(9) } });
    task({ request: { state: 'uncertain', updatedAt: T(3) } });
    expect(await read()).toEqual({ at: T(9), unconfirmed: true, basis: 'uncertain' });
  });
});

describe('Follow-up D: boundaries', () => {
  it('the task being decided never counts its own uncertain request', async () => {
    const own = task({ request: { state: 'uncertain', updatedAt: T(2) } });
    expect(await read({ excludeTaskId: own })).toBeNull();
    task({ request: { state: 'uncertain', updatedAt: T(1) } });
    expect(await read({ excludeTaskId: own })).toEqual({ at: T(1), unconfirmed: true, basis: 'uncertain' });
  });

  it('tenant isolation: another tenant\'s task and request for the same subject id never count', async () => {
    task({ org: OTHER_ORG, request: { state: 'uncertain', updatedAt: T(8) }, completedAt: T(8) });
    expect(await read()).toBeNull();
  });

  it('tenant isolation: a request row of another tenant naming this tenant\'s task never counts', async () => {
    const mine = task({});
    fakeDb.tables.execution_engine_requests.push({ id: 'req-x', organization_id: OTHER_ORG, execution_task_id: mine, engine: 'whatsapp', state: 'uncertain', updated_at: T(6) });
    expect(await read()).toBeNull();
  });

  it('another subject never counts', async () => {
    task({ subject: '0d000000-0000-4000-8000-000000000099', request: { state: 'uncertain', updatedAt: T(2) } });
    expect(await read()).toBeNull();
  });

  it.each(['internal', 'social_post'])('a %s (non-contact) task never counts, uncertain or completed', async (channel) => {
    task({ channel, completedAt: T(1), request: { state: 'uncertain', updatedAt: T(2) } });
    expect(await read()).toBeNull();
  });

  it('every contact channel counts (the policy spans the person\'s channels, as before)', async () => {
    task({ channel: 'linkedin', request: { state: 'uncertain', updatedAt: T(2) } });
    expect(await read()).toEqual({ at: T(2), unconfirmed: true, basis: 'uncertain' });
  });

  it('the requests read is tenant-first and asks only for uncertain rows', async () => {
    task({ request: { state: 'uncertain', updatedAt: T(2) } });
    await read();
    expect(fakeDb.calls).toEqual(['execution_tasks:select', 'execution_plan_steps:select', 'execution_tasks:select', 'execution_engine_requests:select']);
  });
});

describe('D-2: a request in flight counts as possible contact', () => {
  it.each(['submitting', 'submitted'])('a %s request counts from its queue timestamp, as in flight', async (state) => {
    task({ request: { state, updatedAt: T(3) } });
    expect(await read()).toEqual({ at: T(3), unconfirmed: true, basis: 'in_flight' });
  });

  it('the latest possible contact wins across uncertain and in flight', async () => {
    task({ request: { state: 'uncertain', updatedAt: T(2) } });
    task({ request: { state: 'submitted', updatedAt: T(6) } });
    expect(await read()).toEqual({ at: T(6), unconfirmed: true, basis: 'in_flight' });
    task({ request: { state: 'uncertain', updatedAt: T(8) } });
    expect(await read()).toEqual({ at: T(8), unconfirmed: true, basis: 'uncertain' });
  });

  it('a later completed step outranks an earlier queued one, and a tie reads as confirmed', async () => {
    task({ request: { state: 'submitted', updatedAt: T(4) } });
    task({ completedAt: T(4) });
    expect(await read()).toEqual({ at: T(4), unconfirmed: false, basis: 'completed' });
    task({ completedAt: T(5) });
    expect(await read()).toEqual({ at: T(5), unconfirmed: false, basis: 'completed' });
  });

  it('the task being decided never counts its own request in flight', async () => {
    const own = task({ request: { state: 'submitted', updatedAt: T(2) } });
    expect(await read({ excludeTaskId: own })).toBeNull();
  });

  it('tenant isolation holds for requests in flight', async () => {
    task({ org: OTHER_ORG, request: { state: 'submitted', updatedAt: T(8) } });
    const mine = task({});
    fakeDb.tables.execution_engine_requests.push({ id: 'req-y', organization_id: OTHER_ORG, execution_task_id: mine, engine: 'whatsapp', state: 'submitting', updated_at: T(9) });
    expect(await read()).toBeNull();
  });

  it.each(['internal', 'social_post'])('a %s (non-contact) task in flight never counts', async (channel) => {
    task({ channel, request: { state: 'submitted', updatedAt: T(2) } });
    expect(await read()).toBeNull();
  });

  it('once the engine records the outcome the request stops counting', async () => {
    task({ request: { state: 'submitted', updatedAt: T(2) } });
    expect((await read())?.basis).toBe('in_flight');
    fakeDb.tables.execution_engine_requests[0].state = 'skipped';        // blocked by governance
    expect(await read()).toBeNull();
    fakeDb.tables.execution_engine_requests[0].state = 'failed';         // blocked or refused
    expect(await read()).toBeNull();
  });
});

describe('D-2: the immutable queue time, and failing closed', () => {
  it('the counted time is queued_at, not updated_at (a later reconciliation never moves it)', async () => {
    task({ request: { state: 'uncertain', updatedAt: T(9), queuedAt: T(2) } });
    expect(await read()).toEqual({ at: T(2), unconfirmed: true, basis: 'uncertain' });
    // The ledger read asks the database for queued_at; updated_at is never read.
    const ledgerSelect = mockSelects.find((x) => x.startsWith('execution_engine_requests:'));
    expect(ledgerSelect).toBe('execution_engine_requests:queued_at, state');
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['malformed', 'not-a-time'],
  ])('a counted request with a %s queue time fails closed: invalid, never dropped', async (_label, queuedAt) => {
    task({ completedAt: T(1) });
    task({ request: { state: 'submitted', updatedAt: T(3), queuedAt: queuedAt as string | null } });
    expect(await read()).toEqual({ at: null, unconfirmed: true, basis: 'in_flight', invalid: true });
  });

  it('a missing queue time is found even when a valid, later one exists (contradictory history)', async () => {
    task({ request: { state: 'submitted', updatedAt: T(8) } });
    task({ request: { state: 'uncertain', updatedAt: T(2), queuedAt: null } });
    expect((await read())?.invalid).toBe(true);
  });

  it('a completed step with an unreadable time fails closed', async () => {
    task({ completedAt: 'garbled' });
    expect(await read()).toEqual({ at: null, unconfirmed: false, basis: 'completed', invalid: true });
  });

  it('valid times are not flagged', async () => {
    task({ completedAt: T(1) });
    task({ request: { state: 'submitted', updatedAt: T(3) } });
    const r = await read();
    expect(r?.invalid).toBeUndefined();
    expect(r).toEqual({ at: T(3), unconfirmed: true, basis: 'in_flight' });
  });

  it('a non-counted request with no queue time (requested, failed) is not a contradiction', async () => {
    task({ request: { state: 'requested', updatedAt: T(3), queuedAt: null } });
    task({ request: { state: 'failed', updatedAt: T(4), queuedAt: null } });
    expect(await read()).toBeNull();
  });
});

describe('Follow-up D: fails closed', () => {
  it('an unreadable request ledger throws: an unknown history is never read as "not contacted"', async () => {
    task({ completedAt: T(1) });
    failNext('execution_engine_requests', 'select');
    await expect(read()).rejects.toThrow();
  });

  it.each([0, 1])('an unreadable task list throws (read %i)', async (skip) => {
    task({ completedAt: T(1) });
    failNext('execution_tasks', 'select', skip);
    await expect(read()).rejects.toThrow();
  });
});

describe('the completed-only read is unchanged', () => {
  it('lastCompletedActionAtForSubject ignores uncertain requests, as before', async () => {
    task({ completedAt: T(1) });
    task({ request: { state: 'uncertain', updatedAt: T(5) } });
    expect(await lastCompletedActionAtForSubject(ORG, 'prospect', SUBJECT)).toBe(T(1));
  });

  it('… and still excludes non-contact channels', async () => {
    task({ channel: 'internal', completedAt: T(3) });
    expect(await lastCompletedActionAtForSubject(ORG, 'prospect', SUBJECT)).toBeNull();
  });
});

