/**
 * e9 ruling 2026-11-13 (BLOCKING, access): a self-joined membership stored with the legacy spelling 'self_registered'
 * is governed by the integrity check (isSelfRegisteredJoinSource accepts both spellings) but was INVISIBLE to the company
 * admin's self-joined screen (exact .eq('join_source','self_joined')), so it could be neither reviewed nor removed.
 * The screen now selects via the SAME shared list the integrity check uses. No data change.
 *
 * The fake applies .eq / .in filters to fixture rows, so a filter that misses a spelling misses the row.
 */
type Row = Record<string, unknown>;
const rows: Row[] = [];
const ops: Array<{ op: string; filters: Array<[string, string, unknown]> }> = [];

function query(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let op = 'select';
  let patch: Row | null = null;
  const match = (r: Row) => filters.every(([kind, col, v]) =>
    kind === 'eq' ? r[col] === v : (v as unknown[]).includes(r[col]));
  const q: any = {
    select: () => q,
    eq: (col: string, v: unknown) => { filters.push(['eq', col, v]); return q; },
    in: (col: string, v: unknown[]) => { filters.push(['in', col, v]); return q; },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    insert: async () => ({ error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      if (table !== 'user_company_roles') return resolve({ data: null, error: null });
      ops.push({ op, filters: [...filters] });
      const hit = rows.filter(match);
      if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
      if (op === 'delete') hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return resolve({ data: hit, error: null });
    },
  };
  return q;
}
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => query(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.test` } } }) } },
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: 'admin-1' } })),
}));

import handler from '../../../pages/api/team/self-joined';
import { SELF_JOINED_JOIN_SOURCE_SPELLINGS, isSelfRegisteredJoinSource } from '../../services/companyMembershipIntegrityService';

function res() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}
const call = async (method: string, query: Record<string, string>, body?: Row) => {
  const r = res();
  await (handler as any)({ method, query, body, headers: {} }, r);
  return r;
};

beforeEach(() => {
  rows.length = 0;
  ops.length = 0;
  rows.push(
    { company_id: 'co_1', user_id: 'u_new', join_source: 'self_joined', status: 'active', role: 'CONTENT_CREATOR', created_at: 't1' },
    { company_id: 'co_1', user_id: 'u_legacy', join_source: 'self_registered', status: 'active', role: 'CONTENT_CREATOR', created_at: 't0' },
    { company_id: 'co_1', user_id: 'u_invited', join_source: 'invited', status: 'active', role: 'COMPANY_ADMIN', created_at: 't2' },
  );
});

it('the screens and the integrity check share ONE list of spellings - pinned to EXACTLY these two', () => {
  // FROZEN (e9/05, 2026-11-13): adding any other value - in particular 'release_validation' - would make 22 unreviewed
  // memberships look "self-joined" to the governance check and the admin screens, laundering grants that the owner's
  // access review has not yet decided. Until that review lands, this constant is the single lever that could undo the
  // freeze silently, so its CONTENTS are pinned, not just its use.
  expect([...SELF_JOINED_JOIN_SOURCE_SPELLINGS]).toEqual(['self_joined', 'self_registered']);
  for (const s of SELF_JOINED_JOIN_SOURCE_SPELLINGS) expect(isSelfRegisteredJoinSource(s)).toBe(true);
  expect(isSelfRegisteredJoinSource('invited')).toBe(false);
});

it('GET lists the legacy self_registered member alongside self_joined (and not the invited one)', async () => {
  const r = await call('GET', { companyId: 'co_1' });
  expect(r.statusCode).toBe(200);
  expect(r.body.users.map((u: Row) => u.user_id).sort()).toEqual(['u_legacy', 'u_new']);
});

it('PATCH can promote the legacy self_registered member', async () => {
  const r = await call('PATCH', { companyId: 'co_1', userId: 'u_legacy' }, { role: 'CONTENT_CREATOR' });
  expect(r.statusCode).toBe(200);
  expect(rows.find((x) => x.user_id === 'u_legacy')?.join_source).toBe('invited');
});

it('DELETE can remove the legacy self_registered member - and never an invited one', async () => {
  expect((await call('DELETE', { companyId: 'co_1', userId: 'u_legacy' })).statusCode).toBe(200);
  expect(rows.some((x) => x.user_id === 'u_legacy')).toBe(false);
  await call('DELETE', { companyId: 'co_1', userId: 'u_invited' });
  expect(rows.some((x) => x.user_id === 'u_invited')).toBe(true);
});
