/**
 * D-03 — pausing a journey holds an email task already handed to WS-3.
 *
 * `resolveJourneyHold` (emailExecutionContext.ts) answers "does the run behind this
 * task forbid acting on it?", and the common dispatcher asks it after the transport
 * guard and before governance, so a held task leaves nothing behind. Mocked here, in
 * the WS-3 dispatch suites' own style; the database-backed proof is
 * realschema/orch_pause_handoff.test.ts.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  failTable: null as string | null,
  throwTable: null as string | null,
  reads: [] as string[],
};

const APPEND_ONLY = ['outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions', 'outreach_internal_work_items', 'outreach_approvals'];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (db.throwTable === table) throw new Error('client exploded');
    const st: { op: string; filters: Array<[string, unknown]>; payload: Row | null } = { op: 'select', filters: [], payload: null };
    const rows = () => (db.tables[table] ??= []);
    const matches = (r: Row) =>
      st.filters.every(([c, v]) => {
        if (c.startsWith('__gte__')) return String(r[c.slice(7)] ?? '') >= String(v);
        if (c.startsWith('__is__')) return (r[c.slice(6)] ?? null) === v;
        if (c.startsWith('__in__')) return Array.isArray(v) && (v as unknown[]).includes(r[c.slice(6)]);
        return r[c] === v;
      });
    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (st.op === 'select') db.reads.push(table);
      if (db.failTable === table) return { data: null, error: { code: '08006', message: 'connection failure' } };
      if (st.op === 'insert') {
        const row = st.payload as Row;
        if (table === 'outreach_attempts'
          && rows().some((r) => r.company_id === row.company_id && r.task_id === row.task_id && r.attempt_number === row.attempt_number)) {
          return { data: null, error: { code: '23505', message: 'duplicate attempt_number' } };
        }
        const created = { ...row, id: `${table}-${db.nextId++}`, created_at: '2026-11-03T00:00:00.000Z' };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        if (APPEND_ONLY.includes(table)) return { data: null, error: { code: '2F004', message: `${table} is append-only` } };
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
// The bridge store is imported only to pin its stamp; it must not reach a client.
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no client in this suite'); } } }));

const fakeRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) + n; this.store.set(k, v); return v; },
  async decrby(k: string, n: number) { const v = (this.store.get(k) ?? 0) - n; this.store.set(k, v); return v; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => fakeRedis }));
// D-02 — what a bridged email would say, so its approval can be bound to it (the fixture
// handoff carries only the run). The real send path is exercised in realschema.
jest.mock('../../services/emailEngine/emailSendPath', () => ({
  ...jest.requireActual('../../services/emailEngine/emailSendPath'),
  prepareEmailSend: async () => ({
    context: { workflowVersionId: '00000000-0000-4000-8000-0000000000f1' },
    recipient: { email: 'cto@bigcorp.example', personId: 'p-1', personalization: {} },
    rendered: { subject: 'Hello', body: 'Intro', personalizationInputs: {}, contentSource: 'test' },
  }),
}));

import * as fs from 'fs';
import * as path from 'path';
import {
  EMAIL_ENABLED_ENV, EXECUTION_RUNTIME_VERSION, GOVERNANCE_VERSION, INTERNAL_CHANNEL, TRANSLATION_VERSION,
  __clearTransportsForTests, __resetQuotaRedisForTests, dispatchInternalOutreachTask, getOutreachTaskById,
  insertOutreachTask, listAttempts, registerDefaultTransports, setOutreachTaskState,
  type EmailProviderPort, type NewOutreachTask,
} from '../../services/leadOutreachExecution';
import { BRIDGED_TASK_PLANNER_VERSION, resolveJourneyHold } from '../../services/emailEngine/emailExecutionContext';
import { BRIDGE_PLANNER_VERSION } from '../../services/outreachBridge/outreachBridgeStore';
import { createWs3Adapter, type Ws3AdapterDeps } from '../../services/orchestration/engineAdapters';
import { renderEmailContent } from '../../services/emailEngine/emailContentGenerator';
import { computeApprovalBinding } from '../../services/leadOutreachExecution/approvalBinding';

const ORG = '00000000-0000-4000-8000-00000000000a';
const NOW = '2026-11-03T12:00:00.000Z';
const RECIPIENT = 'cto@bigcorp.example';
const RUN = '00000000-0000-4000-8000-000000000101';
// O-2: a real handoff always names its plan and step (both NOT NULL), and the hold reads the step.
const PLAN = '00000000-0000-4000-8000-000000000201';
const STEP = '00000000-0000-4000-8000-000000000301';
const handoffRow = (outreachTaskId: string, org = ORG) =>
  ({ organization_id: org, outreach_task_id: outreachTaskId, execution_instance_id: RUN, execution_plan_id: PLAN, execution_plan_step_id: STEP });
const stepRow = (over: Record<string, unknown> = {}) => ({
  id: STEP, organization_id: ORG, plan_id: PLAN, step_key: 'intro', step_order: 1, channel: 'email',
  delay_after_previous_hours: 0, state: 'ready', ready_at: NOW, started_at: null, settled_at: null, completed_at: null,
  not_before: null, ...over,
});

const calls: string[] = [];
const provider: EmailProviderPort = {
  name: 'recording_provider',
  async send(r) { calls.push(r.to); return { accepted: true, messageId: `m-${r.idempotencyKey}` }; },
};

const newTask = (over: Partial<NewOutreachTask> = {}): NewOutreachTask => ({
  companyId: ORG, leadId: 'L1', planTaskId: 'exec-task-1', taskOrder: 1,
  kind: 'outreach', action: 'Send intro email', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Intro',
  requiresApproval: false, plannerVersion: BRIDGED_TASK_PLANNER_VERSION, translationVersion: TRANSLATION_VERSION,
  governanceVersion: GOVERNANCE_VERSION, executionRuntimeVersion: EXECUTION_RUNTIME_VERSION,
  materializedAt: NOW, ...over,
});

const configureTenant = () => {
  (db.tables.outreach_governance_config ??= []).push({
    company_id: ORG, enabled: true, kill_switch: false,
    enabled_channels: ['email', INTERNAL_CHANNEL], restricted_regions: [],
    daily_limit_tenant: null, daily_limit_lead: null,
  });
};

/** A task in `status`, optionally with a handoff to a run in `state`. */
async function task(status: string, opts: { state?: string | null; handoff?: boolean; over?: Partial<NewOutreachTask> } = {}): Promise<string> {
  const id = (await insertOutreachTask(newTask(opts.over))).data!.id as string;
  await setOutreachTaskState(ORG, id, { status });
  if (status === 'approved') {
    // D-02 — an approved task carries the approval that authorised it, bound to its content.
    // Bound to the dispatch recipient, with the passkey evidence an external approval records,
    // decided now (expiry is judged against the server clock, T2).
    const binding = await computeApprovalBinding(ORG, (await getOutreachTaskById(ORG, id))!, { recipient: RECIPIENT });
    (db.tables.outreach_approvals ??= []).push({
      company_id: ORG, task_id: id, decision: 'approved', approver_user_id: 'u-approver',
      decided_at: new Date().toISOString(), approved_content_hash: binding.hash, missing_information: [],
      approved_recipient: binding.recipient, // r3 L-3: the address the approval binds is stored with it
      passkey_credential_id: 'cred-test', passkey_verified_at: new Date().toISOString(),
    });
  }
  if (opts.handoff !== false) {
    (db.tables.outreach_bridge_handoffs ??= []).push(handoffRow(id));
    if (!(db.tables.execution_plan_steps ?? []).some((r) => r.id === STEP)) (db.tables.execution_plan_steps ??= []).push(stepRow());
  }
  if (opts.state !== undefined) {
    (db.tables.execution_instances ??= []).push({ organization_id: ORG, id: RUN, lifecycle_state: opts.state });
  }
  return id;
}
const setRun = (state: string) => { for (const r of db.tables.execution_instances ?? []) r.lifecycle_state = state; };
const dispatch = (id: string) => dispatchInternalOutreachTask(ORG, id, { now: NOW, recipient: RECIPIENT });
const count = (table: string) => (db.tables[table] ?? []).length;

beforeEach(() => {
  db.tables = {};
  db.nextId = 1;
  db.failTable = null;
  db.throwTable = null;
  db.reads = [];
  calls.length = 0;
  fakeRedis.store.clear();
  __resetQuotaRedisForTests();
  __clearTransportsForTests();
  process.env[EMAIL_ENABLED_ENV] = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `t1:${'t'.repeat(40)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  // The placeholder composition, so the send itself needs no handoff and the hold is
  // the only journey read under test.
  registerDefaultTransports({ emailProvider: provider });
  configureTenant();
});
const prior = { keys: process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS, appUrl: process.env.NEXT_PUBLIC_APP_URL };
afterEach(() => {
  delete process.env[EMAIL_ENABLED_ENV];
  for (const [k, v] of [['OUTREACH_UNSUBSCRIBE_TOKEN_KEYS', prior.keys], ['NEXT_PUBLIC_APP_URL', prior.appUrl]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('D-03 — resolveJourneyHold fails closed', () => {
  const stamped = { id: 't-1', plannerVersion: BRIDGED_TASK_PLANNER_VERSION };
  const handoff = () => { db.tables.outreach_bridge_handoffs = [handoffRow('t-1')]; db.tables.execution_plan_steps = [stepRow()]; };
  const run = (state: unknown) => { db.tables.execution_instances = [{ organization_id: ORG, id: RUN, lifecycle_state: state }]; };

  it('pins the stamp to the one the bridge writes', () => {
    expect(BRIDGED_TASK_PLANNER_VERSION).toBe(BRIDGE_PLANNER_VERSION);
  });

  it('a task that never came from a journey is not held, and nothing is read', async () => {
    for (const plannerVersion of ['lie-2.1.0', '', 'wf-bridge-1.0.1']) {
      expect(await resolveJourneyHold(ORG, { id: 't-1', plannerVersion })).toBeNull();
    }
    expect(db.reads).toEqual([]);
  });

  it('only a definite `active` run returns null', async () => {
    handoff(); run('active');
    expect(await resolveJourneyHold(ORG, stamped)).toBeNull();
  });

  it('a paused run holds', async () => {
    handoff(); run('paused');
    expect(await resolveJourneyHold(ORG, stamped)).toMatchObject({ code: 'journey_paused' });
  });

  it.each(['created', 'queued', 'completed', 'cancelled', 'failed', 'archived', 'ACTIVE', ' active', '', null, 7])(
    'a run in %p holds as not active', async (state) => {
      handoff(); run(state);
      expect(await resolveJourneyHold(ORG, stamped)).toMatchObject({ code: 'journey_not_active' });
    });

  it('a stamped task with no handoff holds', async () => {
    run('active');
    expect(await resolveJourneyHold(ORG, stamped)).toMatchObject({ code: 'handoff_missing' });
  });

  it('another tenant\'s handoff is not this task\'s handoff', async () => {
    db.tables.outreach_bridge_handoffs = [handoffRow('t-1', 'co-b')];
    run('active');
    expect(await resolveJourneyHold(ORG, stamped)).toMatchObject({ code: 'handoff_missing' });
  });

  it.each([
    ['the handoff read fails', 'handoff read failed', () => { db.failTable = 'outreach_bridge_handoffs'; }],
    ['the run read fails', 'run read failed', () => { db.failTable = 'execution_instances'; }],
    ['the run is not found', 'run not found', () => { db.tables.execution_instances = []; }],
    ['the client throws', 'read threw', () => { db.throwTable = 'outreach_bridge_handoffs'; }],
    ['the run store throws', 'run read failed', () => { db.throwTable = 'execution_instances'; }],
  ])('%s: holds as unreadable, never throws', async (_label, detail, arrange) => {
    handoff(); run('active');
    (arrange as () => void)();
    const hold = await resolveJourneyHold(ORG, stamped);
    expect(hold).toMatchObject({ code: 'journey_state_unreadable' });
    expect(hold?.reason).toContain(`(${detail as string})`);
  });

  // ── O-2: the handed-off step's return date, for a run that is active again ──
  const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

  it('O-2: an active run whose handed-off step has a future not_before holds', async () => {
    handoff(); run('active');
    db.tables.execution_plan_steps = [stepRow({ not_before: inMs(10 * 86_400_000) })];
    const hold = await resolveJourneyHold(ORG, stamped);
    expect(hold).toMatchObject({ code: 'journey_not_before' });
    expect(hold?.reason).toMatch(/a person deferred this journey step until/);
  });

  it('O-2: a not_before that has passed, or none, is the earlier behaviour (no hold)', async () => {
    handoff(); run('active');
    db.tables.execution_plan_steps = [stepRow({ not_before: inMs(-60_000) })];
    expect(await resolveJourneyHold(ORG, stamped)).toBeNull();
    db.tables.execution_plan_steps = [stepRow({ not_before: null })];
    expect(await resolveJourneyHold(ORG, stamped)).toBeNull();
  });

  it('O-2: the step is read after the run, and only for an active run', async () => {
    handoff(); run('active');
    await resolveJourneyHold(ORG, stamped);
    expect(db.reads.indexOf('execution_plan_steps')).toBeGreaterThan(db.reads.indexOf('execution_instances'));
    db.reads = [];
    run('paused');
    expect(await resolveJourneyHold(ORG, stamped)).toMatchObject({ code: 'journey_paused' });
    expect(db.reads).not.toContain('execution_plan_steps');
  });

  it.each([
    ['the handoff names no step', 'journey_state_unreadable', 'the handoff names no step or plan', () => { db.tables.outreach_bridge_handoffs = [{ ...handoffRow('t-1'), execution_plan_step_id: null }]; }],
    ['the handoff names no plan', 'journey_state_unreadable', 'the handoff names no step or plan', () => { db.tables.outreach_bridge_handoffs = [{ ...handoffRow('t-1'), execution_plan_id: null }]; }],
    ['the step is not found', 'journey_state_unreadable', 'step not found', () => { db.tables.execution_plan_steps = []; }],
    ['the step read fails', 'journey_state_unreadable', 'step read failed', () => { db.failTable = 'execution_plan_steps'; }],
    ['the step store throws', 'journey_state_unreadable', 'step read failed', () => { db.throwTable = 'execution_plan_steps'; }],
    ['the step id is not a uuid', 'journey_state_unreadable', 'step read failed', () => { db.tables.outreach_bridge_handoffs = [{ ...handoffRow('t-1'), execution_plan_step_id: 'not-a-uuid' }]; }],
    ['the step belongs to another plan', 'journey_step_inconsistent', 'does not belong to the plan', () => { db.tables.execution_plan_steps = [stepRow({ plan_id: '00000000-0000-4000-8000-000000000999' })]; }],
    ['the return date is not an instant', 'journey_state_unreadable', 'the return date is not an instant', () => { db.tables.execution_plan_steps = [stepRow({ not_before: 'next Monday' })]; }],
  ])('O-2: %s: an active run still holds, never throws', async (_label, code, detail, arrange) => {
    handoff(); run('active');
    (arrange as () => void)();
    const hold = await resolveJourneyHold(ORG, stamped);
    expect(hold).toMatchObject({ code });
    expect(hold?.reason).toContain(detail as string);
  });
});

describe('D-03 — the dispatcher holds a bridged task and writes nothing', () => {
  const nothingWritten = async (id: string, status: string) => {
    expect(calls).toHaveLength(0);
    expect(await listAttempts(ORG, id)).toHaveLength(0);
    expect(count('outreach_attempts')).toBe(0);
    expect(count('outreach_decisions')).toBe(0);
    expect(count('outreach_delivery_evidence')).toBe(0);
    expect(fakeRedis.store.size).toBe(0);
    expect((await getOutreachTaskById(ORG, id))?.status).toBe(status);
  };

  it.each([
    ['paused', 'journey_paused'], ['created', 'journey_not_active'], ['cancelled', 'journey_not_active'],
  ])('an approved task of a %s run is held (%s)', async (state) => {
    const id = await task('approved', { state });
    const res = await dispatch(id);
    expect(res).toMatchObject({ ok: false, outcome: 'deferred_journey', status: 'approved', attemptNumber: null, governance: null });
    await nothingWritten(id, 'approved');
  });

  it('a missing handoff and an unreadable run hold the same way', async () => {
    const lost = await task('approved', { handoff: false });
    expect((await dispatch(lost)).outcome).toBe('deferred_journey');
    await nothingWritten(lost, 'approved');

    const id = await task('approved', { state: 'active', over: { planTaskId: 'exec-task-2' } });
    db.failTable = 'execution_instances';
    expect((await dispatch(id)).outcome).toBe('deferred_journey');
    db.failTable = null;
    await nothingWritten(id, 'approved');
  });

  it('a requeued task (approval on record) is held before the prior-attempt check', async () => {
    const id = await task('queued', { state: 'paused' });
    (db.tables.outreach_approvals ??= []).push({ company_id: ORG, task_id: id, decision: 'approved', decided_at: NOW });
    const res = await dispatch(id);
    expect(res.outcome).toBe('deferred_journey');
    expect(res.outcome).not.toBe('blocked_prior_attempt');
    await nothingWritten(id, 'queued');
  });

  it('resumed, the same task dispatches exactly once', async () => {
    const id = await task('approved', { state: 'paused' });
    for (let i = 0; i < 3; i += 1) expect((await dispatch(id)).outcome).toBe('deferred_journey');
    await nothingWritten(id, 'approved');

    setRun('active');
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent', attemptNumber: 1 });
    // A sent task is no longer eligible; it is never sent twice.
    expect((await dispatch(id)).ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(await listAttempts(ORG, id)).toHaveLength(1);
  });

  it('an active journey sends', async () => {
    const id = await task('approved', { state: 'active' });
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent', status: 'sent' });
    expect(calls).toEqual([RECIPIENT]);
  });

  it('a task that never came from a journey dispatches as before, and no journey table is read', async () => {
    const id = await task('approved', { handoff: false, over: { plannerVersion: 'lie-2.1.0' } });
    expect(await dispatch(id)).toMatchObject({ outcome: 'sent', status: 'sent', attemptNumber: 1 });
    expect(calls).toHaveLength(1);
    expect(db.reads).not.toContain('outreach_bridge_handoffs');
    expect(db.reads).not.toContain('execution_instances');
  });

  it('holds a bridged task on any channel (agreed widening)', async () => {
    const id = await task('approved', { state: 'paused', over: { channel: INTERNAL_CHANNEL } });
    expect((await dispatch(id)).outcome).toBe('deferred_journey');
    expect(count('outreach_internal_work_items')).toBe(0);
    await nothingWritten(id, 'approved');
  });
});

describe('D-03 — placement', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadOutreachExecution/dispatch.ts'), 'utf8');
  const body = src.slice(src.indexOf('export async function dispatchInternalOutreachTask('));

  it('the hold sits after the transport guard and before governance, once', () => {
    const guard = body.indexOf('const transport = resolveTransport(task.channel);');
    const hold = body.indexOf('await resolveJourneyHold(companyId, task)');
    const governance = body.indexOf('await evaluateTaskGovernance(');
    expect(guard).toBeGreaterThan(-1);
    expect(hold).toBeGreaterThan(guard);
    expect(governance).toBeGreaterThan(hold);
    expect(src.split('resolveJourneyHold(').length - 1).toBe(1);
  });
});

describe('D-03 — the orchestration adapter waits on a held dispatch', () => {
  const step = { key: 's', channel: 'email', delay_after_previous_hours: 0, execution_mode: 'human', instruction: 'Hello {{first_name}}' };
  const ctx = (channel: string) => ({
    organizationId: ORG, executionInstanceId: RUN, executionTaskId: 't', planStepId: 'p', channel,
    subject: { kind: 'prospect', id: 'x' }, step: { ...step, channel }, personId: 'person',
  }) as never;
  const held = { outcome: 'deferred_journey', reason: 'the journey is paused; this task is held until it resumes' };
  const deps = (over: Partial<Ws3AdapterDeps> = {}): Ws3AdapterDeps => ({
    bridge: jest.fn(async () => ({ handoff: { outreachTaskId: 'task' } })) as never,
    getTask: jest.fn(async () => ({ id: 'task', status: 'approved' })) as never,
    submitForApproval: jest.fn(async () => ({ ok: true })) as never,
    dispatch: jest.fn(async () => held) as never,
    registerTransports: jest.fn(),
    resolveRecipient: jest.fn(async () => ({ personId: 'person', email: 'p@example.test', sourceOfTruth: null, personalization: { first_name: 'Ana' } })) as never,
    renderContent: renderEmailContent,
    sendEmail: jest.fn(async () => ({ dispatch: held })) as never,
    ...over,
  });

  it.each(['email', 'internal'])('a %s step held by the dispatcher waits; it is never refused or sent to a person', async (channel) => {
    const r = await createWs3Adapter(deps()).execute(ctx(channel));
    expect(r).toMatchObject({ outcome: 'deferred_journey', disposition: 'wait' });
  });

  it('nothing maps deferred_journey to a refusal: the adapter has no case for it', () => {
    const adapter = fs.readFileSync(path.join(process.cwd(), 'backend/services/orchestration/engineAdapters.ts'), 'utf8');
    expect(adapter).not.toContain('deferred_journey');
    expect(adapter).toMatch(/\/\/ deferred_\*, skipped_transport_disabled, skipped_already_dispatched, …\s*\n\s*return result\(outcome, 'wait'/);
  });
});
