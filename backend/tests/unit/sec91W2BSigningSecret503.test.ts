/**
 * SEC91-W2B-5 (P3) — signing-secret-unavailable answers.
 *
 * Since SEC91-B1 the extension and RPA token issuers fail closed when no server-only
 * signing secret is configured (SigningSecretUnavailableError). The routes then answered
 * HTTP 500 with the error message, which names the environment variables to set
 * (`... (set EXTENSION_SESSION_SECRET or AUTH_SECRET)`) — configuration detail handed to
 * any authenticated caller (or, for /api/extension/redeem, any claim-code holder).
 *
 * NOW: 503 with the plain code `SIGNING_SECRET_UNAVAILABLE`; any other failure is a
 * generic 500 without the internal message. Production resolves AUTH_SECRET (it has no
 * EXTENSION_SESSION_SECRET / RPA_AUTH_SECRET), so the success path is unchanged (COMPAT).
 */
import { seed, invoke, CO_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

/* eslint-disable @typescript-eslint/no-var-requires */
const route = (p: string) => require(`../../../pages/api/${p}`).default;
const { createClaimCode } = require('../../services/extensionClaimCodeService');
/* eslint-enable @typescript-eslint/no-var-requires */

const SECRET_ENVS = ['EXTENSION_SESSION_SECRET', 'RPA_AUTH_SECRET', 'AUTH_SECRET', 'NEXTAUTH_SECRET'];
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of SECRET_ENVS) saved[k] = process.env[k]; });
afterAll(() => { for (const k of SECRET_ENVS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
beforeEach(() => {
  seed();
  for (const k of SECRET_ENVS) delete process.env[k];
});

const CASES: Array<{ name: string; path: string; method: string; body?: unknown; query?: Record<string, string> }> = [
  { name: 'extension/bootstrap', path: 'extension/bootstrap', method: 'POST', body: { organization_id: CO_A } },
  { name: 'extension/session', path: 'extension/session', method: 'GET', query: { organization_id: CO_A } },
  { name: 'rpa/auth/start', path: 'rpa/auth/start', method: 'POST', body: { organization_id: CO_A, platform: 'linkedin' } },
];

const noEnvNames = (body: unknown) => {
  const s = JSON.stringify(body ?? '');
  for (const k of SECRET_ENVS) expect(s).not.toContain(k);
  expect(s).not.toMatch(/SECRET_UNAVAILABLE:|\(set /);
};

describe('SEC91-W2B-5 signing secret missing → 503 with a plain code, no env names', () => {
  it.each(CASES)('$name', async (c) => {
    const r = await invoke(route(c.path), { method: c.method, as: 'A', body: c.body, query: c.query });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: 'SIGNING_SECRET_UNAVAILABLE' });
    noEnvNames(r.body);
  });

  it('extension/redeem: a claim minted before the secret went away → 503, no env names', async () => {
    process.env.AUTH_SECRET = 'sec91-w2b-5-test-auth-secret';
    const claim = createClaimCode('user-x', CO_A);
    delete process.env.AUTH_SECRET;
    const r = await invoke(route('extension/redeem'), { method: 'POST', body: { claim_code: claim.code } });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ success: false, error: 'SIGNING_SECRET_UNAVAILABLE' });
    noEnvNames(r.body);
  });
});

describe('COMPAT: with AUTH_SECRET configured (production) the routes issue tokens as before', () => {
  beforeEach(() => { process.env.AUTH_SECRET = 'sec91-w2b-5-test-auth-secret'; });

  it('extension/bootstrap → 200 with a claim code', async () => {
    const r = await invoke(route('extension/bootstrap'), { method: 'POST', as: 'A', body: { organization_id: CO_A } });
    expect(r.status).toBe(200);
    expect(r.body.data.claim_code).toMatch(/^cc_/);
  });

  it('extension/redeem → 200 with a session token', async () => {
    const claim = createClaimCode('user-x', CO_A);
    const r = await invoke(route('extension/redeem'), { method: 'POST', body: { claim_code: claim.code } });
    expect(r.status).toBe(200);
    expect(typeof r.body.data.session_token).toBe('string');
  });

  it('extension/session → 200 with a session token', async () => {
    const r = await invoke(route('extension/session'), { method: 'GET', as: 'A', query: { organization_id: CO_A } });
    expect(r.status).toBe(200);
    expect(typeof r.body.data.sessionToken).toBe('string');
  });

  it('rpa/auth/start → 200 with a session token', async () => {
    const r = await invoke(route('rpa/auth/start'), { method: 'POST', as: 'A', body: { organization_id: CO_A, platform: 'linkedin' } });
    expect(r.status).toBe(200);
    expect(typeof r.body.session_token).toBe('string');
  });

  it('authorization is unchanged: anonymous extension/session → 401, no token', async () => {
    const r = await invoke(route('extension/session'), { method: 'GET', query: { organization_id: CO_A } });
    expect(r.status).toBe(401);
  });
});
