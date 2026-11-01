/**
 * ORCHESTRATION — the shared contract on REAL PostgreSQL: the central gate, choice groups,
 * execution windows, blocked and stuck runs, a person settling or cancelling through the
 * real routes, the event view, and one whole journey from PI to outcome reporting.
 *
 * Real: every store, the sweeper, governance, WS-3, the certified email engine, SES event
 * ingestion, PI's producer and writer, the routes' handlers. Replaced: the email provider
 * (recording), the Redis quota counter, PostgREST, and the session and capability checks
 * in front of the routes. Provider integration is NOT proven here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
import {
  decisions, enableOutreach, enrol, emailStep, handoffTasks, humanStep, instanceState, lifecycle, newProspect, newUser, one, rows,
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
const { ingestSesEvent } = require('../../services/providerEvents/sesProviderEventIngestion');
const { readJourneyEvents } = require('../../services/orchestration/journeyEvents');
const { buildJourneyReport } = require('../../services/orchestration/journeyReport');
const { getReadyStep, listProgressionSteps, transitionPlanStep } = require('../../services/workflowExecution/stepProgressionStore');
const { getPlanForInstance } = require('../../services/executionPlans/executionPlanStore');
const progressionRoute = require('../../../pages/api/execution-instances/[id]/progression').default;
const instanceRoute = require('../../../pages/api/execution-instances/[id]').default;
const eventsRoute = require('../../../pages/api/execution-instances/[id]/events').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const ADDRESS = 'person@example.test';
const sent: Array<{ to: string; subject: string }> = [];
const providerRefuses = { on: false };
const provider = {
  name: 'supabase_edge_ses',
  async send(r: { to: string; subject: string; idempotencyKey: string }) {
    sent.push({ to: r.to, subject: r.subject });
    if (providerRefuses.on) return { accepted: false, messageId: null, raw: {}, error: 'provider refused the request' };
    return { accepted: true, messageId: `msg-${r.idempotencyKey}`, raw: {} };
  },
};
const realWs3 = () => createWs3Adapter({
  ...defaultWs3Deps,
  registerTransports: () => ensureWorkflowTransports({ emailProvider: provider }),
  sendEmail: (input: Record<string, unknown>) => dispatchWorkflowEmailTask({ ...input, emailProvider: provider }),
});
/** An engine that records being asked, to prove what reached an engine and what did not. */
const spy = (engine: string, channels: string[], asked: string[], disposition = 'completed', outcome = 'sent') => ({
  engine, channels,
  execute: async (ctx: { step: { key: string } | null }) => {
    asked.push(String(ctx.step?.key));
    return { engine, outcome, disposition, reason: null, externalRef: null };
  },
});
const NOW = () => new Date().toISOString();
const sweep = (adapters: unknown[], now: string = NOW(), org: string = ORG_A) =>
  advanceAndDispatchWorkflowExecution(org, { now, deps: { adapters } });
const internalStep = (key: string, extra: Record<string, unknown> = {}) => humanStep(key, 'internal', extra);

async function setup(channels: string[], contact: { email?: string; phone?: string } = { email: ADDRESS }) {
  await seedTenants();
  await enableOutreach(ORG_A, channels);
  const actor = await newUser();
  mockActor.id = actor;
  const { prospectId, personId } = await newProspect(ORG_A, contact);
  return { actor, prospectId, personId };
}

function callRoute(route: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, id: string, body: Record<string, unknown>, query: Record<string, string> = {}) {
  const out: { status: number; json: Record<string, unknown> } = { status: 0, json: {} };
  const res = {
    setHeader: () => res,
    status(n: number) { out.status = n; return res; },
    json(j: Record<string, unknown>) { out.json = j; return res; },
    end() { return res; },
    writableEnded: false,
    headersSent: false,
    getHeader: () => undefined,
  };
  const req = { method, query: { id, company_id: ORG_A, ...query }, body, headers: {}, url: `/api/execution-instances/${id}` };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

beforeAll(() => {
  process.env.LEAD_OUTREACH_EMAIL_ENABLED = 'true';
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});
beforeEach(() => { sent.length = 0; providerRefuses.on = false; mockRedis.store.clear(); });

describe('the central gate holds every contact engine', () => {
  it('a tenant kill switch stops a community step before the engine is asked, and nothing settles', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['community']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('c', 'community')] });
      await db.query('UPDATE public.outreach_governance_config SET kill_switch = true WHERE company_id = $1', [ORG_A]);
      const asked: string[] = [];
      const r = await sweep([spy('community', ['community'], asked)]);
      expect(asked).toEqual([]);
      expect(r.decisions[0]).toMatchObject({ decision: 'waiting', outcome: 'tenant_kill_switch' });
      expect((await rows('SELECT state FROM public.execution_plan_steps s JOIN public.execution_plans p ON p.id = s.plan_id WHERE p.execution_instance_id = $1', [instanceId]))[0]!.state).toBe('ready');
    });
  });

  it('a channel the tenant has not enabled is held, and enabling it releases the same step', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['email']);
      await enrol(ORG_A, actor, prospectId, { steps: [humanStep('c', 'community')] });
      const asked: string[] = [];
      const first = await sweep([spy('community', ['community'], asked)]);
      expect(asked).toEqual([]);
      expect(first.decisions[0]).toMatchObject({ decision: 'waiting', outcome: 'channel_not_enabled' });
      await enableOutreach(ORG_A, ['email', 'community']);
      await sweep([spy('community', ['community'], asked)]);
      expect(asked).toEqual(['c']);
    });
  });

  it('a person opted out of everything is not contacted through community', async () => {
    await inRollback(async () => {
      const { actor, prospectId, personId } = await setup(['community']);
      await db.query(`INSERT INTO public.contact_governance_records
        (organization_id, person_id, channel, governance_type, source)
        VALUES ($1,$2,'*','dnc_permanent','contract-test')`, [ORG_A, personId]);
      await enrol(ORG_A, actor, prospectId, { steps: [humanStep('c', 'community')] });
      const asked: string[] = [];
      const r = await sweep([spy('community', ['community'], asked)]);
      expect(asked).toEqual([]);
      expect(r.decisions[0]).toMatchObject({ decision: 'skipped' });
      expect(r.decisions[0].reasons.join(' ')).toContain('community_permitted');
    });
  });

  it('a non-contact step keeps moving under a kill switch: it reaches nobody', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      await enrol(ORG_A, actor, prospectId, { steps: [internalStep('i')] });
      await db.query('UPDATE public.outreach_governance_config SET kill_switch = true WHERE company_id = $1', [ORG_A]);
      const asked: string[] = [];
      await sweep([spy('ws3', ['internal', 'email'], asked)]);
      expect(asked).toEqual(['i']);
    });
  });
});

describe('a choice group branches on what is known about the person', () => {
  const definition = {
    steps: [
      internalStep('rich', { choice_group: 'offer', when: [{ fact: 'has_phone', op: 'eq', value: true }] }),
      internalStep('plain', { choice_group: 'offer' }),
      internalStep('after'),
    ],
  };
  const run = async (adapters: unknown[]) => { for (let i = 0; i < 4; i += 1) await sweep(adapters); };

  it('the first candidate that holds acts; the others are skipped, recorded and not asked', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal'], { email: ADDRESS, phone: '+15550000001' });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, definition);
      const asked: string[] = [];
      await run([spy('ws3', ['internal', 'email'], asked)]);
      expect(asked).toEqual(['rich', 'after']);
      const d = await decisions(instanceId);
      expect(d.find((x) => x.step_key === 'plain')).toMatchObject({ decision: 'skipped', outcome: 'branch_not_taken' });
      expect(await instanceState(instanceId)).toBe('completed');
    });
  });

  it('a person the first does not fit takes the next, and the journey still finishes', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, definition);
      const asked: string[] = [];
      await run([spy('ws3', ['internal', 'email'], asked)]);
      expect(asked).toEqual(['plain', 'after']);
      expect(await instanceState(instanceId)).toBe('completed');
    });
  });

  it('a candidate whose engine declines lets the next candidate act', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal'], { email: ADDRESS, phone: '+15550000002' });
      await enrol(ORG_A, actor, prospectId, definition);
      const asked: string[] = [];
      const decliner = {
        engine: 'ws3', channels: ['internal', 'email'],
        execute: async (ctx: { step: { key: string } | null }) => {
          asked.push(String(ctx.step?.key));
          return { engine: 'ws3', outcome: ctx.step?.key === 'rich' ? 'rejected' : 'sent', disposition: ctx.step?.key === 'rich' ? 'skipped' : 'completed', reason: null, externalRef: null };
        },
      };
      await run([decliner]);
      expect(asked).toEqual(['rich', 'plain', 'after']);
    });
  });
});

describe('the execution window', () => {
  // 2031-03-03 is a Monday. Far ahead of the database clock, which only gates readiness.
  const window = { timezone: 'UTC', start_hour: 9, end_hour: 17 };
  const AT = (h: string) => `2031-03-03T${h}:00:00.000Z`;

  it('out of hours a contact step waits, recorded; in hours the same step acts', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['email']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('e')], policy: { execution_window: window } });
      const asked: string[] = [];
      const adapter = spy('ws3', ['internal', 'email'], asked);
      const early = await sweep([adapter], AT('06'));
      expect(asked).toEqual([]);
      expect(early.decisions[0]).toMatchObject({ decision: 'deferred', outcome: 'outside_execution_window' });
      await sweep([adapter], AT('10'));
      expect(asked).toEqual(['e']);
      expect((await decisions(instanceId)).map((d) => d.outcome)).toEqual(expect.arrayContaining(['outside_execution_window', 'sent']));
    });
  });

  it("is local to the person when their timezone is known", async () => {
    await inRollback(async () => {
      const { actor, prospectId, personId } = await setup(['email']);
      await db.query('UPDATE public.unified_persons SET timezone = $1 WHERE id = $2', ['Asia/Tokyo', personId]);
      await enrol(ORG_A, actor, prospectId, { steps: [emailStep('e')], policy: { execution_window: window } });
      const asked: string[] = [];
      const adapter = spy('ws3', ['internal', 'email'], asked);
      await sweep([adapter], AT('10'));                 // 19:00 in Tokyo
      expect(asked).toEqual([]);
      await sweep([adapter], AT('02'));                 // 11:00 in Tokyo
      expect(asked).toEqual(['e']);
    });
  });

  it('a window does not hold back a step that contacts nobody', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      await enrol(ORG_A, actor, prospectId, { steps: [internalStep('i')], policy: { execution_window: window } });
      const asked: string[] = [];
      await sweep([spy('ws3', ['internal', 'email'], asked)], AT('03'));
      expect(asked).toEqual(['i']);
    });
  });
});

describe('recovery', () => {
  it('a failed step ends the run: unsent tasks withdrawn, re-enrolment possible', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [internalStep('a'), internalStep('b')] });
      const plan = await (async () => { await sweep([spy('ws3', ['internal', 'email'], [], 'wait', 'queued')]); return getPlanForInstance(ORG_A, instanceId); })();
      const ready = await getReadyStep(ORG_A, plan.id);
      await transitionPlanStep({ organizationId: ORG_A, stepId: ready.id, state: 'running' });
      await transitionPlanStep({ organizationId: ORG_A, stepId: ready.id, state: 'failed' });
      expect(await instanceState(instanceId)).toBe('active');
      const r = await sweep([spy('ws3', ['internal', 'email'], [])]);
      expect(await instanceState(instanceId)).toBe('failed');
      expect(r.decisions.find((d: { decision: string }) => d.decision === 'exited')).toMatchObject({ outcome: 'step_failed' });
      const again = await enrol(ORG_A, actor, prospectId, { steps: [internalStep('later')] });
      expect(again.report.enrolled).toBe(1);
    });
  });

  it('an engine holding a step for a week is reported to a person, and nothing is retried or settled', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [internalStep('a')] });
      const asked: string[] = [];
      const holding = spy('ws3', ['internal', 'email'], asked, 'wait', 'awaiting_approval');
      await sweep([holding]);
      const later = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();
      const r = await sweep([holding], later);
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'stuck_waiting' });
      const plan = await getPlanForInstance(ORG_A, instanceId);
      expect((await listProgressionSteps(ORG_A, plan.id))[0].state).toBe('ready');
    });
  });

  it('a step left running by a person is reported once it has been a week', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [internalStep('a')] });
      await sweep([spy('ws3', ['internal', 'email'], [], 'wait', 'queued')]);
      const plan = await getPlanForInstance(ORG_A, instanceId);
      const ready = await getReadyStep(ORG_A, plan.id);
      await transitionPlanStep({ organizationId: ORG_A, stepId: ready.id, state: 'running' });
      const soon = await sweep([spy('ws3', ['internal', 'email'], [])]);
      expect(soon.decisions).toEqual([]);
      const later = await sweep([spy('ws3', ['internal', 'email'], [])], new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString());
      expect(later.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'running_step_unattended' });
    });
  });
});

describe('a person acting through the routes', () => {
  it("a step of another run in the same tenant cannot be moved through this run's path", async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      const other = await newProspect(ORG_A, { email: 'other@example.test' });
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [internalStep('a')] });
      const victim = await enrol(ORG_A, actor, other.prospectId, { steps: [internalStep('b')] });
      await sweep([spy('ws3', ['internal', 'email'], [], 'wait', 'queued')]);
      const victimPlan = await getPlanForInstance(ORG_A, victim.instanceId);
      const victimStep = await getReadyStep(ORG_A, victimPlan.id);
      const out = await callRoute(progressionRoute, 'PATCH', instanceId, { stepId: victimStep.id, state: 'completed' });
      expect(out.status).toBe(404);
      expect((await listProgressionSteps(ORG_A, victimPlan.id))[0].state).toBe('ready');
    });
  });

  it('settling a step records who did it, and the journey moves on', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['internal']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [internalStep('a')] });
      await sweep([spy('ws3', ['internal', 'email'], [], 'needs_human', 'uncertain')]);
      const plan = await getPlanForInstance(ORG_A, instanceId);
      const ready = await getReadyStep(ORG_A, plan.id);
      const out = await callRoute(progressionRoute, 'PATCH', instanceId, { stepId: ready.id, state: 'completed' });
      expect(out.status).toBe(200);
      expect(out.json.auditFailed).toBe(false);
      const d = (await decisions(instanceId)).find((x) => x.outcome === 'human_completed')!;
      expect(d.decision).toBe('executed');
      expect(d.reasons).toEqual([`actor:${actor}`]);
    });
  });

  it('cancelling a run withdraws a task awaiting approval, so nobody can still approve and send it', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['email']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('a')] });
      await sweep([realWs3()]);
      expect((await handoffTasks(instanceId)).map((t) => t.status)).toEqual(['awaiting_approval']);
      const out = await callRoute(progressionRoute, 'POST', instanceId, { action: 'cancel' });
      expect(out.status).toBe(200);
      expect((await handoffTasks(instanceId)).map((t) => t.status)).toEqual(['cancelled']);
      expect((await decisions(instanceId)).find((x) => x.outcome === 'cancelled_by_person')!.reasons).toEqual([`actor:${actor}`]);
      expect(sent).toEqual([]);
    });
  });

  it('ending a run by its lifecycle state withdraws the same way', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['email']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('a')] });
      await sweep([realWs3()]);
      const out = await callRoute(instanceRoute, 'PATCH', instanceId, { lifecycleState: 'cancelled' });
      expect(out.status).toBe(200);
      expect((await handoffTasks(instanceId)).map((t) => t.status)).toEqual(['cancelled']);
    });
  });
});

describe('one whole journey, from PI to outcome reporting', () => {
  async function journey() {
    const { actor, prospectId } = await setup(['email']);
    const { instanceId, workflowId } = await enrol(ORG_A, actor, prospectId, {
      objective: { statement: 'get a reply', success_outcome: 'replied' },
      steps: [emailStep('intro'), emailStep('next')],
    });
    await sweep([realWs3()]);
    const [first] = await handoffTasks(instanceId);
    expect((await ws3.approveOutreachTask(ORG_A, first!.id, { approverUserId: actor })).ok).toBe(true);
    await sweep([realWs3()]);
    expect(sent).toHaveLength(1);
    await sweep([realWs3()]);
    const evidence = await one('SELECT provider_message_id FROM public.outreach_delivery_evidence WHERE task_id = $1 AND provider_message_id IS NOT NULL', [first!.id]);
    await ingestSesEvent({ eventType: 'Delivery', mail: { messageId: String(evidence.provider_message_id), destination: [ADDRESS] }, delivery: { timestamp: NOW() } });
    return { actor, prospectId, instanceId, workflowId, firstTask: first!.id };
  }

  it('enrolment, decision, approval, send, delivery, reply, adaptation, PI update, report: all persisted', async () => {
    await inRollback(async () => {
      const s = await journey();
      expect((await ws3.ingestFeedback({ companyId: ORG_A, taskId: s.firstTask, signal: 'replied', occurredAt: NOW(), source: 'manual' })).ok).toBe(true);
      const swept = await sweep([realWs3()]);

      // Adaptation: the reply ended the journey, and the next message was withdrawn.
      expect(swept.counters.journeys_exited).toBe(1);
      expect(await instanceState(s.instanceId)).toBe('cancelled');
      expect((await handoffTasks(s.instanceId)).map((t) => t.status)).toEqual(['delivered', 'cancelled']);
      expect(sent).toHaveLength(1);

      // Intelligence: PI recorded it.
      expect((await lifecycle(ORG_A, s.prospectId)).at(-1)).toMatchObject({ state: 'engaged' });

      // Events: every stage, in the one view.
      const page = await readJourneyEvents(ORG_A, s.instanceId);
      const types = page.events.map((e: { type: string }) => e.type);
      for (const t of ['journey.enrolled', 'approval.granted', 'execution.started', 'execution.accepted', 'delivery.confirmed',
        'response.replied', 'journey.terminated', 'prospect.lifecycle_changed']) {
        expect(types).toContain(t);
      }
      for (const e of page.events) {
        expect(e).toMatchObject({ eventVersion: 1, organizationId: ORG_A, executionInstanceId: s.instanceId, subject: { kind: 'prospect', id: s.prospectId } });
        expect(e.correlationId.startsWith(`journey:${s.instanceId}`)).toBe(true);
        expect(e.positiveEngagement).toBe(e.type === 'response.replied');
      }

      // Nothing personal leaves through the view.
      expect(JSON.stringify(page)).not.toContain(ADDRESS);
      expect(JSON.stringify(page)).not.toContain('Hello');

      // Reporting: the reply counts as attainment, and the exit reason is visible.
      const report = await buildJourneyReport({ organizationId: ORG_A, workflowId: s.workflowId });
      expect(report.versions[0].attainment.reached).toBe(1);
      expect(report.versions[0].exits).toEqual({ replied: 1 });
      expect(report.versions[0].enrolled).toBe(1);
    });
  });

  it('replay gives the same events; a cursor walks them all exactly once', async () => {
    await inRollback(async () => {
      const s = await journey();
      const a = await readJourneyEvents(ORG_A, s.instanceId);
      const b = await readJourneyEvents(ORG_A, s.instanceId);
      expect(b.events).toEqual(a.events);
      expect(new Set(a.events.map((e: { eventId: string }) => e.eventId)).size).toBe(a.events.length);

      const walked: string[] = [];
      let after: string | undefined;
      for (let i = 0; i < 100; i += 1) {
        const p = await readJourneyEvents(ORG_A, s.instanceId, { limit: 2, ...(after === undefined ? {} : { after }) });
        walked.push(...p.events.map((e: { eventId: string }) => e.eventId));
        if (!p.hasMore) break;
        after = p.cursor;
      }
      expect(walked).toEqual(a.events.map((e: { eventId: string }) => e.eventId));
    });
  });

  it('a duplicate provider event does not make a second event', async () => {
    await inRollback(async () => {
      const s = await journey();
      const evidence = await one('SELECT provider_message_id FROM public.outreach_delivery_evidence WHERE task_id = $1 AND provider_message_id IS NOT NULL', [s.firstTask]);
      const count = async () => (await readJourneyEvents(ORG_A, s.instanceId)).events.filter((e: { type: string }) => e.type === 'delivery.confirmed').length;
      const before = await count();
      const event = { eventType: 'Delivery', mail: { messageId: String(evidence.provider_message_id), destination: [ADDRESS] }, delivery: { timestamp: '2030-01-01T00:00:00.000Z' } };
      await ingestSesEvent(event);
      const once = await count();
      await ingestSesEvent(event);
      expect(await count()).toBe(once);
      expect(once).toBeGreaterThanOrEqual(before);
    });
  });

  it('events are tenant scoped, through the service and the route', async () => {
    await inRollback(async () => {
      const s = await journey();
      expect(await readJourneyEvents(ORG_B, s.instanceId)).toBeNull();
      const other = await callRoute(eventsRoute, 'GET', s.instanceId, {}, { company_id: ORG_B });
      expect(other.status).toBe(404);
      const own = await callRoute(eventsRoute, 'GET', s.instanceId, {});
      expect(own.status).toBe(200);
      expect((own.json.events as unknown[]).length).toBeGreaterThan(0);
    });
  });
});

describe('an engine result that needs a person is not repeated by the clock', () => {
  it('a provider refusal reaches the provider once, however many sweeps follow, until a person resolves the step', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['email']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro')] });
      await sweep([realWs3()]);
      const [task] = await handoffTasks(instanceId);
      expect((await ws3.approveOutreachTask(ORG_A, task!.id, { approverUserId: actor })).ok).toBe(true);

      providerRefuses.on = true;
      const first = await sweep([realWs3()]);
      expect(first.decisions[0]).toMatchObject({ decision: 'needs_human' });
      expect(sent).toHaveLength(1);

      for (let i = 0; i < 3; i += 1) {
        const later = await sweep([realWs3()]);
        expect(sent).toHaveLength(1);
        expect(later.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'provider_refused_prior_attempt' });
      }
      expect(sent).toHaveLength(1);
      expect(Number((await one('SELECT count(*) n FROM public.outreach_attempts WHERE task_id = $1', [task!.id])).n)).toBe(1);

      // A person settles it: the journey moves on.
      const plan = await getPlanForInstance(ORG_A, instanceId);
      const ready = await getReadyStep(ORG_A, plan.id);
      const settled = await callRoute(progressionRoute, 'PATCH', instanceId, { stepId: ready.id, state: 'skipped' });
      expect(settled.status).toBe(200);
      await sweep([realWs3()]);
      expect(sent).toHaveLength(1);
      expect(await instanceState(instanceId)).toBe('completed');
    });
  });

  it('a disabled transport never reached a provider, so it stays free to go when enabled', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['email']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [emailStep('intro')] });
      await sweep([realWs3()]);
      const [task] = await handoffTasks(instanceId);
      expect((await ws3.approveOutreachTask(ORG_A, task!.id, { approverUserId: actor })).ok).toBe(true);
      const attempt = await one(`INSERT INTO public.outreach_attempts (company_id, task_id, attempt_number, outcome, started_at) VALUES ($1,$2,1,'disabled',now()) RETURNING id`, [ORG_A, task!.id]);
      await db.query(`INSERT INTO public.outreach_delivery_evidence (company_id, task_id, attempt_id, delivery_status, provider, transport_response, observed_at)
        VALUES ($1,$2,$3,'failed','supabase_edge_ses',$4,now())`, [ORG_A, task!.id, attempt.id, JSON.stringify({ outcome: 'disabled' })]);
      await db.query(`UPDATE public.outreach_tasks SET status = 'queued' WHERE id = $1`, [task!.id]);
      await sweep([realWs3()]);
      expect(sent).toHaveLength(1);
    });
  });
});

describe('a contact channel with no permission source fails closed', () => {
  it('an engine serving a new channel is not asked until that channel has a permission source', async () => {
    await inRollback(async () => {
      const { actor, prospectId } = await setup(['sms']);
      const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('s', 'sms')] });
      const asked: string[] = [];
      const r = await sweep([spy('whatsapp', ['sms'], asked)]);
      expect(asked).toEqual([]);
      expect(r.decisions[0]).toMatchObject({ decision: 'needs_human', outcome: 'no_permission_source' });
      const plan = await getPlanForInstance(ORG_A, instanceId);
      expect((await getReadyStep(ORG_A, plan.id)).stepKey).toBe('s');
    });
  });
});

describe('a WhatsApp reply counts only after this run actually reached out', () => {
  async function whatsappRun(requestState: string) {
    const { actor, prospectId } = await setup(['whatsapp'], { email: ADDRESS, phone: '+15551230002' });
    const { instanceId } = await enrol(ORG_A, actor, prospectId, { steps: [humanStep('wa', 'whatsapp', { whatsapp: { template_name: 'hello_1' } })] });
    await sweep([]);
    const task = await one('SELECT id FROM public.execution_tasks WHERE execution_instance_id = $1 AND channel = $2', [instanceId, 'whatsapp']);
    const u = await one('SELECT id FROM public.users LIMIT 1');
    const account = await one(`INSERT INTO public.social_accounts (user_id, platform, platform_user_id, account_name, access_token, company_id)
      VALUES ($1,'whatsapp',$2,'wa','t',$3) RETURNING id`, [u.id, `wa-${instanceId}`, ORG_A]);
    await db.query(`INSERT INTO public.execution_engine_requests (organization_id, execution_task_id, engine, state, external_ref, created_at)
      VALUES ($1,$2,'whatsapp',$3,$4, now() - interval '1 hour')`, [ORG_A, task.id, requestState, requestState === 'submitted' ? `ext-${instanceId}` : null]);
    const thread = await one(`INSERT INTO public.engagement_threads (platform, platform_thread_id, organization_id, social_account_id)
      VALUES ('whatsapp',$1,$2,$3) RETURNING id`, [`wa:${account.id}:15551230002`, ORG_A, account.id]);
    await db.query(`INSERT INTO public.engagement_messages (thread_id, platform, platform_message_id, content, direction, status, created_at)
      VALUES ($1,'whatsapp',$2,'hello','inbound','received', now())`, [thread.id, `wamid.${instanceId}`]);
    return { instanceId };
  }

  it('a request that never went out does not make an unrelated inbound message a response', async () => {
    await inRollback(async () => {
      const { instanceId } = await whatsappRun('requested');
      const execute = jest.fn(async () => ({ engine: 'whatsapp', outcome: 'submitted', disposition: 'wait', reason: null, externalRef: null }));
      const r = await sweep([{ engine: 'whatsapp', channels: ['whatsapp'], execute }]);
      expect(r.counters.journeys_exited).toBe(0);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(await instanceState(instanceId)).not.toBe('cancelled');
    });
  });

  it('after a submitted request the reply ends the journey and appears in the event view', async () => {
    await inRollback(async () => {
      const { instanceId } = await whatsappRun('submitted');
      const r = await sweep([spy('whatsapp', ['whatsapp'], [])]);
      expect(r.counters.journeys_exited).toBe(1);
      const page = await readJourneyEvents(ORG_A, instanceId);
      expect(page.events.map((e: { type: string }) => e.type)).toContain('response.replied');
      expect(JSON.stringify(page)).not.toContain('hello');
    });
  });
});
