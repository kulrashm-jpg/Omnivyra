/**
 * PUBLIC-BLOGS-SEC-001 — the public blog projection contract.
 *
 * pages/api/blogs/public.ts          — declared contract "Embeddable Content"
 * pages/api/blogs/[id]/public.ts     — declared contract "Published Content"
 *
 * Both are deliberately UNAUTHENTICATED and read through the service-role
 * client, so RLS is bypassed and the ROUTE is the entire boundary. Until now the
 * only coverage was publicPolicyDeclarations.test.ts, which checks that a policy
 * block exists — it asserts nothing about what these endpoints actually return.
 *
 * These tests assert the two things that matter for a public projection:
 *
 *   1. PUBLICATION — every lookup path filters status='published', so drafts,
 *      scheduled and failed posts are unreachable. blogs.status is
 *      CHECK (status IN ('draft','scheduled','published','failed')), so
 *      "scheduled" is a distinct state rather than a future-dated publish.
 *
 *   2. PROJECTION — the response carries only the intended public fields. The
 *      blogs table also holds created_by, company_id, integration_id,
 *      external_id, website_id, views_count, likes_count, scheduled_publish_at,
 *      used_at and used_platform. None of those may ever reach an anonymous
 *      caller, so each is seeded with an unmistakable canary value and the whole
 *      serialized response is asserted not to contain it.
 */

export {};

const PUB_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const SCHEDULED_ID = '33333333-3333-4333-8333-333333333333';
const FAILED_ID = '44444444-4444-4444-8444-444444444444';
const COMPANY = 'a0000000-0000-0000-0000-00000000000a';
const OTHER_COMPANY = 'b0000000-0000-0000-0000-00000000000b';

/** Values that must NEVER appear in an anonymous response. */
const CANARY = {
  created_by: 'CANARY-INTERNAL-USER-ID',
  company_id: COMPANY,
  integration_id: 'CANARY-INTEGRATION',
  external_id: 'CANARY-EXTERNAL',
  website_id: 'CANARY-WEBSITE',
  used_platform: 'CANARY-PLATFORM',
};

const ROWS = [
  {
    id: PUB_ID, company_id: COMPANY, status: 'published',
    title: 'Public Post', slug: 'public-post', excerpt: 'visible',
    content: '<p>body</p>', content_blocks: [{ t: 'p' }],
    featured_image_url: 'https://img', category: 'news', tags: ['a'],
    seo_meta_title: 'seo', seo_meta_description: 'seo desc',
    is_featured: true, published_at: '2026-01-01', created_at: '2026-01-01',
    // internal columns that exist on the table and must not be exposed
    ...CANARY, views_count: 999, likes_count: 42,
    scheduled_publish_at: '2030-01-01', used_at: '2026-01-02', updated_at: '2026-02-02',
  },
  { id: DRAFT_ID, company_id: COMPANY, status: 'draft', title: 'DRAFT-SECRET', slug: 'draft-post', ...CANARY },
  { id: SCHEDULED_ID, company_id: COMPANY, status: 'scheduled', title: 'SCHEDULED-SECRET', slug: 'sched', ...CANARY },
  { id: FAILED_ID, company_id: COMPANY, status: 'failed', title: 'FAILED-SECRET', slug: 'failed', ...CANARY },
];

const queries: Array<{ table: string; filters: Record<string, unknown>; selected: string; range?: [number, number] }> = [];
const writes: Array<{ table: string; op: string }> = [];

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    let selected = '';
    let range: [number, number] | undefined;
    const b: any = {};
    b.select = (cols: string) => { selected = cols ?? ''; return b; };
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b;
    b.limit = () => b;
    b.range = (a: number, z: number) => { range = [a, z]; return b; };
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      b[op] = () => { writes.push({ table, op }); return b; };
    }
    const matched = () => {
      queries.push({ table, filters: { ...filters }, selected, range });
      let rows = ROWS.filter(r =>
        Object.entries(filters).every(([k, v]) => (r as any)[k] === v));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      // Return ONLY the columns the route asked for — as PostgREST would.
      const cols = selected.split(',').map(s => s.trim()).filter(Boolean);
      const projected = rows.map(r => {
        const o: any = {};
        for (const c of cols) if (c in (r as any)) o[c] = (r as any)[c];
        return o;
      });
      return projected;
    };
    b.maybeSingle = () => {
      const rows = matched();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    };
    b.then = (fn: any) => {
      const rows = matched();
      return Promise.resolve({ data: rows, error: null, count: rows.length }).then(fn);
    };
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

const listRoute = require('../../../pages/api/blogs/public').default;
const byIdRoute = require('../../../pages/api/blogs/[id]/public').default;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  return res;
}

async function call(route: any, query: any, method = 'GET') {
  queries.length = 0; writes.length = 0;
  const res = mockRes();
  await route({ method, url: '/x', headers: {}, query, body: {} } as never, res);
  return res;
}

/** The whole response, serialized — the only honest way to check for leakage. */
const dump = (res: any) => JSON.stringify(res.body ?? {});

describe('blogs/public — collection', () => {
  it('anonymous access is allowed BY DESIGN and returns published posts', async () => {
    const res = await call(listRoute, { company_id: COMPANY });
    expect(res.statusCode).toBe(200);
    expect(res.body.blogs.length).toBeGreaterThan(0);
  });

  it('CRITICAL every query filters status=published', async () => {
    await call(listRoute, { company_id: COMPANY });
    expect(queries[0].filters.status).toBe('published');
    expect(queries[0].filters.company_id).toBe(COMPANY);
  });

  it('CRITICAL no draft, scheduled or failed post appears', async () => {
    const res = await call(listRoute, { company_id: COMPANY });
    const body = dump(res);
    expect(body).not.toContain('DRAFT-SECRET');
    expect(body).not.toContain('SCHEDULED-SECRET');
    expect(body).not.toContain('FAILED-SECRET');
    for (const b of res.body.blogs) expect(b.id).toBe(PUB_ID);
  });

  it('CRITICAL no internal identifier or metadata leaks', async () => {
    const res = await call(listRoute, { company_id: COMPANY });
    const body = dump(res);
    for (const [field, canary] of Object.entries(CANARY)) {
      if (field === 'company_id') continue; // caller already supplied it
      expect(body).not.toContain(canary);
    }
    const post = res.body.blogs[0];
    for (const forbidden of ['created_by', 'company_id', 'integration_id', 'external_id',
                             'website_id', 'views_count', 'likes_count', 'scheduled_publish_at',
                             'used_at', 'used_platform', 'updated_at', 'status', 'content']) {
      expect(post).not.toHaveProperty(forbidden);
    }
  });

  it('the returned field set is exactly the documented public projection', async () => {
    const res = await call(listRoute, { company_id: COMPANY });
    expect(Object.keys(res.body.blogs[0]).sort()).toEqual([
      'category', 'excerpt', 'featured_image_url', 'id', 'is_featured',
      'published_at', 'slug', 'tags', 'title',
    ]);
  });

  it('page size is server-fixed and not caller-controllable', async () => {
    const res = await call(listRoute, { company_id: COMPANY, page: '1', page_size: '5000', limit: '5000' });
    expect(res.body.pagination.page_size).toBe(12);
    expect(queries[0].range).toEqual([0, 11]);
  });

  it('a missing company_id is rejected before any query', async () => {
    const res = await call(listRoute, {});
    expect(res.statusCode).toBe(400);
    expect(queries).toEqual([]);
  });

  it('a foreign company returns only that company posts', async () => {
    const res = await call(listRoute, { company_id: OTHER_COMPANY });
    expect(res.body.blogs).toEqual([]);
    expect(queries[0].filters.company_id).toBe(OTHER_COMPANY);
  });

  it('performs no writes and rejects non-GET', async () => {
    await call(listRoute, { company_id: COMPANY });
    expect(writes).toEqual([]);
    const post = await call(listRoute, { company_id: COMPANY }, 'POST');
    expect(post.statusCode).toBe(405);
    const opts = await call(listRoute, { company_id: COMPANY }, 'OPTIONS');
    expect(opts.statusCode).toBe(200);
  });
});

describe('blogs/[id]/public — single post', () => {
  it('a published post is returned by id', async () => {
    const res = await call(byIdRoute, { id: PUB_ID });
    expect(res.statusCode).toBe(200);
    expect(res.body.post.id).toBe(PUB_ID);
  });

  it('a published post is returned by slug + company', async () => {
    const res = await call(byIdRoute, { slug: 'public-post', company_id: COMPANY });
    expect(res.statusCode).toBe(200);
    expect(res.body.post.slug).toBe('public-post');
  });

  it('CRITICAL a draft cannot be fetched even with its exact id', async () => {
    const res = await call(byIdRoute, { id: DRAFT_ID });
    expect(res.statusCode).toBe(404);
    expect(dump(res)).not.toContain('DRAFT-SECRET');
  });

  it('CRITICAL a scheduled post cannot be fetched even with its exact id', async () => {
    const res = await call(byIdRoute, { id: SCHEDULED_ID });
    expect(res.statusCode).toBe(404);
    expect(dump(res)).not.toContain('SCHEDULED-SECRET');
  });

  it('CRITICAL a failed post cannot be fetched even with its exact id', async () => {
    const res = await call(byIdRoute, { id: FAILED_ID });
    expect(res.statusCode).toBe(404);
    expect(dump(res)).not.toContain('FAILED-SECRET');
  });

  it('CRITICAL status=published is applied on BOTH lookup paths', async () => {
    await call(byIdRoute, { id: PUB_ID });
    expect(queries[0].filters.status).toBe('published');
    await call(byIdRoute, { slug: 'public-post', company_id: COMPANY });
    expect(queries[0].filters.status).toBe('published');
  });

  it('is NOT an existence oracle: unpublished and nonexistent are indistinguishable', async () => {
    const draft = await call(byIdRoute, { id: DRAFT_ID });
    const missing = await call(byIdRoute, { id: '99999999-9999-4999-8999-999999999999' });
    const malformed = await call(byIdRoute, { id: "not-a-uuid' OR 1=1--" });
    expect(draft.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    expect(draft.body).toEqual(missing.body);
    expect(malformed.body).toEqual(missing.body);
  });

  it('CRITICAL no internal identifier or metadata leaks', async () => {
    const res = await call(byIdRoute, { id: PUB_ID });
    const body = dump(res);
    for (const [field, canary] of Object.entries(CANARY)) {
      if (field === 'company_id') continue;
      expect(body).not.toContain(canary);
    }
    for (const forbidden of ['created_by', 'company_id', 'integration_id', 'external_id',
                             'website_id', 'views_count', 'likes_count', 'scheduled_publish_at',
                             'used_at', 'used_platform', 'updated_at', 'status']) {
      expect(res.body.post).not.toHaveProperty(forbidden);
    }
  });

  it('the returned field set is exactly the documented public render payload', async () => {
    const res = await call(byIdRoute, { id: PUB_ID });
    expect(Object.keys(res.body.post).sort()).toEqual([
      'category', 'content', 'content_blocks', 'created_at', 'excerpt',
      'featured_image_url', 'id', 'is_featured', 'published_at',
      'seo_meta_description', 'seo_meta_title', 'slug', 'tags', 'title',
    ]);
  });

  it('neither identifier form is accepted when absent', async () => {
    const res = await call(byIdRoute, {});
    expect(res.statusCode).toBe(400);
    expect(queries).toEqual([]);
  });

  it('performs no writes and rejects non-GET', async () => {
    await call(byIdRoute, { id: PUB_ID });
    expect(writes).toEqual([]);
    const post = await call(byIdRoute, { id: PUB_ID }, 'POST');
    expect(post.statusCode).toBe(405);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Characterization — company lifecycle is NOT part of the public predicate.
 *
 * blogs has no soft-delete column (deletion is a hard DELETE, and company_id is
 * ON DELETE CASCADE — which never fires, because companies are SOFT-deleted).
 * soft_delete_company() does not touch blogs. So a soft-deleted company's
 * published posts stay publicly readable.
 *
 * That is the CURRENT behaviour and it is consistent with the declared contract
 * ("publishing is the authorization"; company_id is a content selector, not an
 * authorization input). It is pinned here as characterization, NOT endorsed as
 * settled policy: whether a deleted company's content should stop being served
 * is a product decision the repository does not answer, and it affects ZERO rows
 * in production today.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('company lifecycle is not a public-visibility predicate (characterization)', () => {
  it('the public queries filter on company and status ONLY — never company lifecycle', async () => {
    await call(listRoute, { company_id: COMPANY });
    expect(Object.keys(queries[0].filters).sort()).toEqual(['company_id', 'status']);
    expect(queries.some(q => q.table === 'companies')).toBe(false);

    await call(byIdRoute, { id: PUB_ID });
    expect(queries.some(q => q.table === 'companies')).toBe(false);
  });
});
