/**
 * Follow-up D-2 — the atomic frequency claim (public.orch_claim_engine_request, migration
 * 20270129000001) on REAL PostgreSQL, with INDEPENDENT CONNECTIONS and genuinely concurrent
 * transactions.
 *
 * Unlike the rest of the real-schema suite this file does NOT use inRollback: the rows it
 * needs are COMMITTED through the shared fixture client, so two separate `pg` clients (two
 * backends, two transactions) can race on them. Every test uses its own people and tasks, so
 * the tests do not interfere; the database is disposable.
 *
 * What is proven, by observation of the database (pg_stat_activity, row states), not by mocks:
 *   - two workers cannot both pass the gap and claim for the same tenant/person;
 *   - unrelated people and other tenants are not blocked;
 *   - COMMIT, ROLLBACK and an error inside the transaction all release the person's lock;
 *   - a lock wait is bounded (55P03); two callers locking two people in opposite order are
 *     resolved by PostgreSQL's deadlock detector (40P01) and every lock is released after;
 *   - queued_at is set once and survives every later transition; a contradictory history
 *     fails closed; terminal outcomes stop counting; the gap boundary is exact.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { db } from './setup';

import { enableOutreach, enrol, humanStep, newProspect, newUser, one } from './helpers/journeyFixtures';

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
  for (const [id, name] of [[ORG_A, 'D2 frequency isolated tenant A'], [ORG_B, 'D2 frequency isolated tenant B']]) {
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureProspectLifecycleOpen } = require('../../services/prospectLifecycle');

const NON_CONTACT = ['internal', 'social_post'];

let c1: Client;
let c2: Client;
let pid2: number;
let actorA: string;
let actorB: string;

beforeAll(async () => {
  await db.query('BEGIN');
  await seedTenants();
  await enableOutreach(ORG_A, ['whatsapp']);
  await enableOutreach(ORG_B, ['whatsapp']);
  actorA = await newUser();
  actorB = await newUser();
  await db.query('COMMIT');
  c1 = new Client({ connectionString: process.env.W6_DB_URL });
  c2 = new Client({ connectionString: process.env.W6_DB_URL });
  await c1.connect();
  await c2.connect();
  pid2 = Number((await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
});
afterAll(async () => {
  await c1?.end().catch(() => undefined);
  await c2?.end().catch(() => undefined);
});

/** A person in `org` with `n` WhatsApp journeys, each with one task and a `requested` ledger row (all COMMITTED). */
async function person(org: string, n: number): Promise<string[]> {
  // The fixture services write through pgTransport (savepoints), so the seed runs in one
  // transaction on the shared client, and is COMMITTED before any worker races on it.
  await db.query('BEGIN');
  try {
    const tasks = await seedPerson(org, n);
    await db.query('COMMIT');
    return tasks;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
async function seedPerson(org: string, n: number): Promise<string[]> {
  const actor = org === ORG_A ? actorA : actorB;
  const { prospectId } = await newProspect(org, { phone: `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}` });
  await ensureProspectLifecycleOpen({ organizationId: org, prospectId, now: new Date().toISOString() });
  const tasks: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { instanceId } = await enrol(org, actor, prospectId, { policy: { min_hours_between_actions: 24 }, steps: [humanStep(`wa-${i}`, 'whatsapp', { whatsapp: { template_name: 'hello_1' } })] });
    const t = await one(`SELECT id FROM public.execution_tasks WHERE organization_id = $1 AND execution_instance_id = $2`, [org, instanceId]);
    await db.query(`INSERT INTO public.execution_engine_requests (organization_id, execution_task_id, engine, state) VALUES ($1, $2, 'whatsapp', 'requested')`, [org, t!.id]);
    tasks.push(String(t!.id));
  }
  return tasks;
}
const orgOf = new Map<string, string>();
async function personIn(org: string, n: number): Promise<string[]> {
  const t = await person(org, n);
  for (const id of t) orgOf.set(id, org);
  return t;
}

/** The claim, as the adapters make it (one call = one transaction unless the caller opened one). */
type ClaimRow = { outcome: string; last_contact_at: string | null; basis: string | null };
function claim(c: Client, task: string, opts: { gap?: number | null; now?: Date | string; timeoutMs?: number } = {}): Promise<ClaimRow> {
  return c.query(
    'SELECT outcome, last_contact_at::text AS last_contact_at, basis FROM public.orch_claim_engine_request($1, $2, NULL, $3, $4, $5, $6)',
    [orgOf.get(task), task, opts.gap === undefined ? 24 : opts.gap, typeof opts.now === 'string' ? opts.now : (opts.now ?? new Date()).toISOString(), NON_CONTACT, opts.timeoutMs ?? 15000],
  ).then((r) => r.rows[0] as ClaimRow);
}
const request = async (task: string) =>
  (await db.query('SELECT state, queued_at, updated_at FROM public.execution_engine_requests WHERE execution_task_id = $1', [task])).rows[0] as { state: string; queued_at: Date | null; updated_at: Date };
const tracked = <T>(p: Promise<T>) => { const s = { done: false, value: undefined as T | undefined, error: undefined as unknown }; const q: Promise<T> = p.then((v) => { s.done = true; s.value = v; return v; }, (e: unknown) => { s.done = true; s.error = e; throw e; }); return { s, q }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Is backend `pid` waiting on a lock right now? */
const waitingOnLock = async (pid: number) =>
  Number((await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`, [pid])).rows[0].n) > 0;
const rollbackQuietly = async (c: Client) => { await c.query('ROLLBACK').catch(() => undefined); };

describe('D-2 atomic claim: two workers, one person', () => {
  it('the second worker WAITS on the person lock while the first holds its claim, then sees it and is deferred', async () => {
    const [x1, x2] = await personIn(ORG_A, 2);
    await c1.query('BEGIN');
    try {
      expect((await claim(c1, x1)).outcome).toBe('claimed');          // worker 1 holds the lock, uncommitted
      const w2 = tracked(claim(c2, x2));                                  // worker 2, its own connection and transaction
      await sleep(600);
      expect(w2.s.done).toBe(false);                                      // it has not passed the gate…
      expect(await waitingOnLock(pid2)).toBe(true);                       // …because it is blocked on the lock
      await c1.query('COMMIT');
      const r2 = await w2.q;
      expect(r2.outcome).toBe('deferred');                               // it then sees worker 1's claim
      expect(r2.basis).toBe('possible_contact');
    } finally { await rollbackQuietly(c1); }
    expect((await request(x1)).state).toBe('submitting');
    expect((await request(x2)).state).toBe('requested');                // exactly one claim
  });

  it('released by ROLLBACK: the first claim is undone and the second worker claims', async () => {
    const [x1, x2] = await personIn(ORG_A, 2);
    await c1.query('BEGIN');
    expect((await claim(c1, x1)).outcome).toBe('claimed');
    const w2 = tracked(claim(c2, x2));
    await sleep(400);
    expect(w2.s.done).toBe(false);
    await c1.query('ROLLBACK');
    expect((await w2.q).outcome).toBe('claimed');
    expect((await request(x1)).state).toBe('requested');
    expect((await request(x2)).state).toBe('submitting');
  });

  it('released by an ERROR in the holding transaction: nothing is left locked', async () => {
    const [x1, x2] = await personIn(ORG_A, 2);
    await c1.query('BEGIN');
    expect((await claim(c1, x1)).outcome).toBe('claimed');
    await expect(c1.query('SELECT 1 / 0')).rejects.toMatchObject({ code: '22012' });
    await c1.query('ROLLBACK');
    const started = Date.now();
    expect((await claim(c2, x2)).outcome).toBe('claimed');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a lock wait is bounded: 55P03 to the caller, and the holder is unaffected', async () => {
    const [x1, x2] = await personIn(ORG_A, 2);
    await c1.query('BEGIN');
    try {
      expect((await claim(c1, x1)).outcome).toBe('claimed');
      await expect(claim(c2, x2, { timeoutMs: 300 })).rejects.toMatchObject({ code: '55P03' });
      await c1.query('COMMIT');
    } finally { await rollbackQuietly(c1); }
    expect((await request(x1)).state).toBe('submitting');
    expect((await request(x2)).state).toBe('requested');
  });

  it('two callers locking two people in opposite order: PostgreSQL detects the deadlock (40P01) and every lock is released after', async () => {
    const [m1, m2] = await personIn(ORG_A, 2);
    const [n1, n2] = await personIn(ORG_A, 2);
    await c1.query('BEGIN');
    await c2.query('BEGIN');
    try {
      await claim(c1, m1);                                                // c1 holds person M
      await claim(c2, n1);                                                // c2 holds person N
      const a = tracked(claim(c1, n2));                                   // c1 waits for N
      await sleep(200);
      const b = tracked(claim(c2, m2));                                   // c2 waits for M: a cycle
      await Promise.allSettled([a.q, b.q]);
      const codes = [a.s.error, b.s.error].filter(Boolean).map((e) => (e as { code?: string }).code);
      expect(codes).toEqual(['40P01']);                                   // exactly one is chosen as the victim
    } finally { await rollbackQuietly(c1); await rollbackQuietly(c2); }
    // Nothing remains locked: both people claim at once, quickly.
    const started = Date.now();
    expect((await claim(c1, m1, { gap: null })).outcome).toBe('claimed');
    expect((await claim(c2, n1, { gap: null })).outcome).toBe('claimed');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('D-2 atomic claim: unrelated people and tenants are not serialized', () => {
  it('another person of the same tenant claims at once while the first person is locked', async () => {
    const [x1] = await personIn(ORG_A, 1);
    const [y1] = await personIn(ORG_A, 1);
    await c1.query('BEGIN');
    try {
      expect((await claim(c1, x1)).outcome).toBe('claimed');
      const started = Date.now();
      expect((await claim(c2, y1)).outcome).toBe('claimed');
      expect(Date.now() - started).toBeLessThan(2000);
      expect(await waitingOnLock(pid2)).toBe(false);
    } finally { await rollbackQuietly(c1); }
  });

  it('a person of another tenant claims at once while a person of this tenant is locked', async () => {
    const [x1] = await personIn(ORG_A, 1);
    const [z1] = await personIn(ORG_B, 1);
    await c1.query('BEGIN');
    try {
      expect((await claim(c1, x1)).outcome).toBe('claimed');
      const started = Date.now();
      expect((await claim(c2, z1)).outcome).toBe('claimed');
      expect(Date.now() - started).toBeLessThan(2000);
    } finally { await rollbackQuietly(c1); }
  });
});

describe('D-2 queued_at: set once, never moved', () => {
  it('recorded at the claim; kept through submitted, uncertain, repeated claims, and a released-and-reclaimed retry', async () => {
    const [x1] = await personIn(ORG_A, 1);
    expect((await request(x1)).queued_at).toBeNull();                   // requested: not a possible contact yet
    expect((await claim(c1, x1, { gap: null })).outcome).toBe('claimed');
    const q0 = (await request(x1)).queued_at;
    expect(q0).toBeInstanceOf(Date);

    // A retry: the stale claim is released, then claimed again later.
    await db.query(`UPDATE public.execution_engine_requests SET state = 'requested', detail = 'stale claim released' WHERE execution_task_id = $1`, [x1]);
    await sleep(50);
    expect((await claim(c1, x1, { gap: null })).outcome).toBe('claimed');
    expect((await request(x1)).queued_at).toEqual(q0);

    // Repeated processing: claiming again claims nothing and moves nothing.
    expect((await claim(c2, x1, { gap: null })).outcome).toBe('not_claimed');
    expect((await request(x1)).queued_at).toEqual(q0);

    await db.query(`UPDATE public.execution_engine_requests SET state = 'submitted', external_ref = 'bc-x' WHERE execution_task_id = $1`, [x1]);
    expect((await request(x1)).queued_at).toEqual(q0);
    await db.query(`UPDATE public.execution_engine_requests SET state = 'uncertain', detail = 'reconciled as uncertain' WHERE execution_task_id = $1`, [x1]);
    const after = await request(x1);
    expect(after.queued_at).toEqual(q0);
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(q0!.getTime());   // updated_at moves; queued_at does not

    // Nothing may rewrite it.
    await expect(db.query(`UPDATE public.execution_engine_requests SET queued_at = now() + interval '1 day' WHERE execution_task_id = $1`, [x1]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`UPDATE public.execution_engine_requests SET queued_at = NULL WHERE execution_task_id = $1`, [x1]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('a counted request with no queued_at (a contradiction) fails closed: invalid_history, nothing claimed', async () => {
    const [x1, x2] = await personIn(ORG_A, 2);
    expect((await claim(c1, x1, { gap: null })).outcome).toBe('claimed');
    // Simulate a row that escaped the trigger (e.g. written before it existed and missed by the backfill).
    await db.query('ALTER TABLE public.execution_engine_requests DISABLE TRIGGER trg_execution_engine_requests_queued_at');
    try {
      await db.query('UPDATE public.execution_engine_requests SET queued_at = NULL WHERE execution_task_id = $1', [x1]);
    } finally {
      await db.query('ALTER TABLE public.execution_engine_requests ENABLE TRIGGER trg_execution_engine_requests_queued_at');
    }
    expect((await claim(c2, x2)).outcome).toBe('invalid_history');
    expect((await request(x2)).state).toBe('requested');
    // Without a gap there is no history to trust or distrust: the claim is not refused.
    expect((await claim(c2, x2, { gap: null })).outcome).toBe('claimed');
  });
});

describe('D-2 frequency semantics in the database', () => {
  it('the gap boundary is exact: just inside defers, exactly at the gap claims', async () => {
    const [x1, x2] = await personIn(ORG_A, 2);
    expect((await claim(c1, x1, { gap: null })).outcome).toBe('claimed');
    // Computed in the database: queued_at has microseconds, a JS Date only milliseconds.
    const b = await one(`SELECT (queued_at + interval '24 hours')::text AS at_gap,
                                (queued_at + interval '24 hours' - interval '1 microsecond')::text AS inside,
                                queued_at::text AS q
                           FROM public.execution_engine_requests WHERE execution_task_id = $1`, [x1]);
    const inside = await claim(c2, x2, { now: String(b!.inside) });
    expect(inside.outcome).toBe('deferred');
    expect((await one('SELECT $1::timestamptz = $2::timestamptz AS same', [inside.last_contact_at, b!.q]))!.same).toBe(true);
    expect((await claim(c2, x2, { now: String(b!.at_gap) })).outcome).toBe('claimed');
  });

  it.each([
    ['failed (blocked by a send control, or refused)', 'failed'],
    ['skipped (blocked by governance)', 'skipped'],
  ])('a confirmed terminal outcome, %s, stops counting', async (_label, terminal) => {
    const [x1, x2] = await personIn(ORG_A, 2);
    expect((await claim(c1, x1, { gap: null })).outcome).toBe('claimed');
    await db.query(`UPDATE public.execution_engine_requests SET state = 'submitted', external_ref = 'bc-t' WHERE execution_task_id = $1`, [x1]);
    expect((await claim(c2, x2)).outcome).toBe('deferred');
    await db.query(`UPDATE public.execution_engine_requests SET state = $2 WHERE execution_task_id = $1`, [x1, terminal]);
    expect((await claim(c2, x2)).outcome).toBe('claimed');
  });

  it.each(['submitting', 'submitted', 'uncertain'])('a %s request of the same person defers', async (state) => {
    const [x1, x2] = await personIn(ORG_A, 2);
    expect((await claim(c1, x1, { gap: null })).outcome).toBe('claimed');
    if (state !== 'submitting') await db.query(`UPDATE public.execution_engine_requests SET state = 'submitted', external_ref = 'bc-s' WHERE execution_task_id = $1`, [x1]);
    if (state === 'uncertain') await db.query(`UPDATE public.execution_engine_requests SET state = 'uncertain' WHERE execution_task_id = $1`, [x1]);
    expect((await request(x1)).state).toBe(state);
    expect(await claim(c2, x2)).toMatchObject({ outcome: 'deferred', basis: 'possible_contact' });
  });

  it('the task being claimed never counts its own request', async () => {
    const [x1] = await personIn(ORG_A, 1);
    expect((await claim(c1, x1)).outcome).toBe('claimed');               // its own claim is not a prior contact
    // Claimed again (a second worker, or a replay): another caller holds it — never "deferred by itself".
    expect(await claim(c2, x1)).toMatchObject({ outcome: 'not_claimed', basis: null });
  });

  it('a task of another tenant is not found (tenant first)', async () => {
    const [z1] = await personIn(ORG_B, 1);
    const r = await c1.query('SELECT outcome FROM public.orch_claim_engine_request($1, $2, NULL, 24, now(), $3)', [ORG_A, z1, NON_CONTACT]);
    expect(r.rows[0].outcome).toBe('task_not_found');
    expect((await request(z1)).state).toBe('requested');
  });
});
