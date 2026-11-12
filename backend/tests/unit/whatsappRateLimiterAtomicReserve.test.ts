/**
 * CLASS-2 (e9 sweep, B5): the Redis layer of the WhatsApp daily limit reserves ATOMICALLY.
 *
 * It used to GET the day's count, compare, then INCRBY: two enqueues on one number (two
 * broadcasts - the enqueue lease is per broadcast, not per number) both read room and both
 * consumed it, over the tier/plan limit. And a failed INCRBY (null) answered allowed:true with
 * nothing counted. Now one INCRBY is the reservation: over the limit it is given back and
 * refused; a failed INCRBY falls to the database layer (atomic, fails closed).
 *
 * The REAL checkAndConsume, over an in-memory Redis whose GET yields to the event loop (so the
 * old GET-then-INCRBY interleaves exactly as two concurrent requests would).
 */
type RpcAnswer = { data: unknown; error: { message: string } | null };
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<RpcAnswer> = async () => ({ data: null, error: null });

jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return rpcImpl(fn, args); } },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const api: Record<string, unknown> = { select: () => api, eq: () => api, single: async () => ({ data: { messaging_tier: 1 }, error: null }) };
    return api;
  },
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return rpcImpl(fn, args); },
}));

const store = new Map<string, number>();
let incrbyImpl: ((k: string, n: number) => Promise<number>) | null = null;
const yieldTick = () => new Promise<void>((r) => setImmediate(r));
jest.mock('../../queue/bullmqClient', () => ({
  getSharedRedisClient: () => ({
    status: 'ready',
    get: async (k: string) => { await yieldTick(); return store.has(k) ? String(store.get(k)) : null; },
    incrby: async (k: string, n: number) => {
      if (incrbyImpl) return incrbyImpl(k, n);
      await yieldTick();
      const v = (store.get(k) ?? 0) + n; store.set(k, v); return v;
    },
    decrby: async (k: string, n: number) => { const v = (store.get(k) ?? 0) - n; store.set(k, v); return v; },
    expire: async () => 1,
  }),
}));

import { checkAndConsume } from '../../services/whatsappRateLimiter';

// Tier 1 (1,000/day) and plan pro (5,000): the effective limit is 1,000.
const params = (count: number) => ({ social_account_id: 'sa-1', phone_number_id: 'pn-1', company_id: 'co-a', plan: 'pro', count });
const used = () => [...store.values()].reduce((a, b) => a + b, 0);

beforeEach(() => {
  store.clear(); rpcCalls.length = 0; incrbyImpl = null;
  rpcImpl = async () => ({ data: null, error: null });
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('two concurrent reservations that fit alone but not together: exactly ONE is allowed, and only it is counted', async () => {
  const [a, b] = await Promise.all([checkAndConsume(params(600)), checkAndConsume(params(600))]);
  expect([a.allowed, b.allowed].filter(Boolean)).toHaveLength(1);
  expect(used()).toBe(600);
});

it('over the limit: refused, and the reservation is given back (the day is not consumed by a refusal)', async () => {
  store.set(`wa:usage:pn-1:${new Date().toISOString().slice(0, 10)}`, 950);
  const r = await checkAndConsume(params(100));
  expect(r).toMatchObject({ allowed: false, source: 'redis', remaining: 50 });
  expect(used()).toBe(950);
});

it('a FAILED INCRBY is never "allowed" on Redis\' word: the database layer decides (and fails closed)', async () => {
  incrbyImpl = async () => { throw new Error('Connection is closed.'); };
  rpcImpl = async () => ({ data: null, error: { message: 'unavailable' } });
  const r = await checkAndConsume(params(10));
  expect(r).toMatchObject({ allowed: false, source: 'db' });
  expect(rpcCalls.map((c) => c.fn)).toEqual(['whatsapp_consume_daily_quota']);
});

it('NEGATIVE CONTROL: within the limit -> allowed from Redis and counted, the database untouched', async () => {
  const r = await checkAndConsume(params(10));
  expect(r).toMatchObject({ allowed: true, source: 'redis', remaining: 990 });
  expect(used()).toBe(10);
  expect(rpcCalls).toEqual([]);
});
