/**
 * e9 (C) d2, 2026-11-11: the super-admin GA / GSC connect is a LIVE product
 * capability. The env-credential super-admin login mints only a canonical
 * session (no Supabase token), so the OAuth callback - which authenticated
 * with the Supabase user alone - always answered `error=unauthorized` for that
 * operator. The callback now falls back to the canonical session when there is
 * no Supabase token. The state names the starting user (super-admin connect
 * writes the principal's users.id) and the callback stays bound to THAT user.
 */
jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', OAUTH_STATE_HMAC_KEY: 'd2-test-hmac-key-for-oauth-state' } }), { virtual: true });
jest.mock('../../../config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', OAUTH_STATE_HMAC_KEY: 'd2-test-hmac-key-for-oauth-state' } }));

let mockSupabaseUser: { id: string } | null = null;
let mockPrincipalUserId: string | null = null;
const mockHandled: Array<Record<string, unknown>> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => (mockSupabaseUser
    ? { user: { ...mockSupabaseUser, email: 'x@example.test', emailVerified: true }, error: null }
    : { user: null, error: 'MISSING_AUTH' }),
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: async () => (mockPrincipalUserId
    ? { ok: true, principal: { userId: mockPrincipalUserId, email: 'sa@example.test', emailVerified: true } }
    : { ok: false, reason: 'NO_AUTH' }),
}));
jest.mock('../../services/analyticsIntegrationService', () => ({
  handleGoogleOAuthCallback: jest.fn(async (input: Record<string, unknown>) => {
    mockHandled.push(input);
    return { companyId: 'c', integration: { id: 'i', status: 'connected' }, properties: [{ id: 'p' }], returnTo: '/super-admin/dashboard', flow: 'ga4' };
  }),
}));
jest.mock('../../auth/oauthTelemetry', () => ({ logOAuthEvent: jest.fn(), safeHost: () => 'host' }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encodeOAuthState } = require('../../auth/oauthState');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const callback = require('../../../pages/api/analytics/connect/google/callback').default;

const OMNI = '00000000-0000-4000-8000-0000000000aa';
const SA = 'sa-user-id';

async function hit(state: string) {
  const out = { code: 0, location: '' };
  const r = {
    status: (c: number) => { out.code = c; return r; },
    json: () => r,
    setHeader: () => r,
    redirect: (a: number | string, b?: string) => { out.code = typeof a === 'number' ? a : 302; out.location = String(b ?? a); return r; },
  };
  await callback({ method: 'GET', query: { code: 'auth-code', state }, headers: { host: 'localhost' }, cookies: {}, url: '/api/analytics/connect/google/callback' }, r);
  return out;
}

beforeEach(() => { mockSupabaseUser = null; mockPrincipalUserId = null; mockHandled.length = 0; });

it('a canonical-session super admin (no Supabase token) COMPLETES the connect it started', async () => {
  mockPrincipalUserId = SA;
  const r = await hit(encodeOAuthState({ companyId: OMNI, userId: SA, flow: 'ga4', returnTo: '/super-admin/dashboard' }));
  expect(r.location).not.toMatch(/error=/);
  expect(mockHandled).toHaveLength(1);
});

it('the callback stays bound to the starting user: another canonical principal is refused', async () => {
  mockPrincipalUserId = 'someone-else';
  const r = await hit(encodeOAuthState({ companyId: OMNI, userId: SA, flow: 'ga4', returnTo: '/super-admin/dashboard' }));
  expect(r.location).toMatch(/error=invalid_oauth_state/);
  expect(mockHandled).toHaveLength(0);
});

it('a user-less state is never accepted, even with a session', async () => {
  mockPrincipalUserId = SA;
  const r = await hit(encodeOAuthState({ companyId: OMNI, flow: 'ga4', returnTo: '/super-admin/dashboard' }));
  expect(r.location).toMatch(/error=invalid_oauth_state/);
  expect(mockHandled).toHaveLength(0);
});

it('no session at all -> unauthorized, nothing handled', async () => {
  const r = await hit(encodeOAuthState({ companyId: OMNI, userId: SA, flow: 'ga4', returnTo: '/super-admin/dashboard' }));
  expect(r.location).toMatch(/error=unauthorized/);
  expect(mockHandled).toHaveLength(0);
});

it('the tenant (Supabase) path is unchanged: the Supabase user wins, no canonical fallback needed', async () => {
  mockSupabaseUser = { id: 'tenant-user' };
  mockPrincipalUserId = 'would-be-wrong';
  const r = await hit(encodeOAuthState({ companyId: OMNI, userId: 'tenant-user', flow: 'gsc', returnTo: '/integrations' }));
  expect(r.location).not.toMatch(/error=/);
  expect(mockHandled).toHaveLength(1);
});
