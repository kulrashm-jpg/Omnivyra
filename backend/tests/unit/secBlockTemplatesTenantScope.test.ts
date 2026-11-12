/**
 * SECURITY (2026-11-11): /api/block-templates read, edit and delete by id were
 * scoped by id ONLY (service-role client, so RLS did not apply). Any member of
 * any company could read, edit or delete another tenant's template by passing
 * their OWN company_id. Every entry point is now scoped to the authorised
 * company; another tenant's id is a 404 indistinguishable from a missing id.
 *
 * The fake enforces the filters a real query applies, so a dropped filter shows
 * up as a cross-tenant hit, not as a passing test.
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa'; // the caller's company
const CO_B = '00000000-0000-4000-8000-0000000000bb'; // the victim tenant
const OWN = '00000000-0000-4000-8000-00000000a001';
const THEIRS = '00000000-0000-4000-8000-00000000b001';
const DEF = '00000000-0000-4000-8000-00000000d001';
const MISSING = '00000000-0000-4000-8000-00000000f404';

type Row = Record<string, unknown>;
let rows: Row[] = [];
let failRead = false;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const f = { eq: [] as Array<[string, unknown]>, or: null as string | null, op: 'select' as 'select' | 'update' | 'delete', patch: null as Row | null };
    const match = (r: Row) => f.eq.every(([c, v]) => r[c] === v)
      && (f.or === null || r.company_id === (f.or.match(/company_id\.eq\.([0-9a-f-]+)/) ?? [])[1] || r.is_default === true);
    const run = () => {
      if (f.op === 'select' && failRead) return { data: null, error: { message: 'boom' } };
      const hits = rows.filter(match);
      if (f.op === 'update') hits.forEach((h) => Object.assign(h, f.patch));
      if (f.op === 'delete') rows = rows.filter((r) => !hits.includes(r));
      return { data: hits.map((h) => ({ ...h })), error: null };
    };
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { f.eq.push([c, v]); return b; };
    b.or = (e: string) => { f.or = e; return b; };
    b.update = (p: Row) => { f.op = 'update'; f.patch = p; return b; };
    b.delete = () => { f.op = 'delete'; return b; };
    b.limit = async () => run();
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
    return b;
  },
}));
// The caller IS a member of CO_A (and is asking about CO_A).
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-a' }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import idRoute from '../../../pages/api/block-templates/[id]';
import indexRoute from '../../../pages/api/block-templates/index';
import deleteTemplateRoute from '../../../pages/api/block-templates/delete-template';

const tpl = (id: string, company_id: string | null, is_default = false): Row => ({
  id, company_id, is_default, name: `tpl-${id.slice(-4)}`, description: null, content_type: 'blog', format_type: null,
  content_blocks: [], tags: [], is_public: false, usage_count: 0, created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});

async function call(h: unknown, method: string, query: Row, body: Row = {}) {
  const res = { code: 0, body: {} as Row };
  const r = {
    status: (c: number) => { res.code = c; return r; },
    json: (b: Row) => { res.body = b; return r; },
    setHeader: () => r,
  };
  await (h as (q: unknown, s: unknown) => Promise<void>)({ method, query, body, headers: {}, cookies: {} }, r);
  return res;
}
const byId = (id: string) => rows.find((r) => r.id === id);

beforeEach(() => {
  rows = [tpl(OWN, CO_A), tpl(THEIRS, CO_B), tpl(DEF, null, true)];
  failRead = false;
});

describe("another tenant's template is invisible and untouchable (404, no write)", () => {
  it('READ: GET [id] for their id is 404 - the same body as a missing id', async () => {
    const theirs = await call(idRoute, 'GET', { id: THEIRS, company_id: CO_A });
    const missing = await call(idRoute, 'GET', { id: MISSING, company_id: CO_A });
    expect(theirs.code).toBe(404);
    expect(theirs.body).toEqual(missing.body); // never reveals that it exists
    expect(JSON.stringify(theirs.body)).not.toContain(String(byId(THEIRS)!.name));
  });

  it('EDIT: PUT [id] on their id is 404 and their row is unchanged', async () => {
    const res = await call(idRoute, 'PUT', { id: THEIRS, company_id: CO_A }, { name: 'pwned' });
    expect(res.code).toBe(404);
    expect(byId(THEIRS)!.name).toBe('tpl-b001');
  });

  it.each([
    ['DELETE [id]', () => call(idRoute, 'DELETE', { id: THEIRS, company_id: CO_A })],
    ['DELETE index ?id=', () => call(indexRoute, 'DELETE', { id: THEIRS, company_id: CO_A })],
    ['POST delete-template', () => call(deleteTemplateRoute, 'POST', {}, { id: THEIRS, company_id: CO_A })],
  ])('DELETE via %s on their id is 404 and their row still exists', async (_label, run) => {
    const res = await run();
    expect(res.code).toBe(404);
    expect(byId(THEIRS)).toBeDefined();
  });
});

describe('same-tenant use still works; system defaults are read-only', () => {
  it('GET / PUT / DELETE of OWN template succeed', async () => {
    expect((await call(idRoute, 'GET', { id: OWN, company_id: CO_A })).code).toBe(200);
    const put = await call(idRoute, 'PUT', { id: OWN, company_id: CO_A }, { name: 'renamed' });
    expect(put.code).toBe(200);
    expect(byId(OWN)!.name).toBe('renamed');
    expect((await call(idRoute, 'DELETE', { id: OWN, company_id: CO_A })).code).toBe(200);
    expect(byId(OWN)).toBeUndefined();
  });

  it('a system default is readable by any company but cannot be edited or deleted', async () => {
    expect((await call(idRoute, 'GET', { id: DEF, company_id: CO_A })).code).toBe(200);
    expect((await call(idRoute, 'PUT', { id: DEF, company_id: CO_A }, { name: 'x' })).code).toBe(404);
    expect((await call(idRoute, 'DELETE', { id: DEF, company_id: CO_A })).code).toBe(404);
    expect(byId(DEF)!.name).toBe('tpl-d001');
  });

  it('a failed read is an ERROR (500), never "not found"', async () => {
    failRead = true;
    expect((await call(idRoute, 'GET', { id: OWN, company_id: CO_A })).code).toBe(500);
  });
});
