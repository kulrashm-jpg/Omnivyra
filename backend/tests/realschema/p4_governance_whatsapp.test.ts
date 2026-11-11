/**
 * Prompt 4 round 2 — governance precedence on the WhatsApp path, REAL PostgreSQL: the real
 * adapter, broadcast service and Meta webhook processor (Meta HTTP stubbed, as in
 * orch_engines_real.test.ts, whose fixtures this file repeats).
 *
 *   C-1  a STOP writes the restriction first, even when classification throws (a classifier
 *        double that throws; it is not on the path at all), when persisting the inbound
 *        message fails, and when the journey consequence (termination) throws; the engine's
 *        own send path still refuses — termination is never the only protection;
 *   G-1  a run suspended by a reply, then STOP, resumed through the route: the send is refused;
 *   D-2  a new journey for a STOPped person: nothing is sent.
 * Every test asserts the Meta call counter.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
import {
  decisions, enableOutreach, enrol, humanStep, instanceState, lifecycle, newProspect, newUser, one, rnd,
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
jest.mock('@/config', () => ({ config: { ENCRYPTION_KEY: 'a'.repeat(64) }, getValidatedConfig: () => ({}) }), { virtual: true });
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const mockRedis = {
  store: new Map<string, number>(),
  async incrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) + by; this.store.set(k, n); return n; },
  async decrby(k: string, by: number) { const n = (this.store.get(k) ?? 0) - by; this.store.set(k, n); return n; },
  async get(k: string) { const v = this.store.get(k); return v === undefined ? null : String(v); },
  async set(k: string, v: string) { this.store.set(k, Number(v)); return 'OK'; },
  async expire() { return 1; },
  async ttl() { return 60; },
};
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => mockRedis }));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
const mockJobs: Array<{ broadcast_id: string; recipient_ids: string[] }> = [];
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: { broadcast_id: string; recipient_ids: string[] }) => { mockJobs.push(data); },
}));
// No live batch jobs; the WhatsApp enqueue lease is a DELIBERATE NO-OP pass-through
// (always acquired), as in the other WhatsApp real-schema suites. Since the resume fix
// enqueueBroadcast takes the lease and counts live batch jobs first; without these the
// enqueue failed and every recipient stayed pending. Lease and live-job behaviour are
// covered by whatsappBroadcastResume.test.ts.
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({ getJobs: async () => [] }) }));
jest.mock('../../../lib/platform/distributedLock', () => ({
  // Every other export stays real; only the lease is a pass-through (55).
  ...jest.requireActual('../../../lib/platform/distributedLock'),
  withLease: async (_n: string, _t: number, fn: () => Promise<unknown>) => ({ ran: true, value: await fn() }),
}));

// Read once at module load by the broadcast service: a required production setting.
process.env.PHONE_HASH_SALT = 'test-salt';

/* eslint-disable @typescript-eslint/no-var-requires */
const { advanceAndDispatchWorkflowExecution } = require('../../services/workflowExecution/workflowProgressionSweeper');
const { createWhatsAppAdapter, defaultWhatsAppDeps } = require('../../services/orchestration/whatsappEngineAdapter');
const { createSocialPublishAdapter } = require('../../services/orchestration/socialPublishEngineAdapter');
const { processBatch } = require('../../services/whatsappBroadcastService');
const { processWhatsAppWebhookJob } = require('../../queue/jobProcessors/whatsappWebhookProcessor');
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');
/* eslint-enable @typescript-eslint/no-var-requires */

const PHONE = '+15551230001';
const WA_ID = '15551230001';
const PHONE_NUMBER_ID = 'pn-test-1';
const metaCalls: Array<{ url: string; to: unknown }> = [];
let metaBehaviour: 'ok' | 'network_error' = 'ok';

const realFetch = global.fetch;
beforeAll(() => {
  global.fetch = (async (url: string, init?: { body?: string }) => {
    if (metaBehaviour === 'network_error') throw new Error('socket hang up');
    metaCalls.push({ url: String(url), to: JSON.parse(String(init?.body ?? '{}')).to });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.${rnd()}` }] }), text: async () => '' };
  }) as unknown as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; });
beforeEach(() => { metaCalls.length = 0; mockJobs.length = 0; mockRedis.store.clear(); metaBehaviour = 'ok'; });

async function whatsappAccount(org: string): Promise<string> {
  const user = await newUser();
  const a = await one(`INSERT INTO public.social_accounts
    (user_id, platform, platform_user_id, account_name, access_token, company_id, phone_number_id, is_active)
    VALUES ($1,'whatsapp',$2,'wa','t',$3,$4,true) RETURNING id`, [user, rnd(), org, PHONE_NUMBER_ID]);
  return String(a.id);
}
async function approvedTemplate(org: string, account: string, name = 'hello_1'): Promise<void> {
  await db.query(`INSERT INTO public.whatsapp_templates (company_id, social_account_id, template_name, template_category, status, is_active, components)
    VALUES ($1,$2,$3,'MARKETING','APPROVED',true,'[]')`, [org, account, name]);
}
const wa = (key: string, template = 'hello_1') => humanStep(key, 'whatsapp', { whatsapp: { template_name: template } });
const sweep = (adapters: unknown[], org: string = ORG_A) =>
  advanceAndDispatchWorkflowExecution(org, { now: new Date().toISOString(), deps: { adapters } });
// Approval is injected: no WhatsApp approval record exists yet. The next describe proves the real default.
const waAdapters = () => [createWhatsAppAdapter({ ...defaultWhatsAppDeps, hasApproval: async () => true })];
const runQueuedJobs = async () => {
  for (const job of mockJobs.splice(0)) await processBatch(job.broadcast_id, job.recipient_ids);
};
const inbound = (text: string, id = `wamid.in.${rnd()}`) => ({
  entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: PHONE_NUMBER_ID },
    messages: [{ from: WA_ID, id, timestamp: String(Math.floor(Date.now() / 1000) + 5), text: { body: text } }],
  } }] }],
});
const recipientStatus = async (instanceId: string) => {
  const r = await one(`SELECT rc.status, rc.wa_message_id FROM public.execution_engine_requests q
    JOIN public.execution_tasks t ON t.id = q.execution_task_id
    JOIN public.whatsapp_broadcast_recipients rc ON rc.broadcast_id = q.external_ref::uuid
    WHERE t.execution_instance_id = $1`, [instanceId]);
  return r ?? null;
};
async function scene(steps: unknown[], person: { phone?: string; email?: string } = { phone: PHONE }) {
  await seedTenants();
  await enableOutreach(ORG_A, ['whatsapp']);
  const actor = await newUser();
  const account = await whatsappAccount(ORG_A);
  await approvedTemplate(ORG_A, account);
  const { prospectId, personId } = await newProspect(ORG_A, person);
  await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: new Date().toISOString() });
  const { instanceId, workflowId } = await enrol(ORG_A, actor, prospectId, { steps });
  return { actor, account, prospectId, personId, instanceId, workflowId };
}

// ── Prompt 4 round 2 additions (this file's own) ─────────────────────────────
const mockClassifier = { calls: 0 };
jest.mock('../../services/engagementClassification', () => ({
  classifyMessage: () => { mockClassifier.calls += 1; throw new Error('classifier down'); },
}));
const mockActor = { id: 'unset' };
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: mockActor.id })) }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: mockActor.id } })) }));
/* eslint-disable @typescript-eslint/no-var-requires */
const journeyExit = require('../../services/orchestration/journeyExit');
const instanceRoute = require('../../../pages/api/execution-instances/[id]').default;
const supabaseModule = require('../../db/supabaseClient');
/* eslint-enable @typescript-eslint/no-var-requires */

afterEach(() => { jest.restoreAllMocks(); });

const stopCount = async () => Number((await one(`SELECT count(*) n FROM public.contact_governance_records
  WHERE organization_id = $1 AND governance_type = 'unsubscribe' AND channel = 'whatsapp' AND revoked_at IS NULL`, [ORG_A])).n);
/** The follow-up step handed straight to the real WhatsApp adapter: the engine's own send path, no sweeper gate in front. */
async function sendFollowupDirectly(instanceId: string, prospectId: string, personId: string) {
  const t = await one(`SELECT t.id, t.plan_step_id FROM public.execution_tasks t JOIN public.execution_plan_steps s ON s.id = t.plan_step_id
    WHERE t.execution_instance_id = $1 AND s.step_key = 'followup'`, [instanceId]);
  const adapter = waAdapters()[0];
  const r = await adapter.execute({
    organizationId: ORG_A, executionInstanceId: instanceId, executionTaskId: String(t.id), planStepId: String(t.plan_step_id),
    channel: 'whatsapp', subject: { kind: 'prospect', id: prospectId }, step: wa('followup'), personId, now: new Date().toISOString(),
  });
  await runQueuedJobs();
  const rc = await one(`SELECT rc.status FROM public.execution_engine_requests q
    JOIN public.whatsapp_broadcast_recipients rc ON rc.broadcast_id = q.external_ref::uuid
    WHERE q.execution_task_id = $1`, [t.id]);
  return { result: r, recipientStatus: rc ? String(rc.status) : null };
}
function patchRun(id: string, body: Record<string, unknown>) {
  const out: { status: number } = { status: 0 };
  const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json() { return res; }, end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined };
  const req = { method: 'PATCH', query: { id, company_id: ORG_A }, body, headers: {}, url: `/api/execution-instances/${id}` };
  return Promise.resolve(instanceRoute(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

describe('control — the direct send path really sends when nothing restricts the person', () => {
  it('no STOP: the follow-up handed to the engine reaches Meta (so a 0 below is a refusal, not a broken helper)', async () => {
    await inRollback(async () => {
      const s = await scene([wa('intro'), wa('followup')]);
      await sweep(waAdapters());
      await runQueuedJobs();
      await sweep(waAdapters());
      const before = metaCalls.length;
      const direct = await sendFollowupDirectly(s.instanceId, s.prospectId, String(s.personId));
      expect(direct.recipientStatus).toBe('sent');
      expect(metaCalls.length - before).toBe(1);
    });
  });
});

describe('C-1 — a WhatsApp STOP: the restriction is written first, whatever else fails', () => {
  it('classification throws, then the consequence write throws: the restriction stands and no follow-up leaves (Meta calls unchanged)', async () => {
    await inRollback(async () => {
      const s = await scene([wa('intro'), wa('followup')]);
      await sweep(waAdapters());
      await runQueuedJobs();
      await sweep(waAdapters());
      expect(metaCalls).toHaveLength(1);
      await processWhatsAppWebhookJob({ data: { payload: inbound('STOP') } });
      expect(await stopCount()).toBe(1);
      expect(mockClassifier.calls).toBe(0);              // no classifier stands on the opt-out path at all

      jest.spyOn(journeyExit, 'exitJourney').mockRejectedValue(Object.assign(new Error('forced'), { code: 'forced_exit_failure' }));
      const failed = await sweep(waAdapters());
      expect(failed.counters.errors).toBeGreaterThan(0);
      expect(await instanceState(s.instanceId)).toBe('active');
      expect(await stopCount()).toBe(1);
      // Termination failed: the engine's own send path still refuses.
      const direct = await sendFollowupDirectly(s.instanceId, s.prospectId, String(s.personId));
      expect(direct.recipientStatus).toBe('blocked_governance');
      expect(metaCalls).toHaveLength(1);
    });
  });

  it('restriction first: the opt-out is recorded even when persisting the inbound message fails', async () => {
    await inRollback(async () => {
      await scene([wa('intro')]);
      await sweep(waAdapters());
      await runQueuedJobs();
      const realFrom = supabaseModule.supabase.from;
      jest.spyOn(supabaseModule.supabase, 'from').mockImplementation(((t: string) => {
        if (t === 'engagement_threads' || t === 'engagement_messages') throw new Error('forced thread/message write failure');
        return realFrom(t);
      }) as never);
      await processWhatsAppWebhookJob({ data: { payload: inbound('STOP') } }).catch(() => undefined);
      expect(await stopCount()).toBe(1);
    });
  });
});

describe('G-1 (WhatsApp) — a suspended run + STOP, resumed through the route: the send is refused', () => {
  it('reply suspends → STOP → resume → the follow-up is blocked by governance; Meta calls unchanged; the next sweep ends the run', async () => {
    await inRollback(async () => {
      const s = await scene([wa('intro'), wa('followup')]);
      mockActor.id = s.actor;
      await sweep(waAdapters());
      await runQueuedJobs();
      await sweep(waAdapters());
      await processWhatsAppWebhookJob({ data: { payload: inbound('later please') } });
      await sweep(waAdapters());
      expect(await instanceState(s.instanceId)).toBe('paused');
      await processWhatsAppWebhookJob({ data: { payload: inbound('STOP') } });
      expect((await patchRun(s.instanceId, { lifecycleState: 'active' })).status).toBe(200);
      const before = metaCalls.length;
      const direct = await sendFollowupDirectly(s.instanceId, s.prospectId, String(s.personId));
      expect(direct.recipientStatus).toBe('blocked_governance');
      expect(metaCalls.length - before).toBe(0);
      const r = await sweep(waAdapters());
      expect(r.decisions.find((d: { decision: string }) => d.decision === 'exited')).toMatchObject({ outcome: 'unsubscribed' });
      expect(metaCalls.length - before).toBe(0);
    });
  });
});

describe('D-2 (WhatsApp) — a NEW journey for a STOPped person is refused at send', () => {
  it('opt-out first, then enrol: the engine refuses, the sweep sends nothing', async () => {
    await inRollback(async () => {
      const s = await scene([wa('intro'), wa('followup')]);
      await processWhatsAppWebhookJob({ data: { payload: inbound('STOP') } });
      expect(await stopCount()).toBe(1);
      const direct = await sendFollowupDirectly(s.instanceId, s.prospectId, String(s.personId));
      expect(direct.recipientStatus).toBe('blocked_governance');
      await sweep(waAdapters());
      await runQueuedJobs();
      await sweep(waAdapters());
      await runQueuedJobs();
      expect(metaCalls).toHaveLength(0);
    });
  });
});
