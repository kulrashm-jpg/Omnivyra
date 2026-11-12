/**
 * SEC-005 - GET /api/debug/whoami is disabled in production (docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md:
 * "Self-scoped, not cross-tenant; disable in production"). The route has no caller in the app.
 *
 * The REAL productionFlags module runs (it freezes NODE_ENV at module load), so each case loads the route in an
 * isolated registry under the NODE_ENV it names. Only the identity / DB seams are observed, to prove a production
 * request does no identity work at all. AUTH-CTX-002 keeps pinning the non-production contract.
 */
const calls = { resolve: 0, db: 0 };
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => {
    calls.resolve += 1;
    return { userId: 'u-1', role: 'user', companyIds: [], defaultCompanyId: '', membershipType: null };
  },
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      calls.db += 1;
      const b: any = { select: () => b, eq: () => Promise.resolve({ data: [], error: null }) };
      return b;
    },
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
  calls.resolve = 0;
  calls.db = 0;
});

function loadUnder(nodeEnv: string): (req: unknown, res: unknown) => Promise<unknown> {
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  let handler: any;
  jest.isolateModules(() => {
    handler = require('../../../pages/api/debug/whoami').default;
  });
  return handler;
}

async function call(handler: (req: unknown, res: unknown) => Promise<unknown>, method = 'GET') {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  await handler({ method, headers: { authorization: 'Bearer x' }, query: {} }, res);
  return res;
}

it('production: 404 for GET and for any verb, no identity resolved, no DB read', async () => {
  const h = loadUnder('production');
  const get = await call(h);
  const post = await call(h, 'POST');
  expect([get.statusCode, post.statusCode]).toEqual([404, 404]);
  expect(JSON.stringify(get.body)).not.toContain('u-1');
  expect(calls).toEqual({ resolve: 0, db: 0 });
});

it('CONTROL: outside production the diagnostic still answers (its contract is AUTH-CTX-002)', async () => {
  const h = loadUnder('development');
  const get = await call(h);
  expect(get.statusCode).toBe(200);
  expect(get.body).toEqual(expect.objectContaining({ resolved_user_id: 'u-1' }));
  expect(calls.resolve).toBe(1);
});
