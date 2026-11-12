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
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; const filters: Array<[string, unknown]> = [];
  let op = 'select'; let payload: Row = {}; let one = false;
  const b: any = {
    select: () => b, order: () => b,
    eq: (c: string, v: unknown) => { filters.push([c, v]); tests.push((r) => r[c] === v); return b; },
    or: () => { throw new Error('interpolated .or() must not be used'); },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    delete: () => { op = 'delete'; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    single: () => { one = true; return b; }, maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const rows = (mockDb[table] ??= []);
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      if (op === 'update') { mockWrites.push({ op, filters }); hit.forEach((r) => Object.assign(r, payload)); }
      if (op === 'delete') { mockWrites.push({ op, filters }); mockDb[table] = rows.filter((r) => !hit.includes(r)); }
      if (one && hit.length !== 1) return Promise.resolve({ data: null, error: { code: 'PGRST116' } }).then(ok, ko);
      return Promise.resolve({ data: one ? hit[0] : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
let mockUserId = 'u-owner';
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: mockUserId }, error: null }),
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const byId = require('../../../pages/api/strategy-templates/[id]').default;
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
  mockWrites.length = 0; mockUserId = 'u-owner';
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
  expect((await call('GET', 't-own-public')).statusCode).toBe(200);
});

it('the list is own + public only - never another user’s private template', async () => {
  const ids = (await listStrategyTemplates('u-owner')).map((t: { id: string }) => t.id).sort();
  expect(ids).toEqual(['t-other-public', 't-own-private', 't-own-public']);
});
