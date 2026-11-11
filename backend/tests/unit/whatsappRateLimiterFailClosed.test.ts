/**
 * The WhatsApp daily limit's DATABASE fallback fails CLOSED (C10, 2026-11-11).
 *
 * Before: during a Redis outage the fallback read a row that never exists
 * (api_provider_accounts by account_name) as usage 0 and "incremented" through
 * rpc('increment_wa_usage'), a function that exists nowhere, discarding the error -
 * so every send was allowed. Now it makes one call to whatsapp_consume_daily_quota
 * (atomic check-and-consume) and refuses on any error, throw, or missing answer.
 *
 * Redis is forced unavailable (its commands reject), so every case below exercises
 * the database layer through the REAL checkAndConsume.
 */

type RpcAnswer = { data: unknown; error: { message: string } | null };

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<RpcAnswer> = async () => ({ data: null, error: null });
const tablesRead: string[] = [];
let redisStatus = 'end';
let tier: number | null = 1;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcImpl(fn, args);
    },
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    tablesRead.push(table);
    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      single: async () => ({ data: table === 'social_accounts' && tier !== null ? { messaging_tier: tier } : null, error: null }),
    };
    return api;
  },
}));

const redisStore = new Map<string, number>();
jest.mock('../../queue/bullmqClient', () => ({
  getSharedRedisClient: () => ({
    get status() { return redisStatus; },
    // Unavailable Redis REJECTS (main's limiter falls back on a rejected command;
    // S additionally skips a client whose status is not 'ready', 53aff0766).
    get: async (k: string) => {
      if (redisStatus !== 'ready') throw new Error('Connection is closed.');
      return redisStore.has(k) ? String(redisStore.get(k)) : null;
    },
    incrby: async (k: string, n: number) => { const v = (redisStore.get(k) ?? 0) + n; redisStore.set(k, v); return v; },
    expire: async () => 1,
  }),
}));

import { checkAndConsume } from '../../services/whatsappRateLimiter';

const params = (over: Partial<Parameters<typeof checkAndConsume>[0]> = {}) => ({
  social_account_id: 'sa-1', phone_number_id: 'sa-1', company_id: 'co-a', plan: 'free', count: 10, ...over,
});

let errSpy: jest.SpyInstance;
beforeEach(() => {
  rpcCalls.length = 0; tablesRead.length = 0; redisStore.clear();
  redisStatus = 'end'; tier = 1;
  rpcImpl = async () => ({ data: null, error: null });
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

describe('WhatsApp daily limit - database fallback fails CLOSED', () => {
  it('an RPC ERROR refuses the send (was: allowed) and logs at ERROR', async () => {
    rpcImpl = async () => ({ data: null, error: { message: 'function does not exist' } });
    const r = await checkAndConsume(params());
    expect(r).toMatchObject({ allowed: false, remaining: 0, source: 'db' });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('fail closed'), expect.objectContaining({ social_account_id: 'sa-1' }));
  });

  it('a THROWN call refuses the send', async () => {
    rpcImpl = async () => { throw new Error('socket hang up'); };
    expect((await checkAndConsume(params())).allowed).toBe(false);
  });

  it.each([
    ['null data', null],
    ['an empty set', []],
    ['a row without allowed', [{ used: 3 }]],
    ['a row with a string used', [{ allowed: true, used: '3' }]],
  ])('NO ANSWER (%s, error:null) refuses the send - no answer is not "allowed"', async (_l, data) => {
    rpcImpl = async () => ({ data, error: null });
    expect((await checkAndConsume(params())).allowed).toBe(false);
  });

  it('the function refusing (over the limit) refuses the send and reports what is left', async () => {
    rpcImpl = async () => ({ data: [{ allowed: false, used: 95 }], error: null });
    const r = await checkAndConsume(params());
    expect(r).toMatchObject({ allowed: false, remaining: 5, source: 'db' });
  });

  it('NEGATIVE CONTROL: the function allowing allows the send, with the remaining budget', async () => {
    rpcImpl = async () => ({ data: [{ allowed: true, used: 10 }], error: null });
    const r = await checkAndConsume(params());
    expect(r).toMatchObject({ allowed: true, remaining: 90, source: 'db' });
  });

  it('ONE atomic call with the effective limit (min of tier and plan) and the UTC day; no increment_wa_usage, no api_provider_accounts', async () => {
    rpcImpl = async () => ({ data: [{ allowed: true, used: 10 }], error: null });
    await checkAndConsume(params({ plan: 'free' })); // tier 1 = 1000, free = 100 -> 100
    expect(rpcCalls).toEqual([{
      fn: 'whatsapp_consume_daily_quota',
      args: { p_social_account_id: 'sa-1', p_usage_day: new Date().toISOString().slice(0, 10), p_count: 10, p_limit: 100 },
    }]);
    expect(tablesRead).not.toContain('api_provider_accounts');
  });

  it('an unlimited tier and plan is still metered (integer maximum), never skipped', async () => {
    tier = 4;
    rpcImpl = async () => ({ data: [{ allowed: true, used: 10 }], error: null });
    const r = await checkAndConsume(params({ plan: 'enterprise' }));
    expect(rpcCalls[0].args.p_limit).toBe(2_147_483_647);
    expect(r).toMatchObject({ allowed: true, remaining: Infinity });
  });

  it('NEGATIVE CONTROL: with Redis READY the database is not consulted (Redis answers)', async () => {
    redisStatus = 'ready';
    const r = await checkAndConsume(params());
    expect(r).toMatchObject({ allowed: true, source: 'redis' });
    expect(rpcCalls).toHaveLength(0);
  });
});
