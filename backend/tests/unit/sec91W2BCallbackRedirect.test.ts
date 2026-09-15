/**
 * SEC91-W2B-4 (P3) — Google Analytics / Search Console OAuth callback redirect target.
 *
 * pages/api/analytics/connect/google/callback.ts `buildRedirectUrl` accepted any
 * `returnTo` that starts with '/', which includes protocol-relative `//evil.example` and
 * `/\evil.example`. Today every returnTo it sees comes from decodeOAuthState (validated by
 * SEC91-B4) — directly or via handleGoogleOAuthCallback — so this is defence in depth:
 * the redirect now goes through the ONE validator, backend/auth/safeRedirect
 * safeRelativeRedirectPath, and a future caller cannot re-open the hole.
 *
 * The meta connector token-exchange log line (connectors/meta/callback.ts) named in the
 * same registry entry was already fixed by SEC91-B6 (summarizeProviderBody); its test is
 * sec91BSecretLogRedaction "community-AI meta connector".
 */
import { seed, invoke, USER_A, CO_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', OAUTH_STATE_HMAC_KEY: 'sec91-w2b-4-test-hmac-key' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../auth/oauthTelemetry', () => ({ logOAuthEvent: jest.fn(), safeHost: () => 'host' }));
jest.mock('../../services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
const mockHandle = jest.fn();
jest.mock('../../services/analyticsIntegrationService', () => ({
  handleGoogleOAuthCallback: (...a: unknown[]) => mockHandle(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { encodeOAuthState } = require('../../auth/oauthState');
const callback = require('../../../pages/api/analytics/connect/google/callback').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const DEFAULT = '/integrations?focus=data';
const state = () => encodeOAuthState({ companyId: CO_A, userId: USER_A, flow: 'ga4', returnTo: '/integrations' });
const serviceResult = (returnTo: string | null, properties: unknown[] = []) => ({
  companyId: CO_A, integration: { id: 'int-1', status: 'connected' }, properties, returnTo, flow: 'ga4',
});

beforeEach(() => {
  seed();
  mockHandle.mockReset();
});

describe('SEC91-W2B-4 google callback redirects only to validated same-origin paths', () => {
  it.each([
    ['protocol-relative', '//evil.example/phish'],
    ['backslash', '/\\evil.example/phish'],
    ['tab-smuggled', '/\t/evil.example'],
  ])('%s returnTo from the service → the default destination', async (_l, evil) => {
    mockHandle.mockResolvedValue(serviceResult(evil));
    const r = await invoke(callback, { as: 'A', query: { code: 'c', state: state() } });
    expect(r.redirect).toBe(`${DEFAULT}&error=no_properties_found`);
  });

  it.each(['//evil.example/phish', '/\\evil.example'])('the success path never redirects to %s', async (evil) => {
    mockHandle.mockResolvedValue(serviceResult(evil, [{ id: 'p1' }]));
    const r = await invoke(callback, { as: 'A', query: { code: 'c', state: state() } });
    expect(String(r.redirect).startsWith(`${DEFAULT}&`)).toBe(true);
    expect(String(r.redirect)).not.toContain('evil.example');
  });

  it('LEGITIMATE: a same-origin returnTo is kept, with its own query string', async () => {
    mockHandle.mockResolvedValue(serviceResult('/super-admin?tab=analytics', [{ id: 'p1' }]));
    const r = await invoke(callback, { as: 'A', query: { code: 'c', state: state() } });
    expect(r.redirect).toBe('/super-admin?tab=analytics&ga4=connected&analytics=ga');
  });

  it('LEGITIMATE: a signed returnTo is used on the error paths (unchanged)', async () => {
    const r = await invoke(callback, { as: 'A', query: { state: state() } });
    expect(r.redirect).toBe('/integrations?error=missing_code');
    expect(mockHandle).not.toHaveBeenCalled();
  });
});
