/**
 * S2 (e1, 83 ruling 3) - allow-list entry strategy-templates-user-owned-or-public. Strategy templates are
 * user-owned (company optional) and public ones are readable by every signed-in user. Pinned: a non-owner can
 * never PUT or DELETE (and the write itself is pinned to the owner's user_id), a non-owner never reads a PRIVATE
 * template even by id, and the list is the caller's own + public templates only (two exact reads).
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ op: string; filters: Array<[string, unknown]> }> = [];
const mockInserts: Row[] = [];
const CO_A = '11111111-1111-4111-8111-111111111111';
const CO_B = '22222222-2222-4222-8222-222222222222';
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; const filters: Array<[string, unknown]> = [];
  let op = 'select'; let payload: Row = {}; let one = false; let pick: string[] | null = null;
  const b: any = {
    select: (cols?: string) => { if (cols && cols !== '*') pick = cols.split(',').map((c) => c.trim()); return b; },
    order: () => b,
    eq: (c: string, v: unknown) => { filters.push([c, v]); tests.push((r) => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { tests.push((r) => r[c] !== v); return b; },
    or: () => { throw new Error('interpolated .or() must not be used'); },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    delete: () => { op = 'delete'; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; mockInserts.push(p); return b; },
    single: () => { one = true; return b; }, maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const rows = (mockDb[table] ??= []);
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      if (op === 'update') { mockWrites.push({ op, filters }); hit.forEach((r) => Object.assign(r, payload)); }
      if (op === 'delete') { mockWrites.push({ op, filters }); mockDb[table] = rows.filter((r) => !hit.includes(r)); }
      if (op === 'insert') return Promise.resolve({ data: { id: 't-new', ...payload }, error: null }).then(ok, ko);
      if (one && hit.length !== 1) return Promise.resolve({ data: null, error: { code: 'PGRST116' } }).then(ok, ko);
      const shape = (r: Row) => (pick ? Object.fromEntries(pick.filter((k) => k in r).map((k) => [k, r[k]])) : r);
      return Promise.resolve({ data: one ? shape(hit[0]) : hit.map(shape), error: null }).then(ok, ko);
    },
  };
  return b;
}
let mockUserId = 'u-owner';
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async (i: { res: any; companyId: string }) => {
    if (i.companyId === '11111111-1111-4111-8111-111111111111') return { userId: 'u-owner' };
    i.res.status(403).json({ error: 'FORBIDDEN' }); return null;
  },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: mockUserId }, error: null }),
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const byId = require('../../../pages/api/strategy-templates/[id]').default;
const index = require('../../../pages/api/strategy-templates/index').default;
const { listStrategyTemplates } = require('../../services/strategyTemplateService');
/* eslint-enable @typescript-eslint/no-var-requires */
async function call(method: string, id: string, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await byId({ method, headers: {}, query: { id }, body }, res);
  return res;
}
const tpl = (id: string, user_id: string, is_public: boolean, name = id) =>
  ({ id, user_id, is_public, name, company_id: null, objective: 'o', target_audience: 't', key_platforms: [], tags: [], updated_at: id });
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockInserts.length = 0; mockUserId = 'u-owner';
  mockDb.strategy_templates = [
    tpl('t-own-private', 'u-owner', false), tpl('t-own-public', 'u-owner', true),
    tpl('t-other-private', 'u-other', false), tpl('t-other-public', 'u-other', true),
  ];
});

it('a non-owner can never PUT or DELETE (a public template is visible, not writable)', async () => {
  mockUserId = 'u-intruder';
  expect((await call('PUT', 't-own-public', { name: 'pwned' })).statusCode).toBe(403);
  expect((await call('DELETE', 't-own-public')).statusCode).toBe(403);
  expect((await call('PUT', 't-own-private', { name: 'pwned' })).statusCode).toBe(404);
  expect((await call('DELETE', 't-own-private')).statusCode).toBe(404);
  expect(mockWrites).toEqual([]);
  expect(mockDb.strategy_templates.map((t) => t.name)).toEqual(['t-own-private', 't-own-public', 't-other-private', 't-other-public']);
});

it("the owner's PUT and DELETE are pinned to the owner's user_id", async () => {
  expect((await call('PUT', 't-own-private', { name: 'renamed', user_id: 'u-other' })).statusCode).toBe(200);
  expect((await call('DELETE', 't-own-public')).statusCode).toBe(200);
  expect(mockWrites.map((w) => [w.op, w.filters])).toEqual([
    ['update', [['id', 't-own-private'], ['user_id', 'u-owner']]],
    ['delete', [['id', 't-own-public'], ['user_id', 'u-owner']]],
  ]);
  expect(mockDb.strategy_templates.find((t) => t.id === 't-own-private')).toMatchObject({ name: 'renamed', user_id: 'u-owner' });
});

it('a non-owner never reads a PRIVATE template, even by id', async () => {
  mockUserId = 'u-intruder';
  const r = await call('GET', 't-own-private');
  expect(r.statusCode).toBe(404);
  expect(JSON.stringify(r.body)).not.toContain('t-own-private');
  const pub = await call('GET', 't-own-public');
  expect(pub.statusCode).toBe(200);
  // public = the content, never who or which company published it
  expect(Object.keys(pub.body.data)).not.toEqual(expect.arrayContaining(['user_id']));
  expect('company_id' in pub.body.data).toBe(false);
  expect('user_id' in pub.body.data).toBe(false);
});

it("the owner still gets their own template in full (incl. company and owner)", async () => {
  const own = await call('GET', 't-own-private');
  expect(own.body.data).toMatchObject({ id: 't-own-private', user_id: 'u-owner', company_id: null });
});

it('the list is own + public only - never another user’s private template', async () => {
  const list = await listStrategyTemplates('u-owner');
  expect(list.map((t: { id: string }) => t.id).sort()).toEqual(['t-other-public', 't-own-private', 't-own-public']);
  // another user's public template: content only - no publisher, no company
  const other = list.find((t: { id: string }) => t.id === 't-other-public');
  expect('user_id' in other).toBe(false);
  expect('company_id' in other).toBe(false);
  // the caller's OWN public template stays full
  expect(list.find((t: { id: string }) => t.id === 't-own-public')).toMatchObject({ user_id: 'u-owner' });
});

async function create(body: Row) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await index({ method: 'POST', headers: {}, query: {}, body: { name: 'n', objective: 'o', target_audience: 't', key_platforms: ['x'], ...body } }, res);
  return res;
}
it('create attaches a company ONLY through the access check; a foreign company writes nothing', async () => {
  expect((await create({ company_id: CO_B, user_id: 'u-other' })).statusCode).toBe(403);
  expect(mockInserts).toEqual([]);
  expect((await create({ company_id: CO_A, user_id: 'u-other' })).statusCode).toBe(201);
  expect((await create({})).statusCode).toBe(201);
  expect(mockInserts.map((r) => [r.user_id, r.company_id])).toEqual([['u-owner', CO_A], ['u-owner', null]]);
});
