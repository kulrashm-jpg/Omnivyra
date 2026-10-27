/**
 * F1 — the daily OAuth sweep classifies refresh failures by their typed outcome (never by message text):
 *      only a revoked grant marks that one connection PROVIDER_REAUTH_REQUIRED.
 * F2 — a successful OAuth callback (code exchanged AND tokens persisted) sets status + connection state
 *      together, clearing a stale PROVIDER_REAUTH_REQUIRED; a failed exchange or failed persistence never
 *      marks the connection connected.
 * In-memory rows behind a recording DB mock; no Google call, no network.
 */
process.env.OAUTH_STATE_HMAC_KEY = process.env.OAUTH_STATE_HMAC_KEY || 'e'.repeat(64);

// ── stateful in-memory tables behind the query-builder chain ─────────────────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const updates: Array<{ table: string; id: unknown; fields: Row }> = [];
function chain(table: string) {
  const filters: Array<[string, unknown]> = [];
  let op: 'select' | 'update' | 'insert' = 'select';
  let payload: Row = {};
  let single = false;
  const rows = () => (tables[table] ??= []).filter((r) => filters.every(([k, v]) => r[k] === v));
  const run = () => {
    if (op === 'update') {
      const hit = rows();
      hit.forEach((r) => Object.assign(r, payload));
      for (const r of hit) updates.push({ table, id: r.id, fields: payload });
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    if (op === 'insert') {
      const r = { id: `${table}-${(tables[table] ??= []).length + 1}`, ...payload };
      tables[table].push(r);
      return { data: single ? r : [r], error: null };
    }
    const hit = rows();
    return { data: single ? hit[0] ?? null : hit, error: null };
  };
  const proxy: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(run()).then(res, rej);
      return (...args: any[]) => {
        if (prop === 'update') { op = 'update'; payload = args[0]; }
        else if (prop === 'insert') { op = 'insert'; payload = args[0]; }
        else if (prop === 'eq') filters.push([args[0], args[1]]);
        else if (prop === 'neq') { /* sweep: status != disconnected — rows below are never disconnected */ }
        else if (prop === 'single' || prop === 'maybeSingle') single = true;
        return proxy;
      };
    },
  });
  return proxy;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => chain(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => chain(t) } }));

// ── sweep collaborators ──────────────────────────────────────────────────────
jest.mock('../../auth/tokenRefresh', () => ({ REFRESH_BUFFER_MS: 300_000, refreshAllExpiringSocialAccounts: async () => ({ companies: 0, checked: 0, refreshed: 0, skipped: 0, errors: 0 }) }));
jest.mock('../../services/integrations/healthProbeService', () => ({ runHealthProbeSweep: async () => ({ attempted: 0, ok: 0, failed: 0 }) }));
const refreshBehaviour: Record<string, () => Promise<string | null>> = {};
jest.mock('../../services/analyticsIntegrationService', () => {
  const sync = jest.requireActual('../../services/analyticsIntegrationServiceSync');
  return { TokenRefreshError: sync.TokenRefreshError, getValidAccessTokenForIntegration: (id: string) => refreshBehaviour[id]() };
});

// ── callback collaborators (Google calls replaced; row/state logic real) ─────
const google = { exchangeFails: false, saveFails: false };
jest.mock('../../services/analyticsIntegrationServiceProviders', () => {
  const actual = jest.requireActual('../../services/analyticsIntegrationServiceProviders');
  return {
    ...actual,
    exchangeAuthorizationCode: async () => { if (google.exchangeFails) throw new Error('Google token exchange failed (400): invalid_grant'); return { access_token: 'new-access', refresh_token: 'new-refresh', expiry_date: '2026-10-27T00:00:00Z', scope: 'x' }; },
    saveAnalyticsTokens: async () => { if (google.saveFails) throw new Error('Failed to update analytics token: db down'); },
    fetchGAAccountsAndProperties: async () => [],
    fetchSearchConsoleSites: async () => [],
    syncAnalyticsProperties: async () => [],
  };
});
jest.mock('../../services/analyticsPostConnectImport', () => ({ schedulePostConnectImport: async () => 'queued' }));

import { runOAuthLifecycleSweep } from '../../services/integrations/oauthLifecycleScheduler';
import { TokenRefreshError, classifyTokenRefreshFailure, handleOAuthCallback, handleSearchConsoleOAuthCallback } from '../../services/analyticsIntegrationServiceSync';
import { encodeOAuthState } from '../../auth/oauthState';
import { getTenantSourceAvailability, tenantProviderReliability } from '../../services/googleTenantSourceAvailability';

const reset = () => { for (const k of Object.keys(tables)) delete tables[k]; updates.length = 0; google.exchangeFails = false; google.saveFails = false; for (const k of Object.keys(refreshBehaviour)) delete refreshBehaviour[k]; };
beforeEach(reset);
const integ = (id: string, company: string, provider = 'GSC', o: Row = {}) => ({ id, company_id: company, provider, status: 'connected', connection_state: 'CONNECTED', ...o });
const stateOf = (id: string) => tables.analytics_integrations.find((r) => r.id === id)!;
const fail = (outcome: 'revoked' | 'transient' | 'client_misconfigured' | 'failed', msg: string) => async () => { throw new TokenRefreshError(outcome, outcome === 'transient' ? 503 : 400, msg); };

// ── F1 ───────────────────────────────────────────────────────────────────────
describe('F1 — sweep uses typed refresh outcomes, never message text', () => {
  it('unauthorized_client is a platform client problem (not a revoked grant)', () => {
    expect(classifyTokenRefreshFailure(400, 'unauthorized_client')).toBe('client_misconfigured');
    expect(classifyTokenRefreshFailure(401, 'invalid_client')).toBe('client_misconfigured');
    expect(classifyTokenRefreshFailure(400, 'invalid_grant')).toBe('revoked');
  });

  it('a revoked grant marks only that connection; the others are untouched', async () => {
    tables.analytics_integrations = [integ('int-a', 'tenant-a'), integ('int-b', 'tenant-b'), integ('int-c', 'tenant-c', 'GA4')];
    refreshBehaviour['int-a'] = fail('revoked', 'Search Console token refresh failed (400, invalid_grant): Token has been expired or revoked.');
    refreshBehaviour['int-b'] = async () => 'still-valid';
    refreshBehaviour['int-c'] = async () => 'still-valid';
    const summary = await runOAuthLifecycleSweep();
    expect(stateOf('int-a').connection_state).toBe('PROVIDER_REAUTH_REQUIRED');
    expect(stateOf('int-b').connection_state).toBe('CONNECTED');
    expect(stateOf('int-c').connection_state).toBe('CONNECTED');
    expect(summary.ga4).toMatchObject({ integrationsChecked: 3, refreshed: 2, reauthRequired: 1, platformConfigErrors: 0, transientErrors: 0 });
  });

  it('unauthorized_client (message contains "unauthorized") leaves every tenant unchanged and is reported once as a platform problem', async () => {
    tables.analytics_integrations = [integ('int-a', 'tenant-a'), integ('int-b', 'tenant-b', 'GA4')];
    for (const id of ['int-a', 'int-b']) refreshBehaviour[id] = fail('client_misconfigured', 'Search Console token refresh failed (400, unauthorized_client): Unauthorized');
    const summary = await runOAuthLifecycleSweep();
    expect(updates.filter((u) => u.table === 'analytics_integrations')).toEqual([]);
    expect(stateOf('int-a').connection_state).toBe('CONNECTED');
    expect(stateOf('int-b').connection_state).toBe('CONNECTED');
    expect(summary.ga4).toMatchObject({ platformConfigErrors: 2, reauthRequired: 0 });
  });

  it.each([
    ['timeout', fail('transient', 'Google Analytics token refresh failed (no response): request timed out')],
    ['rate limit', fail('transient', 'Google Analytics token refresh failed (429): Rate Limit Exceeded')],
    ['Google 5xx', fail('transient', 'Google Analytics token refresh failed (503): backendError')],
    ['unclassified error (e.g. platform config not enabled)', async () => { throw new Error('Google Analytics is not enabled'); }],
  ])('%s does not invalidate the connection', async (_label, behaviour) => {
    tables.analytics_integrations = [integ('int-a', 'tenant-a', 'GA4')];
    refreshBehaviour['int-a'] = behaviour as () => Promise<string | null>;
    const summary = await runOAuthLifecycleSweep();
    expect(stateOf('int-a')).toMatchObject({ status: 'connected', connection_state: 'CONNECTED' });
    expect(updates.filter((u) => u.table === 'analytics_integrations')).toEqual([]);
    expect(summary.ga4.transientErrors).toBe(1);
  });

  it('one company’s failure never changes another’s connection (mixed outcomes in one sweep)', async () => {
    tables.analytics_integrations = [integ('int-a', 'tenant-a'), integ('int-b', 'tenant-b'), integ('int-c', 'tenant-c'), integ('int-d', 'tenant-d')];
    refreshBehaviour['int-a'] = fail('revoked', 'x (400, invalid_grant): revoked');
    refreshBehaviour['int-b'] = fail('transient', 'x (503): down');
    refreshBehaviour['int-c'] = fail('client_misconfigured', 'x (400, unauthorized_client): Unauthorized');
    refreshBehaviour['int-d'] = async () => 'ok';
    await runOAuthLifecycleSweep();
    expect(['int-a', 'int-b', 'int-c', 'int-d'].map((id) => stateOf(id).connection_state)).toEqual(['PROVIDER_REAUTH_REQUIRED', 'CONNECTED', 'CONNECTED', 'CONNECTED']);
    expect(updates.filter((u) => u.table === 'analytics_integrations' && u.fields.connection_state === 'PROVIDER_REAUTH_REQUIRED').map((u) => u.id)).toEqual(['int-a']);
  });
});

// ── F2 ───────────────────────────────────────────────────────────────────────
describe.each([
  ['Search Console', 'GSC', 'gsc' as const, handleSearchConsoleOAuthCallback],
  ['Google Analytics', 'GA4', 'ga4' as const, handleOAuthCallback],
])('F2 — %s reconnect clears stale reauth state only after tokens are saved', (_label, provider, source, callback) => {
  const stateFor = (company: string) => encodeOAuthState({ companyId: company, userId: 'user-a', returnTo: null, flow: source === 'gsc' ? 'gsc' : 'ga4' } as any);
  const call = (company = 'tenant-a') => (callback as any)({ code: 'auth-code', state: stateFor(company), requestBaseUrl: 'https://www.omnivyra.com' });
  const seedRevoked = () => {
    tables.analytics_integrations = [
      integ('int-a', 'tenant-a', provider, { status: 'error', connection_state: 'PROVIDER_REAUTH_REQUIRED', last_provider_error: 'invalid_grant' }),
      integ('int-b', 'tenant-b', provider, { status: 'error', connection_state: 'PROVIDER_REAUTH_REQUIRED' }),
    ];
    tables.analytics_properties = [{ id: 'p-a', integration_id: 'int-a', is_active: true }];
    tables.ingestion_runs = [{ company_id: 'tenant-a', source, status: 'completed', completed_at: new Date(Date.now() - 3_600_000).toISOString() }];
  };

  it('successful reconnect: status and connection state set together, in one update', async () => {
    seedRevoked();
    await call();
    expect(stateOf('int-a')).toMatchObject({ status: 'connected', connection_state: 'CONNECTED', last_provider_error: null });
    const write = updates.filter((u) => u.table === 'analytics_integrations' && u.id === 'int-a');
    expect(write).toHaveLength(1);
    expect(write[0].fields).toMatchObject({ status: 'connected', connection_state: 'CONNECTED' });
  });

  it('only the reconnecting company changes', async () => {
    seedRevoked();
    await call();
    expect(stateOf('int-b')).toMatchObject({ status: 'error', connection_state: 'PROVIDER_REAUTH_REQUIRED' });
  });

  it('availability and confidence reflect the reconnect immediately (no wait for the daily sweep)', async () => {
    seedRevoked();
    expect((await getTenantSourceAvailability('tenant-a', source)).state).toBe('reauth_required');
    expect(await tenantProviderReliability('tenant-a', source)).toBeNull();
    await call();
    expect((await getTenantSourceAvailability('tenant-a', source)).state).toBe('connected');
    expect(typeof (await tenantProviderReliability('tenant-a', source))).toBe('number');
  });

  it('a failed code exchange marks nothing connected', async () => {
    seedRevoked();
    google.exchangeFails = true;
    await expect(call()).rejects.toThrow(/exchange failed/);
    expect(stateOf('int-a')).toMatchObject({ status: 'error', connection_state: 'PROVIDER_REAUTH_REQUIRED' });
    expect(updates).toEqual([]);
  });

  it('a failed token save marks nothing connected', async () => {
    seedRevoked();
    google.saveFails = true;
    await expect(call()).rejects.toThrow(/Failed to update analytics token/);
    expect(stateOf('int-a')).toMatchObject({ status: 'error', connection_state: 'PROVIDER_REAUTH_REQUIRED' });
    expect(updates).toEqual([]);
  });

  it('a first connection creates the row as disconnected, then marks it connected after the tokens are saved', async () => {
    await call('tenant-new');
    const row = tables.analytics_integrations.find((r) => r.company_id === 'tenant-new')!;
    expect(row).toMatchObject({ provider, status: 'connected', connection_state: 'CONNECTED' });
  });

  it('an invalid OAuth state writes nothing', async () => {
    seedRevoked();
    await expect((callback as any)({ code: 'c', state: 'forged', requestBaseUrl: 'https://www.omnivyra.com' })).rejects.toThrow(/Invalid OAuth state/);
    expect(updates).toEqual([]);
  });
});
