/**
 * whatsapp_consume_daily_quota - the WhatsApp daily limit's database fallback,
 * against real PostgreSQL (C10, 2026-11-11).
 *
 * The safety property is a database guarantee, so it is asserted against the
 * database: a single INSERT ... ON CONFLICT DO UPDATE ... WHERE used + count <= limit
 * statement both checks and consumes, so the limit holds under concurrency, a refusal
 * consumes nothing, and only service_role may call it.
 *
 * Every call runs as service_role (SET LOCAL ROLE), as it does behind PostgREST.
 */
import { Client } from 'pg';
import { db } from './setup';

const url = process.env.W6_DB_URL as string;
const ACCOUNT = '00000000-0000-4000-8000-0000000000d1';
const OTHER   = '00000000-0000-4000-8000-0000000000d2';
const DAY  = '2026-11-11';
const NEXT = '2026-11-12';

type Answer = { allowed: boolean; used: number };

/** One call in its own session, as `role`. Returns the answer, or the SQLSTATE it failed with. */
async function consume(account: string, day: string, count: number, limit: number, role = 'service_role'): Promise<Answer | string> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query('SELECT allowed, used FROM public.whatsapp_consume_daily_quota($1, $2, $3, $4)', [account, day, count, limit]);
    await c.query('COMMIT');
    return r.rows[0] as Answer;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return (e as { code?: string }).code ?? 'error';
  } finally {
    await c.end();
  }
}

const usedNow = async (account = ACCOUNT, day = DAY): Promise<number | null> => {
  const r = await db.query('SELECT used FROM public.whatsapp_daily_usage WHERE social_account_id = $1 AND usage_day = $2', [account, day]);
  return r.rows[0]?.used ?? null;
};

beforeAll(async () => {
  for (const id of [ACCOUNT, OTHER]) {
    await db.query(
      `INSERT INTO public.social_accounts (id, user_id, platform, platform_user_id, account_name, access_token)
       VALUES ($1, gen_random_uuid(), 'whatsapp', $1::text, 'wdu-test', 'x') ON CONFLICT (id) DO NOTHING`,
      [id],
    );
  }
});

afterEach(async () => {
  await db.query('DELETE FROM public.whatsapp_daily_usage WHERE social_account_id = ANY($1::uuid[])', [[ACCOUNT, OTHER]]);
});

afterAll(async () => {
  await db.query('DELETE FROM public.social_accounts WHERE id = ANY($1::uuid[])', [[ACCOUNT, OTHER]]);
});

describe('whatsapp_consume_daily_quota: check and consume in one statement', () => {
  it('consumes up to the limit exactly; past it, refuses and consumes NOTHING', async () => {
    expect(await consume(ACCOUNT, DAY, 4, 10)).toEqual({ allowed: true, used: 4 });
    expect(await consume(ACCOUNT, DAY, 6, 10)).toEqual({ allowed: true, used: 10 });  // exactly at the limit
    expect(await consume(ACCOUNT, DAY, 1, 10)).toEqual({ allowed: false, used: 10 }); // one over: refused
    expect(await usedNow()).toBe(10);
  });

  it('a first request of the day larger than the limit is refused and writes no row', async () => {
    expect(await consume(ACCOUNT, DAY, 11, 10)).toEqual({ allowed: false, used: 0 });
    expect(await usedNow()).toBeNull();
  });

  it('the day is part of the key: a new UTC day starts at zero (no reset job)', async () => {
    await consume(ACCOUNT, DAY, 10, 10);
    expect(await consume(ACCOUNT, NEXT, 10, 10)).toEqual({ allowed: true, used: 10 });
  });

  it('NEGATIVE CONTROL: another sender account is metered independently', async () => {
    await consume(ACCOUNT, DAY, 10, 10);
    expect(await consume(OTHER, DAY, 3, 10)).toEqual({ allowed: true, used: 3 });
  });
});

describe('the limit holds under concurrency', () => {
  it('20 concurrent sessions each asking for 1 against a limit of 10: exactly 10 allowed, used = 10', async () => {
    const answers = await Promise.all(Array.from({ length: 20 }, () => consume(ACCOUNT, DAY, 1, 10)));
    expect(answers.every((a) => typeof a === 'object')).toBe(true);
    expect((answers as Answer[]).filter((a) => a.allowed)).toHaveLength(10);
    expect(await usedNow()).toBe(10);
  });

  it('two sessions racing for the last 6 of 10 (4 used): one wins, the loser re-checks after the commit and is refused', async () => {
    await consume(ACCOUNT, DAY, 4, 10);
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      for (const c of [c1, c2]) { await c.query('BEGIN'); await c.query('SET LOCAL ROLE service_role'); }
      const q = 'SELECT allowed, used FROM public.whatsapp_consume_daily_quota($1, $2, 6, 10)';
      const first = await c1.query(q, [ACCOUNT, DAY]);        // holds the row lock, uncommitted
      let settled = false;
      const second = c2.query(q, [ACCOUNT, DAY]).then((r) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);                             // blocked on the row, not decided early
      await c1.query('COMMIT');
      const late = await second;
      await c2.query('COMMIT');
      expect(first.rows[0]).toEqual({ allowed: true, used: 10 });
      expect(late.rows[0]).toEqual({ allowed: false, used: 10 });
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
    expect(await usedNow()).toBe(10);
  });
});

describe('privileges and arguments', () => {
  it.each([['anon'], ['authenticated']])('%s cannot execute the function (42501)', async (role) => {
    expect(await consume(ACCOUNT, DAY, 1, 10, role)).toBe('42501');
    expect(await usedNow()).toBeNull();
  });

  it.each([['anon'], ['authenticated']])('%s cannot read or write the usage table (42501)', async (role) => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${role}`);
      const err = await c.query('SELECT * FROM public.whatsapp_daily_usage').then(() => 'ok', (e) => e.code);
      expect(err).toBe('42501');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
  });

  it.each([
    ['a zero count', 0, 10],
    ['a negative count', -1, 10],
    ['a negative limit', 1, -1],
  ])('%s is rejected (22023) and consumes nothing', async (_l, count, limit) => {
    expect(await consume(ACCOUNT, DAY, count, limit)).toBe('22023');
    expect(await usedNow()).toBeNull();
  });
});
