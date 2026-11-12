/**
 * S2 tenant seam (e1) - pages/api/blogs/optimize.ts. The blog is read and written UNDER the
 * authorized company. Another tenant's blog id is the same uniform 404 as an unknown one (it used
 * to be 404 vs 403 - an existence oracle) and is never modified.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ filters: Row; patch: Row }> = [];
function mockTable(table: string) {
  const filters: Row = {}; const tests: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null; let one = false; let maybe = false;
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (patch) { mockWrites.push({ filters: { ...filters }, patch }); hit.forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    if (one) return hit.length === 1 ? { data: hit[0], error: null } : (hit.length === 0 && maybe ? { data: null, error: null } : { data: null, error: { message: hit.length ? 'multi' : 'no rows' } });
    return { data: hit, error: null };
  };
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters[c] = v; tests.push((r) => r[c] === v); return b; },
    update: (p: Row) => { patch = p; return b; },
    single: () => { one = true; return b; },
    maybeSingle: () => { one = true; maybe = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
jest.mock('../../services/userContextService', () => ({
  ...jest.requireActual('../../services/userContextService'),
  enforceCompanyAccess: async ({ res, companyId }: Row) => (companyId === '11111111-1111-4111-8111-111111111111' ? { userId: 'user-a' } : (res.status(403).json({ e: 1 }), null)),
}));
jest.mock('../../services/rbacService', () => ({ Role: { COMPANY_ADMIN: 'COMPANY_ADMIN' }, enforceRole: async () => ({ ok: true }) }));
jest.mock('../../../lib/blog/regenerationExecutor', () => ({
  applyOptimizationActions: async (blog: Row) => ({ updated_blocks: [{ type: 'p', body: `opt:${blog.id}` }], changes: [] }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const optimize = require('../../../pages/api/blogs/optimize').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function post(body: Row) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await optimize({ method: 'POST', headers: {}, query: {}, body }, res);
  return res;
}
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0;
  mockDb.blogs = [
    { id: 'blog-a', company_id: A, title: 'A', content_blocks: [] },
    { id: 'blog-b', company_id: B, title: 'B secret', content_blocks: [] },
  ];
});
const ACT = [{ instruction_code: 'X' }];

it("another tenant's blog: the SAME 404 as an unknown id, and it is never written", async () => {
  const foreign = await post({ company_id: A, blog_id: 'blog-b', actions: ACT });
  const unknown = await post({ company_id: A, blog_id: 'blog-nope', actions: ACT });
  expect(foreign.statusCode).toBe(404);
  expect(unknown.statusCode).toBe(404);
  expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(unknown.body));
  expect(mockWrites).toHaveLength(0);
  expect(mockDb.blogs.find((b) => b.id === 'blog-b')!.content_blocks).toEqual([]);
});

it("own blog: optimized and saved, the write pinned to company A", async () => {
  const r = await post({ company_id: A, blog_id: 'blog-a', actions: ACT });
  expect(r.statusCode).toBe(200);
  expect(mockWrites[0].filters).toMatchObject({ id: 'blog-a', company_id: A });
});
