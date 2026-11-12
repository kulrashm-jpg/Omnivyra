/**
 * 05 finding (2026-11-12) on the allow-list entry invite-set-password-own-email: the entry said
 * "verified email", the route never checked it. Now set-password lets the authenticated user's
 * email select an invitation ONLY when user.emailVerified is true. Unverified -> no invitation is
 * read, revoked or activated (the password itself is still set).
 * The allow-list entry names the case "an UNVERIFIED email never activates an invitation".
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockReads: string[] = [];
const mockRpcs: string[] = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let patch: Row | null = null;
  const run = () => {
    mockReads.push(table);
    const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
    if (patch) { hit.forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { tests.push((r) => (r[c] ?? null) === v); return b; },
    not: (c: string, _op: string, v: unknown) => { tests.push((r) => (r[c] ?? null) !== v); return b; },
    update: (p: Row) => { patch = p; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
let mockVerified = false;
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockTable(t),
    rpc: async (fn: string) => { mockRpcs.push(fn); return { data: [{ company_id: '22222222-2222-4222-8222-222222222222' }], error: null }; },
    auth: { admin: { updateUserById: async () => ({ error: null }) } },
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIpOrNull: () => '1.2.3.4' }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: { id: 'user-x', supabaseUid: 'sb-x', email: 'victim@b.test', emailVerified: mockVerified, status: 'active' }, error: null }),
}));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: () => undefined }));
jest.mock('../../services/userPreferencesService', () => ({ getPostLoginRoute: async () => '/home' }));
jest.mock('../../security/SessionAuthorityService', () => ({ clearSessionCookie: () => undefined, revokeAllSessionsForUser: async () => undefined }));
jest.mock('../../security/stepup/StepUpSessionService', () => ({ revokeForUser: async () => undefined }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: async () => undefined }));
jest.mock('../../../lib/auth/passwordPolicy', () => ({ validatePassword: () => ({ valid: true }) }));
jest.mock('../../services/invitationExpiry', () => ({ isInvitationExpired: () => false }));

/* eslint-disable @typescript-eslint/no-var-requires */
const setPassword = require('../../../pages/api/auth/set-password').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function post() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await setPassword({ method: 'POST', headers: {}, query: {}, body: { password: 'Correct-Horse-9', flow: 'signup' } }, res);
  return res;
}
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockReads.length = 0; mockRpcs.length = 0;
  mockDb.users = [{ id: 'user-x', has_password: false, name: 'X' }];
  // a pending, link-consumed invitation addressed to victim@b.test for company B
  mockDb.invitations = [{ id: 'inv-b', company_id: '22222222-2222-4222-8222-222222222222', email: 'victim@b.test', accepted_at: null, revoked_at: null, token_consumed_at: '2026-11-12', expires_at: 'x', created_at: '1' }];
  mockDb.user_company_roles = [];
});

it('an UNVERIFIED email never activates an invitation (none is even read)', async () => {
  mockVerified = false;
  const r = await post();
  expect(r.statusCode).toBe(200);
  expect(mockReads).not.toContain('invitations');
  expect(mockRpcs).not.toContain('activate_invitation_membership');
});

it('control: a VERIFIED email activates its pending invitation', async () => {
  mockVerified = true;
  const r = await post();
  expect(r.statusCode).toBe(200);
  expect(mockRpcs).toContain('activate_invitation_membership');
});
