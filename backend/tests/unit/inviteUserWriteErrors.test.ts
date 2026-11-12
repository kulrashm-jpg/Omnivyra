/**
 * CLASS 1 (e9 ruling (a), 2026-11-12): userManagementService.inviteUser did not
 * read its membership read / update / insert errors, so a failed write returned
 * ok:true and logged USER_INVITED for an invite that never happened.
 */
export {};
type Op = 'select' | 'update' | 'insert';
let mockScript: Partial<Record<Op, { data?: unknown; error?: { message: string; code?: string } | null }>> = {};
const mockWrites: Array<{ op: Op; payload?: unknown }> = [];
const mockAudit: string[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    let op: Op = 'select';
    let payload: unknown;
    const b: any = {};
    for (const m of ['eq', 'limit']) b[m] = () => b;
    b.select = () => b;
    b.update = (p: unknown) => { op = 'update'; payload = p; return b; };
    b.insert = (p: unknown) => { op = 'insert'; payload = p; return b; };
    b.maybeSingle = async () => (table === 'users' ? { data: { id: 'u-target', email: 't@example.test' }, error: null } : { data: null, error: null });
    b.then = (ok: any, ko: any) => {
      if (table !== 'user_company_roles') return Promise.resolve({ data: null, error: null }).then(ok, ko);
      if (op !== 'select') mockWrites.push({ op, payload });
      const r = mockScript[op] ?? { data: op === 'select' ? [] : null, error: null };
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(ok, ko);
    };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../services/rbacService', () => ({
  getUserRole: async () => ({ role: null, error: null }),
  isSuperAdmin: async () => true,
  Role: jest.requireActual('../../services/rbacPrimitives').Role,
}));
jest.mock('../../services/campaignAuditService', () => ({ logUserManagementAudit: (k: string) => { mockAudit.push(k); } }));
jest.mock('../../../lib/identity/identityGateway', () => ({ ensureUnifiedPerson: async () => 'p1' }));

import { inviteUser } from '../../services/userManagementService';

const invite = (role = 'CONTENT_CREATOR') => inviteUser('t@example.test', 'co1', role, { userId: 'sa1' } as any);
beforeEach(() => { mockScript = {}; mockWrites.length = 0; mockAudit.length = 0; });

it('membership READ error -> 503, nothing written, no audit', async () => {
  mockScript.select = { error: { message: 'down' } };
  const r = await invite();
  expect(r).toMatchObject({ ok: false, status: 503, error: 'MEMBERSHIP_LOOKUP_FAILED' });
  expect(mockWrites).toEqual([]);
  expect(mockAudit).toEqual([]);
});

it('UPDATE error on an existing membership -> 503, no USER_INVITED audit', async () => {
  mockScript.select = { data: [{ id: 'm1', role: 'VIEW_ONLY' }] };
  mockScript.update = { error: { message: 'down' } };
  const r = await invite('CONTENT_CREATOR');
  expect(r).toMatchObject({ ok: false, status: 503, error: 'MEMBERSHIP_UPDATE_FAILED' });
  expect(mockAudit).toEqual([]);
});

it('INSERT error -> 503, no audit; a 23505 (concurrent create) -> 409, not a success', async () => {
  mockScript.insert = { error: { message: 'down' } };
  expect(await invite()).toMatchObject({ ok: false, status: 503, error: 'MEMBERSHIP_INSERT_FAILED' });
  mockScript.insert = { error: { message: 'dup', code: '23505' } };
  expect(await invite()).toMatchObject({ ok: false, status: 409, error: 'MEMBERSHIP_CREATED_CONCURRENTLY' });
  expect(mockAudit).toEqual([]);
});

it('control: a clean insert succeeds and is audited; the role is stored AS NAMED (R3: no downgrade)', async () => {
  const r = await invite('CONTENT_MANAGER');
  expect(r).toMatchObject({ ok: true, role: 'CONTENT_MANAGER' });
  expect(mockWrites).toEqual([{ op: 'insert', payload: expect.objectContaining({ role: 'CONTENT_MANAGER' }) }]);
  expect(mockAudit).toEqual(['USER_INVITED']);
});

it('R3: the legacy ADMIN alias is no longer invitable here (400), SUPER_ADMIN stays refused (403)', async () => {
  expect(await invite('ADMIN')).toMatchObject({ ok: false, status: 400, error: 'UNSUPPORTED_ROLE' });
  expect(await invite('SUPER_ADMIN')).toMatchObject({ ok: false, status: 403 });
  expect(mockWrites).toEqual([]);
});
