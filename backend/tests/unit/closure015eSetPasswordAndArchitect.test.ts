/**
 * Closure-015E — the two branches the main 015E suites cannot reach:
 *
 *   1. auth/set-password: the invitation-activation step uses the shared
 *      isInvitationExpired predicate — expired AT expires_at, missing /
 *      malformed ⇒ expired — and refuses BEFORE activate_invitation_membership.
 *   2. withRBAC's company-status check exempts the content-architect principal
 *      (as it exempts the platform super admin): withRBAC never read company
 *      status before Closure-015E, so this PRESERVES the architect's existing
 *      behaviour. Whether the architect should be subject to company status is
 *      an open owner decision (report §8, decision E-4) — this pins today's
 *      behaviour so any change is deliberate.
 *
 * REAL: set-password route, invitationExpiry, withRBAC → enforceRole (content
 * architect branch), companyOperationalState — over the routeAuthHarness tables.
 * MOCKED: authentication (x-test-user / a content-architect user context), the
 * Supabase admin password update, session/step-up revocation, security audit.
 */
import { seed, rows, calls, invoke, CO_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const m = require('../helpers/routeAuthHarness').supabaseModule();
  m.supabase.auth.admin.updateUserById = async () => ({ data: {}, error: null });
  return m;
});
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async (req: { headers?: Record<string, unknown> }) => {
    const id = req?.headers?.['x-test-user'];
    return typeof id === 'string' && id
      ? { user: { id, supabaseUid: `sb-${id}`, email: 'invitee@example.test', status: 'active' }, error: null }
      : { user: null, error: 'NO_TOKEN' };
  },
}));
jest.mock('../../security/SessionAuthorityService', () => ({
  clearSessionCookie: jest.fn(), revokeAllSessionsForUser: jest.fn(async () => undefined),
}));
jest.mock('../../security/stepup/StepUpSessionService', () => ({ revokeForUser: jest.fn(async () => undefined) }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/userPreferencesService', () => ({ getPostLoginRoute: async () => '/dashboard' }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
// Content-architect principal for the withRBAC part (x-test-architect header).
jest.mock('../../services/userContextService', () => ({
  ...jest.requireActual('../../services/userContextService'),
  resolveUserContext: async (req: { headers?: Record<string, unknown> }) =>
    req?.headers?.['x-test-architect']
      ? { userId: 'content_architect', role: 'CONTENT_ARCHITECT', authenticated: true, companyIds: [], defaultCompanyId: null }
      : { userId: '', authenticated: false, authError: 'MISSING_AUTH' },
}));

import setPassword from '../../../pages/api/auth/set-password';
import { withRBAC } from '../../middleware/withRBAC';
import { Role } from '../../services/rbacService';

const USER = 'u-invitee';
const PASSWORD = 'C15e-Test-Passw0rd!-not-real';
const T = Date.parse('2026-10-15T12:00:00.000Z');

function world(expires_at: unknown) {
  seed({
    users: [{ id: USER, email: 'invitee@example.test', has_password: false }],
    invitations: [{ id: 'inv-sp', email: 'invitee@example.test', company_id: CO_A, role: 'VIEW_ONLY', expires_at, accepted_at: null, revoked_at: null, token_consumed_at: '2026-10-15T11:00:00.000Z', created_at: '2026-10-15T10:00:00.000Z' }],
  });
}
const post = () => invoke(setPassword as never, { method: 'POST', body: { password: PASSWORD, flow: 'signup' }, headers: { 'x-test-user': USER } });
const activationCalled = () => calls().some((c) => c.table === 'rpc:activate_invitation_membership');
afterEach(() => jest.useRealTimers());

describe('auth/set-password — invitation expiry (shared predicate)', () => {
  it.each([['malformed', 'not-a-date'], ['missing', null], ['empty', '']])('%s expires_at → 400 EXPIRED_INVITATION; invitation revoked; activation RPC never called', async (_d, v) => {
    world(v);
    const r = await post();
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'EXPIRED_INVITATION' });
    expect(rows('invitations')[0].revoked_at).toBeTruthy();
    expect(activationCalled()).toBe(false);
  });

  it('boundary (expires_at === now) → 400 EXPIRED_INVITATION; activation never called', async () => {
    jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    world(new Date(T).toISOString());
    const r = await post();
    expect(r.status).toBe(400);
    expect(activationCalled()).toBe(false);
  });

  it('valid (1 s before expiry) → passes the expiry check and reaches activate_invitation_membership', async () => {
    jest.useFakeTimers({ now: T, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    world(new Date(T + 1000).toISOString());
    await post();
    expect(activationCalled()).toBe(true);
    expect(rows('invitations')[0].revoked_at ?? null).toBeNull();
  });
});

describe('withRBAC — content-architect principal and company status (behaviour preserved; owner decision E-4)', () => {
  const route = withRBAC((async (_q: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(200).json({ ok: true })) as never, [Role.COMPANY_ADMIN]);
  const call = () => invoke(route as never, { method: 'GET', query: { companyId: CO_A }, headers: { 'x-test-architect': '1' } });

  it('active company → 200 (unchanged)', async () => {
    seed();
    expect((await call()).status).toBe(200);
  });

  it('suspended company → 200: the architect is exempt from the new company-status check, exactly as before Closure-015E', async () => {
    seed();
    rows('companies').find((c) => c.id === CO_A)!.status = 'suspended';
    expect((await call()).status).toBe(200);
  });
});
