/**
 * Prompt 4 — an unclassified inbound reply SUSPENDS a journey for a person to evaluate,
 * instead of ending it (owner decision 2026-11-05; SC-7 unratified). REAL PostgreSQL, the
 * real sweeper, stores, WS-3, PI and the existing run route.
 *
 *   unclassified reply (WhatsApp non-STOP inbound, recorded WS-3 `replied`)
 *       → run `paused`, one `needs_human` decision `reply_awaiting_evaluation:<key>`,
 *         nothing withdrawn, nothing sent, the handed-off task held by D-03;
 *   a person resumes it (PATCH lifecycleState `active`) → it continues, and that reply
 *       never suspends it again; a later reply does;
 *   a person ends it (PATCH `cancelled`) → unsent tasks withdrawn;
 *   deterministic answers keep their consequence: WhatsApp STOP, operator-recorded
 *       unsubscribed / converted / rejected → the run ends.
 *
 * Replaced: the email provider (recording), Redis, PostgREST, and the session and
 * capability checks in front of the route.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, ORG_A } from './setup';
import {
  enableOutreach, enrol, emailStep, handoffTasks, humanStep, instanceState, lifecycle, newProspect, newUser, one, rows,
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
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');
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
const spy = (asked: string[]) => ({
  engine: 'whatsapp', channels: ['whatsapp'],
  execute: async (ctx: { step: { key: string } | null }) => {
    asked.push(String(ctx.step?.key));
    return { engine: 'whatsapp', outcome: 'submitted', disposition: 'wait', reason: null, externalRef: null };
  },
});
const NOW = () => new Date().toISOString();
const sweep = (adapters: unknown[]) => advanceAndDispatchWorkflowExecution(ORG_A, { now: NOW(), deps: { adapters } });
const suspensions = (instanceId: string) => rows(
  `SELECT plan_step_id, outcome FROM public.execution_journey_decisions
    WHERE execution_instance_id = $1 AND decision = 'needs_human' AND outcome LIKE 'reply_awaiting_evaluation:%' ORDER BY decided_at`, [instanceId]);

function patchRun(id: string, lifecycleState: string) {
  const out: { status: number; json: Record<string, unknown> } = { status: 0, json: {} };
  const res = {
    setHeader: () => res,
    status(n: number) { out.status = n; return res; },
    json(j: Record<string, unknown>) { out.json = j; return res; },
    end() { return res; },
    writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method: 'PATCH', query: { id, company_id: ORG_A }, body: { lifecycleState }, headers: {}, url: `/api/execution-instances/${id}` };
  return Promise.resolve(instanceRoute(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sent.length = 0; mockRedis.store.clear(); });

// ── WhatsApp: the inbound message that today ended the run ───────────────────

async function whatsappRun() {
  await seedTenants();
  await enableOutreach(ORG_A, ['whatsapp']);
  const actor = await newUser();
  mockActor.id = actor;
  const { prospectId } = await newProspect(ORG_A, { email: ADDRESS, phone: '+15551230009' });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, {
    steps: [humanStep('wa', 'whatsapp', { whatsapp: { template_name: 'hello_1' } }), humanStep('wa2', 'whatsapp', { whatsapp: { template_name: 'hello_2' } })],
  });
  await sweep([]);
  const task = await one('SELECT id FROM public.execution_tasks WHERE execution_instance_id = $1 AND channel = $2 ORDER BY created_at LIMIT 1', [instanceId, 'whatsapp']);
  const u = await one('SELECT id FROM public.users LIMIT 1');
  const account = await one(`INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id)
    VALUES ($1,'whatsapp',$2,'wa','t',$3) RETURNING id`, [u.id, `wa-${instanceId}`, ORG_A]);
  await db.query(`INSERT INTO public.execution_engine_requests (organization_id, execution_task_id, engine, state, external_ref, created_at)
    VALUES ($1,$2,'whatsapp','submitted',$3, now() - interval '1 hour')`, [ORG_A, task.id, `ext-${instanceId}`]);
  const thread = await one(`INSERT INTO public.engagement_threads (platform, platform_thread_id, organization_id, social_account_id)
    VALUES ('whatsapp',$1,$2,$3) RETURNING id`, [`wa:${account.id}:15551230009`, ORG_A, account.id]);
  let n = 0;
  const inbound = (content: string) => db.query(`INSERT INTO public.engagement_messages (thread_id, platform, platform_message_id, content, direction, status, created_at)
    VALUES ($1,'whatsapp',$2,$3,'inbound','received', now() + ($4 || ' seconds')::interval)`, [thread.id, `wamid.${instanceId}.${n += 1}`, content, String(n)]);
  return { instanceId, prospectId, inbound };
}

describe('Prompt 4 — an unclassified WhatsApp reply suspends the journey', () => {
  it('CHANGED: "I am out of office" pauses the run for a person; nothing is asked of an engine; repeated sweeps add nothing', async () => {
    await inRollback(async () => {
      const w = await whatsappRun();
      await w.inbound('I am out of the office until Monday');
      const asked: string[] = [];
      const r = await sweep([spy(asked)]);
      expect(r.counters).toMatchObject({ journeys_suspended: 1, journeys_exited: 0 });
      expect(await instanceState(w.instanceId)).toBe('paused');
      expect(asked).toEqual([]);
      expect(await suspensions(w.instanceId)).toHaveLength(1);
      expect(JSON.stringify(await suspensions(w.instanceId))).not.toMatch(/wamid|office/);
      // Paused runs are not swept: no second suspension, nothing asked.
      for (let i = 0; i < 2; i += 1) expect((await sweep([spy(asked)])).counters.journeys_suspended).toBe(0);
      expect(asked).toEqual([]);
      expect(await suspensions(w.instanceId)).toHaveLength(1);
    });
  });

  it('a person resumes it through the existing route: the evaluated reply does not suspend it again; a later reply does', async () => {
    await inRollback(async () => {
      const w = await whatsappRun();
      await w.inbound('back next week');
      await sweep([spy([])]);
      expect(await instanceState(w.instanceId)).toBe('paused');
      expect((await patchRun(w.instanceId, 'active')).status).toBe(200);
      const asked: string[] = [];
      const resumed = await sweep([spy(asked)]);
      expect(resumed.counters).toMatchObject({ journeys_suspended: 0, journeys_exited: 0 });
      expect(asked).toEqual(['wa']);
      expect(await instanceState(w.instanceId)).toBe('active');
      await w.inbound('actually, call me now');
      const again = await sweep([spy(asked)]);
      expect(again.counters.journeys_suspended).toBe(1);
      expect(await instanceState(w.instanceId)).toBe('paused');
      expect(await suspensions(w.instanceId)).toHaveLength(2);
    });
  });

  it('a person ends it through the existing route', async () => {
    await inRollback(async () => {
      const w = await whatsappRun();
      await w.inbound('not now');
      await sweep([spy([])]);
      expect((await patchRun(w.instanceId, 'cancelled')).status).toBe(200);
      expect(await instanceState(w.instanceId)).toBe('cancelled');
      expect((await sweep([spy([])])).counters.journeys_suspended).toBe(0);
    });
  });

  it('UNCHANGED: a WhatsApp STOP still ends the run as an unsubscribe, even after a plain reply', async () => {
    await inRollback(async () => {
      const w = await whatsappRun();
      await w.inbound('hello');
      await w.inbound('STOP');
      const r = await sweep([spy([])]);
      expect(r.counters).toMatchObject({ journeys_exited: 1, journeys_suspended: 0 });
      expect(await instanceState(w.instanceId)).toBe('cancelled');
      expect(r.decisions.find((d: { decision: string }) => d.decision === 'exited')).toMatchObject({ outcome: 'unsubscribed' });
    });
  });
});

// ── WS-3: a recorded reply on a sent email ───────────────────────────────────

async function firstSent() {
  await seedTenants();
  await enableOutreach(ORG_A, ['email']);
  const actor = await newUser();
  mockActor.id = actor;
  const { prospectId } = await newProspect(ORG_A, { email: ADDRESS });
  await ensureProspectLifecycleOpen({ organizationId: ORG_A, prospectId, now: NOW() });
  const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro'), emailStep('next')] });
  await sweep([realWs3()]);
  const [first] = await handoffTasks(instanceId);
  expect((await approveWithPasskey(ORG_A, first.id, actor)).ok).toBe(true);
  await sweep([realWs3()]);
  expect(sent).toHaveLength(1);
  await sweep([realWs3()]);
  return { actor, prospectId, instanceId, firstTask: String(first.id) };
}
const feedback = (task: string, signal: string) =>
  ws3.ingestFeedback({ companyId: ORG_A, taskId: task, signal, occurredAt: NOW(), source: 'manual' });

describe('Prompt 4 — a recorded WS-3 reply suspends the journey', () => {
  it('CHANGED: replied pauses the run; the next task is NOT withdrawn, and the D-03 hold keeps it from sending', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      const before = (await handoffTasks(s.instanceId)).map((t) => t.status);
      expect((await feedback(s.firstTask, 'replied')).ok).toBe(true);
      const r = await sweep([realWs3()]);
      expect(r.counters).toMatchObject({ journeys_suspended: 1, journeys_exited: 0 });
      expect(await instanceState(s.instanceId)).toBe('paused');
      const after = await handoffTasks(s.instanceId);
      expect(after.map((t) => t.status)).toEqual(before);
      expect((await lifecycle(ORG_A, s.prospectId)).at(-1)).toMatchObject({ state: 'engaged', origin: 'derived' });
      const next = after.find((t) => t.id !== s.firstTask);
      if (next) {
        const held = await ws3.dispatchInternalOutreachTask(ORG_A, next.id, { recipient: ADDRESS });
        expect(held.outcome).toBe('deferred_journey');
      }
      expect(sent).toHaveLength(1);
      // Ended by a person: the unsent task is withdrawn as before.
      expect((await patchRun(s.instanceId, 'cancelled')).status).toBe(200);
      if (next) expect((await handoffTasks(s.instanceId)).find((t) => t.id === next.id)!.status).toBe('cancelled');
    });
  });

  it.each(['unsubscribed', 'converted'])('UNCHANGED: an operator-recorded %s still ends the run', async (signal) => {
    await inRollback(async () => {
      const s = await firstSent();
      expect((await feedback(s.firstTask, signal)).ok).toBe(true);
      const r = await sweep([realWs3()]);
      expect(r.counters).toMatchObject({ journeys_exited: 1, journeys_suspended: 0 });
      expect(await instanceState(s.instanceId)).toBe('cancelled');
    });
  });

  it('UNCHANGED: a rejected outcome row ends the run even beside an unevaluated reply', async () => {
    await inRollback(async () => {
      const s = await firstSent();
      expect((await feedback(s.firstTask, 'replied')).ok).toBe(true);
      await db.query(`INSERT INTO public.outreach_outcomes (company_id, task_id, outcome_type, occurred_at, source, metadata)
        VALUES ($1,$2,'rejected',now(),'manual',$3)`, [ORG_A, s.firstTask, JSON.stringify({ recordedByUserId: s.actor })]);
      const r = await sweep([realWs3()]);
      expect(r.counters).toMatchObject({ journeys_exited: 1, journeys_suspended: 0 });
      expect(await instanceState(s.instanceId)).toBe('cancelled');
    });
  });
});
