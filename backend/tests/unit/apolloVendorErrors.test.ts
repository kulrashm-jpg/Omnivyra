/**
 * Apollo vendor errors and the Apollo ceiling exemption (owner decision 2026-10-23).
 *
 *   "Apollo is based on their subscription, hence we need not control it, but
 *    we need to show the exact error — be it no credits, low credits, no
 *    subscription, daily limit if any, etc."
 *
 * Fixtures follow the bodies and headers Apollo documents:
 *   https://docs.apollo.io/reference/status-codes
 *   https://docs.apollo.io/reference/rate-limits
 *   https://docs.apollo.io/reference/people-api-search
 *   https://docs.apollo.io/reference/organization-enrichment
 *
 * NO APOLLO CALL IS MADE. `safeFetch` is mocked, and no database is touched.
 */

const safeFetchMock = jest.fn();
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import {
  APOLLO_ERROR_CODES,
  APOLLO_ERROR_HTTP_STATUS,
  classifyApolloHttpError,
  classifyApolloTransportError,
  parseApolloUsageHeaders,
  providerErrorResponse,
  redactVendorText,
  isProviderErrorView,
} from '../../services/providerErrors/apolloErrors';
import {
  apolloDiscoveryAdapter,
  ApolloDiscoveryError,
} from '../../services/prospectDiscovery/adapters/apolloDiscovery';
import { runDiscoveryExecution } from '../../services/prospectDiscovery/discoveryExecutor';
import { apolloEnrichmentAdapter } from '../../services/enrichment/providers/adapters/apollo';
import { makeDailyCallCeilingAllow } from '../../services/enrichment/providers/spendCeiling';
import {
  makeTenantFundedExecutionPort,
  tenantFundedExecutionPort,
} from '../../services/enrichment/providers/cost';
import {
  PROVIDER_BILLING_POLICY,
  isBillingGovernedByVendorSubscription,
  providerBillingPolicy,
} from '../../services/enrichment/providers/billingPolicy';
import { executeEnrichment, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentProviderAdapter, EnrichmentRequest } from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const KEY = 'synthetic-tenant-apollo-key-9f3a';
const SEARCH = 'api/v1/mixed_people/api_search';

const headerBag = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
const resp = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: headerBag(headers),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

// ── Documented fixtures ─────────────────────────────────────────────────────
const BODY_401_TEXT = 'Invalid API key. See https://docs.apollo.io/reference/authentication for how to authenticate.';
const BODY_401_JSON = {
  error: 'Invalid access credentials.',
  error_details: {
    code: 'AUTH.AUTHENTICATION.CREDENTIALS_MISSING',
    message: 'This request carried no credential Apollo could authenticate.',
    suggestions: [{ label: 'Send your API key in the X-Api-Key header', header: 'X-Api-Key' }],
    context: {},
  },
};
const BODY_403 = {
  error: 'This API key is not authorized to access api/v1/mixed_people/api_search.',
  error_code: 'API_INACCESSIBLE',
  error_details: {
    code: 'AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED',
    message: 'Your team is not permitted to call this endpoint.',
    suggestions: [{ label: 'Contact support@apollo.io if you need access to this endpoint' }],
  },
};
const BODY_422 = { error: 'Invalid parameters' };
const BODY_429_HOUR = {
  message: 'The maximum number of api calls allowed for api/v1/mixed_people/api_search is 600 times per hour.',
  error_details: {
    code: 'USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED',
    message: 'You have made more API requests than your plan allows in this time window.',
    context: { window: { value: 'hour', description: 'the hourly window' } },
    suggestions: [{ label: 'Wait until the limit resets and retry' }],
  },
};
const BODY_429_PLATFORM = {
  error_details: {
    code: 'USAGE.RATE_LIMIT.PLATFORM_RATE_LIMIT',
    message: 'Apollo is under heavy load.',
    suggestions: [{ label: 'Retry later', retry_after_seconds: 60 }],
  },
};
const HOUR_EXHAUSTED_HEADERS = {
  'x-rate-limit-minute': '200', 'x-minute-usage': '12', 'x-minute-requests-left': '188',
  'x-rate-limit-hourly': '600', 'x-hourly-usage': '600', 'x-hourly-requests-left': '0',
  'x-rate-limit-24-hour': '2000', 'x-24-hour-usage': '900', 'x-24-hour-requests-left': '1100',
  'retry-after': '1200',
};

// ═══════════════════════════════════════════════════════════════════════════
describe('Apollo errors — one stable code per documented refusal', () => {
  it('401 plain text → APOLLO_AUTH_INVALID, message verbatim', () => {
    const v = classifyApolloHttpError({ status: 401, body: BODY_401_TEXT, endpoint: SEARCH });
    expect(v.code).toBe('APOLLO_AUTH_INVALID');
    expect(v.vendorStatus).toBe(401);
    expect(v.vendorMessage).toBe(BODY_401_TEXT);
    expect(v.basis).toBe('status');
  });

  it('401 JSON → APOLLO_AUTH_INVALID with error_details.code', () => {
    const v = classifyApolloHttpError({ status: 401, body: BODY_401_JSON, endpoint: SEARCH });
    expect(v.code).toBe('APOLLO_AUTH_INVALID');
    expect(v.vendorCode).toBe('AUTH.AUTHENTICATION.CREDENTIALS_MISSING');
    expect(v.vendorMessage).toBe('This request carried no credential Apollo could authenticate.');
  });

  it('403 API_INACCESSIBLE → APOLLO_ENDPOINT_NOT_IN_PLAN, plan OR scoped key named honestly', () => {
    const v = classifyApolloHttpError({ status: 403, body: BODY_403, endpoint: SEARCH });
    expect(v.code).toBe('APOLLO_ENDPOINT_NOT_IN_PLAN');
    expect(v.vendorCode).toBe('AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED');
    expect(v.vendorMessage).toBe('Your team is not permitted to call this endpoint.');
    expect(v.message).toMatch(/plan/);
    expect(v.message).toMatch(/scoped key/);
  });

  it('402 → APOLLO_CREDITS_EXHAUSTED by status', () => {
    const v = classifyApolloHttpError({ status: 402, body: { error: 'Payment required' }, endpoint: SEARCH });
    expect(v.code).toBe('APOLLO_CREDITS_EXHAUSTED');
    expect(v.basis).toBe('status');
  });

  it('a vendor code naming credits → APOLLO_CREDITS_EXHAUSTED, basis vendor_code', () => {
    const v = classifyApolloHttpError({
      status: 422, endpoint: SEARCH,
      body: { error_details: { code: 'USAGE.CREDITS.INSUFFICIENT_CREDITS', message: 'Not enough export credits.' } },
    });
    expect(v.code).toBe('APOLLO_CREDITS_EXHAUSTED');
    expect(v.basis).toBe('vendor_code');
    expect(v.vendorMessage).toBe('Not enough export credits.');
  });

  it('an undocumented 422 mentioning credits → APOLLO_CREDITS_EXHAUSTED, marked as an inference', () => {
    const v = classifyApolloHttpError({
      status: 422, endpoint: SEARCH, body: { error: 'You are out of credits for this billing cycle' },
    });
    expect(v.code).toBe('APOLLO_CREDITS_EXHAUSTED');
    expect(v.basis).toBe('vendor_message');
    expect(v.vendorMessage).toBe('You are out of credits for this billing cycle');
  });

  it('422 invalid parameters → APOLLO_REQUEST_REJECTED', () => {
    const v = classifyApolloHttpError({ status: 422, body: BODY_422, endpoint: SEARCH });
    expect(v.code).toBe('APOLLO_REQUEST_REJECTED');
    expect(v.vendorMessage).toBe('Invalid parameters');
  });

  it('429 hourly → APOLLO_RATE_LIMITED with window, limit, remaining and Retry-After', () => {
    const v = classifyApolloHttpError({
      status: 429, body: BODY_429_HOUR, headers: headerBag(HOUR_EXHAUSTED_HEADERS), endpoint: SEARCH,
    });
    expect(v.code).toBe('APOLLO_RATE_LIMITED');
    expect(v.vendorCode).toBe('USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED');
    expect(v.rateLimit).toEqual({ scope: 'plan', window: 'hour', limit: 600, remaining: 0, retryAfterSeconds: 1200 });
    expect(v.usage?.hour).toEqual({ limit: 600, used: 600, left: 0 });
    expect(v.message).toMatch(/hourly API limit of 600 requests/);
    expect(v.message).toMatch(/1200 seconds/);
  });

  it('429 with no body context → the longest exhausted window from the headers', () => {
    const v = classifyApolloHttpError({
      status: 429, body: {}, endpoint: SEARCH,
      headers: headerBag({ 'x-rate-limit-24-hour': '2000', 'x-24-hour-requests-left': '0',
        'x-rate-limit-minute': '200', 'x-minute-requests-left': '0' }),
    });
    expect(v.rateLimit?.window).toBe('day');
    expect(v.rateLimit?.limit).toBe(2000);
    expect(v.rateLimit?.retryAfterSeconds).toBeNull();      // never invented
  });

  it('429 platform → scope platform, retry from Apollo\'s own suggestion', () => {
    const v = classifyApolloHttpError({ status: 429, body: BODY_429_PLATFORM, endpoint: SEARCH });
    expect(v.rateLimit).toEqual({ scope: 'platform', window: null, limit: null, remaining: null, retryAfterSeconds: 60 });
    expect(v.message).toMatch(/across its platform/);
  });

  it('5xx → APOLLO_UNAVAILABLE; an unlisted status → APOLLO_UNKNOWN', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(classifyApolloHttpError({ status: s, body: '', endpoint: SEARCH }).code).toBe('APOLLO_UNAVAILABLE');
    }
    expect(classifyApolloHttpError({ status: 418, body: '', endpoint: SEARCH }).code).toBe('APOLLO_UNKNOWN');
    expect(classifyApolloHttpError({ status: 404, body: '', endpoint: SEARCH }).code).toBe('APOLLO_UNKNOWN');
  });

  it('a transport failure → APOLLO_UNAVAILABLE with no vendor status', () => {
    const v = classifyApolloTransportError({ error: new Error('getaddrinfo ENOTFOUND'), endpoint: SEARCH });
    expect(v).toMatchObject({ code: 'APOLLO_UNAVAILABLE', vendorStatus: null, basis: 'transport' });
  });

  it('the key is redacted from every vendor string', () => {
    const v = classifyApolloHttpError({
      status: 401, body: `key ${KEY} is not valid`, endpoint: SEARCH, apiKey: KEY,
    });
    expect(JSON.stringify(v)).not.toContain(KEY);
    expect(v.vendorMessage).toBe('key [redacted] is not valid');
    const t = classifyApolloTransportError({ error: new Error(`refused ${KEY}`), endpoint: SEARCH, apiKey: KEY });
    expect(JSON.stringify(t)).not.toContain(KEY);
    expect(redactVendorText('x'.repeat(900))?.length).toBeLessThanOrEqual(501);
  });
});

describe('Apollo usage — request-rate quota from headers, never credits', () => {
  it('reads all three windows and flags the low ones', () => {
    const u = parseApolloUsageHeaders(headerBag({
      'x-rate-limit-minute': '200', 'x-minute-usage': '195', 'x-minute-requests-left': '5',
      'x-rate-limit-hourly': '600', 'x-hourly-usage': '10', 'x-hourly-requests-left': '590',
      'x-rate-limit-24-hour': '2000', 'x-24-hour-usage': '1750', 'x-24-hour-requests-left': '250',
    }));
    expect(u?.minute).toEqual({ limit: 200, used: 195, left: 5 });
    expect(u?.day).toEqual({ limit: 2000, used: 1750, left: 250 });
    expect(u?.lowWindows).toEqual(['minute']);
  });

  it('no headers → null, and an empty limit header is not a zero', () => {
    expect(parseApolloUsageHeaders(headerBag({}))).toBeNull();
    expect(parseApolloUsageHeaders(undefined)).toBeNull();
    const u = parseApolloUsageHeaders(headerBag({ 'x-rate-limit-minute': '', 'x-rate-limit-hourly': '600' }));
    expect(u?.minute).toBeNull();
    expect(u?.hour).toEqual({ limit: 600, used: null, left: null });
  });

  it('the usage shape names no credit field', () => {
    const u = parseApolloUsageHeaders(headerBag(HOUR_EXHAUSTED_HEADERS));
    expect(JSON.stringify(u)).not.toMatch(/credit/i);
  });
});

describe('Apollo errors — the HTTP envelope', () => {
  it('maps every code to a status, never 401/403 (those mean the caller\'s own session)', () => {
    for (const c of APOLLO_ERROR_CODES) {
      expect(APOLLO_ERROR_HTTP_STATUS[c]).toBeGreaterThanOrEqual(400);
      expect([401, 403]).not.toContain(APOLLO_ERROR_HTTP_STATUS[c]);
    }
    expect(APOLLO_ERROR_HTTP_STATUS.APOLLO_CREDITS_EXHAUSTED).toBe(402);
    expect(APOLLO_ERROR_HTTP_STATUS.APOLLO_ENDPOINT_NOT_IN_PLAN).toBe(402);
    expect(APOLLO_ERROR_HTTP_STATUS.APOLLO_RATE_LIMITED).toBe(429);
    expect(APOLLO_ERROR_HTTP_STATUS.APOLLO_AUTH_INVALID).toBe(424);
  });

  it('sets Retry-After only when Apollo stated a horizon', () => {
    const limited = providerErrorResponse(classifyApolloHttpError({
      status: 429, body: BODY_429_HOUR, headers: headerBag(HOUR_EXHAUSTED_HEADERS), endpoint: SEARCH,
    }));
    expect(limited.status).toBe(429);
    expect(limited.headers['Retry-After']).toBe('1200');
    expect(limited.body.code).toBe('APOLLO_RATE_LIMITED');
    expect(limited.body.error).toBe(limited.body.providerError.message);

    const plan = providerErrorResponse(classifyApolloHttpError({ status: 403, body: BODY_403, endpoint: SEARCH }));
    expect(plan.status).toBe(402);
    expect(plan.headers).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Discovery adapter — carries the typed error and the usage', () => {
  beforeEach(() => safeFetchMock.mockReset());
  const discover = () => apolloDiscoveryAdapter.discover({
    organizationId: ORG, filters: { titles: ['CTO'] }, continuation: null, remaining: 5, credential: KEY,
  });

  it('a 429 throws ApolloDiscoveryError with the typed view; the message holds no key', async () => {
    safeFetchMock.mockResolvedValue(resp(429, BODY_429_HOUR, HOUR_EXHAUSTED_HEADERS));
    const e = await discover().catch((x) => x);
    expect(e).toBeInstanceOf(ApolloDiscoveryError);
    expect(e.failure).toBe('apollo_rate_limited');
    expect(e.providerError.code).toBe('APOLLO_RATE_LIMITED');
    expect(e.message).toMatch(/HTTP 429 APOLLO_RATE_LIMITED/);
    expect(e.message).not.toContain(KEY);
  });

  it('a 403 carries APOLLO_ENDPOINT_NOT_IN_PLAN', async () => {
    safeFetchMock.mockResolvedValue(resp(403, BODY_403));
    const e = await discover().catch((x) => x);
    expect(e.providerError.code).toBe('APOLLO_ENDPOINT_NOT_IN_PLAN');
  });

  it('a success returns Apollo\'s quota headers as providerUsage', async () => {
    safeFetchMock.mockResolvedValue(resp(200, { people: [], pagination: { page: 1, total_pages: 1 } }, {
      'x-rate-limit-hourly': '600', 'x-hourly-requests-left': '100',
    }));
    const page = await discover();
    expect((page.providerUsage as any).hour).toEqual({ limit: 600, used: null, left: 100 });
    expect((page.providerUsage as any).lowWindows).toEqual([]);
  });
});

describe('Discovery executor — passes the vendor error through to the run result', () => {
  beforeEach(() => safeFetchMock.mockReset());
  const row = {
    id: 'exec-1', organizationId: ORG, providerKey: 'apollo', completedAt: null,
    executionStatus: 'pending', providerCallState: 'not_called', correlationId: 'corr-1',
    searchCriteria: { titles: ['CTO'] }, continuationState: null,
    bounds: { maxPages: 1, maxResults: 5, maxProviderCalls: 1 },
    pagesFetched: 0, resultsObserved: 0, resultsIngested: 0, providerCallsMade: 0,
  };
  const ports = (complete: jest.Mock) => ({
    credential: { resolveCredential: async () => KEY },
    authorizeCost: async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } }),
    getProvider: () => apolloDiscoveryAdapter,
    getExecution: async () => row,
    markPending: async () => true,
    recordPage: async () => undefined,
    complete,
    ingest: async ({ records }: any) => ({ succeeded: records.length }),
    now: () => '2026-10-23T00:00:00.000Z',
  }) as any;

  it('a vendor 402 closes the run failed and returns the typed error', async () => {
    safeFetchMock.mockResolvedValue(resp(402, { error: 'Insufficient credits' }));
    const complete = jest.fn(async () => undefined);
    const run = await runDiscoveryExecution({ organizationId: ORG, executionId: 'exec-1', ports: ports(complete) });
    expect(run.status).toBe('failed');
    expect(isProviderErrorView(run.providerError)).toBe(true);
    expect(run.providerError?.code).toBe('APOLLO_CREDITS_EXHAUSTED');
    // The ledger detail leads with the stable code and never carries the key.
    const detail = (complete.mock.calls[0] as any[])[0].detail as string;
    expect(detail).toMatch(/APOLLO_CREDITS_EXHAUSTED/);
    expect(detail).not.toContain(KEY);
  });

  it('a successful run reports the usage of the last page', async () => {
    safeFetchMock.mockResolvedValue(resp(200, { people: [] }, { 'x-rate-limit-minute': '200', 'x-minute-requests-left': '3' }));
    const run = await runDiscoveryExecution({
      organizationId: ORG, executionId: 'exec-1', ports: ports(jest.fn(async () => undefined)),
    });
    expect(run.status).toBe('completed');
    expect(run.providerError).toBeNull();
    expect((run.providerUsage as any).lowWindows).toEqual(['minute']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Enrichment adapter — the same vocabulary', () => {
  beforeEach(() => safeFetchMock.mockReset());
  const request = (): EnrichmentRequest => ({
    organizationId: ORG, subject: 'account', entityId: ACCOUNT, attributes: ['employee_count'],
    selectors: { domain: 'example.com' }, purpose: 't', correlationId: 'c', credential: KEY,
  });

  it('402 → quota_exceeded (a CALLING outcome) with APOLLO_CREDITS_EXHAUSTED', async () => {
    safeFetchMock.mockResolvedValue(resp(402, { error: 'Insufficient credits' }));
    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('quota_exceeded');
    expect((out.providerError as any).code).toBe('APOLLO_CREDITS_EXHAUSTED');
  });

  it('403 → provider_unavailable outcome with APOLLO_ENDPOINT_NOT_IN_PLAN (never the non-calling provider_declined)', async () => {
    safeFetchMock.mockResolvedValue(resp(403, { ...BODY_403, error: 'This API key is not authorized to access api/v1/organizations/enrich.' }));
    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('provider_unavailable');
    expect((out.providerError as any).code).toBe('APOLLO_ENDPOINT_NOT_IN_PLAN');
    expect((out.providerError as any).endpoint).toBe('api/v1/organizations/enrich');
  });

  it('401 key text is redacted; 404 stays no_match with no provider error', async () => {
    safeFetchMock.mockResolvedValue(resp(401, `bad key ${KEY}`));
    const out = await apolloEnrichmentAdapter.enrich(request());
    expect((out.providerError as any).code).toBe('APOLLO_AUTH_INVALID');
    expect(JSON.stringify(out)).not.toContain(KEY);

    safeFetchMock.mockResolvedValue(resp(404, ''));
    const miss = await apolloEnrichmentAdapter.enrich(request());
    expect(miss.outcome).toBe('no_match');
    expect(miss.providerError).toBeUndefined();
  });

  it('a success carries Apollo\'s quota headers', async () => {
    safeFetchMock.mockResolvedValue(resp(200, { organization: { estimated_num_employees: 40 } },
      { 'x-rate-limit-24-hour': '1000', 'x-24-hour-requests-left': '50' }));
    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('enriched');
    expect((out.providerUsage as any).lowWindows).toEqual(['day']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Ceiling — Apollo is governed by its vendor subscription, every other provider is not', () => {
  it('the policy names Apollo and only Apollo; unknown providers keep the ceiling', () => {
    expect(PROVIDER_BILLING_POLICY).toEqual({ apollo: 'vendor_subscription' });
    expect(isBillingGovernedByVendorSubscription('apollo')).toBe(true);
    expect(isBillingGovernedByVendorSubscription(' Apollo ')).toBe(true);
    for (const p of ['clearbit', 'hunter', 'zoominfo', '', 'apollo2', 'constructor', '__proto__']) {
      expect(providerBillingPolicy(p)).toBe('platform_ceiling');
    }
  });

  it('Apollo: no ceiling read, no usage count, no refusal', async () => {
    const resolveCeiling = jest.fn(async () => null);
    const countCallsToday = jest.fn(async () => 999);
    const allow = makeDailyCallCeilingAllow({ resolveCeiling, countCallsToday });
    expect(await allow({ organizationId: ORG, providerId: 'apollo', attributes: [], correlationId: 'c' })).toBeNull();
    expect(resolveCeiling).not.toHaveBeenCalled();
    expect(countCallsToday).not.toHaveBeenCalled();
  });

  it('another provider with no ceiling is still refused (fail-closed, unchanged)', async () => {
    const allow = makeDailyCallCeilingAllow({ resolveCeiling: async () => null, countCallsToday: async () => 0 });
    expect(await allow({ organizationId: ORG, providerId: 'clearbit', attributes: [], correlationId: 'c' }))
      .toMatch(/no daily provider call ceiling is configured for 'clearbit'/);
  });

  it('another provider at its ceiling is still refused', async () => {
    const allow = makeDailyCallCeilingAllow({ resolveCeiling: async () => 2, countCallsToday: async () => 2 });
    expect(await allow({ organizationId: ORG, providerId: 'clearbit', attributes: [], correlationId: 'c' }))
      .toMatch(/ceiling reached/);
  });

  it('the PRODUCTION port authorises Apollo with no database I/O', async () => {
    // `tenantFundedExecutionPort` carries the real ceiling. With no Supabase in
    // this process, any read would throw; Apollo must authorise without one.
    const d = await tenantFundedExecutionPort.authorizeCost({
      organizationId: ORG, providerId: 'apollo', attributes: [], correlationId: 'c',
    });
    expect(d).toEqual({ authorized: true, holdId: null, cost: { kind: 'unknown' } });
  });

  it('end to end through executeEnrichment: Apollo is called, Clearbit is cost_denied', async () => {
    const port = makeTenantFundedExecutionPort({
      allow: makeDailyCallCeilingAllow({ resolveCeiling: async () => null, countCallsToday: async () => 0 }),
    });
    const enrich = jest.fn(async () => ({
      outcome: 'enriched' as const,
      fields: [{ attribute: 'employee_count', subject: 'account' as const, value: 10, observedAt: null, confidence: null, providerInferred: false }],
      notReturned: [],
    }));
    const adapterFor = (id: string): EnrichmentProviderAdapter => ({
      id, label: id, supports: ['employee_count'], credentialEnvVar: 'X', isAvailable: () => false, enrich,
    } as unknown as EnrichmentProviderAdapter);
    const ports: ExecuteEnrichmentPorts = {
      ...port,
      resolveCredential: async () => KEY,
      findRecentObservation: async () => null,
      persistObservation: async () => ({ sourceRecordId: 'sr-1', canonicalWithheld: [] }),
      now: () => '2026-10-23T00:00:00.000Z',
    };
    const req: EnrichmentRequest = {
      organizationId: ORG, subject: 'account', entityId: ACCOUNT, attributes: ['employee_count'],
      selectors: { domain: 'example.com' }, purpose: 't', correlationId: 'c',
    };

    const apollo = await executeEnrichment(req, 'apollo', ports, { adapter: adapterFor('apollo') });
    expect(apollo.outcome).toBe('enriched');
    expect(enrich).toHaveBeenCalledTimes(1);

    const clearbit = await executeEnrichment(req, 'clearbit', ports, { adapter: adapterFor('clearbit') });
    expect(clearbit.outcome).toBe('cost_denied');
    expect(enrich).toHaveBeenCalledTimes(1);          // no second call
  });
});
