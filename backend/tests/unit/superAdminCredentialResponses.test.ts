/**
 * Super-admin credential read endpoints never serialise stored secret material.
 *
 * The three GET handlers below SELECT ciphertext / token columns to derive flags
 * (configured, has_client_secret, hasAccessToken) and, for platform-oauth-configs, a
 * 6-character client-id preview. This pins that the RESPONSE BODY holds none of: the
 * stored ciphertexts, the access/refresh tokens, the decrypted client secret, or the full
 * decrypted client id — and that the client secret is never decrypted at all.
 * All values are synthetic sentinels.
 */
const CT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:cc01';
const CT_SECRET = 'dddddddddddddddddddddddd:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee:ff02';
const CLIENT_ID_PLAIN = 'SENTINELCLIENTID-0123456789';
const CLIENT_SECRET_PLAIN = 'SENTINEL-CLIENT-SECRET';
const ACCESS = 'SENTINEL-ACCESS-TOKEN';
const REFRESH = 'SENTINEL-REFRESH-TOKEN';
const FORBIDDEN = [CT_ID, CT_SECRET, CLIENT_ID_PLAIN, CLIENT_SECRET_PLAIN, ACCESS, REFRESH, 'cc01', 'ff02'];
const API_KEY_PLAIN = 'SENTINEL-PROVIDER-API-KEY';

const mockTables: Record<string, Array<Record<string, unknown>>> = {
  platform_oauth_configs: [{
    platform: 'linkedin', enabled: true, updated_at: '2026-11-01T00:00:00Z', oauth_authorize_url: null,
    oauth_token_url: null, oauth_scopes: [], oauth_client_id_encrypted: CT_ID, oauth_client_secret_encrypted: CT_SECRET,
  }],
  social_accounts: [{
    id: 'sa-1', user_id: 'u-1', company_id: 'co-1', platform: 'linkedin', account_name: 'A', username: 'a',
    is_active: true, token_expires_at: '2030-01-01T00:00:00Z', access_token: ACCESS, refresh_token: REFRESH,
    refresh_status: null, last_refresh_attempt_at: null, last_refresh_error: null, connection_state: 'connected',
  }],
  user_company_roles: [{ user_id: 'u-1', company_id: 'co-1' }],
  companies: [{ id: 'co-1', name: 'Co' }],
  analytics_provider_config: [{
    provider: 'google_analytics', enabled: true, oauth_client_id_encrypted: CT_ID, oauth_client_secret_encrypted: CT_SECRET,
    scopes: [], redirect_uri: null, status: 'active', updated_at: '2026-11-01T00:00:00Z', metadata: null,
  }],
  api_provider_accounts: [{
    id: 'pa-1', api_source_id: 'src-1', account_name: 'Shared', priority: 1, is_active: true,
    credentials_encrypted: JSON.stringify({ api_key_value: CT_SECRET, oauth_client_id_ref: CT_ID, oauth_client_secret: API_KEY_PLAIN }),
  }],
};

jest.mock('../../db/supabaseClient', () => {
  const builder = (table: string) => {
    const rows = () => mockTables[table] ?? [];
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'is', 'order', 'limit', 'gte', 'lte', 'neq']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    b.single = async () => ({ data: rows()[0] ?? null, error: null });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(res, rej);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

const mockDecrypt = jest.fn((ct: string) => (ct === CT_ID ? CLIENT_ID_PLAIN : ct === CT_SECRET ? CLIENT_SECRET_PLAIN : ''));
jest.mock('../../auth/credentialEncryption', () => ({
  decryptCredential: (ct: string) => mockDecrypt(ct),
  encryptCredential: () => { throw new Error('not used by GET'); },
}));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async () => ({ ok: true, principal: { userId: 'u-admin' } }),
}));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../security/platformWriteAuthority', () => ({ enforcePlatformWriteAuthority: async () => true }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: null, error: 'NO_TOKEN' }) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => true }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import platformOauthConfigs from '../../../pages/api/super-admin/platform-oauth-configs';
import connectionHealth from '../../../pages/api/super-admin/connection-health';
import integrationHealth from '../../../pages/api/super-admin/integration-health';
import analyticsProviderConfig from '../../../pages/api/super-admin/analytics-provider-config';
import providerAccounts from '../../../pages/api/provider-accounts';

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

async function get(handler: Handler, query: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  let status = 0;
  let body: unknown;
  const res = {
    status(c: number) { status = c; return res; },
    json(b: unknown) { body = b; return res; },
    setHeader() { return res; },
    end() { return res; },
  };
  await handler({ method: 'GET', headers: {}, query, cookies: {}, url: '/x' }, res);
  return { status, body };
}

describe('super-admin credential GET responses hold no secret material', () => {
  beforeEach(() => mockDecrypt.mockClear());

  it.each([
    ['platform-oauth-configs', platformOauthConfigs as unknown as Handler],
    ['connection-health', connectionHealth as unknown as Handler],
    ['integration-health', integrationHealth as unknown as Handler],
  ])('%s', async (_name, handler) => {
    const r = await get(handler);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    for (const s of FORBIDDEN) expect(text).not.toContain(s);
    // The client secret is never decrypted by a read endpoint.
    expect(mockDecrypt).not.toHaveBeenCalledWith(CT_SECRET);
  });

  it('platform-oauth-configs still reports the flags and a 6-character preview', async () => {
    const r = await get(platformOauthConfigs as unknown as Handler);
    const li = (r.body as { platforms: Array<Record<string, unknown>> }).platforms.find((p) => p.platform_key === 'linkedin')!;
    expect(li.configured).toBe(true);
    expect(li.has_client_secret).toBe(true);
    expect(li.client_id_preview).toBe(`${CLIENT_ID_PLAIN.slice(0, 6)}…`);
  });
});

/**
 * SEC-FIX round 2 sweep of pages/api/** admin / super-admin reads: two more GET handlers
 * read encrypted columns and were not pinned — analytics-provider-config (decrypts both
 * GA OAuth values to report flags + a 6-character preview) and provider-accounts (lists
 * api_provider_accounts rows, whose credentials_encrypted JSON must be stripped).
 */
describe('super-admin credential GET responses hold no secret material (round-2 sweep)', () => {
  beforeEach(() => mockDecrypt.mockClear());

  it('analytics-provider-config returns flags and a 6-character preview only', async () => {
    const r = await get(analyticsProviderConfig as unknown as Handler);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    for (const s of FORBIDDEN) expect(text).not.toContain(s);
    const config = (r.body as { config: Record<string, unknown> }).config;
    expect(config.configured).toBe(true);
    expect(config.has_client_secret).toBe(true);
    expect(config.client_id_preview).toBe(`${CLIENT_ID_PLAIN.slice(0, 6)}...`);
  });

  it('provider-accounts list strips credentials_encrypted', async () => {
    const r = await get(providerAccounts as unknown as Handler, { api_source_id: 'src-1' });
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    for (const s of [...FORBIDDEN, API_KEY_PLAIN, 'credentials_encrypted']) expect(text).not.toContain(s);
    const accounts = (r.body as { accounts: Array<Record<string, unknown>> }).accounts;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].account_name).toBe('Shared');
    expect(mockDecrypt).not.toHaveBeenCalled();
  });
});
