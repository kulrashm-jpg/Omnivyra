/**
 * Orchestration, Follow-up E — CONCURRENT operators, on REAL PostgreSQL with INDEPENDENT
 * CONNECTIONS (migration 20270129000002).
 *
 * This file COMMITS its rows (a person with an uncertain WhatsApp request in ORG_A), so it runs
 * in its own pass, never beside suites that sweep ORG_A. The rest of E is
 * e_uncertain_acknowledgement_real.test.ts.
 *
 * Real: the routes' handlers (progression cancel, the run route, single enrolment), campaign
 * enrolment, the acknowledgement module, the instance store, the ledger and its D-2 trigger,
 * the D-2 claim function. Replaced: the session and capability checks in front of the routes
 * (an authenticated person is simulated, as every real-schema route suite does) and the
 * idempotency wrapper of the single-enrolment route (it needs an HTTP idempotency key).
 *
 * The concurrency section COMMITS its rows and races two independent `pg` connections, like
 * d2_frequency_claim_concurrency_real.test.ts; everything else runs inside inRollback.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { db } from './setup';

import { enableOutreach, enrol, humanStep, instanceState, newProspect, newUser, one } from './helpers/journeyFixtures';

// FRESH TENANTS FOR THIS SUITE (2026-11-11). This suite COMMITS its fixtures, because two independent
// `pg` connections must see them, and its journeys, tasks and ledger rows are append-only, so they cannot
// be cleaned up afterwards. On the shared ORG_A / ORG_B they leaked into every later suite's PER-TENANT
// counts, e.g. orch_response_matrix's `sweep(ORG_B).instances_scanned`, p4_reply_suspension and
// p4_governance_whatsapp D-2 (5 red when the D2 suite runs first, green when it runs last). Two tenants
// of its own make it invisible to every other suite whatever the order. The only rows it leaves are
// inert: two `companies` rows that no suite counts.
const ORG_A = randomUUID();
const ORG_B = randomUUID();
async function seedTenants(): Promise<void> {
  for (const [id, name] of [[ORG_A, 'E uncertain ack isolated tenant A'], [ORG_B, 'E uncertain ack isolated tenant B']]) {
    await db.query('INSERT INTO public.companies (id, name) VALUES ($1, $2)', [id, name]);
  }
}

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
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');
/* eslint-enable @typescript-eslint/no-var-requires */

type Row = Record<string, unknown>;
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

beforeAll(async () => {
  await db.query('BEGIN');
  await seedTenants();
  await enableOutreach(ORG_A, ['whatsapp']);
  await enableOutreach(ORG_B, ['whatsapp']);
  await db.query('COMMIT');
});

describe('E on real PostgreSQL: concurrent operators (two independent connections)', () => {
  let c1: Client;
  let c2: Client;
  let committed: { instanceId: string; actor: string; requestId: string | null };
  let pid2 = 0;
  beforeAll(async () => {
    await db.query('BEGIN');
    try {
      committed = await personWithRequest(ORG_A);
      await db.query('COMMIT');
    } catch (e) { await db.query('ROLLBACK'); throw e; }
    c1 = new Client({ connectionString: process.env.W6_DB_URL });
    c2 = new Client({ connectionString: process.env.W6_DB_URL });
    await c1.connect();
    await c2.connect();
    pid2 = Number((await c2.query('SELECT pg_backend_pid() AS p')).rows[0].p);
  });
  afterAll(async () => {
    await c1?.end().catch(() => undefined);
    await c2?.end().catch(() => undefined);
  });

  it('two operators acknowledging the same warning at once leave exactly ONE record; the second waits, then sees it', async () => {
    const key = 'd'.repeat(64);
    const sql = `INSERT INTO public.execution_uncertain_acknowledgements (organization_id, operation, execution_instance_id, actor_user_id, communications, acknowledgement_key)
                 VALUES ($1, 'end_run', $2, $3, '[{"requestId":"r"}]'::jsonb, $4)`;
    await c1.query('BEGIN');
    await c1.query(sql, [ORG_A, committed.instanceId, committed.actor, key]);
    const second = c2.query(sql, [ORG_A, committed.instanceId, committed.actor, key]).then(() => 'ok', (e: { code?: string }) => String(e.code));
    await new Promise((r) => setTimeout(r, 600));
    // The second backend is blocked on the first's uncommitted unique-index entry, not done.
    expect(Number((await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`, [pid2])).rows[0].n)).toBe(1);
    await c1.query('COMMIT');
    expect(await second).toBe('23505');
    expect(Number((await db.query(`SELECT count(*)::int AS n FROM public.execution_uncertain_acknowledgements WHERE acknowledgement_key = $1`, [key])).rows[0].n)).toBe(1);
  });

  it('concurrent un-acknowledged endings are both held: neither bypasses the warning, nothing is recorded, the run stays open', async () => {
    mockActor.id = committed.actor;
    await db.query('BEGIN');                                              // the route transport works inside a transaction
    try {
      const [a, b] = await Promise.all([
        callRoute(progressionRoute, 'POST', committed.instanceId, { action: 'cancel' }),
        callRoute(instanceRoute, 'PATCH', committed.instanceId, { lifecycleState: 'cancelled' }),
      ]);
      expect([a.status, b.status]).toEqual([409, 409]);
      expect(await instanceState(committed.instanceId)).not.toBe('cancelled');
      expect(Number((await db.query(`SELECT count(*)::int AS n FROM public.execution_uncertain_acknowledgements WHERE execution_instance_id = $1 AND acknowledgement_key <> $2`, [committed.instanceId, 'd'.repeat(64)])).rows[0].n)).toBe(0);
    } finally { await db.query('ROLLBACK'); }
  });
});
