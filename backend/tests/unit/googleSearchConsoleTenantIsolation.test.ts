/**
 * Google Analytics + Search Console: tenant and property isolation.
 *
 * Each company connects ITS OWN Google account (one platform OAuth client, per-company tokens).
 * These checks hold the boundaries that keep one tenant out of another's data:
 *   - every connect / list / select / disconnect route refuses a user who is not a member;
 *   - a property can be selected only if THIS company's integration listed it;
 *   - properties the current token can no longer read are pruned on re-sync;
 *   - the OAuth callback is bound to the user who started it (a super-admin cookie cannot
 *     complete another user's connect);
 *   - the platform's own "Omnivyra website company" cannot be claimed by a tenant that types
 *     omnivyra.com as its website.
 * NO NETWORK, no real tokens: an in-memory database and synthetic identifiers only.
 */
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
function mockTable(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
  let payload: any = null;
  let single = false;
  const run = async () => {
    const rows = (mockDb[table] ??= []);
    const match = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'update') { match.forEach((r) => Object.assign(r, payload)); return { data: single ? match[0] ?? null : match, error: null }; }
    if (op === 'delete') { mockDb[table] = rows.filter((r) => !match.includes(r)); return { data: null, error: null }; }
    if (op === 'upsert') {
      for (const p of (Array.isArray(payload) ? payload : [payload]) as Row[]) {
        const hit = rows.find((r) => r.integration_id === p.integration_id && r.property_id === p.property_id);
        if (hit) Object.assign(hit, p); else rows.push({ id: `${table}-${rows.length + 1}`, is_active: false, ...p });
      }
      return { data: null, error: null };
    }
    return { data: single ? match[0] ?? null : match, error: null };
  };
  const api: any = {
    select: () => api, order: () => api, limit: () => api,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return api; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return api; },
    not: (c: string, operator: string, list: string) => {
      const vals = list.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      filters.push((r) => !vals.includes(String(r[c])));
      return api;
    },
    update: (p: unknown) => { op = 'update'; payload = p; return api; },
    delete: () => { op = 'delete'; return api; },
    upsert: (p: unknown) => { op = 'upsert'; payload = p; return run(); },
    maybeSingle: () => { single = true; return run(); },
    single: () => { single = true; return run(); },
    then: (res: any, rej: any) => run().then(res, rej),
  };
  return api;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));

// Identity: the caller is whoever the x-user header names; membership comes from a fixed map.
const MEMBERS: Record<string, string[]> = { 'user-a': ['company-a'], 'user-b': ['company-b'] };
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async (req: { headers: Record<string, string> }) =>
    (req.headers['x-user'] ? { user: { id: req.headers['x-user'] }, error: null } : { user: null, error: 'NO_TOKEN' }),
}));
jest.mock('../../security/TenantGuard', () => ({
  assertTenantAccess: async ({ userId, organizationId }: { userId: string; organizationId: string }) =>
    (MEMBERS[userId]?.includes(organizationId) ? { ok: true } : { ok: false, reason: 'NOT_A_MEMBER' }),
}));

// Route effects are spies: a refused request must reach none of them.
const fx = {
  connectGoogleAnalytics: jest.fn(async () => ({ authorizationUrl: 'https://accounts.example.test/o' })),
  connectGoogleSearchConsole: jest.fn(async () => ({ authorizationUrl: 'https://accounts.example.test/o' })),
  listGoogleAnalyticsProperties: jest.fn(async () => []),
  listSearchConsoleProperties: jest.fn(async () => []),
  saveSelectedProperty: jest.fn(async () => ({})),
  saveSelectedSearchConsoleProperty: jest.fn(async () => ({})),
  disconnectGoogleAnalytics: jest.fn(async () => undefined),
  disconnectSearchConsole: jest.fn(async () => undefined),
};
jest.mock('../../services/analyticsIntegrationService', () => {
  const via = (k: string) => (...a: unknown[]) => (fx as any)[k](...a);
  return Object.fromEntries(Object.keys({
    connectGoogleAnalytics: 1, connectGoogleSearchConsole: 1, listGoogleAnalyticsProperties: 1, listSearchConsoleProperties: 1,
    saveSelectedProperty: 1, saveSelectedSearchConsoleProperty: 1, disconnectGoogleAnalytics: 1, disconnectSearchConsole: 1,
  }).map((k) => [k, via(k)]));
});

import connectRoute from '../../../pages/api/analytics/connect/google';
import propertiesRoute from '../../../pages/api/analytics/properties';
import selectRoute from '../../../pages/api/analytics/select-property';
import disconnectRoute from '../../../pages/api/analytics/disconnect';
import { isCallbackStateInvalid } from '../../auth/oauthState';
import { rankOmnivyraClaimants } from '../../services/omnivyraWebsiteCompanyService';
import { syncAnalyticsProperties } from '../../services/analyticsIntegrationServiceProviders';
import { saveSelectedProperty, saveSelectedSearchConsoleProperty } from '../../services/analyticsIntegrationServiceSync';

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; return res; };
  res.redirect = (u: string) => { res.statusCode = 302; res.body = u; return res; };
  res.end = () => res;
  return res;
}
const call = async (handler: any, method: string, user: string | null, input: Record<string, unknown>) => {
  const req = { method, headers: user ? { 'x-user': user } : {}, query: method === 'GET' ? input : {}, body: method === 'GET' ? {} : input, cookies: {}, socket: {}, url: '/api/analytics' };
  const res = fakeRes();
  await handler(req, res);
  return res;
};

beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  Object.values(fx).forEach((f) => f.mockClear());
});

describe('a user cannot act on another company’s Google connection', () => {
  const ATTEMPTS: Array<[string, any, string, Record<string, unknown>, Array<jest.Mock>]> = [
    ['start a connect', connectRoute, 'POST', { companyId: 'company-a', capability: 'google_search_console' }, [fx.connectGoogleSearchConsole, fx.connectGoogleAnalytics]],
    ['list properties', propertiesRoute, 'GET', { companyId: 'company-a', capability: 'google_search_console' }, [fx.listSearchConsoleProperties, fx.listGoogleAnalyticsProperties]],
    ['select a property', selectRoute, 'POST', { companyId: 'company-a', propertyId: 'sc-domain:a.example', capability: 'google_search_console' }, [fx.saveSelectedSearchConsoleProperty, fx.saveSelectedProperty]],
    ['disconnect', disconnectRoute, 'POST', { companyId: 'company-a', capability: 'google_search_console' }, [fx.disconnectSearchConsole, fx.disconnectGoogleAnalytics]],
  ];
  it.each(ATTEMPTS)('%s for company A as a member of company B → 403, nothing happens', async (_n, handler, method, input, effects) => {
    const res = await call(handler, method, 'user-b', input);
    expect(res.statusCode).toBe(403);
    for (const e of effects) expect(e).not.toHaveBeenCalled();
  });
  it.each(ATTEMPTS)('%s with no session → refused, nothing happens', async (_n, handler, method, input, effects) => {
    const res = await call(handler, method, null, input);
    expect([401, 403]).toContain(res.statusCode);
    for (const e of effects) expect(e).not.toHaveBeenCalled();
  });
  it('NON-VACUITY: a member of company A can select a property for company A', async () => {
    const res = await call(selectRoute, 'POST', 'user-a', { companyId: 'company-a', propertyId: 'sc-domain:a.example', capability: 'google_search_console' });
    expect(res.statusCode).toBe(200);
    expect(fx.saveSelectedSearchConsoleProperty).toHaveBeenCalledWith('company-a', 'sc-domain:a.example');
  });
});

describe('properties are scoped to the company’s own integration', () => {
  beforeEach(() => {
    mockDb.analytics_integrations = [
      { id: 'int-a-gsc', company_id: 'company-a', provider: 'GSC', status: 'connected' },
      { id: 'int-b-gsc', company_id: 'company-b', provider: 'GSC', status: 'connected' },
      { id: 'int-b-ga4', company_id: 'company-b', provider: 'GA4', status: 'connected' },
    ];
    mockDb.analytics_properties = [
      { id: 'p-a', integration_id: 'int-a-gsc', property_id: 'sc-domain:a.example', is_active: false },
      { id: 'p-b', integration_id: 'int-b-gsc', property_id: 'sc-domain:b.example', is_active: false },
      { id: 'p-b-ga', integration_id: 'int-b-ga4', property_id: 'properties/999', is_active: false },
    ];
  });

  it('company A cannot select company B’s Search Console site', async () => {
    await expect(saveSelectedSearchConsoleProperty('company-a', 'sc-domain:b.example')).rejects.toThrow(/does not belong/);
    expect(mockDb.analytics_properties.find((p) => p.id === 'p-b')!.is_active).toBe(false);
  });

  it('company A (no GA4 integration) cannot select company B’s GA4 property', async () => {
    await expect(saveSelectedProperty('company-a', 'properties/999')).rejects.toThrow();
    expect(mockDb.analytics_properties.find((p) => p.id === 'p-b-ga')!.is_active).toBe(false);
  });

  it('re-sync with the current token prunes properties it can no longer read, and only this integration’s', async () => {
    const kept = await syncAnalyticsProperties('int-a-gsc', [{ propertyId: 'sc-domain:new.example', propertyName: 'new', accountId: 'acct' } as any]);
    expect(kept.map((p) => p.property_id)).toEqual(['sc-domain:new.example']);
    expect(mockDb.analytics_properties.some((p) => p.property_id === 'sc-domain:a.example')).toBe(false);
    // Company B's rows are untouched.
    expect(mockDb.analytics_properties.filter((p) => p.integration_id === 'int-b-gsc').map((p) => p.property_id)).toEqual(['sc-domain:b.example']);
  });

  it('after pruning, the old property can no longer be selected', async () => {
    await syncAnalyticsProperties('int-a-gsc', [{ propertyId: 'sc-domain:new.example', propertyName: 'new', accountId: 'acct' } as any]);
    await expect(saveSelectedSearchConsoleProperty('company-a', 'sc-domain:a.example')).rejects.toThrow(/does not belong/);
  });
});

describe('the OAuth callback is bound to the user who started it', () => {
  it('rejects a state naming another user, even with a super-admin session', () => {
    expect(isCallbackStateInvalid({ stateValid: true, stateUserId: 'user-a', authUserId: 'user-b', hasSuperAdminSession: true })).toBe(true);
    expect(isCallbackStateInvalid({ stateValid: true, stateUserId: 'user-a', authUserId: null, hasSuperAdminSession: true })).toBe(true);
  });
  it('accepts the starting user, and a user-less state only on a super-admin session', () => {
    expect(isCallbackStateInvalid({ stateValid: true, stateUserId: 'user-a', authUserId: 'user-a', hasSuperAdminSession: false })).toBe(false);
    expect(isCallbackStateInvalid({ stateValid: true, stateUserId: null, authUserId: null, hasSuperAdminSession: true })).toBe(false);
    expect(isCallbackStateInvalid({ stateValid: true, stateUserId: null, authUserId: 'user-a', hasSuperAdminSession: false })).toBe(true);
  });
  it('rejects an invalid (unsigned, expired, tampered) state regardless of session', () => {
    expect(isCallbackStateInvalid({ stateValid: false, stateUserId: 'user-a', authUserId: 'user-a', hasSuperAdminSession: true })).toBe(true);
  });
});

describe('a tenant cannot claim the platform’s own Omnivyra company', () => {
  const original = { id: 'omni', name: 'Omnivyra Technologies', website: 'https://omnivyra.com', website_domain: 'omnivyra.com', status: 'active', created_at: '2025-01-01T00:00:00Z', company_profiles: [] };
  const spoof = { id: 'spoof', name: 'Omnivyra', website: 'https://www.omnivyra.com', website_domain: 'omnivyra.com', status: 'active', created_at: '2026-10-20T00:00:00Z', company_profiles: [] };

  it('a newer tenant copying the exact name and domain does not win', () => {
    expect(rankOmnivyraClaimants([spoof, original], new Set(), null)?.id).toBe('omni');
  });
  it('a company with an active SUPER_ADMIN member wins over any other claimant', () => {
    expect(rankOmnivyraClaimants([original, spoof], new Set(['omni']), null)?.id).toBe('omni');
    const olderSpoof = { ...spoof, created_at: '2024-01-01T00:00:00Z' };
    expect(rankOmnivyraClaimants([olderSpoof, original], new Set(['omni']), null)?.id).toBe('omni');
  });
  it('an explicit pin decides, and names no company that is not a claimant', () => {
    expect(rankOmnivyraClaimants([original, spoof], new Set(), 'omni')?.id).toBe('omni');
    expect(rankOmnivyraClaimants([original, spoof], new Set(), 'someone-else')).toBeNull();
  });
});
