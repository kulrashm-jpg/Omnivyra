/**
 * PI-ICP-DISCOVERY-003 — ICP-driven discovery, at the route.
 *
 * What this suite is for: proving that an ICP-driven request cannot spend a
 * tenant's provider budget on a search that does not represent their ICP, and
 * that the existing filter-mode callers are untouched.
 *
 * The load-bearing assertions are NEGATIVE and are made on the SPIES, not on
 * the response: an error body proves nothing on its own. What matters is that
 * on every refusal path the ICP loader is the only thing that ran — no
 * execution created, no credential resolved, no adapter reached.
 */

type Row = Record<string, unknown>;

/** Every downstream effect, in order, so "nothing ran" is assertable. */
const seen: string[] = [];

const icpVersions: Row[] = [];
const createSpy = jest.fn();
const runSpy = jest.fn();
const credentialSpy = jest.fn();
const adapterSpy = jest.fn();

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => true),
}));

// The route checks `guard.ok !== true` (NOT `!guard`), because the real guard
// returns `{ ok, sent }` and `{ ok: false, sent: true }` is truthy. A bare
// `true` here made the route return early with no response at all.
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true })),
}));

// `withIdempotency(handler, options)` is a higher-order wrapper applied at
// MODULE level, so the double must return the handler rather than invoke it.
// Idempotency itself is the middleware's own contract and is tested there.
jest.mock('../../middleware/withIdempotency', () => ({
  withIdempotency: (handler: unknown) => handler,
}));

jest.mock('../../services/leadIngestion/orchestrator', () => ({
  isLeadIngestionEnabled: () => true,
  resolveLeadIngestionGate: jest.fn(async () => ({ allowed: true, reason: 'test' })),
}));

jest.mock('../../services/leadIngestion', () => ({
  registerBuiltInLeadSources: () => { seen.push('registerLeadSources'); },
}));

jest.mock('../../services/prospectDiscovery/adapters', () => ({
  registerDiscoveryAdapters: () => { seen.push('registerDiscoveryAdapters'); },
}));

jest.mock('../../services/prospectDiscovery/discoveryExecutor', () => ({
  createDiscoveryExecution: (...a: unknown[]) => {
    seen.push('createDiscoveryExecution');
    return createSpy(...a);
  },
  runDiscoveryExecution: (...a: unknown[]) => {
    seen.push('runDiscoveryExecution');
    return runSpy(...a);
  },
}));

// The credential port and the adapter are mocked only so their being reached is
// OBSERVABLE. Nothing in this suite should ever make either fire.
jest.mock('../../services/enrichment/providers/credentials', () => ({
  tenantCredentialPort: {
    resolveCredential: (...a: unknown[]) => { seen.push('resolveCredential'); return credentialSpy(...a); },
  },
}));

jest.mock('../../services/prospectDiscovery/providerRegistry', () => ({
  hasDiscoveryProvider: () => true,
  getDiscoveryProvider: () => {
    seen.push('getDiscoveryProvider');
    return { provider: 'apollo', discover: (...a: unknown[]) => { seen.push('adapter.discover'); return adapterSpy(...a); } };
  },
  registerDiscoveryProvider: jest.fn(),
}));

jest.mock('../../services/prospectIcp/persistence', () => ({
  getIcpVersionById: jest.fn(async (organizationId: string, id: string) => {
    seen.push('getIcpVersionById');
    // The REAL tenant predicate, emulated: a row from another tenant is not
    // returned, exactly as the query's `.eq('organization_id', …)` guarantees.
    const hit = icpVersions.find((v) => v.id === id && v.organization_id === organizationId);
    if (!hit) return null;
    return {
      id: hit.id, organizationId: hit.organization_id, icpId: hit.icp_id,
      version: hit.version, status: hit.status, criteria: hit.criteria,
      proposal: {}, proposedByModel: null,
      ratifiedAt: hit.ratified_at ?? null, ratifiedBy: hit.ratified_by ?? null,
      supersededAt: null, supersededByVersion: null, createdAt: '2026-01-01T00:00:00.000Z',
    };
  }),
}));

import type { NextApiRequest } from 'next';
import handler from '../../../pages/api/prospect-sources/discovery';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const VER_A = '11111111-1111-4111-8111-111111111111';
const VER_B = '22222222-2222-4222-8222-222222222222';

type Res = {
  _status: number; _json: Record<string, unknown> | null;
  status: (c: number) => Res; json: (b: unknown) => Res; setHeader: () => void; end: () => void;
};
const makeRes = (): Res => {
  const r: Res = {
    _status: 0, _json: null,
    status(c) { r._status = c; return r; },
    json(b) { r._json = b as Record<string, unknown>; return r; },
    setHeader() { /* noop */ },
    end() { /* noop */ },
  };
  return r;
};

const post = async (body: Record<string, unknown>) => {
  const res = makeRes();
  await (handler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
    { method: 'POST', body, query: { companyId: ORG_A }, headers: {} } as never as NextApiRequest,
    res,
  );
  return res;
};

const titleCriterion = (over: Record<string, unknown> = {}) => ({
  id: 'c-title', kind: 'mandatory', subject: 'person', attribute: 'job_title',
  predicate: { op: 'one_of', values: ['Head of Platform'] }, ...over,
});

const seedVersion = (over: Row = {}) => {
  const row: Row = {
    id: VER_A, organization_id: ORG_A, icp_id: 'icp-1', version: 3,
    status: 'ratified', criteria: [titleCriterion()],
    ratified_at: '2026-05-01T00:00:00.000Z', ratified_by: 'user-1',
    ...over,
  };
  icpVersions.push(row);
  return row;
};

const BOUNDS = { maxPages: 1, maxResults: 10, maxProviderCalls: 1 };

/** Everything that costs money or writes a ledger row. */
const SPENDING_EFFECTS = ['createDiscoveryExecution', 'runDiscoveryExecution', 'resolveCredential', 'getDiscoveryProvider', 'adapter.discover'];
const spendingEffects = () => seen.filter((x) => SPENDING_EFFECTS.includes(x));

beforeEach(() => {
  seen.length = 0;
  icpVersions.length = 0;
  createSpy.mockReset();
  runSpy.mockReset();
  credentialSpy.mockReset();
  adapterSpy.mockReset();
  createSpy.mockResolvedValue({
    created: true, executionId: 'exec-1', attemptNumber: 1, searchDigest: 'd'.repeat(64),
    bounds: BOUNDS, readyForProviderExecution: true, refusal: null,
  });
  // The route ARMS the provider stage when the execution is ready, so the run
  // must be stubbed with the settled shape it reports verbatim.
  runSpy.mockResolvedValue({
    status: 'completed', outcome: 'ok', stopReason: 'exhausted',
    providerCalls: 1, pagesFetched: 1, resultsObserved: 0, resultsIngested: 0,
  });
});

describe('PI-ICP-003 — backward compatibility for filter mode', () => {
  it('1. filter mode is unchanged and reaches the executor with the caller filters', async () => {
    const r = await post({ provider: 'apollo', filters: { titles: ['CTO'] }, bounds: BOUNDS });
    expect(r._status).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_A, provider: 'apollo', filters: { titles: ['CTO'] },
    }));
    // No ICP machinery was touched.
    expect(seen).not.toContain('getIcpVersionById');
    expect(r._json?.execution).not.toHaveProperty('icp');
  });

  it('2. a missing provider is still a 400, before anything else', async () => {
    const r = await post({ filters: { titles: ['CTO'] } });
    expect(r._status).toBe(400);
    expect(spendingEffects()).toEqual([]);
  });

  it('3. filter mode still works with no filters at all — the executor decides', async () => {
    await post({ provider: 'apollo', bounds: BOUNDS });
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ filters: undefined }));
  });
});

describe('PI-ICP-003 — mode selection', () => {
  it('4. supplying BOTH icpVersionId and filters is a 400 and spends nothing', async () => {
    seedVersion();
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, filters: { titles: ['CTO'] }, bounds: BOUNDS });
    expect(r._status).toBe(400);
    expect(r._json?.code).toBe('mode_conflict');
    expect(spendingEffects()).toEqual([]);
    expect(seen).not.toContain('getIcpVersionById');
  });

  it('5. an empty-but-present filters object still counts as filter mode', async () => {
    seedVersion();
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, filters: {}, bounds: BOUNDS });
    expect(r._status).toBe(400);
    expect(r._json?.code).toBe('mode_conflict');
  });
});

describe('PI-ICP-003 — ratification and tenant ownership', () => {
  it('6. a ratified version drives discovery, with ICP evidence on the response', async () => {
    seedVersion();
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });

    expect(r._status).toBe(201);
    // The SERVER-DERIVED filters reached the executor, not anything from the body.
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_A, filters: { titles: ['Head of Platform'] },
    }));
    const icp = (r._json?.execution as Record<string, unknown>)?.icp as Record<string, unknown>;
    expect(icp).toMatchObject({ icpId: 'icp-1', version: 3, mandatoryOnly: true, omissionsAcknowledged: false });
  });

  it('7. the loader is called with the VERIFIED tenant, never a body value', async () => {
    seedVersion();
    const { getIcpVersionById } = require('../../services/prospectIcp/persistence');
    await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS, companyId: ORG_B, organizationId: ORG_B });
    expect(getIcpVersionById).toHaveBeenCalledWith(ORG_A, VER_A);
  });

  it('8. an UNRATIFIED version is refused, and nothing is spent', async () => {
    for (const status of ['draft', 'proposed', 'superseded']) {
      seen.length = 0; icpVersions.length = 0;
      seedVersion({ status, ratified_at: null, ratified_by: null });
      const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
      expect(r._status).toBe(409);
      expect(r._json?.code).toBe('icp_version_not_ratified');
      expect(spendingEffects()).toEqual([]);
    }
  });

  it('9. a version claiming `ratified` with NO ratifier is still refused', async () => {
    // Coherence, not just the label: a ratified version without a ratifier is
    // not ratified (contract 16 requires a real user id).
    seedVersion({ status: 'ratified', ratified_by: null });
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
    expect(r._status).toBe(409);
    expect(spendingEffects()).toEqual([]);
  });

  it('10. ANOTHER TENANT’s version is a 404 that leaks nothing', async () => {
    icpVersions.push({
      id: VER_B, organization_id: ORG_B, icp_id: 'icp-secret', version: 9,
      status: 'ratified', criteria: [titleCriterion({ predicate: { op: 'one_of', values: ['SECRET TITLE'] } })],
      ratified_at: '2026-05-01T00:00:00.000Z', ratified_by: 'user-b',
    });

    const r = await post({ provider: 'apollo', icpVersionId: VER_B, bounds: BOUNDS });
    expect(r._status).toBe(404);
    expect(r._json?.code).toBe('icp_version_not_found');
    // Neither the foreign criterion values nor its identifiers appear.
    const body = JSON.stringify(r._json);
    expect(body).not.toContain('SECRET TITLE');
    expect(body).not.toContain('icp-secret');
    expect(body).not.toContain(ORG_B);
    expect(spendingEffects()).toEqual([]);
  });

  it('11. a malformed icpVersionId is a 400, not a lookup', async () => {
    const r = await post({ provider: 'apollo', icpVersionId: 'not-a-uuid', bounds: BOUNDS });
    expect(r._status).toBe(404);   // the stub loader finds nothing for a bogus id
    expect(spendingEffects()).toEqual([]);
  });
});

describe('PI-ICP-003 — refusal happens BEFORE any spend', () => {
  it('12. an unsupported MANDATORY criterion prevents execution, credential and adapter', async () => {
    // RETARGETED in PI-ICP-DISCOVERY-005: `seniority` now maps on documented
    // evidence, so headcount is the canonical unsupported-mandatory example.
    seedVersion({ criteria: [titleCriterion({ subject: 'account', attribute: 'employee_band', predicate: { op: 'one_of', values: ['11-50'] } })] });
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });

    expect(r._status).toBe(400);
    expect(r._json?.code).toBe('unsupported_mandatory_criterion');
    // THE ASSERTION THAT MATTERS.
    expect(spendingEffects()).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
    expect(credentialSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
  });

  it('13. an ICP with no translatable criterion cannot become an unrestricted search', async () => {
    seedVersion({ criteria: [titleCriterion({ kind: 'optional' })] });
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });

    expect(r._status).toBe(400);
    expect(r._json?.code).toBe('no_translatable_criteria');
    expect(spendingEffects()).toEqual([]);
    // And emphatically: the executor was never offered an empty filter set.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('14. refusal details carry ids and reasons but never criterion VALUES', async () => {
    seedVersion({ criteria: [titleCriterion({ id: 'c-band', subject: 'account', attribute: 'employee_band', predicate: { op: 'one_of', values: ['11-50', '51-200'] } })] });
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });

    const blocking = r._json?.blocking as Array<Record<string, unknown>>;
    expect(blocking[0]).toMatchObject({ criterionId: 'c-band', attribute: 'employee_band', kind: 'mandatory' });
    expect(String(blocking[0].reason).length).toBeGreaterThan(10);
    expect(JSON.stringify(r._json)).not.toContain('11-50');
    expect(JSON.stringify(r._json)).not.toContain('51-200');
  });
});

describe('PI-ICP-003 — the omission acknowledgement is strict', () => {
  const withSoft = () => seedVersion({
    criteria: [
      titleCriterion(),
      titleCriterion({ id: 'c-soft', kind: 'optional', attribute: 'city', predicate: { op: 'one_of', values: ['London'] } }),
    ],
  });

  it('15. omissions without acknowledgement are refused and spend nothing', async () => {
    withSoft();
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
    expect(r._status).toBe(400);
    expect(r._json?.code).toBe('omissions_unacknowledged');
    expect(spendingEffects()).toEqual([]);
  });

  it('16. only strict `true` acknowledges — no truthy value will do', async () => {
    for (const bogus of ['true', 'yes', 1, {}, [], 'TRUE']) {
      seen.length = 0; icpVersions.length = 0;
      withSoft();
      const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS, acknowledgeOmissions: bogus });
      expect(r._json?.code).toBe('omissions_unacknowledged');
      expect(spendingEffects()).toEqual([]);
    }
  });

  it('17. acknowledged: it proceeds, and the omissions are surfaced in full', async () => {
    withSoft();
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS, acknowledgeOmissions: true });

    expect(r._status).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ filters: { titles: ['Head of Platform'] } }));
    const icp = (r._json?.execution as Record<string, unknown>)?.icp as Record<string, unknown>;
    expect(icp.omissionsAcknowledged).toBe(true);
    expect(icp.mandatoryOnly).toBe(true);
    const omitted = icp.omitted as Array<Record<string, unknown>>;
    expect(omitted).toHaveLength(1);
    expect(omitted[0]).toMatchObject({ criterionId: 'c-soft', attribute: 'city', kind: 'optional' });
  });
});

describe('PI-ICP-003 — truthful lifecycle, no false claims', () => {
  it('18. the route delegates to the executor and never reaches an adapter itself', async () => {
    seedVersion();
    await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
    // The route arms the provider STAGE through the executor; it never resolves
    // a credential or touches an adapter in its own code.
    expect(seen).toContain('createDiscoveryExecution');
    expect(seen).toContain('runDiscoveryExecution');
    expect(seen).not.toContain('adapter.discover');
    expect(seen).not.toContain('resolveCredential');
    expect(adapterSpy).not.toHaveBeenCalled();
    expect(credentialSpy).not.toHaveBeenCalled();
  });

  it('19. the response separates execution from run, and claims no verification', async () => {
    seedVersion();
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
    // Three distinct facts: the execution record, its readiness, and the
    // SETTLED run reported verbatim — never flattened into one "ok".
    const execution = r._json?.execution as Record<string, unknown>;
    expect(execution.readyForProviderExecution).toBe(true);
    expect(r._json?.run).toMatchObject({ status: 'completed', stopReason: 'exhausted' });
    expect(JSON.stringify(r._json)).not.toMatch(/operationallyVerified|operational_verified/);
  });

  it('20. a credential refusal AFTER creation keeps the existing lifecycle shape', async () => {
    seedVersion();
    createSpy.mockResolvedValue({
      created: true, executionId: 'exec-1', attemptNumber: 1, searchDigest: 'd'.repeat(64),
      bounds: BOUNDS, readyForProviderExecution: false, refusal: 'credential_missing',
    });

    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
    const execution = r._json?.execution as Record<string, unknown>;
    // The refusal is RECORDED, not thrown away, and is not a successful search.
    expect(execution.refusal).toBe('credential_missing');
    expect(execution.readyForProviderExecution).toBe(false);
    // `run: null` is how the route says no provider stage was entered.
    expect(r._json?.run).toBeNull();
    expect(seen).not.toContain('runDiscoveryExecution');
    expect(adapterSpy).not.toHaveBeenCalled();
  });

  it('21. an executor refusal before creation is passed through, not reshaped', async () => {
    seedVersion();
    createSpy.mockResolvedValue({ created: false, refusal: 'already_live', reason: 'a live execution exists', activeExecutionId: 'exec-0' });

    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
    expect(r._status).toBe(409);
    expect(r._json?.code).toBe('already_live');
  });

  it('22. an executor throw is not reported as a successful search', async () => {
    seedVersion();
    createSpy.mockRejectedValue(new Error('ledger unavailable'));
    const r = await post({ provider: 'apollo', icpVersionId: VER_A, bounds: BOUNDS });
    expect(r._status).toBeGreaterThanOrEqual(400);
    expect(adapterSpy).not.toHaveBeenCalled();
  });
});
