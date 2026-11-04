/**
 * WS-3 — re-dispatch of a task an earlier dispatch returned to `queued`.
 *
 * Dispatch returns a task to `queued` on a quota deferral, an attempt-write
 * failure or a transport failure, and says it "stays dispatchable later" — but
 * the claim only accepted `approved`, so such a task could never be dispatched
 * again. These tests pin the repair and, above all, its limits:
 *
 *   - a `queued` task is eligible only with an approval on record
 *     (`pending → queued` is a legal edge that involves no human);
 *   - it is re-dispatched only when no earlier attempt can have reached the
 *     recipient: evidence for every attempt, none accepted, and on an external
 *     transport only outcomes that prove nothing was sent;
 *   - an unreadable history refuses rather than reading as "never sent";
 *   - concurrent re-dispatches still execute exactly once.
 *
 * Same strict database double as the M5A suite: compare-and-set updates,
 * append-only audit tables, unique attempt numbers and one work item per attempt.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
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
        // The canonical contact-governance read, which an email task reaches.
        if (c.startsWith('__in__')) return Array.isArray(v) && (v as unknown[]).includes(r[c.slice(6)]);
        return r[c] === v;
      });

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve(); // yield — concurrent dispatchers genuinely interleave
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };

      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'outreach_attempts' && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
          return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
        }
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
      in: (c: string, v: unknown[]) => { st.filters.push([`__in__${c}`, v]); return b; },
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
  async incrby(key: string, by: number) { const n = (this.store.get(key) ?? 0) + by; this.store.set(key, n); return n; },
  async decrby(key: string, by: number) { const n = (this.store.get(key) ?? 0) - by; this.store.set(key, n); return n; },
  async get(key: string) { const v = this.store.get(key); return v === undefined ? null : String(v); },
  async set(key: string, v: string) { this.store.set(key, Number(v)); return 'OK'; },
  async expire() { return 1; },
};

jest.mock('../../queue/bullmqClient', () => ({
  getSharedRedisClient: () => fakeRedis,
}));

const mockInvoke = jest.fn();
jest.mock('../../db/supabaseClient', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/functions-js';
import { registry } from '../../observability/registry';
import {
  createEmailTransport,
  supabaseEdgeEmailProvider,
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  INTERNAL_CHANNEL,
  TRANSLATION_VERSION,
  __clearTransportsForTests,
  __resetQuotaRedisForTests,
  dispatchInternalOutreachTask,
  getOutreachTaskById,
  insertOutreachTask,
  listAttempts,
  listInternalWorkItems,
  readAttemptHistory,
  registerDefaultTransports,
  registerTransport,
  setOutreachTaskState,
  submitForApproval,
  type NewOutreachTask,
  type TransportOutcome,
} from '../../services/leadOutreachExecution';
// D-02 — the one approval path (with its passkey ceremony); an email approval binds the dispatch address.
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';
// D-02 (S-02) — external approvals need a passkey proof: the real ceremony over a WebAuthn double.
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => require('../helpers/approvalPasskeyDouble').webauthnDouble);

const NOW = '2026-08-05T12:00:00.000Z';

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: 'co-a', leadId: 'L1', planTaskId: 'task-1-assign-sdr', taskOrder: 1,
  kind: 'human', action: 'Assign SDR', channel: INTERNAL_CHANNEL, dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Hot lead needs an owner',
  requiresApproval: true, plannerVersion: 'lie-2.1.0', translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

const configureTenant = (over: Row = {}) => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: 'co-a', enabled: true, kill_switch: false,
    enabled_channels: [INTERNAL_CHANNEL], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null, ...over,
  });
};

/** A task approved through the real approval path, so the approval log holds the decision. */
const approvedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const res = await insertOutreachTask(newTask(over));
  const id = res.data!.id as string;
  expect((await submitForApproval('co-a', id)).ok).toBe(true);
  expect((await approveWithPasskey('co-a', id, 'approver-1', { recipient: 'person@example.test' })).ok).toBe(true);
  expect((await getOutreachTaskById('co-a', id))?.status).toBe('approved');
  return id;
};

/**
 * What a quota deferral after the claim leaves behind: approved through the real
 * approval path, returned to `queued`, no attempt recorded.
 */
const requeuedTask = async (over: Partial<NewOutreachTask> = {}): Promise<string> => {
  const id = await approvedTask(over);
  await setOutreachTaskState('co-a', id, { status: 'queued' });
  return id;
};

/** An external transport on the internal channel whose outcomes are scripted per call. */
const scriptedExternal = (script: TransportOutcome[]) => {
  const calls: number[] = [];
  registerTransport({
    channel: INTERNAL_CHANNEL,
    provider: 'scripted_external',
    external: true,
    async send(req) {
      calls.push(req.attemptNumber);
      const outcome = script[Math.min(calls.length - 1, script.length - 1)];
      return {
        outcome,
        provider: 'scripted_external',
        providerMessageId: outcome === 'accepted' ? `msg-${req.attemptNumber}` : null,
        deliveryStatus: outcome === 'accepted' ? 'sent_unverified' : 'failed',
        response: {},
        duplicate: false,
      };
    },
  });
  return calls;
};

const status = async (id: string) => (await getOutreachTaskById('co-a', id))?.status;

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  fakeRedis.store.clear();
  registry.reset();
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  registerDefaultTransports({ emailProvider: { name: 'stub', async send() { throw new Error('email must not be called in this suite'); } } });
});

// G-1 — the real default provider and transport over the real dispatcher, with
// only the Supabase client stubbed: the whole path from an invoke error to the
// decision about a second send.
describe('WS-3 requeued dispatch (G-1) — an invoke error that may have acted is never sent again', () => {
  const emailTask = () => approvedTask({ channel: 'email', kind: 'outreach', planTaskId: 'task-email' });
  const opts = { now: NOW, recipient: 'person@example.test' };
  const priorKeys = process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS;

  beforeEach(() => {
    mockInvoke.mockReset();
    process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `c1:${'c'.repeat(40)}`;
    configureTenant({ enabled_channels: ['email'] });
    registerTransport(createEmailTransport(supabaseEdgeEmailProvider, {
      enabled: () => true, unsubscribeBaseUrl: () => 'https://app.example.test',
    }));
  });
  afterAll(() => {
    if (priorKeys === undefined) delete process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS;
    else process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = priorKeys;
  });

  it.each([
    ['a network failure', () => new FunctionsFetchError(new Error('socket hang up'))],
    ['a relay error', () => new FunctionsRelayError(new Response(null, { status: 502 }))],
    ['a 500', () => new FunctionsHttpError(new Response(null, { status: 500 }))],
  ])('%s: one provider call, then blocked_prior_attempt', async (_label, error) => {
    mockInvoke.mockResolvedValue({ data: null, error: error() });
    const id = await emailTask();

    const first = await dispatchInternalOutreachTask('co-a', id, opts);
    expect(first).toMatchObject({ outcome: 'failed', transportOutcome: 'provider_error' });
    expect(await status(id)).toBe('queued');

    const again = await dispatchInternalOutreachTask('co-a', id, opts);
    expect(again.outcome).toBe('blocked_prior_attempt');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
  });

  it('control: a 4xx proves nothing was sent, so a later dispatch may proceed', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(new Response(null, { status: 400 })) });
    mockInvoke.mockResolvedValueOnce({ data: { ok: true, messageId: 'ses-1' }, error: null });
    const id = await emailTask();

    expect((await dispatchInternalOutreachTask('co-a', id, opts)).outcome).toBe('rejected');
    expect((await dispatchInternalOutreachTask('co-a', id, opts)).outcome).toBe('sent');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

describe('WS-3 requeued dispatch (1) — a deferred or failed task is dispatchable again', () => {
  it('a quota-deferred task (approved, back in queued, no attempt) is dispatched with one attempt and one work item', async () => {
    configureTenant();
    const b = await requeuedTask();

    const again = await dispatchInternalOutreachTask('co-a', b, { now: NOW });

    expect(again.outcome).toBe('sent');
    expect(again.governance?.gates.map((g) => g.rule)).toContain('eligibility.requeued_after_approval');
    expect(await status(b)).toBe('sent');
    expect(await listAttempts('co-a', b)).toHaveLength(1);
    expect(await listInternalWorkItems('co-a', b)).toHaveLength(1);
  });

  it('an internal transport failure is retried as a new attempt; the internal result is authoritative', async () => {
    configureTenant();
    const id = await approvedTask();
    db.failTable = 'outreach_internal_work_items';
    expect((await dispatchInternalOutreachTask('co-a', id, { now: NOW })).outcome).toBe('failed');
    db.failTable = null;
    expect(await status(id)).toBe('queued');

    const again = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(again.outcome).toBe('sent');
    expect(again.attemptNumber).toBe(2);
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(1);
  });

  it('an external send the provider REJECTED (nothing sent) may be dispatched again', async () => {
    configureTenant();
    const calls = scriptedExternal(['rejected', 'accepted']);
    const id = await approvedTask();
    expect((await dispatchInternalOutreachTask('co-a', id, { now: NOW })).outcome).toBe('rejected');
    expect(await status(id)).toBe('queued');

    const again = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(again.outcome).toBe('sent');
    expect(calls).toEqual([1, 2]);
  });

  it('a re-run after the task was sent does nothing', async () => {
    configureTenant();
    const b = await requeuedTask();
    expect((await dispatchInternalOutreachTask('co-a', b, { now: NOW })).outcome).toBe('sent');

    const third = await dispatchInternalOutreachTask('co-a', b, { now: NOW });
    expect(third.outcome).not.toBe('sent');
    expect(await listInternalWorkItems('co-a', b)).toHaveLength(1);
  });
});

describe('WS-3 requeued dispatch (2) — approval is never inferred from status', () => {
  it('a queued task with NO approval on record is blocked by governance and never attempted', async () => {
    configureTenant();
    const res = await insertOutreachTask(newTask());
    const id = res.data!.id as string;
    // pending → queued is a legal lifecycle edge that involves no human.
    await setOutreachTaskState('co-a', id, { status: 'queued' });

    const out = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(out.outcome).toBe('blocked_governance');
    expect(out.governance?.blockingCondition).toBe('eligibility.not_approved');
    expect(await listAttempts('co-a', id)).toHaveLength(0);
    expect(await status(id)).toBe('queued');
  });

  it('an unreadable approval log reads as "no approval": fails closed', async () => {
    configureTenant();
    const b = await requeuedTask();

    db.failTable = 'outreach_approvals';
    const out = await dispatchInternalOutreachTask('co-a', b, { now: NOW });
    db.failTable = null;
    expect(out.outcome).toBe('blocked_governance');
    expect(out.governance?.blockingCondition).toBe('eligibility.not_approved');
    expect(await listInternalWorkItems('co-a', b)).toHaveLength(0);
  });
});

describe('WS-3 requeued dispatch (3) — never a second send that may duplicate one', () => {
  it.each(['timeout', 'provider_error', 'transport_error'] as const)(
    'an external %s is never dispatched again automatically',
    async (ambiguous) => {
      configureTenant();
      const calls = scriptedExternal([ambiguous, 'accepted']);
      const id = await approvedTask();
      await dispatchInternalOutreachTask('co-a', id, { now: NOW });
      expect(await status(id)).toBe('queued');

      const again = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
      expect(again.outcome).toBe('blocked_prior_attempt');
      expect(again.reason).toMatch(/may have sent it/);
      expect(calls).toEqual([1]);
      expect(await listAttempts('co-a', id)).toHaveLength(1);
      expect(await status(id)).toBe('queued');
    },
  );

  it('an attempt with no delivery evidence blocks re-dispatch (unknown is not "not sent")', async () => {
    configureTenant();
    const id = await approvedTask();
    await setOutreachTaskState('co-a', id, { status: 'queued' });
    (db.tables.outreach_attempts ??= []).push({ id: 'att-orphan', company_id: 'co-a', task_id: id, attempt_number: 1 });

    const out = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(out.outcome).toBe('blocked_prior_attempt');
    expect(out.reason).toMatch(/no delivery evidence/);
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(0);
  });

  it('a prior ACCEPTED attempt blocks re-dispatch even on the internal transport', async () => {
    configureTenant();
    const id = await approvedTask();
    await setOutreachTaskState('co-a', id, { status: 'queued' });
    (db.tables.outreach_attempts ??= []).push({ id: 'att-1', company_id: 'co-a', task_id: id, attempt_number: 1 });
    (db.tables.outreach_delivery_evidence ??= []).push({ id: 'ev-1', company_id: 'co-a', task_id: id, attempt_id: 'att-1', transport_response: { outcome: 'accepted' } });

    const out = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(out.outcome).toBe('blocked_prior_attempt');
    expect(out.reason).toMatch(/never sent twice/);
  });

  it('an unreadable attempt history refuses instead of reading as "never sent"', async () => {
    configureTenant();
    const id = await approvedTask();
    await setOutreachTaskState('co-a', id, { status: 'queued' });
    db.failTable = 'outreach_delivery_evidence';
    const out = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    db.failTable = null;
    expect(out.outcome).toBe('blocked_prior_attempt');
    expect(out.reason).toMatch(/unreadable/);
    expect(await listInternalWorkItems('co-a', id)).toHaveLength(0);
  });

  it('readAttemptHistory reports a read failure instead of an empty history', async () => {
    db.failTable = 'outreach_attempts';
    expect((await readAttemptHistory('co-a', 'any')).ok).toBe(false);
    db.failTable = null;
    expect(await readAttemptHistory('co-a', 'any')).toEqual({ ok: true, attempts: [], evidence: [] });
  });
});

describe('WS-3 requeued dispatch (4) — concurrency', () => {
  it('exactly ONE of five concurrent re-dispatches of a requeued task executes', async () => {
    configureTenant();
    const b = await requeuedTask();

    const results = await Promise.all(Array.from({ length: 5 }, () => dispatchInternalOutreachTask('co-a', b, { now: NOW })));
    expect(results.filter((r) => r.outcome === 'sent')).toHaveLength(1);
    expect(await listInternalWorkItems('co-a', b)).toHaveLength(1);
    expect(await listAttempts('co-a', b)).toHaveLength(1);
  });
});

// D-02 F-1 (Outreach review of 9bbbacd2) — re-review must never reopen a task whose earlier
// external attempt may have sent. Converted from Outreach's repro (zzD02ReviewRepro).
describe('D-02 F-1 — re-review never leads to a second send', () => {
  const { requestFreshApproval } = jest.requireActual('../../services/leadOutreachExecution/approvalBinding') as typeof import('../../services/leadOutreachExecution/approvalBinding');

  async function timedOut() {
    configureTenant();
    const calls = scriptedExternal(['timeout', 'accepted']);
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(await status(id)).toBe('queued');
    expect(calls).toEqual([1]);
    // Control (G-1): without a change, the requeued task is refused.
    expect((await dispatchInternalOutreachTask('co-a', id, { now: NOW })).outcome).toBe('blocked_prior_attempt');
    return { id, calls };
  }

  it('the repro: timeout → content edit → stale → (fresh approval) → still never sent twice', async () => {
    const { id, calls } = await timedOut();
    const row = (db.tables.outreach_tasks ?? []).find((r) => r.id === id)!;
    row.action = 'Assign SDR (edited)';
    const stale = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(stale.governance?.blockingCondition).toBe('eligibility.approval_stale');
    // Fix (b): the stale refusal does NOT take the re-review edge for a task that may have sent.
    expect(await status(id)).toBe('queued');
    expect(await requestFreshApproval('co-a', id)).toMatchObject({ ok: false, status: 'queued', reason: expect.stringMatching(/never be sent/) });
    expect(await status(id)).toBe('queued');
    expect((await approveWithPasskey('co-a', id, 'approver-1')).ok).toBe(false);
    expect((await dispatchInternalOutreachTask('co-a', id, { now: NOW })).outcome).not.toBe('sent');
    expect(calls).toEqual([1]);
  });

  it('fix (a): even if a task with a prior attempt reaches a fresh approval, dispatch is blocked_prior_attempt', async () => {
    const { id, calls } = await timedOut();
    // Whatever route put it back in review (a direct write here), a fresh approval follows.
    await setOutreachTaskState('co-a', id, { status: 'awaiting_approval' });
    expect((await approveWithPasskey('co-a', id, 'approver-1')).ok).toBe(true);
    const again = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(again).toMatchObject({ outcome: 'blocked_prior_attempt', status: 'approved' });
    expect(calls).toEqual([1]);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
  });

  it('a task whose only attempt proved nothing was sent (rejected) may still be re-reviewed and sent', async () => {
    configureTenant();
    const calls = scriptedExternal(['rejected', 'accepted']);
    const id = await approvedTask();
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(await status(id)).toBe('queued');
    (db.tables.outreach_tasks ?? []).find((r) => r.id === id)!.action = 'Assign SDR (edited)';
    await dispatchInternalOutreachTask('co-a', id, { now: NOW });
    expect(await status(id)).toBe('awaiting_approval');
    expect((await approveWithPasskey('co-a', id, 'approver-1')).ok).toBe(true);
    expect((await dispatchInternalOutreachTask('co-a', id, { now: NOW })).outcome).toBe('sent');
    expect(calls).toEqual([1, 2]);
  });
});

// D-02 P-1 (review r5, R5-4) — a dispatcher that passed its prior-attempt check BEFORE another
// dispatcher's may-have-sent attempt must not send: the check is repeated under the claim.
describe('D-02 P-1 — the prior-attempt check is repeated under the claim', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const storage = require('../../services/leadOutreachExecution/storage');

  /** A runs; right after its pre-claim history read, B runs a whole dispatch. Returns A's result. */
  async function interleaved(id: string) {
    const original = storage.readAttemptHistory;
    let fired = false;
    const spy = jest.spyOn(storage, 'readAttemptHistory').mockImplementation(async (...a: unknown[]) => {
      const seen = await original(...a);
      if (!fired) {
        fired = true; // A has its (now stale) view; B dispatches to completion
        await dispatchInternalOutreachTask('co-a', id, { now: NOW });
      }
      return seen;
    });
    try {
      const a = await dispatchInternalOutreachTask('co-a', id, { now: NOW });
      expect(fired).toBe(true);
      return a;
    } finally {
      spy.mockRestore();
    }
  }

  it("B's provider_error lands between A's check and A's claim: A is refused, one provider call, one attempt, task queued", async () => {
    configureTenant();
    const calls = scriptedExternal(['provider_error', 'accepted']);
    const id = await requeuedTask();
    const a = await interleaved(id);
    expect(a).toMatchObject({ outcome: 'blocked_prior_attempt', status: 'queued', attemptNumber: null });
    expect(calls).toEqual([1]);
    expect(await listAttempts('co-a', id)).toHaveLength(1);
    expect(await status(id)).toBe('queued');
  });

  it("control: B's attempt was a clean rejection, so A may send — two provider calls", async () => {
    configureTenant();
    const calls = scriptedExternal(['rejected', 'accepted']);
    const id = await requeuedTask();
    const a = await interleaved(id);
    expect(a).toMatchObject({ outcome: 'sent', attemptNumber: 2 });
    expect(calls).toEqual([1, 2]);
    expect(await status(id)).toBe('sent');
  });
});
