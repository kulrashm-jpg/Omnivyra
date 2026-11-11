/**
 * Unread-error census: GET /api/engagement/campaign-signals. With no campaign/activity filter the
 * route first reads the company's campaign_versions; a FAILED read was taken as "no campaigns" and
 * answered 200 { signals: [] } - an empty inbox presented as the truth. It now answers 500.
 */
const mockDb = { versionsFail: false };

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u1' }) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      for (const m of ['select', 'order', 'limit', 'eq', 'in', 'gte', 'lte']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(
        table === 'campaign_versions'
          ? (mockDb.versionsFail ? { data: null, error: { code: '08006', message: 'connection reset' } } : { data: [{ campaign_id: 'cmp1' }], error: null })
          : { data: [{ id: 's1', signal_type: 'comment' }], error: null },
      ).then(res);
      return b;
    },
  },
}));

import handler from '../../../pages/api/engagement/campaign-signals';

function call(query: Record<string, string>) {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return (handler as any)({ method: 'GET', query, headers: {} }, res).then(() => res);
}

beforeEach(() => { mockDb.versionsFail = false; jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

it('a FAILED campaign_versions read is not "no campaigns": 500, never an empty inbox as the truth', async () => {
  mockDb.versionsFail = true;
  const res = await call({ companyId: 'co-a' });
  expect(res.statusCode).toBe(500);
  expect(res.body).not.toHaveProperty('signals');
});

it('NEGATIVE CONTROL: the read succeeds - 200 with the signals', async () => {
  const res = await call({ companyId: 'co-a' });
  expect(res.statusCode).toBe(200);
  expect(res.body.signals).toHaveLength(1);
});
