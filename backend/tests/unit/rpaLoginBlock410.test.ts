/**
 * Owner decision #17 (2026-11-10): RPA browser-automation logins are disabled.
 *
 * The three routes that issue an RPA auth token or persist a captured session answer
 * 410 RPA_DISABLED before anything else runs: no token is issued and nothing is saved,
 * whatever the method, body, caller or signing-secret configuration.
 * /api/rpa/auth/callback (read-only status) is unchanged.
 */
import { seed, invoke, CO_A } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const saveRpaSession = jest.fn();
const importSessionCapture = jest.fn();
jest.mock('../../services/rpaWorker/rpaSessionStore', () => ({
  ...jest.requireActual('../../services/rpaWorker/rpaSessionStore'),
  saveRpaSession: (...a: unknown[]) => saveRpaSession(...a),
}));
jest.mock('../../services/rpaWorker/rpaSessionImporter', () => ({
  ...jest.requireActual('../../services/rpaWorker/rpaSessionImporter'),
  importSessionCapture: (...a: unknown[]) => importSessionCapture(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = (p: string) => require(`../../../pages/api/${p}`).default;
const { issueRpaAuthToken } = require('../../services/rpaWorker/rpaAuthTokens');
const { RPA_LOGIN_DISABLED, RPA_DISABLED_BODY } = require('../../services/rpaWorker/rpaLoginBlock');
/* eslint-enable @typescript-eslint/no-var-requires */

const savedSecret = process.env.AUTH_SECRET;
beforeEach(() => {
  seed();
  saveRpaSession.mockReset();
  importSessionCapture.mockReset();
  process.env.AUTH_SECRET = 'rpa-login-block-test-auth-secret';
});
afterAll(() => { if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret; });

describe('#17 RPA login block', () => {
  it('the block is on and has no environment override', () => {
    expect(RPA_LOGIN_DISABLED).toBe(true);
    process.env.RPA_LOGIN_DISABLED = 'false';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      expect(require('../../services/rpaWorker/rpaLoginBlock').RPA_LOGIN_DISABLED).toBe(true);
    });
    delete process.env.RPA_LOGIN_DISABLED;
  });

  const validToken = () => issueRpaAuthToken({ organization_id: CO_A, platform: 'linkedin', user_id: 'user-a' }).token;

  const cases: Array<{ name: string; path: string; body: () => unknown }> = [
    { name: 'start', path: 'rpa/auth/start', body: () => ({ organization_id: CO_A, platform: 'linkedin' }) },
    { name: 'save-session', path: 'rpa/auth/save-session', body: () => ({ session_token: validToken(), storage_state: { cookies: [{ name: 'li_at', value: 'x', domain: '.linkedin.com', path: '/' }], origins: [] } }) },
    { name: 'complete', path: 'rpa/auth/complete', body: () => ({ session_token: validToken(), capture: { cookies: [{ name: 'li_at', value: 'x', domain: '.linkedin.com', path: '/' }] } }) },
  ];

  it.each(cases)('$name: an otherwise-valid authenticated POST → 410 RPA_DISABLED, nothing issued or saved', async (c) => {
    const r = await invoke(route(c.path), { method: 'POST', as: 'A', body: c.body() });
    expect(r.status).toBe(410);
    expect(r.body).toEqual(RPA_DISABLED_BODY);
    expect(JSON.stringify(r.body)).not.toMatch(/session_token|token/i);
    expect(saveRpaSession).not.toHaveBeenCalled();
    expect(importSessionCapture).not.toHaveBeenCalled();
  });

  it.each(cases)('$name: the block precedes the method check (GET → 410, not 405)', async (c) => {
    const r = await invoke(route(c.path), { method: 'GET', as: 'A' });
    expect(r.status).toBe(410);
  });

  it.each(cases)('$name: anonymous caller → 410 too (no information about auth state)', async (c) => {
    const r = await invoke(route(c.path), { method: 'POST', body: c.body() });
    expect(r.status).toBe(410);
    expect(saveRpaSession).not.toHaveBeenCalled();
  });
});
