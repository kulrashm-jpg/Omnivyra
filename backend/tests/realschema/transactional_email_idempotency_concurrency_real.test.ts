/**
 * The reserve-first RACE on real PostgreSQL, with independent connections (committing suite - it runs in the
 * committing pass where that exists). Two sends with one key at the same moment: exactly ONE reserves; the other
 * waits on the unique index, then is told 'duplicate_inflight' (and, after the winner's confirm, 'duplicate_sent').
 * CONTROL: the same two connections with DIFFERENT keys both reserve, so a refusal above is the key's, not the
 * harness's. Rows are committed under random keys in a table no other suite reads, and removed in afterAll on this
 * suite's own connection.
 */
import { randomBytes } from 'crypto';
import { Client } from 'pg';

const H = 'b'.repeat(64);
const keys: string[] = [];
const newKey = () => { const k = `race-${randomBytes(8).toString('hex')}`; keys.push(k); return k; };
let c1: Client;
let c2: Client;
let pid2: number;
async function reserve(c: Client, key: string): Promise<string> {
  const { rows } = await c.query(`SELECT outcome FROM public.transactional_email_reserve($1, 'team_invite', $2, 3600, 900)`, [key, H]);
  return rows[0].outcome;
}
async function waitUntilBlocked(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const { rows } = await c1.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid2]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('connection 2 never waited on the reservation');
}

beforeAll(async () => {
  c1 = new Client({ connectionString: process.env.W6_DB_URL });
  c2 = new Client({ connectionString: process.env.W6_DB_URL });
  await c1.connect();
  await c2.connect();
  pid2 = Number((await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
});
afterAll(async () => {
  await c1?.query('ROLLBACK').catch(() => undefined);
  await c2?.query('ROLLBACK').catch(() => undefined);
  if (c1 && keys.length) await c1.query(`DELETE FROM public.transactional_email_sends WHERE idempotency_key = ANY($1::text[])`, [keys]);
  await c1?.end().catch(() => undefined);
  await c2?.end().catch(() => undefined);
});

it('one key, two connections at once: exactly one reserves; the other WAITS, then is a duplicate - never a second send', async () => {
  const k = newKey();
  await c1.query('BEGIN');
  expect(await reserve(c1, k)).toBe('reserved');
  const second = reserve(c2, k);
  await waitUntilBlocked();
  await c1.query('COMMIT');
  expect(await second).toBe('duplicate_inflight');
  await c1.query(`SELECT public.transactional_email_confirm($1, 'mid-1')`, [k]);
  expect(await reserve(c2, k)).toBe('duplicate_sent');
});

it('CONTROL - different keys on the same two connections both reserve (the refusal above is the key\'s)', async () => {
  const [a, b] = [newKey(), newKey()];
  await c1.query('BEGIN');
  expect(await reserve(c1, a)).toBe('reserved');
  expect(await reserve(c2, b)).toBe('reserved');
  await c1.query('COMMIT');
});
