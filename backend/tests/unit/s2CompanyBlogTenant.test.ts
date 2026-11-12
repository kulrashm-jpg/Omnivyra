/**
 * S2 tenant seam (e1) - pages/api/company/blog/{relationships,intelligence}.ts.
 * Every tenant read and write is pinned to the company enforceCompanyAccess resolved.
 *
 * Cross-tenant negative cases:
 *   - a relationship naming ANOTHER tenant's blog is refused (404) and nothing is written
 *     (unchecked, the FK also made the insert an existence oracle for foreign blog ids);
 *   - DELETE of another tenant's relationship id deletes nothing;
 *   - intelligence never returns B's blogs, relationships or comments, even for B's blog ids.
 * The fake applies every filter, persists inserts and deletes - never kinder than the DB.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
let mockNextId = 1;

function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'insert' | 'delete' | 'update' = 'select';
  let payload: Row[] = [];
  let patch: Row = {};
  let mode: 'many' | 'one' = 'many';
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    if (op === 'insert') {
      const ins = payload.map((r) => ({ id: `${table}-${mockNextId++}`, ...r }));
      rows.push(...ins);
      return { data: mode === 'one' ? ins[0] : ins, error: null };
    }
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (op === 'update') { for (const r of hit) Object.assign(r, patch); return { data: null, error: null }; }
    if (op === 'delete') { mockDb[table] = rows.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
    return { data: mode === 'one' ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b,
    order: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    insert: (v: Row | Row[]) => { op = 'insert'; payload = Array.isArray(v) ? v : [v]; return b; },
    delete: () => { op = 'delete'; return b; },
    update: (p: Row) => { op = 'update'; patch = p; return b; },
    single: () => { mode = 'one'; return b; },
    maybeSingle: () => { mode = 'one'; return b; },
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
  // The real gate: a member of A only. Any other company is refused (403) before a tenant read.
  enforceCompanyAccess: async ({ res, companyId }: { res: any; companyId: string }) =>
    (companyId === '11111111-1111-4111-8111-111111111111' ? { userId: 'user-a', companyIds: [companyId] } : (res.status(403).json({ error: 'forbidden' }), null)),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const relationships = require('../../../pages/api/company/blog/relationships').default;
const intelligence = require('../../../pages/api/company/blog/intelligence').default;
const seriesItem = require('../../../pages/api/company/blog/series/[id]').default;
const seriesIndex = require('../../../pages/api/company/blog/series/index').default;
/* eslint-enable @typescript-eslint/no-var-requires */

async function call(handler: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.end = () => res;
  res.setHeader = () => res;
  await handler({ method, headers: {}, query, body }, res);
  return res;
}

beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockDb.blogs = [
    { id: 'a1', company_id: A, title: 'A one', status: 'published' },
    { id: 'a2', company_id: A, title: 'A two', status: 'published' },
    { id: 'b1', company_id: B, title: 'B secret', status: 'published' },
  ];
  mockDb.company_blog_relationships = [
    { id: 'rel-b', company_id: B, source_blog_id: 'b1', target_blog_id: 'b1x', relationship_type: 'related' },
  ];
  mockDb.company_blog_comments = [
    { id: 'c-a', company_id: A, blog_id: 'a1' },
    { id: 'c-b', company_id: B, blog_id: 'b1' },
    // a B-owned row pointing at A's blog id: a blog-id-only read would count it
    { id: 'c-bx', company_id: B, blog_id: 'a1' },
  ];
  mockDb.company_blog_performance_summary = [
    { company_id: A, blog_id: 'a1', session_count: 3 },
    // a B-tenant row naming A's blog id: an unfiltered view read would surface it
    { company_id: B, blog_id: 'a1', session_count: 999 },
  ];
  mockDb.company_blog_series = [
    { id: 's-a', company_id: A, title: 'A series' },
    { id: 's-b', company_id: B, title: 'B series' },
  ];
  mockDb.company_blog_series_posts = [
    { id: 'p-a', series_id: 's-a', blog_id: 'a1', position: 0 },
    { id: 'p-b', series_id: 's-b', blog_id: 'b1', position: 0 },
  ];
});

describe('relationships', () => {
  it('own blogs: created, stamped with A', async () => {
    const r = await call(relationships, 'POST', { company_id: A }, { source_blog_id: 'a1', target_blog_id: 'a2' });
    expect(r.statusCode).toBe(201);
    expect(mockDb.company_blog_relationships.find((x) => x.source_blog_id === 'a1')).toMatchObject({ company_id: A, target_blog_id: 'a2' });
  });

  it("a relationship naming ANOTHER tenant's blog is refused (404) and nothing is written", async () => {
    const before = mockDb.company_blog_relationships.length;
    const r = await call(relationships, 'POST', { company_id: A }, { source_blog_id: 'a1', target_blog_id: 'b1' });
    expect(r.statusCode).toBe(404);
    expect(mockDb.company_blog_relationships).toHaveLength(before);
  });

  it("DELETE of another tenant's relationship id deletes nothing", async () => {
    const r = await call(relationships, 'DELETE', { company_id: A, id: 'rel-b' });
    expect(r.statusCode).toBe(204);
    expect(mockDb.company_blog_relationships.map((x) => x.id)).toContain('rel-b');
  });

  it('control: a company the caller is not a member of is refused before any write', async () => {
    const r = await call(relationships, 'POST', { company_id: B }, { source_blog_id: 'b1', target_blog_id: 'b1' });
    expect(r.statusCode).toBe(403);
  });
});

describe('intelligence', () => {
  it("returns only A's blogs, relationships and comment counts - never B's", async () => {
    const r = await call(intelligence, 'GET', { company_id: A });
    expect(r.statusCode).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('B secret');
    expect(text).not.toContain('rel-b');
    expect(text).toContain('A one');
    const a1 = (r.body.posts ?? r.body.blogs ?? []).find((p: Row) => p.id === 'a1');
    expect(a1?.comments_count).toBe(1); // A's own comment only
  });
});

describe('blog series (series_posts is a child of company_blog_series, S1 f285c998a)', () => {
  it("GET another tenant's series -> 404, nothing of B returned", async () => {
    const r = await call(seriesItem, 'GET', { company_id: A, id: 's-b' });
    expect(r.statusCode).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('B series');
  });

  it("PATCH another tenant's series -> 404; B's posts are NOT wiped or rewritten", async () => {
    const r = await call(seriesItem, 'PATCH', { company_id: A, id: 's-b' }, { posts: [{ blog_id: 'a1', position: 0 }] });
    expect(r.statusCode).toBe(404);
    expect(mockDb.company_blog_series_posts.filter((p) => p.series_id === 's-b')).toEqual([{ id: 'p-b', series_id: 's-b', blog_id: 'b1', position: 0 }]);
  });

  it("own series GET returns its posts with A's blog details", async () => {
    const r = await call(seriesItem, 'GET', { company_id: A, id: 's-a' });
    expect(r.statusCode).toBe(200);
    expect(r.body.company_blog_series_posts).toEqual([expect.objectContaining({ blog_id: 'a1', title: 'A one' })]);
  });

  it("own series PATCH replaces ONLY that series' posts", async () => {
    const r = await call(seriesItem, 'PATCH', { company_id: A, id: 's-a' }, { posts: [{ blog_id: 'a2', position: 1 }] });
    expect(r.statusCode).toBe(200);
    expect(mockDb.company_blog_series_posts.filter((p) => p.series_id === 's-a').map((p) => p.blog_id)).toEqual(['a2']);
    expect(mockDb.company_blog_series_posts.filter((p) => p.series_id === 's-b')).toHaveLength(1);
  });

  it("the series list holds only A's series and posts; a create is stamped with A", async () => {
    const list = await call(seriesIndex, 'GET', { company_id: A });
    expect(list.statusCode).toBe(200);
    expect(list.body.series.map((x: Row) => x.id)).toEqual(['s-a']);
    expect(JSON.stringify(list.body)).not.toContain('b1');
    const made = await call(seriesIndex, 'POST', { company_id: A }, { title: 'New' });
    expect(made.statusCode).toBe(201);
    expect(mockDb.company_blog_series.find((x) => x.title === 'New')).toMatchObject({ company_id: A });
  });

  it("intelligence: series carry only A's series and their posts", async () => {
    const r = await call(intelligence, 'GET', { company_id: A });
    expect(r.body.series.map((x: Row) => x.id)).toEqual(['s-a']);
  });
});

it("intelligence: performance comes from A's rows of the tenant VIEW only (S1 a7b6a8f92)", async () => {
  const r = await call(intelligence, 'GET', { company_id: A });
  expect(JSON.stringify(r.body)).not.toContain('999');
});
