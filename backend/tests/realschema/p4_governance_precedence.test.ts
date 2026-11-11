/**
 * Prompt 4 round 2 — governance precedence, RV-1, Q-C1 and the person-supplied not_before,
 * on REAL PostgreSQL (needs migration 20270127000000 in the template).
 *
 * The Outreach sign-off conditions. Every send that must not happen asserts the provider
 * call counter is 0 (or unchanged):
 *   G-1  a suspended (paused) run + a complaint / unsubscribe restriction → resumed through
 *        the route → dispatch REFUSED by governance;
 *   C-2  a complaint whose delivery-evidence write fails: the restriction stands AND the run
 *        ends; if the termination fails too, dispatch is still refused;
 *   D-1  the D-03 hold bypassed (resolveJourneyHold forced null): a paused run's task
 *        reaches governance and is blocked — the pause is not the only protection;
 *   D-2  a NEW journey for a complained / unsubscribed / hard-bounced person is refused at dispatch;
 *   RV-1 a revocation pauses the run; the operator resume never revives the revoked approval;
 *   Q-C1 a complaint ends a run, a paused one included;
 *   NB   not_before: migration apply / rollback / reapply with grants, policies and RLS
 *        unchanged; only-later; never past; the resume with a return date.
 *
 * Replaced: the email provider (recording), Redis, PostgREST, the session and capability
 * checks in front of the route, and — only where a test says so — one seam forced to fail.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { attempt, db, inRollback, seedTenants, ORG_A } from './setup';
import {
  enableOutreach, enrol, emailStep, handoffTasks, humanStep, instanceState, newProspect, newUser, one, rnd, rows,
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
const ws3 = require('../../services/leadOutreachExecution');
const { revokeOutreachApproval } = require('../../services/leadOutreachExecution/approvalRevocation');
const { ingestSesEvent } = require('../../services/providerEvents/sesProviderEventIngestion');
const feedbackIngestion = require('../../services/leadOutreachExecution/feedbackIngestion');
const { recordOutreachUnsubscribe } = require('../../services/leadOutreachExecution/unsubscribeService');
const { recordContactGovernance } = require('../../services/prospectIdentity/contactGovernanceWriter');
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');
const emailContext = require('../../services/emailEngine/emailExecutionContext');
const journeyExit = require('../../services/orchestration/journeyExit');
const { deferStepUntil } = require('../../services/workflowExecution/stepProgressionStore');
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
const sweep = (adapters: unknown[] = [realWs3()]) => advanceAndDispatchWorkflowExecution(ORG_A, { now: NOW(), deps: { adapters } });
const decisionsOf = (instanceId: string) => rows(`SELECT decision, outcome, step_key FROM public.execution_journey_decisions WHERE execution_instance_id = $1 ORDER BY decided_at`, [instanceId]);
/** The direct WS-3 dispatch of one task, the way the activation route and the sweeper reach it. */
const dispatchTask = (taskId: string) => {
  ws3.__clearTransportsForTests();
  ws3.registerDefaultTransports({ emailProvider: provider });
  return ws3.dispatchInternalOutreachTask(ORG_A, taskId, { recipient: ADDRESS });
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

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sent.length = 0; mockRedis.store.clear(); });
afterEach(() => { jest.restoreAllMocks(); });

/** Two email steps: the first approved and sent; the second bridged and awaiting approval. */
async function firstSent(address = ADDRESS) {
  await seedTenants();
  await enableOutreach(ORG_A, ['email', 'internal']);
  const actor = await newUser();
  mockActor.id = actor;
  const { prospectId, personId } = await newProspect(ORG_A, { email: address });
  await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: NOW() });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro'), emailStep('next')] });
  await sweep();
  const [first] = await handoffTasks(instanceId);
  expect((await approveWithPasskey(ORG_A, first.id, actor)).ok).toBe(true);
  await sweep();
  expect(sent).toHaveLength(1);
  await sweep();
  const tasks = await handoffTasks(instanceId);
  const second = tasks.find((t) => t.id !== first.id);
  const attempt1 = await one('SELECT id FROM public.outreach_attempts WHERE task_id = $1', [first.id]);
  const evidence = await one('SELECT provider_message_id FROM public.outreach_delivery_evidence WHERE task_id = $1 AND provider_message_id IS NOT NULL', [first.id]);
  return {
    actor, prospectId, personId: String(personId), instanceId, firstTask: String(first.id), secondTask: second ? String(second.id) : null,
    attemptId: String(attempt1.id), messageId: String(evidence.provider_message_id),
  };
}
/** The run suspended by an unclassified reply (Prompt 4). */
async function suspended(address = ADDRESS) {
  const s = await firstSent(address);
  expect((await ws3.ingestFeedback({ companyId: ORG_A, taskId: s.firstTask, signal: 'replied', occurredAt: NOW(), source: 'manual' })).ok).toBe(true);
  await sweep();
  expect(await instanceState(s.instanceId)).toBe('paused');
  expect(s.secondTask).not.toBeNull();
  return s as typeof s & { secondTask: string };
}
const complaint = (messageId: string, address = ADDRESS) => ingestSesEvent({
  eventType: 'Complaint', mail: { messageId, destination: [address] },
  complaint: { timestamp: NOW(), complainedRecipients: [{ emailAddress: address }] },
}, `sns-${rnd()}`);
const restrictionCount = (type: string) => one(`SELECT count(*)::int n FROM public.contact_governance_records WHERE organization_id = $1 AND governance_type = $2 AND revoked_at IS NULL`, [ORG_A, type]).then((r) => Number(r.n));

describe('G-1 — a suspended run hit by a restriction, resumed through the route: governance refuses the send', () => {
  it('complaint → resume → dispatch blocked_governance; provider calls 0', async () => {
    await inRollback(async () => {
      const s = await suspended();
      expect((await complaint(s.messageId)).status).toBe('processed');
      expect(await restrictionCount('complaint')).toBeGreaterThan(0);
      expect((await patchRun(s.instanceId, { lifecycleState: 'active' })).status).toBe(200);
      expect((await approveWithPasskey(ORG_A, s.secondTask, s.actor)).ok).toBe(true);
      const before = sent.length;
      const r = await dispatchTask(s.secondTask);
      expect(r.outcome).toBe('blocked_governance');
      expect(sent.length - before).toBe(0);
      // Q-C1 — and the next sweep ends the run on the complaint.
      const swept = await sweep();
      expect(swept.decisions.find((d: { decision: string }) => d.decision === 'exited')).toMatchObject({ outcome: 'complained' });
      expect(await instanceState(s.instanceId)).toBe('cancelled');
      expect(sent.length - before).toBe(0);
    });
  });

  it('unsubscribe (the real one-click service) → resume → dispatch blocked_governance; provider calls 0', async () => {
    await inRollback(async () => {
      const s = await suspended();
      const out = await recordOutreachUnsubscribe(
        { organizationId: ORG_A, attemptId: s.attemptId, scope: 'email', recipient: ADDRESS, issuedAt: Date.now(), keyId: 'k1' }, 'one_click');
      expect(out.status).not.toBe('retryable_failure');
      expect(await restrictionCount('unsubscribe')).toBeGreaterThan(0);
      expect((await patchRun(s.instanceId, { lifecycleState: 'active' })).status).toBe(200);
      expect((await approveWithPasskey(ORG_A, s.secondTask, s.actor)).ok).toBe(true);
      const before = sent.length;
      expect((await dispatchTask(s.secondTask)).outcome).toBe('blocked_governance');
      await sweep();
      expect(await instanceState(s.instanceId)).toBe('cancelled');
      expect(sent.length - before).toBe(0);
    });
  });
});

describe('Q-C1 — a complaint ends the run, a paused one included', () => {
  it('a PAUSED run hit by a complaint ends; nothing is sent', async () => {
    await inRollback(async () => {
      const s = await suspended();
      const before = sent.length;
      expect((await complaint(s.messageId)).status).toBe('processed');
      const r = await sweep();
      expect(r.counters.journeys_exited).toBe(1);
      expect(await instanceState(s.instanceId)).toBe('cancelled');
      expect((await handoffTasks(s.instanceId)).find((t) => t.id === s.secondTask)!.status).toBe('cancelled');
      expect((await decisionsOf(s.instanceId)).some((d) => d.decision === 'exited' && d.outcome === 'complained')).toBe(true);
      expect(sent.length - before).toBe(0);
    });
  });

  it('a complaint wins over a pending reply: an active run with both ends, it is not suspended', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      expect((await ws3.ingestFeedback({ companyId: ORG_A, taskId: s.firstTask, signal: 'replied', occurredAt: NOW(), source: 'manual' })).ok).toBe(true);
      expect((await complaint(s.messageId)).status).toBe('processed');
      const r = await sweep();
      expect(r.counters).toMatchObject({ journeys_exited: 1, journeys_suspended: 0 });
      expect(await instanceState(s.instanceId)).toBe('cancelled');
    });
  });

  it('the complaint-inferred evidence alone ends the run (read directly, not through the event view)', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      // The marker on an otherwise odd row: the rule fails toward a complaint.
      await db.query(`INSERT INTO public.outreach_delivery_evidence (company_id, task_id, attempt_id, delivery_status, transport_response, observed_at)
        VALUES ($1,$2,$3,'delivered',$4,now())`, [ORG_A, s.firstTask, s.attemptId, JSON.stringify({ deliveryInferredFrom: 'Complaint' })]);
      jest.spyOn(require('../../services/orchestration/journeyEvents'), 'readJourneyEvents').mockRejectedValue(new Error('event view down'));
      const r = await sweep();
      expect(r.counters.journeys_exited).toBe(1);
      expect(await instanceState(s.instanceId)).toBe('cancelled');
    });
  });
});

describe('C-2 — a complaint whose evidence write fails', () => {
  it('the restriction stands and the run ends; if termination fails too, dispatch is still refused (provider calls 0)', async () => {
    await inRollback(async () => {
      const s = await suspended();
      const before = sent.length;
      jest.spyOn(feedbackIngestion, 'ingestFeedback').mockResolvedValue({ ok: false, rejection: 'write_failed', reason: 'forced' });
      const out = await complaint(s.messageId);
      expect(out.persistence).toMatchObject({ evidence: 'failed', restriction: 'in_force' });
      expect(await restrictionCount('complaint')).toBeGreaterThan(0);
      expect(Number((await one(`SELECT count(*)::int n FROM public.outreach_delivery_evidence WHERE task_id = $1 AND transport_response->>'deliveryInferredFrom' = 'Complaint'`, [s.firstTask])).n)).toBe(0);

      // Termination fails too: the run stays paused, and governance still refuses the send.
      jest.spyOn(journeyExit, 'exitJourney').mockRejectedValue(Object.assign(new Error('forced'), { code: 'forced_exit_failure' }));
      const failed = await sweep();
      expect(failed.counters.errors).toBeGreaterThan(0);
      expect(await instanceState(s.instanceId)).toBe('paused');
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'active' WHERE id = $1`, [s.instanceId]);
      expect((await approveWithPasskey(ORG_A, s.secondTask, s.actor)).ok).toBe(true);
      expect((await dispatchTask(s.secondTask)).outcome).toBe('blocked_governance');
      expect(sent.length - before).toBe(0);

      // Termination restored: the canonical restriction alone ends the run.
      (journeyExit.exitJourney as jest.Mock).mockRestore();
      const ended = await sweep();
      expect(ended.decisions.find((d: { decision: string }) => d.decision === 'exited')).toMatchObject({ outcome: 'complained' });
      expect(await instanceState(s.instanceId)).toBe('cancelled');
      expect(sent.length - before).toBe(0);
    });
  });
});

describe('D-1 — the D-03 hold bypassed: a paused run still fails governance', () => {
  it('control: the hold defers; hold forced off: governance blocks; provider calls 0', async () => {
    await inRollback(async () => {
      const s = await suspended();
      expect((await complaint(s.messageId)).status).toBe('processed');
      // An approval the person could have given before the complaint arrived.
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'active' WHERE id = $1`, [s.instanceId]);
      expect((await approveWithPasskey(ORG_A, s.secondTask, s.actor)).ok).toBe(true);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'paused' WHERE id = $1`, [s.instanceId]);
      const before = sent.length;
      expect((await dispatchTask(s.secondTask)).outcome).toBe('deferred_journey');
      jest.spyOn(emailContext, 'resolveJourneyHold').mockResolvedValue(null);
      const forced = await dispatchTask(s.secondTask);
      expect(forced.outcome).toBe('blocked_governance');
      expect(sent.length - before).toBe(0);
      expect(await instanceState(s.instanceId)).toBe('paused');
    });
  });
});

describe('D-2 — a NEW journey for a restricted person is refused at dispatch', () => {
  it.each([
    ['complaint', '*', 'webhook:ses'],
    ['unsubscribe', 'email', 'outreach_unsubscribe_link'],
    ['bounce_hard', 'email', 'webhook:ses'],
  ])('%s: approved new task → dispatch blocked_governance; the sweep sends nothing either', async (type, channel, source) => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      mockActor.id = actor;
      const address = `d2-${type}@example.test`;
      const { prospectId, personId } = await newProspect(ORG_A, { email: address });
      await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: NOW() });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro')] });
      await sweep();
      const [task] = await handoffTasks(instanceId);
      expect((await approveWithPasskey(ORG_A, task.id, actor)).ok).toBe(true);
      await recordContactGovernance({
        organizationId: ORG_A, governanceType: type, channel, personId: type === 'complaint' ? personId : null, target: address, source, evidence: {},
      });
      ws3.__clearTransportsForTests();
      ws3.registerDefaultTransports({ emailProvider: provider });
      const r = await ws3.dispatchInternalOutreachTask(ORG_A, task.id, { recipient: address });
      expect(r.outcome).toBe('blocked_governance');
      await sweep();
      await sweep();
      expect(sent).toHaveLength(0);
    });
  });
});

describe('RV-1 — a revocation pauses the run; the resume never revives the revoked approval', () => {
  it('revoke → paused (needs_human approval_revoked:…) → resume → the revoked step is skipped, nothing sent without a fresh approval', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      mockActor.id = actor;
      const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
      await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: NOW() });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro'), emailStep('next')] });
      await sweep();
      const [task] = await handoffTasks(instanceId);
      expect((await approveWithPasskey(ORG_A, task.id, actor)).ok).toBe(true);
      expect((await revokeOutreachApproval(ORG_A, task.id, { approverUserId: actor, tier: 'tenant' })).ok).toBe(true);

      const r = await sweep();
      expect(r.counters.journeys_suspended).toBe(1);
      expect(await instanceState(instanceId)).toBe('paused');
      const suspension = (await decisionsOf(instanceId)).find((d) => d.decision === 'needs_human');
      expect(String(suspension?.outcome)).toMatch(/^approval_revoked:[0-9a-f]{32}$/);
      expect(sent).toHaveLength(0);
      // Paused: repeated sweeps add nothing.
      await sweep();
      expect((await decisionsOf(instanceId)).filter((d) => d.decision === 'needs_human')).toHaveLength(1);

      expect((await patchRun(instanceId, { lifecycleState: 'active' })).status).toBe(200);
      const resumed = await sweep();
      expect(resumed.counters.journeys_suspended).toBe(0);
      expect((await decisionsOf(instanceId)).some((d) => d.decision === 'skipped' && d.outcome === 'approval_revoked_reviewed')).toBe(true);
      // The revoked task stays cancelled and cannot be sent; the next step waits for a fresh approval.
      expect((await handoffTasks(instanceId)).find((t) => t.id === task.id)!.status).toBe('cancelled');
      expect((await dispatchTask(String(task.id))).outcome).not.toBe('sent');
      await sweep();
      await sweep();
      const statuses = (await handoffTasks(instanceId)).map((t) => t.status);
      expect(statuses).toEqual(['cancelled', 'awaiting_approval']);
      expect(sent).toHaveLength(0);
    });
  });

  it('an ordinary cancellation (no revoked row) is still a skip; the run is not paused', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['email']);
      const actor = await newUser();
      mockActor.id = actor;
      const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro'), emailStep('next')] });
      await sweep();
      const [task] = await handoffTasks(instanceId);
      await db.query(`UPDATE public.outreach_tasks SET status = 'cancelled' WHERE id = $1`, [task.id]);
      const r = await sweep();
      expect(r.counters.journeys_suspended).toBe(0);
      expect(await instanceState(instanceId)).toBe('active');
      expect((await decisionsOf(instanceId)).some((d) => d.decision === 'skipped' && d.outcome === 'cancelled')).toBe(true);
    });
  });
});

// ── not_before (20270127000000) ──────────────────────────────────────────────

const MIGRATION = path.resolve(__dirname, '../../../supabase/migrations/20270127000000_execution_step_not_before.sql');
const ROLLBACK = path.resolve(__dirname, '../../../supabase/migrations/rollbacks/execution_step_not_before_rollback.sql');
const privileges = async () => JSON.stringify(await rows(`
  SELECT (SELECT json_agg(json_build_object('g', grantee, 'p', privilege_type) ORDER BY grantee, privilege_type)
            FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'execution_plan_steps') grants,
         (SELECT json_agg(json_build_object('n', policyname, 'r', roles::text, 'c', cmd, 'q', qual, 'w', with_check) ORDER BY policyname)
            FROM pg_policies WHERE schemaname = 'public' AND tablename = 'execution_plan_steps') policies,
         (SELECT json_build_object('rls', relrowsecurity, 'force', relforcerowsecurity) FROM pg_class WHERE oid = 'public.execution_plan_steps'::regclass) rls,
         (SELECT json_agg(json_build_object('r', r.rolname, 'p', has_function_privilege(r.rolname, 'public.advance_execution_plan(uuid, uuid)', 'EXECUTE')) ORDER BY r.rolname)
            FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')) fn`));
const notBeforeColumn = () => rows(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'execution_plan_steps' AND column_name = 'not_before'`);

describe('NB — the migration: apply, rollback, reapply; grants, policies and RLS unchanged', () => {
  it('forward is in the template; rollback removes exactly it; reapply restores it; privileges identical throughout', async () => {
    await inRollback(async () => {
      expect(await notBeforeColumn()).toHaveLength(1);
      const withIt = await privileges();
      await db.query(fs.readFileSync(ROLLBACK, 'utf8').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, ''));
      expect(await notBeforeColumn()).toHaveLength(0);
      expect(String((await one(`SELECT pg_get_functiondef('public.advance_execution_plan(uuid, uuid)'::regprocedure) d`)).d)).not.toMatch(/not_before/);
      expect(await rows(`SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_execution_plan_steps_not_before%'`)).toHaveLength(0);
      expect(await privileges()).toBe(withIt);
      await db.query(fs.readFileSync(MIGRATION, 'utf8'));
      expect(await notBeforeColumn()).toHaveLength(1);
      expect(await privileges()).toBe(withIt);
      // Re-run safety: the forward migration applied twice is the same schema.
      await db.query(fs.readFileSync(MIGRATION, 'utf8'));
      expect(await privileges()).toBe(withIt);
    });
  });

  it('the database keeps it later-only, never past, never on a settled step, never on insert', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['internal']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, { email: 'nb@example.test' });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('a', 'internal'), humanStep('b', 'internal')] });
      const steps = await rows(`SELECT s.* FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id WHERE p.execution_instance_id = $1 ORDER BY s.step_order`, [instanceId]);
      const b = String(steps[1].id);
      expect(await attempt(`UPDATE public.execution_plan_steps SET not_before = now() + interval '2 days' WHERE id = $1`, [b])).toBe('ok');
      await db.query(`UPDATE public.execution_plan_steps SET not_before = now() + interval '2 days' WHERE id = $1`, [b]);
      expect(await attempt(`UPDATE public.execution_plan_steps SET not_before = now() + interval '1 day' WHERE id = $1`, [b])).toBe('23514');
      expect(await attempt(`UPDATE public.execution_plan_steps SET not_before = NULL WHERE id = $1`, [b])).toBe('23514');
      expect(await attempt(`UPDATE public.execution_plan_steps SET not_before = now() + interval '3 days' WHERE id = $1`, [b])).toBe('ok');
      // The application path: an earlier value leaves it as it is (greatest, never a replacement).
      const later = new Date((await one(`SELECT not_before FROM public.execution_plan_steps WHERE id = $1`, [b])).not_before as string).getTime();
      const kept = await deferStepUntil({ organizationId: ORG_A, stepId: b, notBefore: new Date(Date.now() + 3_600_000).toISOString() });
      expect(Date.parse(String(kept.notBefore))).toBe(later);
      expect(new Date((await one(`SELECT not_before FROM public.execution_plan_steps WHERE id = $1`, [b])).not_before as string).getTime()).toBe(later);
      const a = String(steps[0].id);
      expect(await attempt(`UPDATE public.execution_plan_steps SET not_before = now() - interval '1 hour' WHERE id = $1`, [a])).toBe('23514');
      await db.query(`UPDATE public.execution_plan_steps SET state = 'ready' WHERE id = $1 AND state = 'pending'`, [a]);
      await db.query(`UPDATE public.execution_plan_steps SET state = 'skipped' WHERE id = $1`, [a]);
      expect(await attempt(`UPDATE public.execution_plan_steps SET not_before = now() + interval '1 day' WHERE id = $1`, [a])).toBe('23514');
      expect(await attempt(`INSERT INTO public.execution_plan_steps (organization_id, plan_id, step_key, step_order, channel, instruction, delay_after_previous_hours, not_before)
        SELECT organization_id, plan_id, 'z', 99, 'internal', null, 0, now() + interval '1 day' FROM public.execution_plan_steps WHERE id = $1`, [a])).toBe('23514');
    });
  });

  it('advance_execution_plan does not make a step ready before not_before; the control (no floor) does', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['internal']);
      const actor = await newUser();
      const done = { engine: 'ws3', channels: ['internal'], execute: async () => ({ engine: 'ws3', outcome: 'sent', disposition: 'completed', reason: null, externalRef: null }) };
      for (const floor of [true, false]) {
        const { prospectId } = await newProspect(ORG_A, { email: `adv-${floor}@example.test` });
        const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('a', 'internal'), humanStep('b', 'internal')] });
        const steps = await rows(`SELECT s.id FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id WHERE p.execution_instance_id = $1 ORDER BY s.step_order`, [instanceId]);
        if (floor) await db.query(`UPDATE public.execution_plan_steps SET not_before = now() + interval '1 day' WHERE id = $1`, [steps[1].id]);
        await sweep([done]);   // a: ready → completed
        await sweep([done]);   // b: due by its delay
        const b = await one(`SELECT state FROM public.execution_plan_steps WHERE id = $1`, [steps[1].id]);
        expect(b.state).toBe(floor ? 'pending' : 'completed');
      }
    });
  });
});

describe('NB — the human-review fallback with a date (PATCH resume with returnDate)', () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it('a future date retimes the step through the engine, persists not_before, resumes; the step waits; provider calls 0', async () => {
    await inRollback(async () => {
      const s = await suspended();
      await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'Europe/London') ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
      const date = inDays(10);
      const out = await patchRun(s.instanceId, { lifecycleState: 'active', returnDate: { kind: 'date', date } });
      expect(out.status).toBe(200);
      expect(await instanceState(s.instanceId)).toBe('active');
      const step = await one(`SELECT s.not_before FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id
        WHERE p.execution_instance_id = $1 AND s.state = 'ready'`, [s.instanceId]);
      expect(Date.parse(String(new Date(step.not_before as string).toISOString()))).toBe(Date.parse(String(out.json.notBefore)));
      expect(Date.parse(String(out.json.notBefore))).toBeGreaterThan(Date.now() + 9 * 86_400_000);
      const before = sent.length;
      expect((await approveWithPasskey(ORG_A, s.secondTask, s.actor)).ok).toBe(true);
      const r = await sweep();
      expect(r.decisions.some((d: { outcome: string }) => d.outcome === 'not_before')).toBe(true);
      expect(sent.length - before).toBe(0);
    });
  });

  it.each([
    ['a past date', { kind: 'date', date: '2020-01-01' }, 400, 'return_date_in_past'],
    ['a past instant', { kind: 'instant', at: '2020-01-01T09:00:00Z' }, 400, 'return_date_in_past'],
    ['more than a year away', { kind: 'date', date: '2099-01-01' }, 400, 'return_date_too_far'],
    ['an unparseable date', { kind: 'date', date: 'next Monday' }, 400, 'invalid_return_date'],
    ['free text', 'back on the 30th', 400, 'invalid_return_date'],
    ['an instant with no offset', { kind: 'instant', at: '2030-01-01T09:00:00' }, 400, 'invalid_return_date'],
  ])('%s: refused, the run stays paused, nothing written or sent', async (_l, returnDate, status, code) => {
    await inRollback(async () => {
      const s = await suspended();
      await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'Europe/London') ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
      const before = sent.length;
      const out = await patchRun(s.instanceId, { lifecycleState: 'active', returnDate });
      expect(out.status).toBe(status);
      expect(out.json.code).toBe(code);
      expect(await instanceState(s.instanceId)).toBe('paused');
      expect(await rows(`SELECT 1 FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id WHERE p.execution_instance_id = $1 AND s.not_before IS NOT NULL`, [s.instanceId])).toHaveLength(0);
      expect(sent.length - before).toBe(0);
    });
  });

  it('only a paused run, and a deterministic answer recorded meanwhile wins (superseded, stays paused)', async () => {
    await inRollback(async () => {
      const s = await suspended();
      await db.query(`INSERT INTO public.company_scheduler_prefs (company_id, timezone) VALUES ($1, 'Europe/London') ON CONFLICT (company_id) DO UPDATE SET timezone = EXCLUDED.timezone`, [ORG_A]);
      expect((await ws3.ingestFeedback({ companyId: ORG_A, taskId: s.firstTask, signal: 'converted', occurredAt: NOW(), source: 'manual' })).ok).toBe(true);
      const out = await patchRun(s.instanceId, { lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(5) } });
      expect(out).toMatchObject({ status: 409, json: { code: 'superseded' } });
      expect(await instanceState(s.instanceId)).toBe('paused');
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'active' WHERE id = $1`, [s.instanceId]);
      expect((await patchRun(s.instanceId, { lifecycleState: 'active', returnDate: { kind: 'date', date: inDays(5) } }))).toMatchObject({ status: 409, json: { code: 'not_paused' } });
      expect((await patchRun(s.instanceId, { lifecycleState: 'cancelled', returnDate: { kind: 'date', date: inDays(5) } })).status).toBe(400);
    });
  });
});
