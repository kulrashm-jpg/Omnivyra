/**
 * O-2 — a person's return date holds a handed-off journey task on EVERY execution path,
 * on REAL PostgreSQL (needs migration 20270127000000 in the template).
 *
 * The scenario the O-2 probe found sending (owner ruling 2026-11-06): a journey's second
 * step is handed off and approved; a reply pauses the run; an operator resumes it with a
 * return date ten days ahead (`not_before`). The run is ACTIVE again, so the D-03 run check
 * alone let the task through manual activation and the recovery sweep. The hold now also
 * reads the handed-off step (emailExecutionContext.resolveJourneyHold), at dispatch, which
 * every path reaches before governance, the claim, quota or an attempt.
 *
 * Every refusal asserts: no provider call, no attempt, no claim (the task keeps its state),
 * no governance decision row, no quota counter, and the hold's own reason. Scope: email and
 * the internal channel the recovery sweep serves. Controls prove each send path really sends.
 *
 * Replaced: the email provider (a recorder, the activation default included), Redis,
 * PostgREST, the session and capability checks in front of the route, and only where a test
 * says so the step read. Global fetch refuses and counts: it must stay at 0.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, ORG_A } from './setup';
import {
  enableOutreach, enrol, emailStep, handoffTasks, humanStep, instanceState, newProspect, newUser, one,
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
/** Activation registers the default email provider; it records here instead of calling out. */
const mockDefaultSent: string[] = [];
jest.mock('../../services/leadOutreachExecution/emailTransport', () => {
  const actual = jest.requireActual('../../services/leadOutreachExecution/emailTransport');
  const recorder = {
    name: 'supabase_edge_ses',
    async send(r: { to: string; idempotencyKey: string }) { mockDefaultSent.push(r.to); return { accepted: true, messageId: `dflt-${r.idempotencyKey}`, raw: {} }; },
  };
  return { ...actual, createEmailTransport: (p: unknown, o: unknown) => actual.createEmailTransport(p ?? recorder, o) };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const ws3 = require('../../services/leadOutreachExecution');
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');
const { dispatchApprovedOutreachForLead } = require('../../services/leadOutreachActivation');
const { runOutreachDispatchRecoverySweep, RECOVERY_SWEEP_ENABLED_ENV } = require('../../services/leadOutreachRecoverySweep');
const stepStore = require('../../services/workflowExecution/stepProgressionStore');
const instanceRoute = require('../../../pages/api/execution-instances/[id]').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const ADDRESS = 'person@example.test';
const sent: string[] = [];
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; idempotencyKey: string }) { sent.push(r.to); return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} }; },
};
const realWs3 = () => createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
});
const NOW = () => new Date().toISOString();
const sweep = () => advanceAndDispatchWorkflowExecution(ORG_A, { now: NOW(), deps: { adapters: [realWs3()] } });
const providerCalls = () => sent.length + mockDefaultSent.length;
let fetchCalls = 0;

/** Direct dispatch: the final execution boundary every path reaches. */
const dispatchTask = (taskId: string) => {
  ws3.__clearTransportsForTests();
  ws3.registerDefaultTransports({ emailProvider: provider });
  return ws3.dispatchInternalOutreachTask(ORG_A, taskId, { recipient: ADDRESS });
};
/** Operator manual activation, as /api/super-admin/outreach/activate calls it (email widened, as the route allows). */
const activate = async (taskId: string) => {
  const lead = String((await one('SELECT lead_id FROM public.outreach_tasks WHERE id = $1', [taskId])).lead_id);
  return dispatchApprovedOutreachForLead(ORG_A, lead, { channels: ['email'], recipient: ADDRESS, taskIds: [taskId] });
};

function patchRun(id: string, body: Record<string, unknown>) {
  const out: { status: number; json: Record<string, unknown> } = { status: 0, json: {} };
  const res = {
    setHeader: () => res,
    status(n: number) { out.status = n; return res; },
    json(j: Record<string, unknown>) { out.json = j; return res; },
    end() { return res; },
    writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method: 'PATCH', query: { id, company_id: ORG_A }, body, headers: {}, url: `/api/execution-instances/${id}` };
  return Promise.resolve(instanceRoute(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

/** Everything a dispatch would consume for a task: none of it may move while it is held. */
async function footprint(taskId: string) {
  const t = await one('SELECT status FROM public.outreach_tasks WHERE id = $1', [taskId]);
  const a = await one('SELECT count(*)::int n FROM public.outreach_attempts WHERE task_id = $1', [taskId]);
  const d = await one('SELECT count(*)::int n FROM public.outreach_decisions WHERE task_id = $1', [taskId]);
  return { status: String(t.status), attempts: Number(a.n), decisions: Number(d.n), quota: JSON.stringify([...mockRedis.store.entries()].sort()), providerCalls: providerCalls() };
}

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  (global as unknown as { fetch: unknown }).fetch = async () => { fetchCalls += 1; throw new Error('o2: network refused'); };
});
beforeEach(() => { sent.length = 0; mockDefaultSent.length = 0; mockRedis.store.clear(); });
afterEach(() => { jest.restoreAllMocks(); delete process.env[RECOVERY_SWEEP_ENABLED_ENV]; });
afterAll(() => { expect(fetchCalls).toBe(0); });

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const HELD = /a person deferred this journey step until/;

/**
 * The probe's scenario: first step sent; the second handed off BEFORE the pause; a reply pauses
 * the run; an operator resumes it (with `returnDate`, or without); the second task is approved.
 */
async function resumed(second: unknown, returnDate: Record<string, unknown> | null) {
  await seedTenants();
  await enableOutreach(ORG_A, ['email', 'internal']);
  const actor = await newUser();
  mockActor.id = actor;
  const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
  await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: NOW() });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro'), second] });
  await sweep();
  const [first] = await handoffTasks(instanceId);
  expect((await approveWithPasskey(ORG_A, first.id, actor)).ok).toBe(true);
  await sweep();
  expect(sent).toHaveLength(1);
  await sweep();
  const handedOff = (await handoffTasks(instanceId)).find((t) => t.id !== first.id);
  expect(handedOff).toBeDefined();
  expect((await ws3.ingestFeedback({ companyId: ORG_A, taskId: String(first.id), signal: 'replied', occurredAt: NOW(), source: 'manual' })).ok).toBe(true);
  await sweep();
  expect(await instanceState(instanceId)).toBe('paused');
  await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'Europe/London') ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
  const out = await patchRun(instanceId, returnDate === null ? { lifecycleState: 'active' } : { lifecycleState: 'active', returnDate });
  expect(out.status).toBe(200);
  expect(await instanceState(instanceId)).toBe('active');
  const task = String(handedOff!.id);
  expect((await approveWithPasskey(ORG_A, task, actor)).ok).toBe(true);
  sent.length = 0;
  mockDefaultSent.length = 0;
  return { instanceId, task, notBefore: returnDate === null ? null : String(out.json.notBefore) };
}

describe('O-2 — a return date holds a handed-off task on every path (email)', () => {
  it('scheduler, manual /activate and direct dispatch all refuse; nothing is consumed; the task stays approved', () => inRollback(async () => {
    const s = await resumed(emailStep('next'), { kind: 'date', date: inDays(10) });
    expect(Date.parse(String(s.notBefore))).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    const before = await footprint(s.task);
    expect(before.status).toBe('approved');

    // 1. Automatic scheduler.
    const r = await sweep();
    expect(r.decisions.some((d: { outcome: string }) => d.outcome === 'not_before')).toBe(true);
    expect(await footprint(s.task)).toEqual(before);

    // 2. Operator manual activation.
    const [report] = await activate(s.task);
    expect(report).toMatchObject({ action: 'dispatched', outcome: 'deferred_journey' });
    expect(String(report.reason)).toMatch(HELD);
    expect(await footprint(s.task)).toEqual(before);

    // 4. Direct dispatch, the final execution boundary.
    const d = await dispatchTask(s.task);
    expect(d.outcome).toBe('deferred_journey');
    expect(d.reason).toMatch(HELD);
    expect(await footprint(s.task)).toEqual(before);
    expect(providerCalls()).toBe(0);
  }), 300_000);
});

describe('O-2 — internal recovery sweep', () => {
  it('a queued handed-off task with a future return date is not dispatched by the recovery sweep; it stays queued', () => inRollback(async () => {
    const s = await resumed(humanStep('next', 'internal', { instruction: 'Call the person about next' }), { kind: 'date', date: inDays(10) });
    // As an earlier dispatch leaves it after a quota deferral: what the recovery sweep scans.
    expect((await db.query(`UPDATE public.outreach_tasks SET status = 'queued' WHERE id = $1 AND status = 'approved'`, [s.task])).rowCount).toBe(1);
    const before = await footprint(s.task);
    process.env[RECOVERY_SWEEP_ENABLED_ENV] = 'true';
    const rep = await runOutreachDispatchRecoverySweep({});
    expect(rep).toMatchObject({ skipped: null, recoverable: 1, sent: 0, outcomes: { deferred_journey: 1 } });
    expect(await footprint(s.task)).toEqual(before);
    expect(before.status).toBe('queued');

    // The final boundary refuses it directly too.
    const d = await ws3.dispatchInternalOutreachTask(ORG_A, s.task, {});
    expect(d.outcome).toBe('deferred_journey');
    expect(await footprint(s.task)).toEqual(before);
  }), 300_000);
});

describe('O-2 — after the return date, and without one', () => {
  it('held until the return instant passes; then it executes exactly once through manual activation', () => inRollback(async () => {
    const s = await resumed(emailStep('next'), { kind: 'instant', at: new Date(Date.now() + 25_000).toISOString() });
    expect(Date.parse(String(s.notBefore)) - Date.now()).toBeLessThan(60_000);
    const before = await footprint(s.task);
    const [early] = await activate(s.task);
    expect(early).toMatchObject({ outcome: 'deferred_journey' });
    expect(await footprint(s.task)).toEqual(before);

    const wait = Date.parse(String(s.notBefore)) - Date.now() + 500;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const [late] = await activate(s.task);
    expect(late).toMatchObject({ action: 'dispatched', outcome: 'sent', governance: 'allowed' });
    expect(providerCalls()).toBe(1);
    const after = await footprint(s.task);
    expect(after).toMatchObject({ status: 'sent', attempts: before.attempts + 1 });

    // Exactly once: activation and direct dispatch again send nothing more.
    const [again] = await activate(s.task);
    expect(again.outcome).not.toBe('sent');
    expect((await dispatchTask(s.task)).outcome).not.toBe('sent');
    expect(providerCalls()).toBe(1);
  }), 300_000);

  it('fails closed on a missing, unreadable or inconsistent step or return date; with no return date the task executes normally', () => inRollback(async () => {
    const s = await resumed(emailStep('next'), null);
    const before = await footprint(s.task);
    const real = stepStore.getProgressionStep;
    const handoff = await one('SELECT execution_plan_step_id FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1', [s.task]);
    const step = await real(ORG_A, String(handoff.execution_plan_step_id));
    expect(step.notBefore).toBeNull();

    const cases: Array<[string, () => Promise<unknown>, RegExp]> = [
      ['the step read fails', async () => { throw new Error('read refused'); }, /could not be read \(step read failed\)/],
      ['the step is missing', async () => null, /could not be read \(step not found\)/],
      ['the step belongs to another plan', async () => ({ ...step, planId: '00000000-0000-4000-8000-000000000000' }), /does not belong to the plan/],
      ['the return date is not an instant', async () => ({ ...step, notBefore: 'next Monday' }), /return date is not an instant/],
    ];
    for (const [label, impl, reason] of cases) {
      const spy = jest.spyOn(stepStore, 'getProgressionStep').mockImplementation(impl as never);
      const d = await dispatchTask(s.task);
      expect({ label, outcome: d.outcome }).toEqual({ label, outcome: 'deferred_journey' });
      expect(d.reason).toMatch(reason);
      const [rep] = await activate(s.task);
      expect({ label, outcome: rep.outcome }).toEqual({ label, outcome: 'deferred_journey' });
      expect(await footprint(s.task)).toEqual(before);
      spy.mockRestore();
    }

    // CONTROL: no return date is the established behaviour; the same task executes once.
    const ok = await dispatchTask(s.task);
    expect(ok.outcome).toBe('sent');
    expect(providerCalls()).toBe(1);
  }), 300_000);

  it('CONTROL: resumed without a return date, manual /activate sends (the path itself works)', () => inRollback(async () => {
    const s = await resumed(emailStep('next'), null);
    const [rep] = await activate(s.task);
    expect(rep).toMatchObject({ action: 'dispatched', outcome: 'sent' });
    expect(providerCalls()).toBe(1);
  }), 300_000);
});
