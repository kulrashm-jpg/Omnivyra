/**
 * PRIVILEGE class 2 (2026-11-12): super-admin suspend / resume updated users BY
 * ID ONLY from a stale read. A resume racing a soft-delete set the DELETED
 * account back to 'active'; a suspend could overwrite a concurrent status
 * change. Now both are a CAS on the state as read (+ not deleted) with a row
 * count -> 409 USER_STATE_CHANGED.
 *
 * The fake applies eq/is filters and returns copies; the race is injected
 * after the route's read.
 */
export {};
type Row = Record<string, any>;
let mockUsers: Row[] = [];
let mockBetween: (() => void) | null = null;

function mockQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: Row = {};
  const exec = async (single: boolean) => {
    if (table !== 'users') return { data: null, error: null };
    const hit = mockUsers.filter((r) => filters.every((f) => f(r)));
    if (op === 'select') { const c = hit.map((r) => ({ ...r })); if (mockBetween) { const f = mockBetween; mockBetween = null; f(); } return { data: single ? c[0] ?? null : c, error: null }; }
    for (const r of hit) Object.assign(r, payload);
    return { data: hit.map((r) => ({ id: r.id })), error: null };
  };
  const b: any = {
    select: () => b,
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    maybeSingle: () => exec(true),
    then: (ok: any, ko: any) => exec(false).then(ok, ko),
  };
  return b;
}
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockQuery(t) } }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: async () => ({ ok: true, principal: { userId: 'sa1' } }) }));
jest.mock('../../services/auditActorService', () => ({ insertAuditLogStrict: jest.fn(async () => ({ ok: true })), SYSTEM_USER_ID: 'system' }));
jest.mock('../../../lib/auth/auditLog', () => ({ logAuthEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/lifecycleGovernance', () => ({ invalidateUserSessionsAndSignOut: jest.fn(async () => ({ ok: true, revokedSessions: 1 })) }));

import suspend from '../../../pages/api/super-admin/users/[id]/suspend';
import resume from '../../../pages/api/super-admin/users/[id]/resume';

function mockRes() { const r: any = { statusCode: 0, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; return r; }
async function call(h: any) { const res = mockRes(); await h({ method: 'POST', query: { id: 'u1' }, body: { reason: 'policy' }, headers: {} } as any, res); return res; }
const user = () => mockUsers[0];

beforeEach(() => { mockUsers = []; mockBetween = null; });

describe('resume', () => {
  beforeEach(() => { mockUsers = [{ id: 'u1', email: 'a@x', status: 'suspended', is_deleted: false, active_company_id: null }]; });
  it('control: a suspended account is resumed', async () => {
    const r = await call(resume);
    expect(r.statusCode).toBe(200);
    expect(user().status).toBe('active');
  });
  it('an account SOFT-DELETED between read and write is NOT reactivated (409)', async () => {
    mockBetween = () => { user().is_deleted = true; user().status = 'deleted'; };
    const r = await call(resume);
    expect(r.statusCode).toBe(409);
    expect(user()).toMatchObject({ status: 'deleted', is_deleted: true });
  });
});

describe('suspend', () => {
  beforeEach(() => { mockUsers = [{ id: 'u1', email: 'a@x', status: 'active', is_deleted: false, active_company_id: null }]; });
  it('control: an active account is suspended', async () => {
    const r = await call(suspend);
    expect(r.statusCode).toBe(200);
    expect(user().status).toBe('suspended');
  });
  it('an account DELETED between read and write is not overwritten (409)', async () => {
    mockBetween = () => { user().is_deleted = true; user().status = 'deleted'; };
    const r = await call(suspend);
    expect(r.statusCode).toBe(409);
    expect(user().status).toBe('deleted');
  });
  it('a user with a NULL status is matched with IS NULL (still suspendable)', async () => {
    user().status = null;
    const r = await call(suspend);
    expect(r.statusCode).toBe(200);
    expect(user().status).toBe('suspended');
  });
});
