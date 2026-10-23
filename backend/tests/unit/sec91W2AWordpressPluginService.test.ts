/**
 * SEC-91 W2-A (STEP 3AH-91, wave 2) — W2A-2 WordPress plugin service binding.
 *
 * SEC-A closed the two route-level exploits (revoke IDOR, anonymous heartbeat)
 * but left the service able to repeat them for any future caller:
 *
 *   - revokeWordPressPlugin() updated by registration id ALONE;
 *   - recordWordPressPluginHeartbeat() accepted a bare registrationId and then
 *     never checked a token (and a token + a DIFFERENT registrationId updated
 *     the other registration);
 *   - exchangeWordPressPluginToken() never cleared auth_nonce_hash, so the
 *     "single-use" registration nonce could mint fresh plugin tokens forever
 *     (each replay silently rotated the live plugin's token), and two
 *     concurrent exchanges both succeeded;
 *   - verifyWordPressPlugin() could flip a REVOKED registration back to
 *     'verified' with the (never cleared) nonce.
 *
 * Now: revoke is bound to the authorized company (and website when known);
 * heartbeat is token-bound and scoped to the token's company/website and to a
 * non-revoked row; the nonce is consumed atomically by the token exchange
 * (conditional UPDATE … WHERE auth_nonce_hash = <hash>) and cleared on revoke.
 *
 * The real service runs against the ROUTE-AUTH-001 harness database.
 */
import crypto from 'crypto';
import { upsertAppendsBlindly, seed, invoke, rows, writeCalls, completedWrites, CO_A, CO_B } from '../helpers/routeAuthHarness';
import {
  exchangeWordPressPluginToken,
  recordWordPressPluginHeartbeat,
  registerWordPressPlugin,
  revokeWordPressPlugin,
  verifyWordPressPlugin,
  authenticateWordPressPluginToken,
} from '../../services/wordpressPluginService';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/auditEventService', () => ({ recordAuditEvent: jest.fn(async () => undefined) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const tokenExchangeRoute = require('../../../pages/api/wordpress-plugin/token-exchange').default;
const revokeRoute = require('../../../pages/api/wordpress-plugin/revoke').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const REG_A = 'reg-a-000-0000-0000-00000000000a';
const REG_B = 'reg-b-000-0000-0000-00000000000b';
const REG_PENDING = 'reg-p-000-0000-0000-00000000000p';
const TOKEN_A = 'ovwp_plugin-token-for-company-a';
const TOKEN_B = 'ovwp_plugin-token-for-company-b';
const NONCE = 'nonce-issued-at-registration-0001';
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

function world() {
  seed({
    wordpress_plugin_registrations: [
      { id: REG_A, company_id: CO_A, website_id: 'web-a', status: 'connected', access_token_hash: sha(TOKEN_A), auth_nonce_hash: null, revoked_at: null, metadata: { site: 'a' } },
      { id: REG_B, company_id: CO_B, website_id: 'web-b', status: 'connected', access_token_hash: sha(TOKEN_B), auth_nonce_hash: null, revoked_at: null, metadata: { site: 'b' } },
      { id: REG_PENDING, company_id: CO_A, website_id: 'web-p', status: 'pending', access_token_hash: null, auth_nonce_hash: sha(NONCE), revoked_at: null, metadata: {} },
    ],
  });
  // UPSERT MODEL, declared explicitly rather than inherited: this suite
  // not conflict resolution. The append model performs no arbiter
  // resolution, so nothing here may be read as evidence about row
  // identity, uniqueness or tenancy through an upsert.
  //
  // THE REASON IS NARROWER THAN AN EARLIER VERSION'S, which said this suite
  // asserts "that the registration write happens once per nonce" — a
  // UNIQUENESS claim, which is exactly what the append model does not model.
  // The once-per-nonce property is in fact proven through the conditional
  // `.update()` statements, whose filters carry the nonce hash. The upsert is
  // exercised once, with a brand-new website_id, so its conflict leg is never
  // reached — and because the production target is (website_id,
  // plugin_site_id) rather than anything company-scoped, nothing here would
  // observe a cross-tenant merge through it either.
  upsertAppendsBlindly('wordpress_plugin_registrations', 'only that the registration statement is issued; the nonce property is proven through .update() filters');
}
beforeEach(world);

const reg = (id: string) => rows('wordpress_plugin_registrations').find((r) => r.id === id)!;
const regWrites = () => writeCalls(['wordpress_plugin_registrations']);
// THE GRANT-PATH ACCESSOR, deliberately separate. regWrites() stays on
// writeCalls() because every no-write assertion below depends on a REFUSED
// statement being COUNTED there. On a grant path that same property is the
// hazard: a refused or errored statement is indistinguishable from a real
// write to presence, payload and ordering assertions. So the two directions
// use different accessors on purpose.
const regCompleted = () => completedWrites(['wordpress_plugin_registrations']);

describe('revokeWordPressPlugin — bound to the authorized company', () => {
  it('company A + B\'s registration id → refused, B untouched', async () => {
    await expect(
      revokeWordPressPlugin({ registrationId: REG_B, companyId: CO_A, reason: 'x', actorUserId: 'u' }),
    ).rejects.toThrow(/not found/i);
    expect(reg(REG_B).status).toBe('connected');
    expect(reg(REG_B).access_token_hash).toBe(sha(TOKEN_B));
  });

  it('the update statement itself carries the company predicate', async () => {
    await revokeWordPressPlugin({ registrationId: REG_A, companyId: CO_A });
    const update = regCompleted().find((c) => c.op === 'update')!;
    expect(update.filters).toMatchObject({ id: REG_A, company_id: CO_A });
  });

  it('a website binding, when supplied, must match too', async () => {
    await expect(
      revokeWordPressPlugin({ registrationId: REG_A, companyId: CO_A, websiteId: 'web-other' }),
    ).rejects.toThrow(/not found/i);
    expect(reg(REG_A).status).toBe('connected');
  });

  it('own registration → revoked; token AND pending nonce cleared', async () => {
    await revokeWordPressPlugin({ registrationId: REG_PENDING, companyId: CO_A, reason: 'abandoned setup' });
    expect(reg(REG_PENDING).status).toBe('revoked');
    expect(reg(REG_PENDING).access_token_hash).toBeNull();
    expect(reg(REG_PENDING).auth_nonce_hash).toBeNull();
    expect(reg(REG_PENDING).revoked_at).toBeTruthy();
  });

  it('a missing companyId is refused before any write', async () => {
    await expect(
      revokeWordPressPlugin({ registrationId: REG_A, companyId: '' }),
    ).rejects.toThrow(/companyId/i);
    expect(regWrites()).toEqual([]);
  });
});

describe('recordWordPressPluginHeartbeat — token-bound', () => {
  it('a bare registration id (no token) → refused, nothing written', async () => {
    await expect(
      recordWordPressPluginHeartbeat({ registrationId: REG_B, accessToken: '', healthStatus: 'healthy' }),
    ).rejects.toThrow(/token/i);
    expect(regWrites()).toEqual([]);
    expect(reg(REG_B).metadata).toEqual({ site: 'b' });
  });

  it('A\'s token + B\'s registration id → refused, B untouched', async () => {
    await expect(
      recordWordPressPluginHeartbeat({ registrationId: REG_B, accessToken: TOKEN_A, metadata: { pwned: true } }),
    ).rejects.toThrow(/does not match/i);
    expect(reg(REG_B).metadata).toEqual({ site: 'b' });
    expect(regWrites()).toEqual([]);
  });

  it('valid token → own row updated, scoped to its company/website and to a non-revoked row', async () => {
    await recordWordPressPluginHeartbeat({ accessToken: TOKEN_A, metadata: { message: 'ok' }, healthStatus: 'healthy' });
    expect(reg(REG_A).metadata).toEqual({ message: 'ok' });
    expect(reg(REG_B).metadata).toEqual({ site: 'b' });
    const update = regCompleted().find((c) => c.op === 'update')!;
    expect(update.filters).toMatchObject({ id: REG_A, company_id: CO_A, website_id: 'web-a', revoked_at: null });
  });

  it('a revoked token → refused', async () => {
    await revokeWordPressPlugin({ registrationId: REG_A, companyId: CO_A });
    await expect(recordWordPressPluginHeartbeat({ accessToken: TOKEN_A })).rejects.toThrow(/token/i);
    expect(reg(REG_A).status).toBe('revoked');
  });
});

describe('registration nonce — single use', () => {
  it('first exchange mints a token and CONSUMES the nonce', async () => {
    const out = await exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE });
    expect(out.accessToken).toMatch(/^ovwp_/);
    expect(reg(REG_PENDING).auth_nonce_hash).toBeNull();
    expect(reg(REG_PENDING).status).toBe('connected');
    expect(await authenticateWordPressPluginToken(out.accessToken)).toMatchObject({ registrationId: REG_PENDING });
  });

  it('THE REPLAY: the same nonce cannot mint a second token (live token untouched)', async () => {
    const first = await exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE });
    const liveHash = reg(REG_PENDING).access_token_hash;
    await expect(exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE })).rejects.toThrow(/nonce/i);
    expect(reg(REG_PENDING).access_token_hash).toBe(liveHash);
    expect(await authenticateWordPressPluginToken(first.accessToken)).not.toBeNull();
  });

  it('two concurrent exchanges with one nonce → exactly one token', async () => {
    const results = await Promise.allSettled([
      exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE }),
      exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled') as Array<PromiseFulfilledResult<{ accessToken: string }>>;
    expect(ok).toHaveLength(1);
    expect(reg(REG_PENDING).access_token_hash).toBe(sha(ok[0].value.accessToken));
  });

  it('the consuming update is conditional on the nonce hash (atomic compare-and-clear)', async () => {
    await exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE });
    const update = regCompleted().find((c) => c.op === 'update')!;
    expect(update.filters).toMatchObject({ id: REG_PENDING, auth_nonce_hash: sha(NONCE), revoked_at: null });
    expect((update.payload as Record<string, unknown>).auth_nonce_hash).toBeNull();
  });

  it('a wrong nonce → refused, nothing written', async () => {
    await expect(exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: 'guess' })).rejects.toThrow(/nonce/i);
    expect(regWrites()).toEqual([]);
  });

  it('verify cannot reuse a consumed nonce, and cannot resurrect a revoked registration', async () => {
    expect(await verifyWordPressPlugin({ registrationId: REG_PENDING, nonce: NONCE })).toBe(true); // before exchange: unchanged
    await exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE });
    expect(await verifyWordPressPlugin({ registrationId: REG_PENDING, nonce: NONCE })).toBe(false);
    expect(reg(REG_PENDING).status).toBe('connected');

    world();
    await revokeWordPressPlugin({ registrationId: REG_PENDING, companyId: CO_A });
    expect(await verifyWordPressPlugin({ registrationId: REG_PENDING, nonce: NONCE })).toBe(false);
    expect(reg(REG_PENDING).status).toBe('revoked');
  });

  it('a registration revoked AFTER a nonce was issued never exchanges (even with a stale nonce hash)', async () => {
    reg(REG_PENDING).revoked_at = '2026-01-01';
    reg(REG_PENDING).status = 'revoked';
    await expect(exchangeWordPressPluginToken({ registrationId: REG_PENDING, nonce: NONCE })).rejects.toThrow();
    expect(reg(REG_PENDING).access_token_hash).toBeNull();
  });

  it('setup flow (register → immediate exchange with the fresh nonce) still connects', async () => {
    const created = await registerWordPressPlugin({ companyId: CO_A, websiteId: 'web-new', siteUrl: 'https://new.example', pluginSiteId: 'site-new' });
    const out = await exchangeWordPressPluginToken({ registrationId: created.id, nonce: created.nonce });
    expect(out.registrationId).toBe(created.id);
    expect(reg(created.id).auth_nonce_hash).toBeNull();
  });
});

describe('routes on top of the service', () => {
  it('POST /api/wordpress-plugin/token-exchange replay → 400 the second time', async () => {
    const first = await invoke(tokenExchangeRoute, { method: 'POST', body: { registration_id: REG_PENDING, nonce: NONCE } });
    expect(first.status).toBe(200);
    const again = await invoke(tokenExchangeRoute, { method: 'POST', body: { registration_id: REG_PENDING, nonce: NONCE } });
    expect(again.status).toBe(400);
    expect(reg(REG_PENDING).access_token_hash).toBe(sha(first.body.accessToken));
  });

  it('plugin self-disconnect still revokes exactly its own registration', async () => {
    const r = await invoke(revokeRoute, { method: 'POST', body: { registration_id: REG_A }, headers: { authorization: `Bearer ${TOKEN_A}` } });
    expect(r.status).toBe(200);
    expect(reg(REG_A).status).toBe('revoked');
    const update = regCompleted().find((c) => c.op === 'update')!;
    expect(update.filters).toMatchObject({ id: REG_A, company_id: CO_A, website_id: 'web-a' });
  });
});

// ── OD-6 (Phase 82) ── mechanical adoption of the harness-configuration detector.
//
// A refusal means the harness declined to MODEL a statement, so nothing ran.
// On a DENY path writeCalls() counts it, so the canonical zero-write assertion
// fails and the refusal surfaces. On a GRANT path it does not: a refused
// statement is indistinguishable from a real write to presence, payload and
// ordering assertions, and a route that catches the throw makes it silent.
//
// This is the established detector, already proven in three suites. Adopting it
// here fails the test instead of letting a swallowed refusal read as
// enforcement. It is additive: no existing hook, assertion or declaration is
// changed, and the helper is required lazily so no import statement is touched.
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../helpers/routeAuthHarness').assertNoHarnessConfigurationError();
});
