/**
 * S2 tenant seam (e1) - pages/api/virality/playbooks/{index,[id]}.ts.
 * GET is pinned to the company the role check authorized; POST and PUT write through the seam with
 * the company requireCapability authorized (the playbook's own company for PUT).
 *
 * Cross-tenant cases: A's list never holds B's playbooks; a create cannot be stamped with another
 * company; a PUT on B's playbook by A's admin is refused and writes nothing; every write carries
 * the tenant predicate. The fake applies every filter and records write filters.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; filters: Row; payload: Row }> = [];
let mockId = 1;
function mockTable(table: string) {
  const filters: Row = {}; const tests: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'insert' | 'update' = 'select'; let payload: Row = {}; let one = false;
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    if (op === 'insert') { const r = { id: `pb-${mockId++}`, ...payload }; rows.push(r); mockWrites.push({ table, op, filters: {}, payload }); return { data: r, error: null }; }
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (op === 'update') { mockWrites.push({ table, op, filters: { ...filters }, payload }); hit.forEach((r) => Object.assign(r, payload)); return { data: one ? hit[0] ?? null : hit, error: hit.length || !one ? null : { message: 'no row' } }; }
    return { data: one ? hit[0] ?? null : hit, error: one && !hit[0] ? { message: 'no row' } : null };
  };
  const b: any = {
    select: () => b, order: () => b,
    eq: (c: string, v: unknown) => { filters[c] = v; tests.push((r) => r[c] === v); return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    single: () => { one = true; return b; }, maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: { id: 'user-a' }, error: null }) }));
jest.mock('../../services/rbacService', () => ({
  Role: {}, isPlatformSuperAdmin: async () => false, isSuperAdmin: async () => false,
  getUserRole: async (_u: string, companyId: string) => (companyId === '11111111-1111-4111-8111-111111111111' ? { role: 'COMPANY_ADMIN', error: null } : { role: null, error: null }),
}));
jest.mock('../../security/requireCapability', () => ({
  // A's admin holds organization.manage for A only.
  requireCapability: async (_req: unknown, res: any, o: { organizationId: string }) =>
    (o.organizationId === '11111111-1111-4111-8111-111111111111' ? { ok: true, principal: { userId: 'user-a' } } : (res.status(403).json({ error: 'forbidden' }), { ok: false, sent: true })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const index = require('../../../pages/api/virality/playbooks/index').default;
const item = require('../../../pages/api/virality/playbooks/[id]').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function call(h: any, method: string, query: Row, body: Row = {}) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await h({ method, headers: {}, query, body, url: '/x' }, res);
  return res;
}
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0;
  mockDb.virality_playbooks = [
    { id: 'pa', company_id: A, name: 'A plan', updated_at: '1' },
    { id: 'pb', company_id: B, name: 'B secret', updated_at: '1' },
  ];
});

it("GET lists only A's playbooks", async () => {
  const r = await call(index, 'GET', { companyId: A });
  expect(r.statusCode).toBe(200);
  expect(r.body.playbooks.map((p: Row) => p.id)).toEqual(['pa']);
});

it('POST is stamped with the authorized company - a body company_id cannot redirect it', async () => {
  const r = await call(index, 'POST', {}, { companyId: A, name: 'n', objective: 'o', platforms: ['x'], content_types: ['y'], company_id: B });
  // the seam refuses a payload naming another tenant, or stamps A - never B
  expect(mockDb.virality_playbooks.some((p) => p.name === 'n' && p.company_id === B)).toBe(false);
  if (r.statusCode === 201) expect(mockDb.virality_playbooks.find((p) => p.name === 'n')).toMatchObject({ company_id: A });
});

it("PUT B's playbook by A's admin is refused; nothing written", async () => {
  const r = await call(item, 'PUT', { id: 'pb' }, { name: 'hijack' });
  expect(r.statusCode).toBe(403);
  expect(mockWrites.filter((w) => w.op === 'update')).toHaveLength(0);
  expect(mockDb.virality_playbooks.find((p) => p.id === 'pb')!.name).toBe('B secret');
});

it("PUT own playbook: the write carries company_id = the playbook's authorized company", async () => {
  const r = await call(item, 'PUT', { id: 'pa' }, { name: 'renamed' });
  expect(r.statusCode).toBe(200);
  expect(mockWrites.find((w) => w.op === 'update')!.filters).toMatchObject({ id: 'pa', company_id: A });
});
