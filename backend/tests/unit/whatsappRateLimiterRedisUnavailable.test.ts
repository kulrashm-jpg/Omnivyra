/**
 * WhatsApp rate limiter: a disconnected Redis must not hang a send.
 *
 * The limiter reuses the shared BullMQ client (maxRetriesPerRequest null,
 * offline queue, endless reconnect). While it is not connected, a command is
 * queued and never rejected; before the status check, checkAndConsume (and the
 * broadcast batch waiting on it) hung until Redis returned and the database
 * fallback never ran. Same defect class as the WS-3 quota (b4a592074).
 *
 * The hanging double makes any issued command fail the test by timeout, so
 * "settles on the database layer" is proven, not assumed.
 *
 * The database layer is the atomic, fail-closed whatsapp_consume_daily_quota
 * (be869a03c); the double below answers as that function does: it consumes only
 * when the new total stays within the limit, and returns { allowed, used }.
 */

const db = { tier: 1 as number, usageDay: 0 as number, rpcCalls: [] as unknown[] };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.single = async () =>
      table === 'social_accounts'
        ? { data: { messaging_tier: db.tier }, error: null }
        : { data: { current_usage_day: db.usageDay }, error: null };
    return q;
  },
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    rpc: async (name: string, args: { p_count: number; p_limit: number }) => {
      db.rpcCalls.push([name, args]);
      const allowed = db.usageDay + args.p_count <= args.p_limit;
      if (allowed) db.usageDay += args.p_count;
      return { data: [{ allowed, used: db.usageDay }], error: null };
    },
  },
}));

const calls: string[] = [];
let client: Record<string, unknown> = {};

jest.mock('../../queue/bullmqClient', () => ({
  getSharedRedisClient: () => client,
}));

const hanging = (status: string): Record<string, unknown> => {
  const c: Record<string, unknown> = { status };
  for (const m of ['get', 'incrby', 'expire']) {
    c[m] = (...a: unknown[]) => { calls.push(`${m}:${String(a[0])}`); return new Promise<never>(() => undefined); };
  }
  return c;
};

const TODAY = () => new Date().toISOString().slice(0, 10);
const consume = (count: number) => ['whatsapp_consume_daily_quota', { p_social_account_id: 'sa-1', p_usage_day: TODAY(), p_count: count, p_limit: 1000 }];

const params = (count = 1) => ({ social_account_id: 'sa-1', phone_number_id: 'pn-1', company_id: 'co-1', plan: 'pro', count });

// The limiter memoizes the client at module level, so each case loads a fresh module.
const load = () => {
  let mod!: typeof import('../../services/whatsappRateLimiter');
  jest.isolateModules(() => { mod = require('../../services/whatsappRateLimiter'); });
  return mod;
};

beforeEach(() => {
  calls.length = 0;
  db.tier = 1;
  db.usageDay = 0;
  db.rpcCalls = [];
});

describe('WhatsApp rate limiter with Redis unavailable', () => {
  it.each(['connecting', 'reconnecting', 'close', 'end', 'wait'])(
    'status %s: nothing is issued to Redis, the database answers and allows within the limit',
    async (status) => {
      client = hanging(status);
      const r = await load().checkAndConsume(params(10));
      expect(r).toMatchObject({ allowed: true, source: 'db', tier: 1, remaining: 990 });
      expect(calls).toEqual([]);
      expect(db.rpcCalls).toEqual([consume(10)]);
    },
  );

  it('still refuses at the limit from the database alone', async () => {
    client = hanging('reconnecting');
    db.usageDay = 995;
    const r = await load().checkAndConsume(params(10));
    expect(r).toMatchObject({ allowed: false, source: 'db', remaining: 5 });
    expect(calls).toEqual([]);
    expect(db.rpcCalls).toEqual([consume(10)]); // one atomic call; it consumed nothing
    expect(db.usageDay).toBe(995);
  });

  it('a connected client is still used (the check does not disable the fast path)', async () => {
    const store = new Map<string, number>();
    client = {
      status: 'ready',
      get: async (k: string) => (store.has(k) ? String(store.get(k)) : null),
      incrby: async (k: string, n: number) => { const v = (store.get(k) ?? 0) + n; store.set(k, v); return v; },
      expire: async () => 1,
    };
    const r = await load().checkAndConsume(params(10));
    expect(r).toMatchObject({ allowed: true, source: 'redis', remaining: 990 });
    expect(db.rpcCalls).toEqual([]);
  });
});
