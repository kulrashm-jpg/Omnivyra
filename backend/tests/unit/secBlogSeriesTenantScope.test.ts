/**
 * SECURITY (2026-11-11): PATCH /api/company/blog/series/[id] scoped its metadata
 * update by company, but the update matches 0 rows on a foreign id WITHOUT
 * failing, and the post-list replace (delete by series_id + insert) then ran on
 * ANY series id. Its delete error was also ignored. And the GET resolved post
 * blog ids with no company filter, leaking another tenant's titles/slugs.
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const CO_B = '00000000-0000-4000-8000-0000000000bb';
const S_A = 'series-a';
const S_B = 'series-b';

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let failDelete = false;

jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const ins: Array<[string, unknown[]]> = [];
      let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
      let payload: Row | Row[] | null = null;
      const match = (r: Row) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c]));
      const run = () => {
        const rows = db[table] ?? (db[table] = []);
        if (op === 'insert') { rows.push(...(Array.isArray(payload) ? payload : [payload as Row])); return { data: null, error: null }; }
        if (op === 'delete') {
          if (failDelete) return { data: null, error: { message: 'delete failed' } };
          db[table] = rows.filter((r) => !match(r)); return { data: null, error: null };
        }
        const hits = rows.filter(match);
        if (op === 'update') hits.forEach((h) => Object.assign(h, payload));
        return { data: hits.map((h) => ({ ...h })), error: null };
      };
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
      b.in = (c: string, vs: unknown[]) => { ins.push([c, vs]); return b; };
      b.update = (p: Row) => { op = 'update'; payload = p; return b; };
      b.delete = () => { op = 'delete'; return b; };
      b.insert = (p: Row | Row[]) => { op = 'insert'; payload = p; return b; };
      b.maybeSingle = async () => {
        const r = run();
        const data = Array.isArray(r.data) ? r.data : [];
        // the series GET embeds its posts
        const row = data[0] ? { ...data[0], company_blog_series_posts: (db.company_blog_series_posts ?? []).filter((p) => p.series_id === data[0].id) } : null;
        return { data: row, error: r.error };
      };
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
      return b;
    },
  },
}), { virtual: true });
jest.mock('@/backend/services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-a' }) }), { virtual: true });
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// The write-ROLE gate (blogWriteRoles.test.ts pins it) is not what this suite tests: tenant scope is. Allowed here.
jest.mock('@/backend/services/content/contentWriteAuthz', () => ({ enforceContentWriteRole: async () => true }), { virtual: true });

import handler from '../../../pages/api/company/blog/series/[id]';

async function call(method: string, id: string, body: Row = {}) {
  const res = { code: 0, body: {} as Row };
  const r = { status: (c: number) => { res.code = c; return r; }, json: (b: Row) => { res.body = b; return r; }, end: () => r };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)({ method, query: { id, company_id: CO_A }, body, headers: {}, cookies: {} }, r);
  return res;
}
const postsOf = (sid: string) => (db.company_blog_series_posts ?? []).filter((p) => p.series_id === sid);

beforeEach(() => {
  failDelete = false;
  db = {
    company_blog_series: [
      { id: S_A, company_id: CO_A, title: 'A series' },
      { id: S_B, company_id: CO_B, title: 'B series' },
    ],
    company_blog_series_posts: [
      { series_id: S_A, blog_id: 'blog-a1', position: 0 },
      { series_id: S_B, blog_id: 'blog-b1', position: 0 },
      { series_id: S_B, blog_id: 'blog-b2', position: 1 },
    ],
    blogs: [
      { id: 'blog-a1', company_id: CO_A, title: 'A one', slug: 'a-one', status: 'published' },
      { id: 'blog-a2', company_id: CO_A, title: 'A two', slug: 'a-two', status: 'draft' },
      { id: 'blog-b1', company_id: CO_B, title: 'B SECRET', slug: 'b-secret', status: 'draft' },
      { id: 'blog-b2', company_id: CO_B, title: 'B two', slug: 'b-two', status: 'draft' },
    ],
  };
});

describe("company A cannot rewrite company B's series", () => {
  it("PATCH B's series with posts[] is 404, and B's post links are untouched", async () => {
    const res = await call('PATCH', S_B, { posts: [{ blog_id: 'blog-a1', position: 0 }] });
    expect(res.code).toBe(404);
    expect(postsOf(S_B).map((p) => p.blog_id)).toEqual(['blog-b1', 'blog-b2']);
  });

  it("PATCH B's series with an EMPTY posts[] (a wipe) is 404, and nothing is deleted", async () => {
    expect((await call('PATCH', S_B, { posts: [] })).code).toBe(404);
    expect(postsOf(S_B)).toHaveLength(2);
  });
});

describe('a series cannot reference, or reveal, another tenant\'s blog', () => {
  it("PATCH OWN series with B's blog id is refused 400 and the list is unchanged", async () => {
    const res = await call('PATCH', S_A, { posts: [{ blog_id: 'blog-b1', position: 0 }] });
    expect(res.code).toBe(400);
    expect(postsOf(S_A).map((p) => p.blog_id)).toEqual(['blog-a1']);
  });

  it("GET never returns a foreign blog's title/slug/status, even if a link to it exists", async () => {
    db.company_blog_series_posts.push({ series_id: S_A, blog_id: 'blog-b1', position: 1 }); // a pre-existing injected link
    const res = await call('GET', S_A);
    expect(res.code).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('B SECRET');
    expect(JSON.stringify(res.body)).not.toContain('b-secret');
  });
});

describe('same-tenant use works; errors are not ignored', () => {
  it('PATCH OWN series replaces its posts with own blogs', async () => {
    const res = await call('PATCH', S_A, { title: 'Renamed', posts: [{ blog_id: 'blog-a2', position: 0 }, { blog_id: 'blog-a1', position: 1 }] });
    expect(res.code).toBe(200);
    expect(postsOf(S_A).map((p) => p.blog_id)).toEqual(['blog-a2', 'blog-a1']);
  });

  // 05/e9 (2026-11-12): the ownership check compares a SET of normalised ids.
  it('a REPEATED own blog id is one blog, not a foreign reference (200)', async () => {
    const res = await call('PATCH', S_A, { posts: [{ blog_id: 'blog-a1', position: 0 }, { blog_id: 'blog-a1', position: 1 }] });
    expect(res.code).toBe(200);
  });

  it('an own blog id with surrounding whitespace is the same blog (200), stored trimmed', async () => {
    const res = await call('PATCH', S_A, { posts: [{ blog_id: ' blog-a2 ', position: 0 }, { blog_id: 'blog-a2', position: 1 }] });
    expect(res.code).toBe(200);
    expect(postsOf(S_A).map((p) => p.blog_id)).toEqual(['blog-a2', 'blog-a2']);
  });

  it('control: a foreign id mixed with own ids is still refused 400', async () => {
    const res = await call('PATCH', S_A, { posts: [{ blog_id: 'blog-a1', position: 0 }, { blog_id: 'blog-b1', position: 1 }] });
    expect(res.code).toBe(400);
  });

  it('a failed clear is a 500, and no insert follows it', async () => {
    failDelete = true;
    const res = await call('PATCH', S_A, { posts: [{ blog_id: 'blog-a2', position: 0 }] });
    expect(res.code).toBe(500);
    expect(postsOf(S_A).map((p) => p.blog_id)).toEqual(['blog-a1']); // not duplicated / half-replaced
  });
});
