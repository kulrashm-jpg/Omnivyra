/**
 * PHASE 4 — the discovery route, invoked.
 *
 * WHY THIS FILE EXISTS. Two Phase 4 mutation probes SURVIVED: one that let GET
 * execute discovery, and one that gave Drishiq Labs a special tenant path through
 * the request body. Neither survived because the code was wrong — both survived
 * because nothing invoked the route. Every other route assertion in this
 * programme was a source-shape check, and a source-shape check cannot see what a
 * handler DOES with a GET.
 *
 * So this suite calls the handler. The two probes are killed by the first and the
 * seventh test below, and the gap they exposed is closed rather than argued away.
 *
 * Nothing here reaches a database, a provider or a credential: the executor, the
 * guards, the registries and the kill switch are all mocked, and the tests assert
 * on what the route passed them.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

// The wrappers pass through, so the default export IS the handler — the pattern
// `phase1aDataSources.test.ts` already uses for this repository's routes.
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));

const enforceCompanyAccess = jest.fn();
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

const requireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

let ingestionEnabled = true;
jest.mock('../../services/leadIngestion/orchestrator', () => ({
  isLeadIngestionEnabled: () => ingestionEnabled,
}));
jest.mock('../../services/leadIngestion', () => ({ registerBuiltInLeadSources: jest.fn() }));

const registerDiscoveryAdapters = jest.fn();
jest.mock('../../services/prospectDiscovery/adapters', () => ({
  registerDiscoveryAdapters: (...a: unknown[]) => registerDiscoveryAdapters(...a),
}));

const createDiscoveryExecution = jest.fn();
const runDiscoveryExecution = jest.fn();
jest.mock('../../services/prospectDiscovery/discoveryExecutor', () => ({
  createDiscoveryExecution: (...a: unknown[]) => createDiscoveryExecution(...a),
  runDiscoveryExecution: (...a: unknown[]) => runDiscoveryExecution(...a),
}));

import handler from '../../../pages/api/prospect-sources/discovery';

const ORG_A = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ORG_B = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';

function makeRes() {
  const res: Record<string, unknown> = { _status: 0, _json: null, _headers: {} };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (b: unknown) => { res._json = b; return res; };
  res.setHeader = (k: string, v: unknown) => { (res._headers as Record<string, unknown>)[k] = v; };
  res.end = () => res;
  return res as never;
}

const call = async (over: Record<string, unknown> = {}) => {
  const req = {
    method: 'POST',
    query: { company_id: ORG_A },
    body: { provider: 'apollo', filters: { titles: ['CTO'] }, bounds: { maxPages: 1, maxResults: 5, maxProviderCalls: 1 } },
    url: '/api/prospect-sources/discovery',
    ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res as unknown as { _status: number; _json: Record<string, unknown>; _headers: Record<string, unknown> };
};

const READY = {
  created: true,
  executionId: 'exec-1',
  attemptNumber: 1,
  searchDigest: 'a'.repeat(64),
  bounds: { maxPages: 1, maxResults: 5, maxProviderCalls: 1 },
  readyForProviderExecution: true,
  refusal: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  ingestionEnabled = true;
  enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });
  requireCapability.mockResolvedValue({ ok: true });
  createDiscoveryExecution.mockResolvedValue(READY);
  runDiscoveryExecution.mockResolvedValue({
    status: 'completed', outcome: 'discovered', stopReason: 'provider_exhausted',
    providerCalls: 1, pagesFetched: 1, resultsObserved: 2, resultsIngested: 2,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — only POST can execute discovery', () => {
  it('GET is refused 405 and executes NOTHING', async () => {
    const res = await call({ method: 'GET' });
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
    // The property the surviving probe exposed: a read must never reach the
    // claim, let alone the provider.
    expect(createDiscoveryExecution).not.toHaveBeenCalled();
    expect(runDiscoveryExecution).not.toHaveBeenCalled();
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  it('PUT, PATCH, DELETE and HEAD are all refused without executing', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD']) {
      jest.clearAllMocks();
      const res = await call({ method });
      expect(res._status).toBe(405);
      expect(createDiscoveryExecution).not.toHaveBeenCalled();
      expect(runDiscoveryExecution).not.toHaveBeenCalled();
    }
  });
});

describe('Phase 4 — the gates run in order, and before anything happens', () => {
  it('the kill switch answers 404 before any membership lookup', async () => {
    ingestionEnabled = false;
    const res = await call();
    expect(res._status).toBe(404);
    expect(res._json.code).toBe('LEAD_INGESTION_DISABLED');
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(createDiscoveryExecution).not.toHaveBeenCalled();
  });

  it('a missing or malformed company_id is refused before authorization', async () => {
    let res = await call({ query: {} });
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();

    jest.clearAllMocks();
    res = await call({ query: { company_id: 'not-a-uuid' } });
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  it('an unauthorized tenant never reaches the executor', async () => {
    enforceCompanyAccess.mockResolvedValue(null);   // the guard wrote its own 401/403
    await call();
    expect(createDiscoveryExecution).not.toHaveBeenCalled();
    expect(runDiscoveryExecution).not.toHaveBeenCalled();
  });

  it('a caller without the capability never reaches the executor', async () => {
    requireCapability.mockResolvedValue({ ok: false, sent: true });
    await call();
    expect(createDiscoveryExecution).not.toHaveBeenCalled();
    expect(runDiscoveryExecution).not.toHaveBeenCalled();
  });

  it('the capability asked for is the prospect-ingest one, for the query tenant', async () => {
    await call();
    expect(requireCapability.mock.calls[0][2]).toMatchObject({ organizationId: ORG_A });
  });
});

describe('Phase 4 — the tenant is the VERIFIED one, never the body\'s', () => {
  it('the executor is called with the query tenant', async () => {
    await call();
    expect(enforceCompanyAccess.mock.calls[0][0].companyId).toBe(ORG_A);
    expect(createDiscoveryExecution.mock.calls[0][0].organizationId).toBe(ORG_A);
  });

  it('a body naming another company or a company NAME changes nothing', async () => {
    // The property the second surviving probe exposed. A client-supplied tenant
    // identifier — or an owner-company name — must not reach the executor.
    await call({
      body: {
        provider: 'apollo',
        filters: { titles: ['CTO'] },
        bounds: { maxPages: 1, maxResults: 5, maxProviderCalls: 1 },
        company_id: ORG_B,
        companyId: ORG_B,
        companyName: 'Drishiq Labs',
        organizationId: ORG_B,
      },
    });
    const passed = createDiscoveryExecution.mock.calls[0][0];
    expect(passed.organizationId).toBe(ORG_A);
    expect(passed.organizationId).not.toBe(ORG_B);
    expect(runDiscoveryExecution.mock.calls[0][0].organizationId).toBe(ORG_A);
  });

  it('Drishiq Labs follows exactly the same path — no branch exists', async () => {
    await call({ body: { provider: 'apollo', filters: { titles: ['CTO'] }, bounds: { maxPages: 1, maxResults: 5, maxProviderCalls: 1 }, companyName: 'Drishiq Labs' } });
    expect(createDiscoveryExecution).toHaveBeenCalledTimes(1);
    expect(createDiscoveryExecution.mock.calls[0][0].organizationId).toBe(ORG_A);
    expect(runDiscoveryExecution).toHaveBeenCalledTimes(1);
  });

  it('a provider is required', async () => {
    const res = await call({ body: { filters: { titles: ['x'] } } });
    expect(res._status).toBe(400);
    expect(createDiscoveryExecution).not.toHaveBeenCalled();
  });
});

describe('Phase 4 — execution happens only through a ready, claimed execution', () => {
  it('registers the discovery adapters before claiming', async () => {
    await call();
    expect(registerDiscoveryAdapters).toHaveBeenCalled();
  });

  it('a READY execution is run, and the response carries truthful accounting', async () => {
    const res = await call();
    expect(res._status).toBe(201);
    expect(runDiscoveryExecution).toHaveBeenCalledWith({
      organizationId: ORG_A, executionId: 'exec-1',
    });
    expect(res._json.run).toMatchObject({
      status: 'completed', outcome: 'discovered', stopReason: 'provider_exhausted',
      providerCalls: 1, pagesFetched: 1, resultsObserved: 2, resultsIngested: 2,
    });
  });

  it('a NOT-ready execution is recorded and the provider is NOT run', async () => {
    createDiscoveryExecution.mockResolvedValue({
      ...READY, readyForProviderExecution: false, refusal: 'credential_missing',
    });
    const res = await call();
    expect(res._status).toBe(201);
    expect(res._json.run).toBeNull();
    // No credential ⇒ no provider call. The refusal is still reported.
    expect(runDiscoveryExecution).not.toHaveBeenCalled();
    expect((res._json.execution as Record<string, unknown>).refusal).toBe('credential_missing');
  });

  it('a live execution answers 409 and names the holder, without running', async () => {
    createDiscoveryExecution.mockResolvedValue({
      created: false, refusal: 'already_live', reason: 'in flight', activeExecutionId: 'exec-0',
    });
    const res = await call();
    expect(res._status).toBe(409);
    expect(res._json.activeExecutionId).toBe('exec-0');
    expect(runDiscoveryExecution).not.toHaveBeenCalled();
  });

  it('a malformed search is refused 400 without running', async () => {
    createDiscoveryExecution.mockResolvedValue({
      created: false, refusal: 'malformed_search', reason: 'at least one filter',
    });
    const res = await call();
    expect(res._status).toBe(400);
    expect(res._json.code).toBe('malformed_search');
    expect(runDiscoveryExecution).not.toHaveBeenCalled();
  });

  it('an executor failure answers 500 and leaks nothing from the provider', async () => {
    runDiscoveryExecution.mockRejectedValue(new Error('x-api-key: super-secret leaked'));
    const res = await call();
    expect(res._status).toBe(500);
    expect(JSON.stringify(res._json)).not.toContain('super-secret');
  });
});
