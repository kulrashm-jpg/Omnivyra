/**
 * MONEY / PRIVILEGE unread-error sites (2026-11-12): super-admin credit grants.
 *  - credits/grant: a failed org-existence read was "Organization not found"
 *    (404); now 503 and nothing granted.
 *  - free-credits/grant: an unread role read looked like "no role" and
 *    INSERTED a COMPANY_ADMIN membership for a user who may already hold
 *    another role - a privilege change on an unread answer. Now the membership
 *    is only created on a clean empty read; otherwise the response says the
 *    role was NOT ensured (the credits are already granted).
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockScript: Record<string, () => Res> = {};
const mockWrites: string[] = [];
const mockGrants: string[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../security/requireCapability', () => ({ requireCapability: async () => ({ ok: true, principal: { userId: 'sa1' } }) }));
jest.mock('../../security/preAuthorization', () => ({ mayAttemptCapability: async () => true }));
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: async () => undefined }));
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: async (a: { referenceId: string }) => { mockGrants.push(a.referenceId); },
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let op = 'select';
      const b: any = {};
      const result = () => (mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))();
      for (const m of ['select', 'eq', 'limit']) b[m] = () => b;
      b.insert = () => { op = 'insert'; mockWrites.push(table + ':insert'); return b; };
      b.maybeSingle = async () => result();
      b.single = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));

import creditsGrant from '../../../pages/api/super-admin/credits/grant';
import freeCreditsGrant from '../../../pages/api/super-admin/free-credits/grant';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}
async function post(h: (req: any, res: any) => unknown, body: unknown) {
  const res = mockRes();
  await h({ method: 'POST', body, headers: {}, query: {} }, res);
  return res;
}
const DOWN = () => ({ data: null, error: { message: 'down' } });
let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockScript = { 'manual_credit_grants:insert': () => ({ data: { id: 'g1' }, error: null }) };
  mockWrites.length = 0; mockGrants.length = 0;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

describe('super-admin/credits/grant', () => {
  it('org lookup error -> 503, NOT 404; nothing granted', async () => {
    mockScript['companies:select'] = DOWN;
    const res = await post(creditsGrant, { organization_id: 'o1', credits: 10, reason: 'r' });
    expect(res.statusCode).toBe(503);
    expect(mockGrants).toEqual([]);
  });
  it('control: an absent org is still 404', async () => {
    const res = await post(creditsGrant, { organization_id: 'o1', credits: 10, reason: 'r' });
    expect(res.statusCode).toBe(404);
  });
});

describe('super-admin/free-credits/grant', () => {
  const BODY = { organizationId: 'o1', userId: 'u1', creditsAmount: 10, category: 'manual', reason: 'r' };

  it('role read error -> credits granted but NO membership inserted; response says role NOT ensured', async () => {
    mockScript['user_company_roles:select'] = DOWN;
    const res = await post(freeCreditsGrant, BODY);
    expect(res.statusCode).toBe(200);
    expect(mockGrants).toEqual(['g1']);
    expect(mockWrites).not.toContain('user_company_roles:insert');
    expect(res.body).toMatchObject({ success: true, roleEnsured: false });
  });

  it('control: a clean empty role read creates the COMPANY_ADMIN membership', async () => {
    const res = await post(freeCreditsGrant, BODY);
    expect(mockWrites).toContain('user_company_roles:insert');
    expect(res.body).toMatchObject({ success: true, roleEnsured: true });
  });

  it('role insert error -> reported (roleEnsured false), never a silent success', async () => {
    mockScript['user_company_roles:insert'] = DOWN;
    const res = await post(freeCreditsGrant, BODY);
    expect(res.body).toMatchObject({ roleEnsured: false });
  });
});
