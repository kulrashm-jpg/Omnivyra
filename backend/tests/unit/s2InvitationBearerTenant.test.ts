/**
 * S2 tenant seam (e1) - invitation BEARER flows (83 Case B: allow-listed bearer lookup, then every
 * write pinned via systemTenantContext(row.company_id, reason)):
 *   - accept-invite (bearer: sha256 of the secret token): consume / revoke / un-consume writes carry
 *     the invitation's OWN tenant;
 *   - resend-invitation self-serve (bearer: an email, constant 200): the revoke write carries the
 *     invitation's tenant, and the response is the SAME 200 body whether or not an invitation
 *     exists (no enumeration) - the test named by the allow-list entry invite-resend-self-serve.
 * The fake applies every filter and records each write with its filters.
 */
export {};
import { createHash } from 'crypto';
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; filters: Row; patch: Row }> = [];
function mockTable(table: string) {
  const filters: Row = {}; const tests: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null; let one = false;
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (patch) { mockWrites.push({ table, filters: { ...filters }, patch }); hit.forEach((r) => Object.assign(r, patch)); return { data: one ? hit[0] ?? null : hit, error: null }; }
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { filters[c] = v; tests.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters[`${c}:is`] = v; tests.push((r) => (r[c] ?? null) === v); return b; },
    update: (p: Row) => { patch = p; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
let mockOtpError: unknown = null;
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t), auth: { signInWithOtp: async () => ({ error: mockOtpError }) } } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }), LOGIN_LIMIT: {}, EMAIL_LINK_LIMIT: {} }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: () => undefined }));
jest.mock('../../config/getCanonicalAppUrl', () => ({ getCanonicalAppUrl: () => 'https://app.test' }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
let mockAdminOf: string | null = null; // the company the admin principal administers
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: async () => (mockAdminOf ? { ok: true, principal: { userId: 'admin-a', legacyCookieSuperAdmin: false } } : { ok: false }),
}));
jest.mock('../../security/TenantGuard', () => ({
  // the real guard answers 403 for a company the caller does not administer
  requireTenantAccess: async (_req: unknown, res: any, companyId: string) =>
    (companyId === mockAdminOf ? { userId: 'admin-a', organizationId: companyId } : (res.status(403).json({ error: 'forbidden' }), null)),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: async () => undefined }));
jest.mock('../../services/invitationService', () => ({ createAndSendInvitation: async () => ({ id: 'inv-new' }) }));
let mockExpired = false;
jest.mock('../../services/invitationExpiry', () => ({ isInvitationExpired: () => mockExpired }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
/* eslint-disable @typescript-eslint/no-var-requires */
const accept = require('../../../pages/api/auth/accept-invite').default;
const resend = require('../../../pages/api/auth/resend-invitation').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function post(h: any, body: Row) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await h({ method: 'POST', headers: {}, query: {}, body }, res);
  return res;
}
const TOKEN_B = 'token-for-company-b-0123456789';
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockExpired = false; mockOtpError = null; mockAdminOf = null;
  mockDb.invitations = [
    { id: 'inv-b', company_id: B, email: 'x@b.test', role: 'VIEW_ONLY', invited_by: null, token_hash: createHash('sha256').update(TOKEN_B).digest('hex'), expires_at: 'x', accepted_at: null, revoked_at: null, token_consumed_at: null },
    { id: 'inv-a', company_id: A, email: 'y@a.test', role: 'VIEW_ONLY', invited_by: null, token_hash: 'other', expires_at: 'x', accepted_at: null, revoked_at: null, token_consumed_at: null },
  ];
});
const inviteWrites = () => mockWrites.filter((w) => w.table === 'invitations');

describe('accept-invite (bearer: secret token)', () => {
  it("the consume write carries the invitation's OWN tenant (B)", async () => {
    const r = await post(accept, { token: TOKEN_B });
    expect(r.statusCode).toBe(200);
    expect(inviteWrites()[0].filters).toMatchObject({ id: 'inv-b', company_id: B });
    expect(mockDb.invitations.find((i) => i.id === 'inv-a')!.token_consumed_at).toBeNull();
  });
  it('an expired invitation is revoked - the write pinned to its tenant', async () => {
    mockExpired = true;
    const r = await post(accept, { token: TOKEN_B });
    expect(r.statusCode).toBe(400);
    expect(inviteWrites()[0]).toMatchObject({ filters: { id: 'inv-b', company_id: B } });
  });
  it('an OTP failure un-consumes the token - pinned to its tenant', async () => {
    mockOtpError = { message: 'smtp down' };
    const r = await post(accept, { token: TOKEN_B });
    expect(r.statusCode).toBe(502);
    expect(inviteWrites().map((w) => w.filters.company_id)).toEqual([B, B]);
  });
});

describe('resend-invitation self-serve (bearer: email, constant 200)', () => {
  it('self-serve resend answers the same 200 body whether or not an invitation exists', async () => {
    const withInvite = await post(resend, { email: 'x@b.test' });
    const without = await post(resend, { email: 'nobody@nowhere.test' });
    expect(withInvite.statusCode).toBe(200);
    expect(without.statusCode).toBe(200);
    expect(JSON.stringify(withInvite.body)).toBe(JSON.stringify(without.body));
  });
  it("the revoke of the old invitation carries its OWN tenant (B)", async () => {
    await post(resend, { email: 'x@b.test' });
    expect(inviteWrites()[0].filters).toMatchObject({ id: 'inv-b', company_id: B });
  });
});

describe('resend-invitation ADMIN mode (83 Case A: derive -> authorize -> act)', () => {
  it("another tenant's ACCEPTED invitation and an unknown id answer the SAME 404 (no status oracle); nothing written", async () => {
    mockAdminOf = A;
    mockDb.invitations.find((i) => i.id === 'inv-b')!.accepted_at = '2026-11-01';
    const foreign = await post(resend, { invitationId: 'inv-b' });
    const unknown = await post(resend, { invitationId: 'inv-nope' });
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(unknown.body));
    expect(inviteWrites()).toHaveLength(0);
  });
  it('own invitation: resent, and the revoke is pinned to the authorized company', async () => {
    mockAdminOf = A;
    const r = await post(resend, { invitationId: 'inv-a' });
    expect(r.statusCode).toBe(200);
    expect(inviteWrites()[0].filters).toMatchObject({ id: 'inv-a', company_id: A });
  });
  it("own ACCEPTED invitation: 409 is disclosed only AFTER authorization", async () => {
    mockAdminOf = A;
    mockDb.invitations.find((i) => i.id === 'inv-a')!.accepted_at = '2026-11-01';
    const r = await post(resend, { invitationId: 'inv-a' });
    expect(r.statusCode).toBe(409);
  });
});
