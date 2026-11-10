/**
 * Orchestration, Follow-up E — operator warnings for unresolved uncertain communications, on
 * REAL PostgreSQL (migration 20270129000002), through the REAL routes and services.
 *
 * Real: the routes' handlers (progression cancel, the run route, single enrolment), campaign
 * enrolment, the acknowledgement module, the instance store, the ledger and its D-2 trigger,
 * the D-2 claim function. Replaced: the session and capability checks in front of the routes
 * (an authenticated person is simulated, as every real-schema route suite does) and the
 * idempotency wrapper of the single-enrolment route (it needs an HTTP idempotency key).
 *
 * Everything here runs inside inRollback. The concurrency proofs COMMIT rows and race two
 * independent connections, so they live in e_uncertain_acknowledgement_concurrency_real.test.ts and
 * run in their own pass (as d2_frequency_claim_concurrency_real.test.ts does).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { db, inRollback, seedTenants, ORG_A, ORG_B } from './setup';
import { decisions, enableOutreach, enrol, humanStep, instanceState, newProspect, newUser, one, rows } from './helpers/journeyFixtures';

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
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
const mockActor = { id: 'unset' };
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: mockActor.id })) }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: mockActor.id } })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const progressionRoute = require('../../../pages/api/execution-instances/[id]/progression').default;
const instanceRoute = require('../../../pages/api/execution-instances/[id]').default;
const invokeRoute = require('../../../pages/api/prospect-campaigns/[id]/execution-instances').default;
const { enrollCampaignTargets } = require('../../services/orchestration/campaignEnrollment');
const { checkUncertainAcknowledgement } = require('../../services/orchestration/uncertainCommunicationAcknowledgement');
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');
const { createExecutionPlan } = require('../../services/executionPlans/executionPlanStore');
/* eslint-enable @typescript-eslint/no-var-requires */

type Row = Record<string, unknown>;
const NON_CONTACT = ['internal', 'social_post'];
const WA = { policy: { min_hours_between_actions: 24 }, steps: [humanStep('wa', 'whatsapp', { whatsapp: { template_name: 'hello_1' } })] };

function callRoute(route: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, id: string, body: Row, org = ORG_A) {
  const out: { status: number; json: Row } = { status: 0, json: {} };
  const res = {
    setHeader: () => res, status(n: number) { out.status = n; return res; }, json(j: Row) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method, query: { id, company_id: org }, body, headers: {}, url: `/api/x/${id}` };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}

/** A person in `org` with one WhatsApp journey whose ledger request ends `uncertain` (or `final`). */
async function personWithRequest(org: string, final: 'uncertain' | 'completed' | 'failed' | 'submitted' | null = 'uncertain') {
  const actor = await newUser();
  mockActor.id = actor;
  const { prospectId } = await newProspect(org, { phone: `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}` });
  await ensureProspectLifecycleOpen({ organizationId: org, prospectId, now: new Date().toISOString() });
  const { instanceId, workflowId } = await enrol(org, actor, prospectId, WA);
  const inst = await one('SELECT campaign_id FROM public.execution_instances WHERE id = $1', [instanceId]);
  const task = await one('SELECT id FROM public.execution_tasks WHERE organization_id = $1 AND execution_instance_id = $2', [org, instanceId]);
  let requestId: string | null = null;
  if (final !== null) {
    requestId = String((await one(`INSERT INTO public.execution_engine_requests (organization_id, execution_task_id, engine, state)
      VALUES ($1, $2, 'whatsapp', 'requested') RETURNING id`, [org, task.id])).id);
    await db.query(`UPDATE public.execution_engine_requests SET state = 'submitting' WHERE id = $1`, [requestId]);
    if (final === 'uncertain') {
      await db.query(`UPDATE public.execution_engine_requests SET state = 'uncertain', external_ref = $2, detail = 'whatsapp_enqueue_uncertain' WHERE id = $1`, [requestId, `bcast-${requestId.slice(0, 8)}`]);
    } else {
      await db.query(`UPDATE public.execution_engine_requests SET state = 'submitted', external_ref = $2 WHERE id = $1`, [requestId, `bcast-${requestId.slice(0, 8)}`]);
      if (final !== 'submitted') await db.query(`UPDATE public.execution_engine_requests SET state = $2 WHERE id = $1`, [requestId, final]);
    }
  }
  return { actor, prospectId, instanceId, workflowId, campaignId: String(inst.campaign_id), taskId: String(task.id), requestId };
}
const requestRow = (id: string) => one('SELECT state, external_ref, queued_at::text AS queued_at, updated_at::text AS updated_at, detail FROM public.execution_engine_requests WHERE id = $1', [id]);
const acks = (org = ORG_A) => rows('SELECT * FROM public.execution_uncertain_acknowledgements WHERE organization_id = $1 ORDER BY acknowledged_at', [org]);

beforeAll(async () => {
  await db.query('BEGIN');
  await seedTenants();
  await enableOutreach(ORG_A, ['whatsapp']);
  await enableOutreach(ORG_B, ['whatsapp']);
  await db.query('COMMIT');
});

describe('E on real PostgreSQL: ending a run', () => {
  it('a run with no uncertain communication ends normally; nothing is acknowledged', async () => {
    await inRollback(async () => {
      for (const final of ['completed', 'failed', 'submitted', null] as const) {
        const p = await personWithRequest(ORG_A, final);
        const out = await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel' });
        expect(out.status).toBe(200);
        expect(out.json.acknowledgement).toBeNull();
        expect(await instanceState(p.instanceId)).toBe('cancelled');
      }
      expect(await acks()).toEqual([]);
    });
  });

  it('cancel is HELD with the warning: the communication, its channel, queue time and broadcast reference; the run stays open', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      const before = await requestRow(p.requestId!);
      const out = await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel' });
      expect(out.status).toBe(409);
      expect(out.json.code).toBe('uncertain_communication_unacknowledged');
      const w = out.json.warning as Row;
      expect(w.acknowledgementIsNotApproval).toBe(true);
      expect(w.message).toMatch(/may already have been sent/);
      const [c] = w.communications as Row[];
      expect(c).toMatchObject({ requestId: p.requestId, executionTaskId: p.taskId, executionInstanceId: p.instanceId, engine: 'whatsapp', channel: 'whatsapp', reference: before.external_ref });
      expect(Date.parse(String(c.queuedAt))).toBe(Date.parse(String(before.queued_at)));
      expect(await instanceState(p.instanceId)).not.toBe('cancelled');
      expect((await decisions(p.instanceId)).some((d) => d.outcome === 'cancelled_by_person')).toBe(false);
      expect(await acks()).toEqual([]);
    });
  });

  it('acknowledged: recorded durably with the actor, time, operation and references; the run ends; the request stays uncertain, untouched', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      const before = await requestRow(p.requestId!);
      const w = (await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel' })).json.warning as Row;
      const out = await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel', acknowledgeUncertain: w.acknowledgementKey });
      expect(out.status).toBe(200);
      expect(await instanceState(p.instanceId)).toBe('cancelled');
      const [a] = await acks();
      expect(a).toMatchObject({ operation: 'end_run', execution_instance_id: p.instanceId, actor_user_id: p.actor, campaign_id: null, workflow_id: null, history_unreadable: false, acknowledgement_key: w.acknowledgementKey });
      expect(a.acknowledged_at).toBeInstanceOf(Date);
      expect(a.communications).toEqual([expect.objectContaining({ requestId: p.requestId, reference: before.external_ref })]);
      expect((out.json.acknowledgement as Row).id).toBe(a.id);
      expect(await requestRow(p.requestId!)).toEqual(before);          // state, reference, queue time, updated_at, detail: unchanged
      expect((await decisions(p.instanceId)).find((d) => d.outcome === 'cancelled_by_person')!.reasons).toEqual([`actor:${p.actor}`]);
    });
  });

  it('ending by lifecycle state is held and acknowledged the same way', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      const held = await callRoute(instanceRoute, 'PATCH', p.instanceId, { lifecycleState: 'cancelled' });
      expect(held.status).toBe(409);
      expect(await instanceState(p.instanceId)).not.toBe('cancelled');
      const key = (held.json.warning as Row).acknowledgementKey;
      expect((await callRoute(instanceRoute, 'PATCH', p.instanceId, { lifecycleState: 'cancelled', acknowledgeUncertain: key })).status).toBe(200);
      expect(await instanceState(p.instanceId)).toBe('cancelled');
      expect(await acks()).toHaveLength(1);
      expect((await requestRow(p.requestId!)).state).toBe('uncertain');
    });
  });

  it('a wrong or another operator\'s key is refused and nothing is recorded', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      const key = String(((await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel' })).json.warning as Row).acknowledgementKey);
      expect((await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel', acknowledgeUncertain: 'f'.repeat(64) })).json.code).toBe('acknowledgement_stale');
      mockActor.id = await newUser();                                   // another operator, same key
      expect((await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel', acknowledgeUncertain: key })).json.code).toBe('acknowledgement_stale');
      expect(await acks()).toEqual([]);
      expect(await instanceState(p.instanceId)).not.toBe('cancelled');
    });
  });
});

describe('E on real PostgreSQL: enrolling a person again', () => {
  it('re-enrolment is held, naming the earlier run; acknowledged, it is recorded and the new run is created', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'cancelled' WHERE id = $1`, [p.instanceId]);
      const body = { workflowId: p.workflowId, subjectKind: 'prospect', subjectId: p.prospectId };
      const held = await callRoute(invokeRoute, 'POST', p.campaignId, body);
      expect(held.status).toBe(409);
      const w = held.json.warning as Row;
      expect(w.operation).toBe('reenrol');
      expect((w.communications as Row[])[0]).toMatchObject({ requestId: p.requestId, executionInstanceId: p.instanceId });
      expect(Number((await one('SELECT count(*)::int AS n FROM public.execution_instances WHERE subject_id = $1', [p.prospectId])).n)).toBe(1);

      const ok = await callRoute(invokeRoute, 'POST', p.campaignId, { ...body, acknowledgeUncertain: w.acknowledgementKey });
      expect(ok.status).toBe(201);
      const [a] = await acks();
      expect(a).toMatchObject({ operation: 'reenrol', execution_instance_id: p.instanceId, campaign_id: p.campaignId, workflow_id: p.workflowId, actor_user_id: p.actor });
      expect((await requestRow(p.requestId!)).state).toBe('uncertain');
    });
  });

  it('the old acknowledgement cannot authorize a LATER re-enrolment of the same person', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'cancelled' WHERE id = $1`, [p.instanceId]);
      const body = { workflowId: p.workflowId, subjectKind: 'prospect', subjectId: p.prospectId };
      const key = (await callRoute(invokeRoute, 'POST', p.campaignId, body)).json.warning as Row;
      const second = await callRoute(invokeRoute, 'POST', p.campaignId, { ...body, acknowledgeUncertain: key.acknowledgementKey });
      expect(second.status).toBe(201);
      const secondRun = String((second.json.instance as Row).id);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'cancelled' WHERE id = $1`, [secondRun]);
      const replay = await callRoute(invokeRoute, 'POST', p.campaignId, { ...body, acknowledgeUncertain: key.acknowledgementKey });
      expect(replay.status).toBe(409);
      expect(replay.json.code).toBe('acknowledgement_stale');
      // Both runs were written in this one transaction, so they share created_at and either may be
      // "latest"; the key binds EVERY run of the person, which is why the replay is stale regardless.
      expect([secondRun, p.instanceId]).toContain((replay.json.warning as Row).executionInstanceId);
      expect(await acks()).toHaveLength(1);
    });
  });

  it('batch enrolment holds that person (needs_acknowledgement, with the warning) and enrols them once acknowledged', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'cancelled' WHERE id = $1`, [p.instanceId]);
      const run = (extra: Row = {}) => enrollCampaignTargets({ organizationId: ORG_A, campaignId: p.campaignId, workflowId: p.workflowId, actorUserId: p.actor, ...extra });
      const preview = await run({ dryRun: true });
      expect(preview.needsAcknowledgement).toBe(1);
      const held = await run();
      expect(held.enrolled).toBe(0);
      const o = held.outcomes.find((x: Row) => x.prospectId === p.prospectId);
      expect(o).toMatchObject({ outcome: 'needs_acknowledgement', reasons: ['uncertain_communication_unacknowledged'] });
      expect(await acks()).toEqual([]);
      const done = await run({ acknowledgements: { [p.prospectId]: o.warning.acknowledgementKey } });
      expect(done.enrolled).toBe(1);
      expect(await acks()).toHaveLength(1);
    });
  });

  it('another tenant cannot discover the uncertain history: same ids, another tenant, nothing to warn about', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      const scope = { kind: 'subject', subjectKind: 'prospect', subjectId: p.prospectId, campaignId: p.campaignId, workflowId: p.workflowId };
      expect(await checkUncertainAcknowledgement({ organizationId: ORG_B, operation: 'reenrol', scope, actorUserId: p.actor, acknowledgementKey: undefined, onUnreadable: 'refuse' }))
        .toEqual({ ok: true, acknowledged: null });
      expect(await checkUncertainAcknowledgement({ organizationId: ORG_B, operation: 'end_run', scope: { kind: 'run', executionInstanceId: p.instanceId }, actorUserId: p.actor, acknowledgementKey: undefined, onUnreadable: 'warn' }))
        .toEqual({ ok: true, acknowledged: null });
      expect((await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel' }, ORG_B)).status).toBe(404);   // the route's bind
      expect(await acks(ORG_B)).toEqual([]);
    });
  });
});

describe('E on real PostgreSQL: acknowledgement is not approval', () => {
  it('after an acknowledged re-enrolment, the D-2 claim STILL defers the new run\'s WhatsApp step on the uncertain send', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      await db.query(`UPDATE public.execution_instances SET lifecycle_state = 'cancelled' WHERE id = $1`, [p.instanceId]);
      const body = { workflowId: p.workflowId, subjectKind: 'prospect', subjectId: p.prospectId };
      const key = ((await callRoute(invokeRoute, 'POST', p.campaignId, body)).json.warning as Row).acknowledgementKey;
      const created = await callRoute(invokeRoute, 'POST', p.campaignId, { ...body, acknowledgeUncertain: key });
      const newRun = String((created.json.instance as Row).id);
      await createExecutionPlan({ organizationId: ORG_A, executionInstanceId: newRun });
      const task = await one('SELECT id FROM public.execution_tasks WHERE organization_id = $1 AND execution_instance_id = $2', [ORG_A, newRun]);
      await db.query(`INSERT INTO public.execution_engine_requests (organization_id, execution_task_id, engine, state) VALUES ($1, $2, 'whatsapp', 'requested')`, [ORG_A, task.id]);
      const claim = await one(`SELECT outcome, basis FROM public.orch_claim_engine_request($1, $2, NULL, 24, now(), $3, 5000)`, [ORG_A, task.id, NON_CONTACT]);
      expect(claim).toEqual({ outcome: 'deferred', basis: 'possible_contact' });
      expect((await one('SELECT state FROM public.execution_engine_requests WHERE execution_task_id = $1', [task.id])).state).toBe('requested');
    });
  });

  it('acknowledging writes no approval, no governance, no ledger change and no delivery evidence', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A);
      const count = async (t: string) => Number((await one(`SELECT count(*)::int AS n FROM public.${t} WHERE organization_id = $1`, [ORG_A])).n);
      const approvals = async () => Number((await one(`SELECT count(*)::int AS n FROM public.execution_approvals WHERE company_id = $1`, [ORG_A])).n);
      const suppression = async () => Number((await one(`SELECT count(*)::int AS n FROM public.suppression_entries WHERE company_id IN ($1, '__global__')`, [ORG_A])).n);
      const before = {
        approvals: await approvals(), governance: await count('contact_governance_records'), suppression: await suppression(),
        ledger: JSON.stringify(await rows('SELECT * FROM public.execution_engine_requests WHERE organization_id = $1 ORDER BY id', [ORG_A])),
      };
      const key = ((await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel' })).json.warning as Row).acknowledgementKey;
      await callRoute(progressionRoute, 'POST', p.instanceId, { action: 'cancel', acknowledgeUncertain: key });
      expect(await approvals()).toBe(before.approvals);
      expect(await count('contact_governance_records')).toBe(before.governance);
      expect(await suppression()).toBe(before.suppression);
      expect(JSON.stringify(await rows('SELECT * FROM public.execution_engine_requests WHERE organization_id = $1 ORDER BY id', [ORG_A]))).toBe(before.ledger);
    });
  });
});

describe('E on real PostgreSQL: the record', () => {
  const insertAck = (c: typeof db, key: string, instanceId: string, actor: string, extra: Row = {}) => c.query(
    `INSERT INTO public.execution_uncertain_acknowledgements (organization_id, operation, execution_instance_id, actor_user_id, communications, acknowledgement_key, campaign_id, workflow_id, history_unreadable)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
    [ORG_A, extra.operation ?? 'end_run', instanceId, actor, JSON.stringify(extra.communications ?? [{ requestId: 'r' }]), key, extra.campaign_id ?? null, extra.workflow_id ?? null, extra.history_unreadable ?? false],
  );
  const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return String((e as { code?: string }).code); } };

  it('is append-only, idempotent on the key, and refuses a malformed record', async () => {
    await inRollback(async () => {
      const p = await personWithRequest(ORG_A, null);
      const k = 'a'.repeat(64);
      await db.query('SAVEPOINT s');
      expect(await code(insertAck(db, k, p.instanceId, p.actor))).toBe('ok');
      await db.query('SAVEPOINT s1');
      expect(await code(insertAck(db, k, p.instanceId, p.actor))).toBe('23505');
      await db.query('ROLLBACK TO SAVEPOINT s1');
      expect(await code(db.query(`UPDATE public.execution_uncertain_acknowledgements SET actor_user_id = gen_random_uuid() WHERE acknowledgement_key = $1`, [k]))).toBe('23514');
      await db.query('ROLLBACK TO SAVEPOINT s1');
      for (const [extra, expected] of [
        [{ operation: 'approve' }, '23514'],
        [{ operation: 'reenrol' }, '23514'],                                        // reenrol needs its campaign and workflow
        [{ communications: [] }, '23514'],                                          // nothing acknowledged
        [{ communications: {} }, '23514'],
      ] as Array<[Row, string]>) {
        expect(await code(insertAck(db, 'b'.repeat(64), p.instanceId, p.actor, extra))).toBe(expected);
        await db.query('ROLLBACK TO SAVEPOINT s1');
      }
      expect(await code(insertAck(db, 'NOT-A-KEY', p.instanceId, p.actor))).toBe('23514');
      await db.query('ROLLBACK TO SAVEPOINT s1');
      expect(await code(insertAck(db, 'c'.repeat(64), '00000000-0000-4000-8000-000000000999', p.actor))).toBe('23503');
      await db.query('ROLLBACK TO SAVEPOINT s1');
    });
  });

  it('privileges: no client role can reach it; service_role may only read and insert', async () => {
    const roles = (await rows(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`)).map((r) => String(r.rolname));
    for (const r of roles.filter((x) => x !== 'service_role')) {
      expect((await one(`SELECT has_table_privilege($1, 'public.execution_uncertain_acknowledgements', 'SELECT,INSERT,UPDATE,DELETE') AS p`, [r])).p).toBe(false);
    }
    if (roles.includes('service_role')) {
      const priv = async (p: string) => (await one(`SELECT has_table_privilege('service_role', 'public.execution_uncertain_acknowledgements', $1) AS p`, [p])).p;
      expect(await priv('SELECT')).toBe(true);
      expect(await priv('INSERT')).toBe(true);
      for (const p of ['UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv(p)).toBe(false);
    }
  });
});
