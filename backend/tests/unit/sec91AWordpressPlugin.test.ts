/**
 * SEC-91A (STEP 3AH-91) — WordPress plugin registration routes.
 *
 * A4 (revoke IDOR) — /api/wordpress-plugin/revoke authorized the caller as an
 * admin of body.company_id and then revoked body.registration_id by id alone
 * (wordpressPluginService.revokeWordPressPlugin has no company predicate): an
 * admin of company A could disconnect ANY tenant's plugin. The registration
 * must now belong to the authorized company (foreign/unknown → 404).
 *
 * A4 (plugin disconnect) — the plugin's disconnect() sends only its own bearer
 * token; revoke required a user session, so disconnect silently failed. A valid
 * plugin token may now revoke exactly its own registration.
 *
 * A1 (heartbeat) — recordWordPressPluginHeartbeat() accepts a bare
 * registrationId without any token, so the route let an anonymous caller
 * rewrite any registration's metadata/settings/status. A valid plugin token
 * bound to the registration is now required.
 *
 * The real service runs against the harness database; only audit events are stubbed.
 */
import crypto from 'crypto';
import { seed, invoke, rows, writeCalls, CO_A, CO_B } from '../helpers/routeAuthHarness';
import { bearer } from '../helpers/sec91AHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/sec91AHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/sec91AHarness').identityModule());
jest.mock('../../services/auditEventService', () => ({ recordAuditEvent: jest.fn(async () => undefined) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const revoke = require('../../../pages/api/wordpress-plugin/revoke').default;
const heartbeat = require('../../../pages/api/wordpress-plugin/heartbeat').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const REG_A = 'reg-a-000-0000-0000-00000000000a';
const REG_B = 'reg-b-000-0000-0000-00000000000b';
const REG_REVOKED = 'reg-r-000-0000-0000-00000000000r';
const TOKEN_A = 'ovwp_plugin-token-for-company-a';
const TOKEN_B = 'ovwp_plugin-token-for-company-b';
const TOKEN_REVOKED = 'ovwp_plugin-token-already-revoked';
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

function world() {
  seed({
    wordpress_plugin_registrations: [
      { id: REG_A, company_id: CO_A, website_id: 'web-a', status: 'connected', access_token_hash: sha(TOKEN_A), revoked_at: null, metadata: { site: 'a' } },
      { id: REG_B, company_id: CO_B, website_id: 'web-b', status: 'connected', access_token_hash: sha(TOKEN_B), revoked_at: null, metadata: { site: 'b' } },
      { id: REG_REVOKED, company_id: CO_A, website_id: 'web-r', status: 'revoked', access_token_hash: sha(TOKEN_REVOKED), revoked_at: '2026-01-01', metadata: {} },
    ],
  });
}
beforeEach(world);

const reg = (id: string) => rows('wordpress_plugin_registrations').find((r) => r.id === id)!;
const regWrites = () => writeCalls(['wordpress_plugin_registrations']);
const pluginAuth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('POST /api/wordpress-plugin/revoke — user (dashboard) path', () => {
  it('unauthenticated → 401, nothing revoked', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { company_id: CO_B, registration_id: REG_B } });
    expect(r.status).toBe(401);
    expect(regWrites()).toEqual([]);
  });

  it('THE EXPLOIT: admin of A names its own company + B\'s registration → 404, B untouched', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { company_id: CO_A, registration_id: REG_B }, headers: bearer('A') });
    expect(r.status).toBe(404);
    expect(regWrites()).toEqual([]);
    expect(reg(REG_B).status).toBe('connected');
    expect(reg(REG_B).access_token_hash).toBe(sha(TOKEN_B));
    expect(JSON.stringify(r.body)).not.toContain(CO_B);
  });

  it('admin of A naming company B → 403 (not a member), B untouched', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { company_id: CO_B, registration_id: REG_B }, headers: bearer('A') });
    expect(r.status).toBe(403);
    expect(regWrites()).toEqual([]);
  });

  it('unknown registration → 404', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { company_id: CO_A, registration_id: 'nope' }, headers: bearer('A') });
    expect(r.status).toBe(404);
    expect(regWrites()).toEqual([]);
  });

  it('admin of A revokes A\'s own registration → 200, only A revoked', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { company_id: CO_A, registration_id: REG_A, reason: 'rotating' }, headers: bearer('A') });
    expect(r.status).toBe(200);
    expect(reg(REG_A).status).toBe('revoked');
    expect(reg(REG_A).access_token_hash).toBeNull();
    expect(reg(REG_B).status).toBe('connected');
  });

  it('platform super admin (override) revokes B\'s registration under company B → 200', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { company_id: CO_B, registration_id: REG_B }, headers: bearer('SUPER') });
    expect(r.status).toBe(200);
    expect(reg(REG_B).status).toBe('revoked');
  });
});

describe('POST /api/wordpress-plugin/revoke — plugin self-disconnect (bearer ovwp_ token)', () => {
  it('the plugin\'s own disconnect call (token + its registration_id) revokes its registration → 200', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { registration_id: REG_A, reason: 'Disconnected from WordPress plugin' }, headers: pluginAuth(TOKEN_A) });
    expect(r.status).toBe(200);
    expect(reg(REG_A).status).toBe('revoked');
    expect(reg(REG_B).status).toBe('connected');
  });

  it('a plugin token cannot revoke a different registration → 403, nothing revoked', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { registration_id: REG_B }, headers: pluginAuth(TOKEN_A) });
    expect(r.status).toBe(403);
    expect(regWrites()).toEqual([]);
  });

  it('an invalid or already-revoked plugin token → 401, nothing revoked', async () => {
    const bad = await invoke(revoke, { method: 'POST', body: { registration_id: REG_A }, headers: pluginAuth('ovwp_forged') });
    expect(bad.status).toBe(401);
    const old = await invoke(revoke, { method: 'POST', body: { registration_id: REG_REVOKED }, headers: pluginAuth(TOKEN_REVOKED) });
    expect(old.status).toBe(401);
    expect(regWrites()).toEqual([]);
  });

  it('body company_id cannot redirect the plugin path to another tenant', async () => {
    const r = await invoke(revoke, { method: 'POST', body: { company_id: CO_B }, headers: pluginAuth(TOKEN_A) });
    expect(r.status).toBe(200);
    expect(reg(REG_A).status).toBe('revoked');
    expect(reg(REG_B).status).toBe('connected');
  });
});

describe('POST /api/wordpress-plugin/heartbeat', () => {
  const beat = { metadata: { message: 'overwritten' }, settings: { injected: true }, health_status: 'healthy' };

  it('THE EXPLOIT: anonymous caller with only a registration_id → 401, row untouched', async () => {
    const r = await invoke(heartbeat, { method: 'POST', body: { registration_id: REG_B, ...beat } });
    expect(r.status).toBe(401);
    expect(regWrites()).toEqual([]);
    expect(reg(REG_B).metadata).toEqual({ site: 'b' });
  });

  it('anonymous heartbeat against a REVOKED registration cannot flip it back to connected → 401', async () => {
    const r = await invoke(heartbeat, { method: 'POST', body: { registration_id: REG_REVOKED, ...beat } });
    expect(r.status).toBe(401);
    expect(reg(REG_REVOKED).status).toBe('revoked');
  });

  it('invalid token → 401', async () => {
    const r = await invoke(heartbeat, { method: 'POST', body: beat, headers: pluginAuth('ovwp_forged') });
    expect(r.status).toBe(401);
    expect(regWrites()).toEqual([]);
  });

  it('token of A naming B\'s registration → 403, B untouched', async () => {
    const r = await invoke(heartbeat, { method: 'POST', body: { registration_id: REG_B, ...beat }, headers: pluginAuth(TOKEN_A) });
    expect(r.status).toBe(403);
    expect(regWrites()).toEqual([]);
  });

  it('the plugin\'s real heartbeat (token, no registration_id) → 200, only its own row updated', async () => {
    const r = await invoke(heartbeat, { method: 'POST', body: beat, headers: pluginAuth(TOKEN_A) });
    expect(r.status).toBe(200);
    expect(reg(REG_A).metadata).toEqual({ message: 'overwritten' });
    expect(reg(REG_B).metadata).toEqual({ site: 'b' });
    expect(regWrites().every((c) => c.filters.id === REG_A)).toBe(true);
  });

  it('token supplied as body.access_token (legacy transport) still works', async () => {
    const r = await invoke(heartbeat, { method: 'POST', body: { access_token: TOKEN_B, ...beat } });
    expect(r.status).toBe(200);
    expect(reg(REG_B).metadata).toEqual({ message: 'overwritten' });
    expect(reg(REG_A).metadata).toEqual({ site: 'a' });
  });
});
