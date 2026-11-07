/**
 * O2-F1 and the Prompt 5 reply evaluation, on REAL PostgreSQL (needs 20270127000000, and for
 * opt_out 20270127000001, in the template).
 *
 * O2-F1: a plain PATCH resume that lands between a return-date resume's paused check and its
 * floor (`deferStepUntil`) made the run active before the floor existed, so a dispatch could
 * send early, and BOTH resumes reported success. Every resume now moves the run only from
 * `paused` (a compare-and-set); the loser answers 409 `resume_race_lost`.
 *
 * The probe at every interleaving point is the O-2 dispatch-time hold
 * (emailExecutionContext.resolveJourneyHold), which every send path reaches first: null means
 * the task could go out now. The retimed resume may report success ONLY if the hold never
 * opened before its floor. Controls dispatch the task for real.
 *
 * Replaced: the email provider (recording), Redis, PostgREST (pgTransport), the session and
 * capability checks in front of the route. Global fetch refuses and counts: it must stay 0.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, ORG_A } from './setup';
import {
  enableOutreach, enrol, emailStep, handoffTasks, instanceState, newProspect, newUser, one, rows,
} from './helpers/journeyFixtures';

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, supabase: { from: (t: string) => pgTable(client, t), rpc: pgRpc(client) } };
});
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const mockRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) + by; this.store.set(k, n); return n; },
  async decrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) - by; this.store.set(k, n); return n; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => mockRedis }));
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => require('../helpers/approvalPasskeyDouble').webauthnDouble);
import { approveWithPasskey } from '../helpers/approvalPasskeyDouble';
const mockActor = { id: 'unset' };
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: mockActor.id })),
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: mockActor.id } })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const { resolveJourneyHold, BRIDGED_TASK_PLANNER_VERSION } = require('../../services/emailEngine/emailExecutionContext');
const ws3 = require('../../services/leadOutreachExecution');
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');
const stepStore = require('../../services/workflowExecution/stepProgressionStore');
const store = require('../../services/executionInstances/executionInstanceStore');
const instanceRoute = require('../../../pages/api/execution-instances/[id]').default;
/* eslint-enable @typescript-eslint/no-var-requires */

type Row = Record<string, unknown>;
const ADDRESS = 'person@example.test';
const sent: string[] = [];
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; idempotencyKey: string }) { sent.push(r.to); return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} }; },
};
const realWs3 = () => createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Row) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
});
const NOW = () => new Date().toISOString();
const sweep = () => advanceAndDispatchWorkflowExecution(ORG_A, { now: NOW(), deps: { adapters: [realWs3()] } });
let fetchCalls = 0;
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const dispatchTask = (taskId: string) => {
  ws3.__clearTransportsForTests();
  ws3.registerDefaultTransports({ emailProvider: provider });
  return ws3.dispatchInternalOutreachTask(ORG_A, taskId, { recipient: ADDRESS });
};

function patchRun(id: string, body: Row) {
  const out: { status: number; json: Row } = { status: 0, json: {} };
  const res = {
    setHeader: () => res,
    status(n: number) { out.status = n; return res; },
    json(j: Row) { out.json = j; return res; },
    end() { return res; },
    writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method: 'PATCH', query: { id, company_id: ORG_A }, body, headers: {}, url: `/api/execution-instances/${id}` };
  return Promise.resolve(instanceRoute(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  (global as unknown as { fetch: unknown }).fetch = async () => { fetchCalls += 1; throw new Error('o2f1: network refused'); };
});
beforeEach(() => { sent.length = 0; mockRedis.store.clear(); });
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { expect(fetchCalls).toBe(0); });

/** A run paused by a reply, with its second step handed off and that task approved. */
async function pausedByReply() {
  await seedTenants();
  await enableOutreach(ORG_A, ['email', 'internal']);
  const actor = await newUser();
  mockActor.id = actor;
  const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
  await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: NOW() });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro'), emailStep('next')] });
  await sweep();
  const [first] = await handoffTasks(instanceId);
  expect((await approveWithPasskey(ORG_A, first.id, actor)).ok).toBe(true);
  await sweep();
  expect(sent).toHaveLength(1);
  await sweep();
  const second = (await handoffTasks(instanceId)).find((t) => t.id !== first.id);
  expect(second).toBeDefined();
  expect((await ws3.ingestFeedback({ companyId: ORG_A, taskId: String(first.id), signal: 'replied', occurredAt: NOW(), source: 'manual' })).ok).toBe(true);
  await sweep();
  expect(await instanceState(instanceId)).toBe('paused');
  await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'Europe/London') ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
  const task = String(second!.id);
  expect((await approveWithPasskey(ORG_A, task, actor)).ok).toBe(true);
  sent.length = 0;
  return { instanceId, task, actor, prospectId };
}

/** The O-2 dispatch-time hold for the task: null means it could be sent right now. */
const holdOpen = async (task: string) => (await resolveJourneyHold(ORG_A, { id: task, plannerVersion: BRIDGED_TASK_PLANNER_VERSION })) === null;
const floorOf = async (task: string) => {
  const r = await one(`SELECT s.not_before FROM public.outreach_bridge_handoffs h JOIN public.execution_plan_steps s ON s.id = h.execution_plan_step_id
    WHERE h.outreach_task_id = $1`, [task]);
  return r.not_before === null ? null : new Date(r.not_before as string).toISOString();
};

describe('O2-F1 — a plain resume lands between the paused check and the floor', () => {
  it('the retimed resume loses (409 resume_race_lost); it never reports success after an unfloored active window', () => inRollback(async () => {
    const s = await pausedByReply();
    const real = stepStore.deferStepUntil;
    let plain: { status: number; json: Row } | null = null;
    let openedBeforeFloor = false;
    jest.spyOn(stepStore, 'deferStepUntil').mockImplementation(async (...a: unknown[]) => {
      plain = await patchRun(s.instanceId, { lifecycleState: 'active' });
      openedBeforeFloor = (await floorOf(s.task)) === null && (await holdOpen(s.task));
      return real(...a);
    });
    const retimed = await patchRun(s.instanceId, { lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
    expect(plain!.status).toBe(200);
    // THE INVARIANT: a retimed resume that reports success never had the hold open before its floor.
    expect({ retimed: retimed.status, openedBeforeFloor }).not.toEqual({ retimed: 200, openedBeforeFloor: true });
    expect(retimed.status).toBe(409);
    expect(retimed.json.code).toBe('resume_race_lost');
    expect(await instanceState(s.instanceId)).toBe('active');
  }), 300_000);
});

describe('O2-F1 — the retimed resume wins', () => {
  it('a plain resume that read `paused` but moves after it loses; the run is never active without the floor; nothing is sent', () => inRollback(async () => {
    const s = await pausedByReply();
    const realCas = store.compareAndSetExecutionInstanceState;
    const snapshots: Array<{ state: string; floor: string | null; open: boolean }> = [];
    const snap = async () => snapshots.push({ state: await instanceState(s.instanceId), floor: await floorOf(s.task), open: await holdOpen(s.task) });
    let retimed: { status: number; json: Row } | null = null;
    let first = true;
    jest.spyOn(store, 'compareAndSetExecutionInstanceState').mockImplementation(async (...a: unknown[]) => {
      if (first) {                                     // the plain resume, after its read of `paused`
        first = false;
        retimed = await patchRun(s.instanceId, { lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } });
      }
      await snap();
      const r = await realCas(...a);
      await snap();
      return r;
    });
    const plain = await patchRun(s.instanceId, { lifecycleState: 'active' });
    jest.restoreAllMocks();
    expect(retimed!.status).toBe(200);
    expect(plain.status).toBe(409);
    expect(plain.json.code).toBe('resume_race_lost');
    expect(snapshots.length).toBeGreaterThanOrEqual(4);
    for (const x of snapshots) {
      if (x.state === 'active') expect(x.floor).not.toBeNull();
      expect(x.open).toBe(false);
    }
    // CONTROL: the real dispatch boundary refuses the task before the floor.
    const d = await dispatchTask(s.task);
    expect(d.outcome).toBe('deferred_journey');
    expect(sent).toHaveLength(0);
  }), 300_000);

  it('started together: exactly one resume moves the run; a retimed winner always has its floor', () => inRollback(async () => {
    const s = await pausedByReply();
    const [plain, retimed] = await Promise.all([
      patchRun(s.instanceId, { lifecycleState: 'active' }),
      patchRun(s.instanceId, { lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(10) } }),
    ]);
    expect(await instanceState(s.instanceId)).toBe('active');
    for (const r of [plain, retimed]) expect([200, 409]).toContain(r.status);
    if (retimed.status === 200) {
      expect(await floorOf(s.task)).not.toBeNull();
      expect(await holdOpen(s.task)).toBe(false);
    }
    if (plain.status === 409) expect(plain.json.code).toBe('resume_race_lost');
    if (retimed.status === 409) expect(retimed.json.code).toBe('resume_race_lost');
  }), 300_000);
});

describe('Prompt 5 — a person evaluates the reply (real route, real decision log)', () => {
  const evaluations = (id: string) => rows(
    `SELECT decision, outcome, reasons, plan_step_id FROM public.execution_journey_decisions
      WHERE execution_instance_id = $1 AND (outcome LIKE 'reply_evaluated:%' OR outcome = 'cancelled_by_person') ORDER BY decided_at`, [id]);
  const lifecycleRows = async (prospectId: string) => Number((await one(
    'SELECT count(*)::int n FROM public.prospect_lifecycle_transitions WHERE organization_id = $1 AND prospect_id = $2', [ORG_A, prospectId])).n);

  it('continue: the run resumes and the decision names the actor; PI receives nothing', () => inRollback(async () => {
    const s = await pausedByReply();
    const pi = await lifecycleRows(s.prospectId);
    const r = await patchRun(s.instanceId, { evaluation: 'continue' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ auditFailed: false, evaluation: { action: 'continue' } });
    expect(await instanceState(s.instanceId)).toBe('active');
    const [d] = await evaluations(s.instanceId);
    expect(d).toMatchObject({ decision: 'waiting' });
    expect(String(d.outcome)).toMatch(/^reply_evaluated:continue:[0-9a-f]{32}$/);
    expect((d.reasons as string[])[0]).toBe(`actor:${s.actor}`);
    expect(await lifecycleRows(s.prospectId)).toBe(pi);
    // The same reply is not evaluated twice, and the sweeper does not pause again on it.
    await sweep();
    expect(await instanceState(s.instanceId)).not.toBe('paused');
  }), 300_000);

  it('retime: the floor is written, the hold stays shut, the decision is `deferred` with the actor', () => inRollback(async () => {
    const s = await pausedByReply();
    const r = await patchRun(s.instanceId, { evaluation: 'retime', returnDate: { kind: 'date', date: inDays(10) } });
    expect(r.status).toBe(200);
    expect(await floorOf(s.task)).not.toBeNull();
    expect(await holdOpen(s.task)).toBe(false);
    const [d] = await evaluations(s.instanceId);
    expect(d).toMatchObject({ decision: 'deferred' });
    expect((d.reasons as string[]).slice(0, 2)).toEqual([`actor:${s.actor}`, 'evaluation:retime']);
    expect((await dispatchTask(s.task)).outcome).toBe('deferred_journey');
    expect(sent).toHaveLength(0);
  }), 300_000);

  it('end: the run is cancelled, the unsent task withdrawn, an `exited` decision with the actor', () => inRollback(async () => {
    const s = await pausedByReply();
    const r = await patchRun(s.instanceId, { evaluation: 'end' });
    expect(r.status).toBe(200);
    expect(await instanceState(s.instanceId)).toBe('cancelled');
    const [d] = await evaluations(s.instanceId);
    expect(d).toMatchObject({ decision: 'exited', outcome: 'cancelled_by_person', plan_step_id: null });
    expect((d.reasons as string[])[0]).toBe(`actor:${s.actor}`);
    expect((await dispatchTask(s.task)).outcome).not.toBe('sent');
    expect(sent).toHaveLength(0);
  }), 300_000);

  it('opt_out (G-11): all-channel holds on the person and the address, an admin review, the run ends, and a NEW journey contacts nobody', () => inRollback(async () => {
    const s = await pausedByReply();
    const pi = await lifecycleRows(s.prospectId);
    const r = await patchRun(s.instanceId, { evaluation: 'opt_out' });
    expect(r.status).toBe(200);
    expect(await instanceState(s.instanceId)).toBe('cancelled');
    const gov = await rows(
      `SELECT id, governance_type, channel, person_id, target_normalized, source, revoked_at, purpose_scope, evidence->>'source_ref' AS ref
         FROM public.contact_governance_records
        WHERE organization_id = $1 AND source = 'optout_review:reply_opt_out' ORDER BY target_normalized NULLS FIRST`, [ORG_A]);
    expect(gov).toHaveLength(2);                                                 // the person, and the address (no number on file)
    for (const g of gov) expect(g).toMatchObject({ governance_type: 'unsubscribe', channel: '*', revoked_at: null, purpose_scope: null });
    expect(gov[0].person_id).not.toBeNull();
    expect(gov[1]).toMatchObject({ person_id: null, target_normalized: ADDRESS });
    const [d] = await rows(
      `SELECT decision, outcome, reasons FROM public.execution_journey_decisions
        WHERE execution_instance_id = $1 AND outcome = 'unsubscribed' AND decision = 'exited'`, [s.instanceId]);
    expect((d.reasons as string[]).slice(0, 2)).toEqual([`actor:${s.actor}`, 'evaluation:opt_out']);
    const [review] = await rows(`SELECT id, anchor_kind, anchor_value, state, triggers, locked_channels, adopted_hold_ids, source_refs
      FROM public.contact_opt_out_reviews WHERE organization_id = $1`, [ORG_A]);
    expect(review).toMatchObject({ anchor_kind: 'person', anchor_value: gov[0].person_id, state: 'pending', triggers: ['reply_opt_out'], locked_channels: [] });
    expect([...(review.adopted_hold_ids as string[])].sort()).toEqual(gov.map((g) => g.id).sort());
    expect(review.source_refs).toEqual([String(gov[0].ref)]);
    expect(String(gov[0].ref)).toMatch(new RegExp(`^${s.instanceId}:[0-9a-f]{32}$`));
    expect(d.reasons).toContain(`optout_review:${review.id}`);
    expect(await lifecycleRows(s.prospectId)).toBe(pi);              // P-1: PI is not written
    expect((await dispatchTask(s.task)).outcome).not.toBe('sent');
    // A NEW journey for the same prospect: whatever it creates, nothing reaches the person.
    const again = await enrol(ORG_A, s.actor, s.prospectId, { steps: [emailStep('later')] });
    expect(again.report.enrolled).toBe(1);                         // PI closure is not used: the run exists
    expect(again.instanceId).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      await sweep();
      for (const t of await handoffTasks(again.instanceId)) await approveWithPasskey(ORG_A, String(t.id), s.actor);
    }
    await sweep();
    expect(sent).toHaveLength(0);
    expect(await instanceState(again.instanceId)).toBe('cancelled');  // the restriction ends it as unsubscribed
  }), 300_000);

  it('refusals: invalid action, retime without a date, and a non-paused run record nothing', () => inRollback(async () => {
    const s = await pausedByReply();
    expect(await patchRun(s.instanceId, { evaluation: 'approve' })).toMatchObject({ status: 400, json: { code: 'invalid_action' } });
    expect(await patchRun(s.instanceId, { evaluation: 'retime' })).toMatchObject({ status: 400, json: { code: 'return_date_required' } });
    expect(await instanceState(s.instanceId)).toBe('paused');
    expect((await patchRun(s.instanceId, { lifecycleState: 'active' })).status).toBe(200);
    expect(await patchRun(s.instanceId, { evaluation: 'continue' })).toMatchObject({ status: 409, json: { code: 'not_paused' } });
    expect(await evaluations(s.instanceId)).toEqual([]);
  }), 300_000);
});
