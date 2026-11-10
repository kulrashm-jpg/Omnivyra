/**
 * ORCHESTRATION — the engines themselves, on REAL PostgreSQL.
 *
 * WhatsApp: the real adapter, the real broadcast service (create, expand, enqueue,
 * processBatch) and the real Meta webhook processor. Replaced, and named so nobody reads
 * this as a provider integration test: `fetch` to Meta, the access-token lookup, the
 * queue, and the Redis counter. No message leaves the process.
 *
 * Social publish: the real adapter reading real scheduled_posts rows. It only observes;
 * no publish is exercised, because it has no publish path.
 *
 * Community: the real adapter and link store on the real schema. `executeAction`, which
 * would call a platform, is replaced in the one test that reaches it.
 *
 * Browser: claims no channel, and a channel with no engine stays visibly unsupported.
 */

import { attempt, db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
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
/** RUL-C: the queue keeps the job but its acknowledgement is lost (the add throws). */
const mockQueueAck = { lost: false };
jest.mock('../../middleware/queueBackpressure', () => ({
  enqueueOrThrow: async (_q: unknown, _n: unknown, _j: unknown, data: { broadcast_id: string; recipient_ids: string[] }) => {
    mockJobs.push(data);
    if (mockQueueAck.lost) throw new Error('Connection is closed.');
  },
}));
jest.mock('../../queue/contentGenerationQueues', () => ({ getContentQueue: () => ({}) }));

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
beforeEach(() => { metaCalls.length = 0; mockJobs.length = 0; mockRedis.store.clear(); metaBehaviour = 'ok'; mockQueueAck.lost = false; });

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

describe('WhatsApp engine, the controls that stand before any broadcast', () => {
  it('with the real default, no execution mode sends: not human, not assisted, not autonomous', async () => {
    for (const mode of ['human', 'assisted', 'autonomous']) {
      await inRollback(async () => {
        const { instanceId } = await scene([humanStep('intro', 'whatsapp', { execution_mode: mode, whatsapp: { template_name: 'hello_1' } })]);
        const r = await sweep([createWhatsAppAdapter()]);
        expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'approval_required' });
        expect(mockJobs).toHaveLength(0);
        expect(metaCalls).toHaveLength(0);
        expect(Number((await one('SELECT count(*) n FROM public.whatsapp_broadcasts')).n)).toBe(0);
        expect(await instanceState(instanceId)).toBe('active');
      });
    }
  });

  it.each([
    ['tenant_kill_switch', 'UPDATE public.outreach_governance_config SET kill_switch = true WHERE company_id = $1'],
    ['channel_not_enabled', "UPDATE public.outreach_governance_config SET enabled_channels = '{email}' WHERE company_id = $1"],
    ['tenant_not_enabled', 'UPDATE public.outreach_governance_config SET enabled = false WHERE company_id = $1'],
  ])('%s stops it even when approved', async (code, sql) => {
    await inRollback(async () => {
      await scene([wa('intro')]);
      await db.query(sql, [ORG_A]);
      // The central gate holds the step and it stays eligible once the control clears.
      const held = await sweep(waAdapters());
      expect(held.decisions[0]).toMatchObject({ decision: 'waiting', outcome: code });
      // The engine's own gate still stands behind it: not a second authority, but not removed.
      const r = await advanceAndDispatchWorkflowExecution(ORG_A, { now: new Date().toISOString(), deps: { adapters: waAdapters(), channelGate: async () => null } });
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: code });
      expect(mockJobs).toHaveLength(0);
      expect(Number((await one('SELECT count(*) n FROM public.whatsapp_broadcasts')).n)).toBe(0);
    });
  });
});

describe('WhatsApp engine, real service and webhook processor; Meta HTTP stubbed', () => {
  it('sends once through the real queue path, survives a job retry, and settles on the engine\'s own record', async () => {
    await inRollback(async () => {
      const { instanceId, personId } = await scene([wa('intro')]);

      let r = await sweep(waAdapters());
      expect(r.issues).toEqual([]);
      expect(r.counters.tasks_waiting).toBe(1);
      expect(metaCalls).toHaveLength(0);                    // the sweep never sends; only the queue does
      expect(mockJobs).toHaveLength(1);
      // The journey recipient carries its canonical person, for send-time person-level restrictions.
      const recipients = await db.query(`SELECT rc.person_id FROM public.execution_engine_requests q
        JOIN public.execution_tasks t ON t.id = q.execution_task_id
        JOIN public.whatsapp_broadcast_recipients rc ON rc.broadcast_id = q.external_ref::uuid
        WHERE t.execution_instance_id = $1`, [instanceId]);
      expect(recipients.rows).toEqual([{ person_id: personId }]);
      const job = { ...mockJobs[0] };

      await runQueuedJobs();
      expect(metaCalls).toEqual([{ url: expect.stringContaining(`/${PHONE_NUMBER_ID}/messages`), to: expect.stringContaining('15551230001') }]);

      // A BullMQ retry of the same batch cannot message them twice.
      await processBatch(job.broadcast_id, job.recipient_ids);
      expect(metaCalls).toHaveLength(1);

      r = await sweep(waAdapters());
      expect(r.counters.steps_settled).toBe(1);
      expect((await recipientStatus(instanceId))?.status).toBe('sent');
      r = await sweep(waAdapters());
      expect(mockJobs).toHaveLength(0);                     // no second broadcast
      expect(await instanceState(instanceId)).toBe('completed');
      expect((await decisions(instanceId)).map((d) => d.decision)).toEqual(expect.arrayContaining(['waiting', 'executed']));
    });
  });

  it('a delivery webhook moves the real recipient row through the real processor', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro')]);
      await sweep(waAdapters());
      await runQueuedJobs();
      const before = await recipientStatus(instanceId);
      await processWhatsAppWebhookJob({ data: { payload: { entry: [{ changes: [{ field: 'messages', value: {
        statuses: [{ id: before?.wa_message_id, status: 'delivered' }],
      } }] }] } } });
      expect((await recipientStatus(instanceId))?.status).toBe('delivered');
    });
  });

  it('a real inbound reply, persisted by the real processor, suspends the journey and reaches PI not at all (X-3)', async () => {
    await inRollback(async () => {
      const { instanceId, prospectId } = await scene([wa('intro'), wa('followup')]);
      await sweep(waAdapters());
      await runQueuedJobs();
      await sweep(waAdapters());                            // intro settled
      await processWhatsAppWebhookJob({ data: { payload: inbound('yes, tell me more') } });
      expect(Number((await one(`SELECT count(*) n FROM public.engagement_messages WHERE direction = 'inbound' AND content = 'yes, tell me more'`)).n)).toBe(1);

      const r = await sweep(waAdapters());
      // Prompt 4 — CHANGED: the reply suspends the journey for a person; no follow-up.
      expect(r.counters).toMatchObject({ journeys_exited: 0, journeys_suspended: 1 });
      expect(await instanceState(instanceId)).toBe('paused');
      expect(metaCalls).toHaveLength(1);                    // no follow-up
      // X-3 (Prompt 5) — CHANGED: was `{ state: 'engaged', evidence_kind: 'engagement_thread' }`.
      // An unclassified inbound is not engagement: PI's ledger is where the scene left it.
      const ledger = await lifecycle(ORG_A, prospectId);
      expect(ledger.at(-1)).toMatchObject({ state: 'identified' });
      expect(ledger.some((row) => row.state === 'engaged' || row.evidence_kind === 'engagement_thread')).toBe(false);
      expect(r.counters.lifecycle_transitions_written).toBe(0);
    });
  });

  it('a STOP is an opt-out, not engagement: contact stops, governance is written, PI closes the prospect', async () => {
    await inRollback(async () => {
      const { instanceId, prospectId } = await scene([wa('intro'), wa('followup')]);
      await sweep(waAdapters());
      await runQueuedJobs();
      await sweep(waAdapters());
      await processWhatsAppWebhookJob({ data: { payload: inbound('STOP') } });
      expect(Number((await one(`SELECT count(*) n FROM public.contact_governance_records WHERE organization_id = $1 AND governance_type = 'unsubscribe' AND channel = 'whatsapp'`, [ORG_A])).n)).toBe(1);

      const r = await sweep(waAdapters());
      expect(r.counters.journeys_exited).toBe(1);
      expect(metaCalls).toHaveLength(1);
      const exited = (await decisions(instanceId)).find((d) => d.decision === 'exited');
      expect(exited?.outcome).toBe('unsubscribed');
      const state = (await lifecycle(ORG_A, prospectId)).at(-1);
      expect(state?.state).toBe('closed_disqualified');
    });
  });

  it('an opt-out recorded after queuing is honoured at send time by the engine', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro')]);
      await sweep(waAdapters());
      await processWhatsAppWebhookJob({ data: { payload: inbound('STOP') } });
      await runQueuedJobs();
      expect(metaCalls).toHaveLength(0);
      expect((await recipientStatus(instanceId))?.status).toBe('blocked_governance');
    });
  });

  it('a kill switch thrown after queuing stops the send, and the journey does not complete', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro')]);
      await sweep(waAdapters());
      await db.query('UPDATE public.outreach_governance_config SET kill_switch = true WHERE company_id = $1', [ORG_A]);
      await runQueuedJobs();
      expect(metaCalls).toHaveLength(0);
      expect((await recipientStatus(instanceId))?.status).toBe('blocked_send_control');

      await db.query('UPDATE public.outreach_governance_config SET kill_switch = false WHERE company_id = $1', [ORG_A]);
      await sweep(waAdapters());
      expect(await instanceState(instanceId)).toBe('active');
      expect(metaCalls).toHaveLength(0);
    });
  });

  it('a reply received after queuing stops the send, and the next sweep ends the journey', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro')]);
      await sweep(waAdapters());
      await processWhatsAppWebhookJob({ data: { payload: inbound('yes, tell me more') } });
      await runQueuedJobs();
      expect(metaCalls).toHaveLength(0);
      expect((await recipientStatus(instanceId))?.status).toBe('blocked_send_control');

      const r = await sweep(waAdapters());
      // Prompt 4 — CHANGED: suspended for a person, not ended.
      expect(r.counters).toMatchObject({ journeys_exited: 0, journeys_suspended: 1 });
      expect(await instanceState(instanceId)).toBe('paused');
    });
  });

  it('a send whose result is unknown is never retried, and goes to a person', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro')]);
      await sweep(waAdapters());
      const job = { ...mockJobs[0] };
      metaBehaviour = 'network_error';
      await runQueuedJobs().catch(() => undefined);
      metaBehaviour = 'ok';
      expect((await recipientStatus(instanceId))?.status).toBe('send_uncertain');

      await processBatch(job.broadcast_id, job.recipient_ids).catch(() => undefined);
      expect(metaCalls).toHaveLength(0);

      const r = await sweep(waAdapters());
      expect(r.counters.tasks_needing_human).toBe(1);
      expect(await instanceState(instanceId)).toBe('active');
    });
  });

  it('RUL-C: a lost queue acknowledgement the engine cannot withdraw is uncertain on the real ledger, never failed; it sends once at most', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro')]);
      // Inside this transaction only: the engine's withdrawal write is refused, so it cannot
      // tell whether the queue kept the batch (WhatsAppEnqueueUncertainError).
      await db.query(`CREATE FUNCTION public.rulc_refuse_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          IF NEW.error_message LIKE 'enqueue_unconfirmed:%' THEN RAISE EXCEPTION 'withdrawal refused (test)'; END IF;
          RETURN NEW;
        END $f$`);
      await db.query(`CREATE TRIGGER rulc_refuse_withdrawal BEFORE UPDATE ON public.whatsapp_broadcast_recipients
        FOR EACH ROW EXECUTE FUNCTION public.rulc_refuse_withdrawal()`);
      mockQueueAck.lost = true;

      const r = await sweep(waAdapters());
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'uncertain' });
      const req = await one(`SELECT q.id, q.state, q.external_ref, q.detail FROM public.execution_engine_requests q
        JOIN public.execution_tasks t ON t.id = q.execution_task_id WHERE t.execution_instance_id = $1`, [instanceId]);
      expect(req).toMatchObject({ state: 'uncertain', detail: expect.stringMatching(/^whatsapp_enqueue_uncertain: /) });
      expect(req!.external_ref).toEqual(expect.any(String));
      expect((await recipientStatus(instanceId))?.status).toBe('pending');      // not withdrawn: the kept job may send it
      const job = { ...mockJobs[0] };

      // The real guard: a settled request never moves, so nothing can put it back in play.
      expect(await attempt(`UPDATE public.execution_engine_requests SET state = 'requested' WHERE id = $1`, [req!.id])).toBe('23514');
      expect(await attempt(`UPDATE public.execution_engine_requests SET state = 'failed' WHERE id = $1`, [req!.id])).toBe('23514');

      // The queue recovers. Sweeps never create or enqueue a second batch.
      mockQueueAck.lost = false;
      mockJobs.length = 0;
      for (let i = 0; i < 2; i += 1) {
        const again = await sweep(waAdapters());
        expect(again.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'uncertain' });
      }
      expect(mockJobs).toHaveLength(0);
      const broadcasts = await one(`SELECT count(*)::int AS n FROM public.whatsapp_broadcasts WHERE company_id = $1`, [ORG_A]);
      expect(broadcasts!.n).toBe(1);

      // The job the queue did keep sends exactly once, through a BullMQ retry too.
      await processBatch(job.broadcast_id, job.recipient_ids);
      await processBatch(job.broadcast_id, job.recipient_ids);
      expect(metaCalls).toHaveLength(1);
      expect((await recipientStatus(instanceId))?.status).toBe('sent');
      // No request-level reconciler exists: the step stays with a person (C-5/C-6 are not built).
      expect((await sweep(waAdapters())).decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'uncertain' });
      expect(await instanceState(instanceId)).toBe('active');
    });
  });

  it('RUL-C: a lost acknowledgement whose recipients are withdrawn stays failed on the real ledger; the kept job sends nothing', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro')]);
      mockQueueAck.lost = true;
      const r = await sweep(waAdapters());
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'submit_failed' });
      const req = await one(`SELECT q.state FROM public.execution_engine_requests q
        JOIN public.execution_tasks t ON t.id = q.execution_task_id WHERE t.execution_instance_id = $1`, [instanceId]);
      expect(req).toMatchObject({ state: 'failed' });
      expect((await recipientStatus(instanceId))?.status).toBe('failed');
      await runQueuedJobs();
      expect(metaCalls).toHaveLength(0);
    });
  });

  it('Follow-up D: an uncertain send in one journey holds another journey for the same person for the policy gap, on the real schema', async () => {
    await inRollback(async () => {
      const a = await scene([wa('intro')]);
      await sweep(waAdapters());
      metaBehaviour = 'network_error';
      await runQueuedJobs().catch(() => undefined);
      metaBehaviour = 'ok';
      expect((await recipientStatus(a.instanceId))?.status).toBe('send_uncertain');
      const settled = await sweep(waAdapters());
      expect(settled.decisions.find((d: { executionInstanceId: string }) => d.executionInstanceId === a.instanceId))
        .toMatchObject({ decision: 'needs_human', outcome: 'send_uncertain' });
      const reqA = await one(`SELECT q.state, q.updated_at FROM public.execution_engine_requests q
        JOIN public.execution_tasks t ON t.id = q.execution_task_id WHERE t.execution_instance_id = $1`, [a.instanceId]);
      expect(reqA).toMatchObject({ state: 'uncertain' });

      // A second journey (another campaign and workflow) for the same person, with a 24h gap.
      const b = await enrol(ORG_A, a.actor, a.prospectId, { policy: { min_hours_between_actions: 24 }, steps: [wa('follow')] });
      const at = (h: number) => new Date(new Date(String(reqA!.updated_at)).getTime() + h * 3600_000).toISOString();
      const sweepAt = (h: number) => advanceAndDispatchWorkflowExecution(ORG_A, { now: at(h), deps: { adapters: waAdapters() } });
      const of = (r: { decisions: Array<{ executionInstanceId: string; reasons: string[] }> }, id: string) => r.decisions.find((d) => d.executionInstanceId === id);

      mockJobs.length = 0;
      const r1 = await sweepAt(1);
      expect(of(r1, b.instanceId)).toMatchObject({ decision: 'deferred' });
      expect(of(r1, b.instanceId)!.reasons.join(' ')).toMatch(/unconfirmed: it may have been sent/);
      // Journey A is not deferred by its own uncertain send: it still goes to a person.
      expect(of(r1, a.instanceId)).toMatchObject({ decision: 'needs_human' });
      expect(mockJobs).toHaveLength(0);
      expect(metaCalls).toHaveLength(0);

      const r2 = await sweepAt(25);
      expect(of(r2, b.instanceId)).toMatchObject({ decision: 'waiting', outcome: 'submitted' });
      expect(mockJobs).toHaveLength(1);
      // Nothing was read as sent: A's request and recipient are unchanged.
      expect((await one(`SELECT q.state FROM public.execution_engine_requests q
        JOIN public.execution_tasks t ON t.id = q.execution_task_id WHERE t.execution_instance_id = $1`, [a.instanceId]))).toMatchObject({ state: 'uncertain' });
      expect((await recipientStatus(a.instanceId))?.status).toBe('send_uncertain');
    });
  });

  it('D-2: two journeys due in the same sweep for one person: one is queued, the other waits the gap; counted once after the send, on the real schema', async () => {
    await inRollback(async () => {
      const gap = { policy: { min_hours_between_actions: 24 } };
      // Run A only sets the tenant up (an internal step: not contact, no policy). B and C are
      // two WhatsApp journeys for the same person, each with a 24h gap.
      const a = await scene([humanStep('prep', 'internal')]);
      const b = await enrol(ORG_A, a.actor, a.prospectId, { ...gap, steps: [wa('second')] });
      const c = await enrol(ORG_A, a.actor, a.prospectId, { ...gap, steps: [wa('third')] });
      const t0 = Date.now();
      const sweepAt = (ms: number) => advanceAndDispatchWorkflowExecution(ORG_A, { now: new Date(t0 + ms).toISOString(), deps: { adapters: waAdapters() } });
      const of = (r: { decisions: Array<{ executionInstanceId: string; decision: string; reasons: string[] }> }, id: string) => r.decisions.find((d) => d.executionInstanceId === id);

      // One sweep: three runs due for the same person. Exactly one is queued; the others wait.
      const r1 = await sweepAt(1000);
      const decided = [b.instanceId, c.instanceId].map((id) => of(r1, id)?.decision).sort();
      expect(decided).toEqual(['deferred', 'waiting']);
      expect(mockJobs).toHaveLength(1);
      const held = [b.instanceId, c.instanceId].map((id) => of(r1, id)).find((d) => d?.decision === 'deferred')!;
      expect(held.reasons.join(' ')).toMatch(/queued and not yet confirmed: it may be sent/);
      const queued = await one(`SELECT t.execution_instance_id AS run, q.state FROM public.execution_engine_requests q
        JOIN public.execution_tasks t ON t.id = q.execution_task_id
        WHERE q.organization_id = $1 AND q.state = 'submitted'`, [ORG_A]);
      expect(queued).toMatchObject({ state: 'submitted' });

      // The queue sends it; the owning run records it. It now counts once, as a completed step.
      await runQueuedJobs();
      expect(metaCalls).toHaveLength(1);
      await sweepAt(2000);
      const states = await db.query(`SELECT q.state FROM public.execution_engine_requests q WHERE q.organization_id = $1`, [ORG_A]);
      expect(states.rows.map((x: { state: string }) => x.state)).toEqual(['completed']);
      const r3 = await sweepAt(3 * 3600_000);
      const other = [b.instanceId, c.instanceId].find((id) => id !== String(queued!.run))!;
      expect(of(r3, other)).toMatchObject({ decision: 'deferred' });
      expect(of(r3, other)!.reasons.join(' ')).not.toMatch(/not yet confirmed|unconfirmed/);   // now a confirmed contact, counted once
      expect(mockJobs).toHaveLength(0);

      // After the gap, the next run proceeds (one at a time: each new queue entry holds the rest).
      const r4 = await sweepAt(25 * 3600_000);
      expect(of(r4, other)).toMatchObject({ decision: 'waiting', outcome: 'submitted' });
      expect(mockJobs).toHaveLength(1);
    });
  });

  it('an unapproved template, or a person with no number, is settled honestly without a send', async () => {
    await inRollback(async () => {
      const a = await scene([wa('intro', 'not_approved')]);
      let r = await sweep(waAdapters());
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'submit_failed' });
      expect(mockJobs).toHaveLength(0);
      expect(await instanceState(a.instanceId)).toBe('active');
    });
    await inRollback(async () => {
      const b = await scene([wa('intro')], { email: 'nophone@example.test' });
      const r = await sweep(waAdapters());
      // No number means the fail-closed permission fact cannot hold.
      expect(r.decisions[0].decision).toBe('skipped');
      expect(metaCalls).toHaveLength(0);
      await sweep(waAdapters());
      expect(await instanceState(b.instanceId)).toBe('completed');
    });
  });

  it('another tenant\'s inbound message on the same number does not end this journey', async () => {
    await inRollback(async () => {
      const { instanceId } = await scene([wa('intro'), wa('followup')]);
      await sweep(waAdapters());
      await runQueuedJobs();
      await sweep(waAdapters());
      const otherAccount = await whatsappAccount(ORG_B);
      await db.query(`UPDATE public.social_accounts SET phone_number_id = 'pn-other' WHERE id = $1`, [otherAccount]);
      const payload = inbound('from the other tenant');
      payload.entry[0].changes[0].value.metadata.phone_number_id = 'pn-other';
      await processWhatsAppWebhookJob({ data: { payload } });
      const r = await sweep(waAdapters());
      expect(r.counters.journeys_exited).toBe(0);
      expect(await instanceState(instanceId)).toBe('active');
    });
  });
});

describe('Social publish engine: observes a real scheduled_posts row; publishes nothing', () => {
  async function post(org: string, status: string, extra: Record<string, unknown> = {}): Promise<string> {
    const user = await newUser();
    const account = await one(`INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id)
      VALUES ($1,'linkedin',$2,'li','t',$3) RETURNING id`, [user, rnd(), org]);
    const p = await one(`INSERT INTO public.scheduled_posts (user_id, social_account_id, platform, content_type, content, status, scheduled_for, platform_post_id)
      VALUES ($1,$2,'linkedin','post','Hello',$3, now(), $4) RETURNING id`, [user, account.id, status, extra.platform_post_id ?? null]);
    return String(p.id);
  }
  const step = (id: string) => humanStep('announce', 'social_post', { social_post: { scheduled_post_id: id } });
  async function run(org: string, postId: string) {
    await seedTenants();
    await enableOutreach(ORG_A, []);
    const actor = await newUser();
    const { prospectId } = await newProspect(ORG_A, {});
    const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [step(postId)] });
    const r = await sweep([createSocialPublishAdapter()]);
    return { r, instanceId };
  }

  it('a published post completes the step; the engine\'s own row is unchanged', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await post(ORG_A, 'published', { platform_post_id: 'urn:li:1' });
      const before = await one('SELECT status, updated_at FROM public.scheduled_posts WHERE id = $1', [id]);
      const { r } = await run(ORG_A, id);
      expect(r.decisions[0]).toMatchObject({ decision: 'executed', outcome: 'published' });
      expect(await one('SELECT status, updated_at FROM public.scheduled_posts WHERE id = $1', [id])).toEqual(before);
    });
  });

  it('a post not yet published leaves the step waiting', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await post(ORG_A, 'scheduled');
      const { r } = await run(ORG_A, id);
      expect(r.decisions[0].decision).toBe('waiting');
    });
  });

  it('another tenant\'s post cannot even be confirmed to exist', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await post(ORG_B, 'published', { platform_post_id: 'urn:li:2' });
      const { r } = await run(ORG_A, id);
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'reference_not_found' });
    });
  });
});

describe('Community engine: the real adapter, link store and proof on the real schema', () => {
  it('with no link, nothing is claimed or sent: the step goes to a person', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['community']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, {});
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('reply', 'community')] });
      const { createCommunityAdapter } = require('../../services/orchestration/communityEngineAdapter');
      const r = await sweep([createCommunityAdapter()]);
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'no_bound_action' });
      expect(await instanceState(instanceId)).toBe('active');
    });
  });

  it('a link to an unverified identity is refused by the database, so this engine cannot act today', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['community']);
      const actor = await newUser();
      const { prospectId, personId } = await newProspect(ORG_A, {});
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('reply', 'community')] });
      await sweep([]);
      const task = await one(`SELECT id FROM public.execution_tasks WHERE execution_instance_id = $1`, [instanceId]);
      const action = await one(`INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, suggested_text, status, requires_human_approval)
        VALUES ($1,$1,'linkedin','reply','t-1','Hi','approved',true) RETURNING id`, [ORG_A]);
      await db.query('SAVEPOINT l');
      await expect(db.query(`INSERT INTO public.community_action_journey_links (organization_id, execution_task_id, execution_instance_id, plan_step_id, community_action_id, person_id, linked_by)
        SELECT $1, t.id, t.execution_instance_id, t.plan_step_id, $2, $3, $4 FROM public.execution_tasks t WHERE t.id = $5`,
      [ORG_A, action.id, personId, actor, task.id])).rejects.toThrow();
      await db.query('ROLLBACK TO SAVEPOINT l');
    });
  });
});

describe('Channels with no engine', () => {
  it('a linkedin step and the browser adapter: visibly unsupported, nothing acts', async () => {
    await inRollback(async () => {
      await seedTenants();
      await enableOutreach(ORG_A, ['community']);
      const actor = await newUser();
      const { prospectId } = await newProspect(ORG_A, {});
      await enrol(ORG_A, actor, prospectId, { steps: [humanStep('dm', 'linkedin')] });
      const { createBrowserAdapter } = require('../../services/orchestration/browserEngineAdapter');
      const r = await sweep([createBrowserAdapter()]);
      expect(r.decisions[0]).toMatchObject({ decision: 'unsupported' });
      expect(r.unsupported).toEqual(['linkedin']);
    });
  });
});



