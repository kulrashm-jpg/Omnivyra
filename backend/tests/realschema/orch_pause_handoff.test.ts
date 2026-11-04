/**
 * D-03 — a paused journey holds an email task already handed to WS-3, on REAL
 * PostgreSQL, through every WS-3 entry point: the operator activation route (after an
 * operator approval), a requeued task, the recovery sweep, and the orchestration
 * adapter.
 *
 * A hold writes nothing: no governance decision, no claim, no quota reservation, no
 * attempt, no evidence, and the task keeps its status. A resumed journey then sends
 * exactly once. Replaced: the email provider (recording; the activation route's
 * default edge seam is the mocked `functions.invoke`), the Redis quota counter and
 * PostgREST. Nothing is ever sent.
 */

import { db, inRollback, seedTenants, ORG_A } from './setup';
import {
  enableOutreach, enrol, emailStep, humanStep, handoffTasks, newProspect, newUser, one, rows,
} from './helpers/journeyFixtures';

/** Every call the activation route's default provider (the edge seam) receives. */
const mockInvoked: Array<Record<string, unknown>> = [];

jest.mock('../../db/writeOwner', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return { __esModule: true, ownedDbTable: (t: string) => pgTable(client, t), ownedDbRpc: pgRpc(client) };
});
jest.mock('../../db/supabaseClient', () => {
  const { pgTable, pgRpc } = require('./helpers/pgTransport');
  const client = () => require('./setup').db;
  return {
    __esModule: true,
    supabase: {
      from: (t: string) => pgTable(client, t),
      rpc: pgRpc(client),
      functions: {
        invoke: async (_fn: string, opts: { body: Record<string, unknown> }) => {
          mockInvoked.push(opts.body);
          return { data: { messageId: `edge-${String(opts.body.idempotencyKey)}` }, error: null };
        },
      },
    },
  };
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

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWs3Adapter, defaultWs3Deps } = require('../../services/orchestration/engineAdapters');
const { dispatchWorkflowEmailTask, ensureWorkflowTransports } = require('../../services/emailEngine/workflowEmailDispatch');
const { BRIDGED_TASK_PLANNER_VERSION } = require('../../services/emailEngine/emailExecutionContext');
const { approveOutreachTaskForOperator, dispatchApprovedOutreachForLead } = require('../../services/leadOutreachActivation');
const { runOutreachDispatchRecoverySweep } = require('../../services/leadOutreachRecoverySweep');
const ws3 = require('../../services/leadOutreachExecution');
/* eslint-enable @typescript-eslint/no-var-requires */

const ADDRESS = 'person@example.test';
const sent: string[] = [];
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; idempotencyKey: string }) {
    sent.push(r.to);
    return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} };
  },
};
const adapter = () => createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
});
const sweep = () =>
  advanceAndDispatchWorkflowExecution(ORG_A, { now: new Date().toISOString(), deps: { adapters: [adapter()] } });
/** Every provider call through any composition. */
const providerCalls = () => sent.length + mockInvoked.length;

const setRun = (id: string, state: string) =>
  db.query('UPDATE public.execution_instances SET lifecycle_state = $2 WHERE id = $1', [id, state]);
const status = async (taskId: string) =>
  String((await one('SELECT status FROM public.outreach_tasks WHERE id = $1', [taskId])).status);
const countOf = async (table: string, taskId: string) =>
  Number((await one(`SELECT count(*)::int n FROM public.${table} WHERE task_id = $1`, [taskId])).n);

/** What a hold must leave untouched, captured so "nothing was written" is exact. */
async function footprint(taskId: string) {
  return {
    status: await status(taskId),
    decisions: await countOf('outreach_decisions', taskId),
    attempts: await countOf('outreach_attempts', taskId),
    evidence: await countOf('outreach_delivery_evidence', taskId),
    workItems: await countOf('outreach_internal_work_items', taskId),
    quota: JSON.stringify([...mockRedis.store.entries()].sort()),
    providerCalls: providerCalls(),
  };
}

/** A journey whose first step is bridged and awaiting a person's approval. */
async function handedOff(channel: 'email' | 'internal' = 'email') {
  await seedTenants();
  await enableOutreach(ORG_A, ['email', 'internal']);
  const actor = await newUser();
  const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
  const step = channel === 'email' ? emailStep('intro') : humanStep('ping', 'internal', { instruction: 'Look at this account' });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [step] });
  await sweep();
  const [task] = await handoffTasks(instanceId);
  expect(task.status).toBe('awaiting_approval');
  return { actor, prospectId, instanceId, taskId: task.id };
}

/** Return an approved task to `queued` the way WS-3 does: a quota deferral, no attempt. */
async function requeueByQuota(prospectId: string, taskId: string, channel: string) {
  await db.query('UPDATE public.outreach_governance_config SET daily_limit_tenant = 1 WHERE company_id = $1', [ORG_A]);
  mockRedis.store.set(`ws3:quota:tenant:${ORG_A}`, 5);
  const [r] = await dispatchApprovedOutreachForLead(ORG_A, prospectId, { channels: [channel], taskIds: [taskId], recipient: ADDRESS });
  expect(r.outcome).toBe('deferred_quota');
  expect(await status(taskId)).toBe('queued');
  expect(await countOf('outreach_attempts', taskId)).toBe(0);
  mockRedis.store.clear();
  await db.query('UPDATE public.outreach_governance_config SET daily_limit_tenant = NULL WHERE company_id = $1', [ORG_A]);
}

const activate = async (prospectId: string, taskId: string, channel = 'email') =>
  (await dispatchApprovedOutreachForLead(ORG_A, prospectId, { channels: [channel], taskIds: [taskId], recipient: ADDRESS }))[0];

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
afterAll(() => { delete process.env.LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED; });
beforeEach(() => { sent.length = 0; mockInvoked.length = 0; mockRedis.store.clear(); });

describe('D-03 — approval cannot bypass a paused journey', () => {
  it('approve, then the activation route, with the run paused: held, nothing written; resumed: sent once', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      await setRun(s.instanceId, 'paused');
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      const before = await footprint(s.taskId);
      expect(before).toMatchObject({ status: 'approved', attempts: 0, providerCalls: 0 });

      for (let i = 0; i < 2; i += 1) {
        const r = await activate(s.prospectId, s.taskId);
        expect(r).toMatchObject({ action: 'dispatched', outcome: 'deferred_journey' });
        expect(r.reason).toMatch(/paused/);
      }
      expect(await footprint(s.taskId)).toEqual(before);

      // The orchestration sweep does not act on a paused run either.
      await sweep();
      expect(await footprint(s.taskId)).toEqual(before);

      await setRun(s.instanceId, 'active');
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ action: 'terminal' });
      await sweep();
      expect(await status(s.taskId)).toBe('sent');
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(providerCalls()).toBe(1);
      expect(mockInvoked[0]).toMatchObject({ type: 'lead_outreach', recipientEmail: ADDRESS });
    });
  });

  it('an active journey still sends through the same route', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(providerCalls()).toBe(1);
    });
  });
});

describe('D-03 — fail closed', () => {
  it.each(['created', 'cancelled'])('a run in %s holds', async (state) => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      await setRun(s.instanceId, state);
      const before = await footprint(s.taskId);
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'deferred_journey' });
      expect(await footprint(s.taskId)).toEqual(before);
    });
  });

  it('a lifecycle state outside the known set holds', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      await db.query('ALTER TABLE public.execution_instances DROP CONSTRAINT execution_instances_lifecycle_valid');
      await setRun(s.instanceId, 'archived');
      const before = await footprint(s.taskId);
      const r = await activate(s.prospectId, s.taskId);
      expect(r).toMatchObject({ outcome: 'deferred_journey' });
      expect(r.reason).toMatch(/archived/);
      expect(await footprint(s.taskId)).toEqual(before);
    });
  });

  it('an unreadable journey state holds', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      const before = await footprint(s.taskId);
      // The read of `lifecycle_state` now fails (42703) inside the real query path.
      await db.query('ALTER TABLE public.execution_instances RENAME COLUMN lifecycle_state TO lifecycle_state_unreadable');
      const r = await activate(s.prospectId, s.taskId);
      await db.query('ALTER TABLE public.execution_instances RENAME COLUMN lifecycle_state_unreadable TO lifecycle_state');
      expect(r).toMatchObject({ outcome: 'deferred_journey' });
      expect(r.reason).toMatch(/could not be read/);
      expect(await footprint(s.taskId)).toEqual(before);
    });
  });

  it('a journey-stamped task with no handoff holds', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId, personId } = await newProspect(ORG_A, { email: ADDRESS });
      const ins = await ws3.insertOutreachTask({
        companyId: ORG_A, leadId: prospectId, personId, planTaskId: `orphan-${Date.now()}`, taskOrder: 1,
        kind: 'outreach', action: 'Hello', channel: 'email', dependsOnPlanTaskId: null, estimatedDelayHours: 0,
        confidence: null, explanation: null, requiresApproval: true,
        plannerVersion: BRIDGED_TASK_PLANNER_VERSION, translationVersion: ws3.TRANSLATION_VERSION,
        governanceVersion: ws3.GOVERNANCE_VERSION, executionRuntimeVersion: ws3.EXECUTION_RUNTIME_VERSION,
        materializedAt: new Date().toISOString(),
      });
      expect(ins.ok).toBe(true);
      const taskId = String(ins.data.id);
      expect((await approveOutreachTaskForOperator(ORG_A, taskId, actor, 'operator approves')).ok).toBe(true);
      expect(await rows('SELECT 1 FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1', [taskId])).toHaveLength(0);
      const before = await footprint(taskId);
      const r = await activate(prospectId, taskId);
      expect(r).toMatchObject({ outcome: 'deferred_journey' });
      expect(r.reason).toMatch(/handoff is missing/);
      expect(await footprint(taskId)).toEqual(before);
    });
  });
});

describe('D-03 — a requeued task (the retry path) obeys the same hold', () => {
  it('held with no attempt, no blocked_prior_attempt and no decision; resumed it sends once', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      await requeueByQuota(s.prospectId, s.taskId, 'email');
      await setRun(s.instanceId, 'paused');
      const before = await footprint(s.taskId);
      expect(before).toMatchObject({ status: 'queued', attempts: 0 });

      const r = await activate(s.prospectId, s.taskId);
      expect(r.outcome).toBe('deferred_journey');
      expect(r.outcome).not.toBe('blocked_prior_attempt');
      expect(await footprint(s.taskId)).toEqual(before);
      // The recovery sweep's advisory check still finds nothing against it.
      const task = await ws3.getOutreachTaskById(ORG_A, s.taskId);
      expect(await ws3.requeuedDispatchProblem(ORG_A, task)).toBeNull();

      await setRun(s.instanceId, 'active');
      expect(await activate(s.prospectId, s.taskId)).toMatchObject({ outcome: 'sent' });
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(providerCalls()).toBe(1);
    });
  });
});

describe('D-03 — the recovery sweep (the worker) obeys the same hold', () => {
  it('a held queued task stays recoverable, is reselected once per run, and sends once on resume', async () => {
    await inRollback(async () => {
      const s = await handedOff('internal');
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      await requeueByQuota(s.prospectId, s.taskId, 'internal');
      await setRun(s.instanceId, 'paused');
      const before = await footprint(s.taskId);

      for (let run = 0; run < 2; run += 1) {
        const report = await runOutreachDispatchRecoverySweep();
        expect(report).toMatchObject({ recoverable: 1, unrecoverable: 0, sent: 0, failures: [] });
        expect(report.outcomes).toEqual({ deferred_journey: 1 });
        expect(await footprint(s.taskId)).toEqual(before);
      }

      await setRun(s.instanceId, 'active');
      const report = await runOutreachDispatchRecoverySweep();
      expect(report).toMatchObject({ sent: 1, unrecoverable: 0 });
      expect(await status(s.taskId)).toBe('sent');
      expect(await countOf('outreach_attempts', s.taskId)).toBe(1);
      expect(await countOf('outreach_internal_work_items', s.taskId)).toBe(1);
      expect((await runOutreachDispatchRecoverySweep()).scanned).toBe(0);
    });
  });

  it('a queued email task is still left to its own route by the sweep, as before', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      await requeueByQuota(s.prospectId, s.taskId, 'email');
      await setRun(s.instanceId, 'paused');
      const report = await runOutreachDispatchRecoverySweep();
      expect(report.outcomes).toEqual({ channel_not_permitted: 1 });
      expect(providerCalls()).toBe(0);
    });
  });
});

describe('D-03 — the orchestration adapter, reached on a paused run', () => {
  it('a dispatch made while the run is paused is held and the step waits', async () => {
    await inRollback(async () => {
      const s = await handedOff();
      expect((await approveOutreachTaskForOperator(ORG_A, s.taskId, s.actor, 'operator approves')).ok).toBe(true);
      await setRun(s.instanceId, 'paused');
      const step = await one(
        `SELECT execution_task_id AS task_id, execution_plan_step_id AS plan_step_id, person_id
           FROM public.outreach_bridge_handoffs WHERE outreach_task_id = $1`, [s.taskId]);
      const before = await footprint(s.taskId);
      // The sweeper would not call this for a paused run; calling it directly is the
      // race where a pause lands between the sweeper's read and the send.
      const r = await adapter().execute({
        organizationId: ORG_A, executionInstanceId: s.instanceId, executionTaskId: String(step.task_id),
        planStepId: String(step.plan_step_id), channel: 'email', subject: { kind: 'prospect', id: s.prospectId },
        step: emailStep('intro'), personId: String(step.person_id),
      });
      expect(r).toMatchObject({ outcome: 'deferred_journey', disposition: 'wait' });
      expect(await footprint(s.taskId)).toEqual(before);
    });
  });
});

describe('D-03 — a task that never came from a journey', () => {
  it('dispatches exactly as before', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      const { prospectId, personId } = await newProspect(ORG_A, { email: ADDRESS });
      const ins = await ws3.insertOutreachTask({
        companyId: ORG_A, leadId: prospectId, personId, planTaskId: `legacy-${Date.now()}`, taskOrder: 1,
        kind: 'outreach', action: 'Hello', channel: 'email', dependsOnPlanTaskId: null, estimatedDelayHours: 0,
        confidence: null, explanation: null, requiresApproval: true,
        plannerVersion: 'lie-2.1.0', translationVersion: ws3.TRANSLATION_VERSION,
        governanceVersion: ws3.GOVERNANCE_VERSION, executionRuntimeVersion: ws3.EXECUTION_RUNTIME_VERSION,
        materializedAt: new Date().toISOString(),
      });
      const taskId = String(ins.data.id);
      expect((await approveOutreachTaskForOperator(ORG_A, taskId, actor, 'operator approves')).ok).toBe(true);
      ws3.__clearTransportsForTests();
      ws3.registerDefaultTransports({ emailProvider: provider });
      const r = await ws3.dispatchInternalOutreachTask(ORG_A, taskId, { recipient: ADDRESS });
      expect(r).toMatchObject({ outcome: 'sent', attemptNumber: 1 });
      expect(sent).toEqual([ADDRESS]);
    });
  });
});
