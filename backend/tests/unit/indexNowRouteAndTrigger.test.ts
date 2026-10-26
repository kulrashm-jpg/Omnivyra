/**
 * IndexNow: the key-file route as deployed (rewrite target), the publication switch, and the blog
 * publishing trigger. Nothing is ever submitted: every request goes to an injected fake fetch, and the
 * admin-route tests replace the notifier with a recorder.
 */
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'https://www.omnivyra.com' }));

type Op = { table: string; calls: Array<[string, unknown[]]> };
let dbResult: (op: Op) => unknown = () => ({ data: null, error: null });
function fakeTable(table: string) {
  const op: Op = { table, calls: [] };
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(dbResult(op)).then(res, rej);
      return (...args: unknown[]) => { op.calls.push([String(prop), args]); return proxy; };
    },
  });
  return proxy;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => fakeTable(t) } }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: async () => ({ ok: true, principal: { userId: 'admin-1' } }) }));
const notified: any[] = [];
jest.mock('../../services/indexNow/indexNow', () => {
  const actual = jest.requireActual('../../services/indexNow/indexNow');
  return { ...actual, notifyIndexNowOfBlogChange: async (e: unknown) => { notified.push(e); return null; } };
});

import keyRoute from '../../../pages/api/indexnow-key';
import blogItemRoute from '../../../pages/api/admin/blog/[id]';
import blogCreateRoute from '../../../pages/api/admin/blog/index';
const { notifyIndexNowOfBlogChange, readIndexNowConfig } = jest.requireActual('../../services/indexNow/indexNow');

const KEY = ['fixture', 'indexnow', 'route', 'key'].join('-');
const ENV = ['INDEXNOW_API_KEY', 'INDEXNOW_PUBLISH_KEY_FILE', 'INDEXNOW_SUBMIT_ENABLED'];
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of ENV) saved[k] = process.env[k]; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
beforeEach(() => { notified.length = 0; dbResult = () => ({ data: null, error: null }); });

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.send = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
  res.end = () => res;
  return res;
}
const call = async (route: any, method: string, query: Record<string, string>, body?: unknown) => {
  const res = mockRes();
  await route({ method, query, headers: {}, body } as any, res);
  return res;
};

describe('key-file route (/<key>.txt → /api/indexnow-key)', () => {
  it('publication off (default) → 404 even for the exact key', async () => {
    process.env.INDEXNOW_API_KEY = KEY;
    delete process.env.INDEXNOW_PUBLISH_KEY_FILE;
    const res = await call(keyRoute, 'GET', { key: KEY });
    expect(res.statusCode).toBe(404);
    expect(res.body).toBeUndefined();
  });

  it('publication on → exact name serves the key as UTF-8 text', async () => {
    Object.assign(process.env, { INDEXNOW_API_KEY: KEY, INDEXNOW_PUBLISH_KEY_FILE: 'true' });
    const res = await call(keyRoute, 'GET', { key: KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(KEY);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it.each([['other name', 'another-name-123'], ['case changed', KEY.toUpperCase()], ['prefix of key', KEY.slice(0, 10)], ['robots', 'robots'], ['empty', '']])('publication on, %s → 404', async (_l, name) => {
    Object.assign(process.env, { INDEXNOW_API_KEY: KEY, INDEXNOW_PUBLISH_KEY_FILE: 'true' });
    expect((await call(keyRoute, 'GET', { key: name })).statusCode).toBe(404);
  });

  it('a malformed configured key is never served; a non-GET method is refused', async () => {
    Object.assign(process.env, { INDEXNOW_API_KEY: 'bad key!', INDEXNOW_PUBLISH_KEY_FILE: 'true' });
    expect((await call(keyRoute, 'GET', { key: 'bad key!' })).statusCode).toBe(404);
    Object.assign(process.env, { INDEXNOW_API_KEY: KEY });
    expect((await call(keyRoute, 'POST', { key: KEY })).statusCode).toBe(405);
  });

  it('the rewrite matches only root-level 8–128 character names (robots.txt and nested paths untouched)', () => {
    const { pathToRegexp } = require('next/dist/compiled/path-to-regexp');
    const rewrite = require('../../../next.config.js');
    expect(typeof rewrite.rewrites).toBe('function');
    const re = pathToRegexp('/:key([A-Za-z0-9-]{8,128}).txt', [], { strict: true, sensitive: false, delimiter: '/' });
    expect(re.test(`/${KEY}.txt`)).toBe(true);
    for (const p of ['/robots.txt', '/a/0123456789.txt', `/${KEY}.txt.bak`, '/under_score1.txt']) expect(re.test(p)).toBe(false);
  });

  it('the rewrite is registered in next.config.js', async () => {
    const config = require('../../../next.config.js');
    const rules = await config.rewrites();
    expect(rules).toEqual(expect.arrayContaining([{ source: '/:key([A-Za-z0-9-]{8,128}).txt', destination: '/api/indexnow-key?key=:key' }]));
  });
});

describe('blog publishing trigger', () => {
  const fakeFetch = (status: number, seen: any[]) => (async (url: any, init: any) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('', { status }); }) as typeof fetch;
  const env = (o: Record<string, string>) => ({ INDEXNOW_API_KEY: KEY, ...o });
  const store = () => ({ lastSent: new Map(), lastSubmitAt: null });

  it('submission switched off (default): nothing is sent', async () => {
    const seen: any[] = [];
    const r = await notifyIndexNowOfBlogChange({ slug: 'new-post', change: 'added' }, { origin: 'https://www.omnivyra.com', env: env({}), fetchImpl: fakeFetch(200, seen), store: store() });
    expect(r.outcome).toBe('disabled');
    expect(seen).toEqual([]);
  });

  it('switched on (in a test only): the post URL and /blog; a slug change also announces the old URL', async () => {
    const seen: any[] = [];
    const r = await notifyIndexNowOfBlogChange({ slug: 'new-slug', change: 'updated', previousSlug: 'old-slug' }, { origin: 'https://www.omnivyra.com', env: env({ INDEXNOW_SUBMIT_ENABLED: 'true' }), fetchImpl: fakeFetch(200, seen), store: store() });
    expect(seen[0].body.urlList).toEqual(['https://www.omnivyra.com/blog/new-slug', 'https://www.omnivyra.com/blog', 'https://www.omnivyra.com/blog/old-slug']);
    expect(r).toMatchObject({ outcome: 'received', attempts: 1 });
  });

  it('bounded: one attempt even on 503; an invalid slug is rejected; never throws', async () => {
    const seen: any[] = [];
    const r = await notifyIndexNowOfBlogChange({ slug: 'Bad Slug!', change: 'added' }, { origin: 'https://www.omnivyra.com', env: env({ INDEXNOW_SUBMIT_ENABLED: 'true' }), fetchImpl: fakeFetch(503, seen), store: store() });
    expect(seen).toHaveLength(1);
    expect(seen[0].body.urlList).toEqual(['https://www.omnivyra.com/blog']);
    expect(r.rejected.map((x: any) => x.reason)).toEqual(['not a page listed in the site’s sitemaps']);
    expect(r.outcome).toBe('failed');
    const boom = await notifyIndexNowOfBlogChange({ slug: 'x-post', change: 'added' }, { origin: 'https://www.omnivyra.com', env: env({ INDEXNOW_SUBMIT_ENABLED: 'true' }), fetchImpl: (async () => { throw new Error('dns'); }) as any, store: store() });
    expect(boom.outcome).toBe('failed');
  });

  it('defaults stay off: no env → disabled, no key → not_configured', () => {
    expect(readIndexNowConfig('https://www.omnivyra.com', {})).toMatchObject({ submitEnabled: false, publishKeyFile: false, key: null });
  });
});

describe('admin blog routes call the trigger only for public changes', () => {
  it('create published → added; create draft → nothing', async () => {
    dbResult = () => ({ data: { id: 'b1', slug: 'launch-post', status: 'published' }, error: null });
    await call(blogCreateRoute, 'POST', {}, { title: 'Launch post', status: 'published' });
    expect(notified).toEqual([{ slug: 'launch-post', change: 'added' }]);
    notified.length = 0;
    dbResult = () => ({ data: { id: 'b2', slug: 'draft-post', status: 'draft' }, error: null });
    await call(blogCreateRoute, 'POST', {}, { title: 'Draft post' });
    expect(notified).toEqual([]);
  });

  it('publish a draft → added; edit while published (slug change) → updated with the old slug; unpublish → deleted', async () => {
    const answer = (before: unknown, after: unknown) => (op: Op) => (op.calls.some(([m]) => m === 'update') ? { data: after, error: null } : op.calls.some(([m]) => m === 'maybeSingle') ? { data: before, error: null } : { data: { published_at: null }, error: null });
    dbResult = answer({ slug: 'p', status: 'draft' }, { slug: 'p', status: 'published' });
    await call(blogItemRoute, 'PATCH', { id: 'b1' }, { status: 'published' });
    dbResult = answer({ slug: 'old', status: 'published' }, { slug: 'new', status: 'published' });
    await call(blogItemRoute, 'PATCH', { id: 'b1' }, { slug: 'new' });
    dbResult = answer({ slug: 'p', status: 'published' }, { slug: 'p', status: 'draft' });
    await call(blogItemRoute, 'PATCH', { id: 'b1' }, { status: 'draft' });
    dbResult = answer({ slug: 'p', status: 'draft' }, { slug: 'p', status: 'draft' });
    await call(blogItemRoute, 'PATCH', { id: 'b1' }, { title: 'x' });
    expect(notified).toEqual([
      { slug: 'p', change: 'added', previousSlug: null },
      { slug: 'new', change: 'updated', previousSlug: 'old' },
      { slug: 'p', change: 'deleted' },
    ]);
  });

  it('delete a published post → deleted; delete a draft → nothing', async () => {
    dbResult = (op) => (op.calls.some(([m]) => m === 'maybeSingle') ? { data: { slug: 'gone', status: 'published' }, error: null } : { data: null, error: null });
    await call(blogItemRoute, 'DELETE', { id: 'b1' });
    dbResult = (op) => (op.calls.some(([m]) => m === 'maybeSingle') ? { data: { slug: 'draft', status: 'draft' }, error: null } : { data: null, error: null });
    await call(blogItemRoute, 'DELETE', { id: 'b2' });
    expect(notified).toEqual([{ slug: 'gone', change: 'deleted' }]);
  });
});
