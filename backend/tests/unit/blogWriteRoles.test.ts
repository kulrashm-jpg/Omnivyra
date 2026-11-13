/**
 * e1 2026-11-13 (55's write-role scan over company routes): the company blog write routes authorized MEMBERSHIP only,
 * so a VIEW_ONLY member could create / edit / delete blog series and relationships and spend AI on brief suggestions.
 * Every non-GET method now needs a content authoring role (enforceContentWriteRole); reads stay membership-only.
 */
const mockRole: { allow: boolean } = { allow: true };
jest.mock('../../services/rbacService', () => ({
  ...jest.requireActual('../../services/rbacService'),
  enforceRole: jest.fn(async ({ res }: any) => {
    if (mockRole.allow) return { userId: 'u-1', role: 'CONTENT_CREATOR' };
    res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }),
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: jest.fn(async () => ({ userId: 'u-1' })) }));
const mockWrites: string[] = [];
jest.mock('../../db/supabaseClient', () => {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'is', 'single', 'maybeSingle']) b[m] = () => b;
  for (const m of ['insert', 'update', 'delete', 'upsert']) b[m] = () => { mockWrites.push(m); return b; };
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
  return { supabase: { from: () => b, rpc: async () => ({ data: null, error: null }) } };
});
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: jest.fn(async () => ({ output: '{}' })) }));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({ resolveCompanyGroundingGuard: jest.fn(async () => ({ directive: '' })) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
export {};
const ROUTES: Record<string, any> = {
  relationships: require('../../../pages/api/company/blog/relationships').default,
  seriesIndex: require('../../../pages/api/company/blog/series/index').default,
  seriesId: require('../../../pages/api/company/blog/series/[id]').default,
  briefSuggestions: require('../../../pages/api/company/blog/brief-suggestions').default,
};
/* eslint-enable @typescript-eslint/no-var-requires */

async function call(route: string, method: string) {
  const out = { code: 0, body: null as any };
  const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: any) => { out.body = b; return res; }, end: () => res, setHeader: () => res };
  try {
    await ROUTES[route]({ method, query: { company_id: 'c-1', id: 's-1' }, body: { company_id: 'c-1', topic: 'T', name: 'S', blog_id: 'b-1', related_blog_id: 'b-2', relationship_type: 'related', field: 'tone' }, headers: {} }, res);
  } catch { /* the thin DB fake can make a route fail AFTER the gate; only the gate decision is asserted */ }
  return out;
}

beforeEach(() => { mockWrites.length = 0; mockRole.allow = true; });

describe.each([
  ['relationships', 'POST'], ['relationships', 'DELETE'],
  ['seriesIndex', 'POST'],
  ['seriesId', 'PATCH'], ['seriesId', 'DELETE'],
  ['briefSuggestions', 'POST'],
])('%s %s', (route, method) => {
  it('VIEW_ONLY (role refused) -> 403 and NOTHING is written', async () => {
    mockRole.allow = false;
    const r = await call(route, method);
    expect(r.code).toBe(403);
    expect(mockWrites).toEqual([]);
  });
  it('a content authoring role passes the gate (the route proceeds past it)', async () => {
    const enforceRole = (jest.requireMock('../../services/rbacService') as any).enforceRole as jest.Mock;
    enforceRole.mockClear();
    const r = await call(route, method);
    expect(enforceRole).toHaveBeenCalledTimes(1); // the gate was actually consulted (not a pre-gate exit)
    expect(r.code).not.toBe(403);
  });
});

it('READS stay membership-only: GET with the role refused is not 403', async () => {
  mockRole.allow = false;
  expect((await call('seriesIndex', 'GET')).code).not.toBe(403);
  expect((await call('seriesId', 'GET')).code).not.toBe(403);
});
