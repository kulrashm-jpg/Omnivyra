/**
 * Apollo vendor errors at the API boundary (owner decision 2026-10-23).
 *
 * Both routes that can reach Apollo must return the vendor's refusal as a clear
 * error object: a stable `code`, our message in `error`, and `providerError`
 * carrying Apollo's own status and message. The HTTP status is mapped from the
 * code, and `Retry-After` is set when Apollo stated a horizon.
 *
 * Every dependency is mocked. No database, provider or credential is reached.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { classifyApolloHttpError } from '../../services/providerErrors/apolloErrors';

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));

const enforceCompanyAccess = jest.fn();
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));
const requireTenantAccess = jest.fn();
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
}));
const requireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));
jest.mock('../../services/leadIngestion/orchestrator', () => ({ isLeadIngestionEnabled: () => true }));
jest.mock('../../services/leadIngestion', () => ({ registerBuiltInLeadSources: jest.fn() }));
jest.mock('../../services/prospectDiscovery/adapters', () => ({ registerDiscoveryAdapters: jest.fn() }));

const createDiscoveryExecution = jest.fn();
const runDiscoveryExecution = jest.fn();
jest.mock('../../services/prospectDiscovery/discoveryExecutor', () => ({
  createDiscoveryExecution: (...a: unknown[]) => createDiscoveryExecution(...a),
  runDiscoveryExecution: (...a: unknown[]) => runDiscoveryExecution(...a),
}));
const executeProspectEnrichment = jest.fn();
jest.mock('../../apiHandlers/prospects/prospectIntelligenceRead', () => ({
  executeProspectEnrichment: (...a: unknown[]) => executeProspectEnrichment(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const discoveryRoute = require('../../../pages/api/prospect-sources/discovery').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const enrichRoute = require('../../../pages/api/prospects/[id]/enrich').default;

const ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const KEY = 'synthetic-tenant-apollo-key-route';
const headerBag = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

type Captured = { status: number; json: Record<string, any>; headers: Record<string, string> };
const invoke = async (route: (q: NextApiRequest, s: NextApiResponse) => Promise<void>, req: Record<string, unknown>) => {
  const out: Captured = { status: 0, json: {}, headers: {} };
  const res = {
    status(c: number) { out.status = c; return res; },
    json(b: Record<string, any>) { out.json = b; return res; },
    setHeader(k: string, v: string) { out.headers[k] = v; },
    end() { return res; },
  };
  await route(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return out;
};

const discovery = () => invoke(discoveryRoute, {
  method: 'POST',
  query: { company_id: ORG },
  body: { provider: 'apollo', filters: { titles: ['CTO'] }, bounds: { maxPages: 1, maxResults: 5, maxProviderCalls: 1 } },
  url: '/api/prospect-sources/discovery',
});
const enrich = () => invoke(enrichRoute, {
  method: 'POST',
  query: { companyId: ORG, id: 'prospect-1' },
  body: { attribute: 'employee_count', subject: 'account' },
});

const failedRun = (providerError: unknown) => ({
  status: 'failed', outcome: null, stopReason: 'provider_failed',
  providerCalls: 1, pagesFetched: 0, resultsObserved: 0, resultsIngested: 0,
  providerError, providerUsage: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });
  requireTenantAccess.mockResolvedValue({ userId: 'u-1' });
  requireCapability.mockResolvedValue({ ok: true });
  createDiscoveryExecution.mockResolvedValue({
    created: true, executionId: 'exec-1', attemptNumber: 1, searchDigest: 'a'.repeat(64),
    bounds: { maxPages: 1, maxResults: 5, maxProviderCalls: 1 }, readyForProviderExecution: true, refusal: null,
  });
});

describe('POST /api/prospect-sources/discovery — Apollo refusals', () => {
  const cases: Array<[string, Parameters<typeof classifyApolloHttpError>[0], number, string]> = [
    ['bad key', { status: 401, body: 'Invalid API key.', endpoint: 'api/v1/mixed_people/api_search' }, 424, 'APOLLO_AUTH_INVALID'],
    ['not in plan', { status: 403, body: { error_code: 'API_INACCESSIBLE', error_details: { code: 'AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED', message: 'Your team is not permitted to call this endpoint.' } }, endpoint: 'api/v1/mixed_people/api_search' }, 402, 'APOLLO_ENDPOINT_NOT_IN_PLAN'],
    ['no credits', { status: 402, body: { error: 'Insufficient credits' }, endpoint: 'api/v1/mixed_people/api_search' }, 402, 'APOLLO_CREDITS_EXHAUSTED'],
    ['bad request', { status: 422, body: { error: 'Invalid parameters' }, endpoint: 'api/v1/mixed_people/api_search' }, 422, 'APOLLO_REQUEST_REJECTED'],
    ['outage', { status: 503, body: '', endpoint: 'api/v1/mixed_people/api_search' }, 503, 'APOLLO_UNAVAILABLE'],
    ['odd status', { status: 418, body: '', endpoint: 'api/v1/mixed_people/api_search' }, 502, 'APOLLO_UNKNOWN'],
  ];

  it.each(cases)('%s → mapped status, stable code, vendor message, execution kept', async (_n, input, status, code) => {
    const view = classifyApolloHttpError(input);
    runDiscoveryExecution.mockResolvedValue(failedRun(view));
    const r = await discovery();
    expect(r.status).toBe(status);
    expect(r.json.code).toBe(code);
    expect(r.json.error).toBe(view.message);
    expect(r.json.providerError).toMatchObject({ provider: 'apollo', code, vendorStatus: input.status });
    expect(r.json.execution.id).toBe('exec-1');
    expect(r.json.run.status).toBe('failed');
    expect(r.headers['Retry-After']).toBeUndefined();
  });

  it('a rate limit answers 429 with Retry-After and the window', async () => {
    const view = classifyApolloHttpError({
      status: 429, endpoint: 'api/v1/mixed_people/api_search',
      body: { error_details: { code: 'USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED', message: 'You have made more API requests than your plan allows in this time window.', context: { window: { value: 'day' } } } },
      headers: headerBag({ 'x-rate-limit-24-hour': '2000', 'x-24-hour-requests-left': '0', 'retry-after': '3600' }),
    });
    runDiscoveryExecution.mockResolvedValue(failedRun(view));
    const r = await discovery();
    expect(r.status).toBe(429);
    expect(r.headers['Retry-After']).toBe('3600');
    expect(r.json.providerError.rateLimit).toMatchObject({ scope: 'plan', window: 'day', limit: 2000, remaining: 0 });
    expect(r.json.providerError.vendorMessage).toBe('You have made more API requests than your plan allows in this time window.');
  });

  it('the key never reaches the response', async () => {
    runDiscoveryExecution.mockResolvedValue(failedRun(classifyApolloHttpError({
      status: 401, body: `key ${KEY} rejected`, endpoint: 'api/v1/mixed_people/api_search', apiKey: KEY,
    })));
    const r = await discovery();
    expect(JSON.stringify(r.json)).not.toContain(KEY);
  });

  it('success stays 201 and carries providerUsage', async () => {
    runDiscoveryExecution.mockResolvedValue({
      status: 'completed', outcome: 'discovered', stopReason: 'provider_exhausted',
      providerCalls: 1, pagesFetched: 1, resultsObserved: 2, resultsIngested: 2,
      providerError: null, providerUsage: { minute: null, hour: { limit: 600, used: 590, left: 10 }, day: null, lowWindows: ['hour'] },
    });
    const r = await discovery();
    expect(r.status).toBe(201);
    expect(r.json.code).toBeUndefined();
    expect(r.json.run.providerUsage.lowWindows).toEqual(['hour']);
  });

  it('a failed run WITHOUT a vendor error keeps the existing 201 answer', async () => {
    runDiscoveryExecution.mockResolvedValue(failedRun(null));
    const r = await discovery();
    expect(r.status).toBe(201);
    expect(r.json.run.status).toBe('failed');
  });
});

describe('POST /api/prospects/:id/enrich — Apollo refusals', () => {
  const executed = (providerError: unknown, outcome = 'provider_unavailable') => ({
    status: 'executed',
    execution: { executed: true, outcome, providerCalled: true, providerId: 'apollo', reason: 'x', providerError },
  });

  it('credits exhausted → 402 with the vendor error and the execution', async () => {
    const view = classifyApolloHttpError({ status: 402, body: { error: 'Insufficient credits' }, endpoint: 'api/v1/organizations/enrich' });
    executeProspectEnrichment.mockResolvedValue(executed(view, 'quota_exceeded'));
    const r = await enrich();
    expect(r.status).toBe(402);
    expect(r.json.code).toBe('APOLLO_CREDITS_EXHAUSTED');
    expect(r.json.providerError.vendorMessage).toBe('Insufficient credits');
    expect(r.json.execution.outcome).toBe('quota_exceeded');
  });

  it('rate limited → 429 with Retry-After', async () => {
    const view = classifyApolloHttpError({
      status: 429, body: {}, endpoint: 'api/v1/organizations/enrich',
      headers: headerBag({ 'x-rate-limit-minute': '100', 'x-minute-requests-left': '0', 'retry-after': '30' }),
    });
    executeProspectEnrichment.mockResolvedValue(executed(view, 'rate_limited'));
    const r = await enrich();
    expect(r.status).toBe(429);
    expect(r.headers['Retry-After']).toBe('30');
    expect(r.json.providerError.rateLimit.window).toBe('minute');
  });

  it('no vendor error → the existing 200 answer, unchanged', async () => {
    executeProspectEnrichment.mockResolvedValue(executed(null, 'enriched'));
    const r = await enrich();
    expect(r.status).toBe(200);
    expect(r.json.code).toBeUndefined();
  });
});
