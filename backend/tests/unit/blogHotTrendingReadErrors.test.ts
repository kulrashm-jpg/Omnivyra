/**
 * GET /api/track/hot never FABRICATES a trending post (05 review of f88b885e2, e9 slot 2026-11-12).
 *
 * It read the 24h baseline with the error unread and fell back to the post's own last-hour count,
 * so a failed 24h read - with the hourly read fine - announced every post with 3+ views as trending
 * at 6x or more. The same fallback fired for a post the row-capped (1000) 24h read had dropped.
 *
 * The fixture fails EXACTLY ONE read (05): failing both would empty the hourly map, the loop would
 * never run, and "no spike" would come out for the wrong reason - on the unfixed code too.
 * The mock serves both the fixed route (exact head counts per post) and the unfixed one (24h rows),
 * so the HEAD control is meaningful.
 */
const mockDb = {
  hourRows: [] as { url_slug: string }[],
  hourCount: null as number | null, // the exact count of the last-hour read; null = rows.length
  dayRows: [] as { url_slug: string }[], // what a ROW read of the 24h window returns (row-capped)
  dayCount: {} as Record<string, number | null>, // the exact 24h count per post (a head read)
  fail: null as null | 'hour' | 'day',
};

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u1' }) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (_table: string) => {
      const f: Record<string, unknown> = {};
      const b: any = {};
      b.select = (_cols: string, opts?: { head?: boolean }) => { f.head = !!opts?.head; return b; };
      b.eq = (c: string, v: unknown) => { f[c] = v; return b; };
      b.gte = (_c: string, v: string) => { f.since = v; return b; };
      b.then = (res: (v: unknown) => unknown) => {
        const ageH = (Date.now() - Date.parse(String(f.since))) / 3_600_000;
        const win = ageH > 2 ? 'day' : 'hour';
        const timeout = { data: null, count: null, error: { message: 'canceling statement due to statement timeout' } };
        if (mockDb.fail === win) return Promise.resolve(timeout).then(res);
        if (win === 'hour') {
          return Promise.resolve({ data: mockDb.hourRows, count: mockDb.hourCount ?? mockDb.hourRows.length, error: null }).then(res);
        }
        if (f.head) {
          const c = mockDb.dayCount[String(f.url_slug)];
          return Promise.resolve({ data: null, count: c === undefined ? 0 : c, error: null }).then(res);
        }
        return Promise.resolve({ data: mockDb.dayRows, count: null, error: null }).then(res);
      };
      return b;
    },
  },
}));

import handler from '../../../pages/api/track/hot';

async function call() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  await (handler as any)({ method: 'GET', query: { account_id: 'co-a' }, headers: {} }, res);
  return res;
}
const views = (slug: string, n: number) => Array.from({ length: n }, () => ({ url_slug: slug }));

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockDb.fail = null;
  mockDb.hourRows = views('post-a', 3);
  mockDb.hourCount = null;
  mockDb.dayRows = views('post-a', 72);
  mockDb.dayCount = { 'post-a': 72 };
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('the 24h read FAILS while the hourly read qualifies (3 views): NO spike - 500 HOT_UNAVAILABLE, logged by name', async () => {
  mockDb.fail = 'day';
  const res = await call();
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ code: 'HOT_UNAVAILABLE', error: expect.any(String) });
  expect(errSpy).toHaveBeenCalledWith('[track/hot] read failed', expect.objectContaining({ read: 'pageviews 24h baseline' }));
});

it('a post the ROW-CAPPED 24h read dropped is not fabricated as trending: its baseline is an exact count', async () => {
  mockDb.dayRows = views('post-other', 1000); // the capped row read never reached post-a
  mockDb.dayCount = { 'post-a': 72 };          // its real 24h views
  const res = await call();
  expect(res.statusCode).toBe(200);
  expect(res.body.hot).toEqual([]);
});

it('a baseline read that answers NO count (null) is unavailable, not zero', async () => {
  mockDb.dayCount = { 'post-a': null };
  const res = await call();
  expect(res.statusCode).toBe(500);
  expect(res.body.code).toBe('HOT_UNAVAILABLE');
});

it('the hourly read FAILS: 500, not "nothing is trending"', async () => {
  mockDb.fail = 'hour';
  const res = await call();
  expect(res.statusCode).toBe(500);
  expect(errSpy).toHaveBeenCalledWith('[track/hot] read failed', expect.objectContaining({ read: 'pageviews last hour' }));
});

it('CONTROL: both reads succeed with a GENUINE spike -> it IS reported (a fix that never reports would fail here)', async () => {
  mockDb.hourRows = views('post-a', 12);
  mockDb.dayRows = views('post-a', 24);
  mockDb.dayCount = { 'post-a': 24 }; // 1/h average, 12 in the last hour
  const res = await call();
  expect(res.statusCode).toBe(200);
  expect(res.body.hot).toEqual([{ slug: 'post-a', views_last_hour: 12, avg_hourly: 1, spike_ratio: 12 }]);
  expect(res.body.has_trending).toBe(true);
});

it('CONTROL: both reads succeed, steady traffic -> nothing is trending', async () => {
  const res = await call(); // 3 in the last hour, 72 in 24h = 3/h
  expect(res.statusCode).toBe(200);
  expect(res.body.hot).toEqual([]);
  expect(res.body.incomplete).toBe(false);
});

it('a row-capped last-hour read is reported as incomplete (some hot posts may be missing)', async () => {
  mockDb.hourCount = 5000;
  const res = await call();
  expect(res.statusCode).toBe(200);
  expect(res.body.incomplete).toBe(true);
});
