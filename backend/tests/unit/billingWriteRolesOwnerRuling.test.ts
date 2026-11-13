/**
 * OWNER RULING 2026-11-13 (via e9): billing WRITES are company admins only - buying credits (checkout create-order),
 * starting a subscription / top-up session (checkout-session), changing the billing profile and the billing context
 * (PUT). verify / close STAY membership-level so a payment already made always completes. The REAL TenantGuard decides
 * (requireTenantAccess with requireRoleIn); only the database and the identity are faked.
 */
import { seed, invoke, rows, CO_A, USER_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
// The harness principal carries no activeOrgId; the billing routes bind to it, so it is added here (company A).
jest.mock('../../security/IdentityResolver', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  return {
    resolvePrincipal: jest.fn(async (req: any) => {
      const u = h.userForRequest(req);
      return u
        ? { ok: true, principal: { userId: u.id, supabaseUid: u.id, email: u.email, legacyCookieSuperAdmin: false, activeOrgId: h.CO_A } }
        : { ok: false, reason: 'NO_AUTH' };
    }),
  };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
const checkoutSession = require('../../../pages/api/billing/checkout-session').default;
const profile = require('../../../pages/api/billing/profile').default;
const context = require('../../../pages/api/billing/context').default;
const createOrder = require('../../../pages/api/billing/checkout/create-order').default;
const verify = require('../../../pages/api/billing/checkout/verify').default;
const close = require('../../../pages/api/billing/checkout/close').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function asRole(role: string) {
  seed();
  const r = rows('user_company_roles').find((x) => x.user_id === USER_A && x.company_id === CO_A)!;
  r.role = role;
}
const run = async (h: any, method: string, body: Record<string, unknown> = {}) => {
  try { return await invoke(h, { method, as: 'A', query: { org_id: CO_A }, body: { org_id: CO_A, ...body } }); }
  catch { return { status: undefined, body: undefined } as any; } // a failure AFTER the gate is not under test here
};

const ADMIN_ONLY: Array<[string, any, string]> = [
  ['checkout-session', checkoutSession, 'POST'],
  ['profile PUT', profile, 'PUT'],
  ['context PUT', context, 'PUT'],
  ['checkout/create-order', createOrder, 'POST'],
];

describe.each(ADMIN_ONLY)('%s is company admins only', (_name, handler, method) => {
  it.each(['VIEW_ONLY', 'CONTENT_CREATOR'])('%s -> 403 INSUFFICIENT_ROLE', async (role) => {
    asRole(role);
    const r = await run(handler, method);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });
  it('COMPANY_ADMIN passes the role gate', async () => {
    asRole('COMPANY_ADMIN');
    const r = await run(handler, method);
    expect(r.body?.code).not.toBe('INSUFFICIENT_ROLE');
    expect(r.status).not.toBe(403);
  });
});

describe('membership-level by ruling: a payment already made always completes', () => {
  it.each([['checkout/verify', verify], ['checkout/close', close]])('%s: a VIEW_ONLY member is NOT refused by role', async (_n, handler) => {
    asRole('VIEW_ONLY');
    const r = await run(handler as any, 'POST', { purchase_id: 'p-1' });
    expect(r.body?.code).not.toBe('INSUFFICIENT_ROLE');
    expect(r.status).not.toBe(403);
  });
  it('context GET (a read) stays membership-level', async () => {
    asRole('VIEW_ONLY');
    const r = await run(context, 'GET');
    expect(r.body?.code).not.toBe('INSUFFICIENT_ROLE');
    expect(r.status).not.toBe(403);
  });
});
