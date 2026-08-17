/**
 * LI-5E.4 — the CRM ingestion entry point.
 *
 * A transport shell over machinery that is already proven, so these tests are
 * mostly about what it REFUSES. The tenant matters most: `company_id` comes from
 * the authenticated query parameter and is membership-verified, and a body
 * attempting to name a tenant is rejected outright rather than quietly ignored.
 *
 * The one assertion unique to this route is that it hands the orchestrator the
 * `crm` source — that is the whole reason a second platform exists.
 */

const enforceCompanyAccess = jest.fn();
const ingestLeadBatch = jest.fn();
const registerBuiltInLeadSources = jest.fn();
let registeredAtImport = 0;

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

jest.mock('../../services/leadIngestion/orchestrator', () => ({
  ingestLeadBatch: (...a: unknown[]) => ingestLeadBatch(...a),
  MAX_BATCH_SIZE: 1000,
}));

jest.mock('../../services/leadIngestion', () => ({
  registerBuiltInLeadSources: () => { registeredAtImport += 1; return registerBuiltInLeadSources(); },
}));

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import handler from '../../../pages/api/lead-ingestion/crm';
import type { NextApiRequest, NextApiResponse } from 'next';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

type Res = NextApiResponse & { _status: number; _json: Record<string, unknown>; _headers: Record<string, string> };

const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {}, _headers: {} };
  r.status = ((c: number) => { (r as Res)._status = c; return r as Res; }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => { (r as Res)._json = b; return r as Res; }) as Res['json'];
  r.setHeader = ((k: string, v: string) => { (r as Res)._headers[k] = v; return r as Res; }) as unknown as Res['setHeader'];
  return r as Res;
};

const call = async (over: Partial<NextApiRequest> = {}) => {
  const req = {
    method: 'POST',
    query: { company_id: ORG_A },
    body: { records: [{ externalId: 'CRM-1' }] },
    url: '/api/lead-ingestion/crm',
    ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res;
};

const OK = { source: 'crm', total: 1, succeeded: 1, failed: 0, outcomes: [{ externalId: 'CRM-1', status: 'ingested' }] };

beforeEach(() => {
  jest.clearAllMocks();
  enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });
  ingestLeadBatch.mockResolvedValue(OK);
});

/**
 * P2D's twelve employer firmographics, in the PROVIDER forms a caller actually
 * sends: numbers as strings, a lowercase country code, an offset timestamp, a
 * real array. Every value is deliberately distinct, so a field that goes missing
 * cannot be masked by another field happening to carry the same value.
 */
const FIRMOGRAPHICS = {
  industry: 'software',
  employeeCount: '250',
  employeeBand: '201-500',
  companyCountryCode: 'us',
  companyRegion: 'ca',
  companyCity: 'San Francisco',
  annualRevenue: '12500000',
  revenueBand: '10m-25m',
  foundedYear: '2014',
  technologies: ['postgres', 'nextjs'],
  fundingStage: 'series-b',
  lastFundingAt: '2026-01-15T10:30:00Z',
};

/** Typed explicitly: `it.each` over mixed-type tuples infers badly otherwise. */
const FIRMOGRAPHIC_ENTRIES: Array<[string, unknown]> = Object.entries(FIRMOGRAPHICS);

describe('LI-5E.4 — the happy path', () => {
  it('an authenticated tenant can invoke CRM-namespace ingestion', async () => {
    const res = await call();
    expect(res._status).toBe(200);
    expect(res._json).toEqual(OK);
  });

  it('calls the EXISTING orchestrator with the verified tenant and the crm source', async () => {
    await call();
    expect(ingestLeadBatch).toHaveBeenCalledTimes(1);
    expect(ingestLeadBatch.mock.calls[0][0]).toMatchObject({
      organizationId: ORG_A,
      source: 'crm',
    });
  });

  it('records pass through unchanged — no route-side normalisation', async () => {
    const records = [{ externalId: 'CRM-1', firstName: 'ada', unknownField: 'kept' }];
    await call({ body: { records } } as Partial<NextApiRequest>);
    expect(ingestLeadBatch.mock.calls[0][0].records).toEqual(records);
  });

  it('accepts an external-id-only record — the evidence case', async () => {
    await call({ body: { records: [{ externalId: 'CRM-1' }] } } as Partial<NextApiRequest>);
    expect(ingestLeadBatch).toHaveBeenCalledTimes(1);
    const sent = ingestLeadBatch.mock.calls[0][0].records[0];
    expect(sent.email).toBeUndefined();
    expect(sent.phone).toBeUndefined();
  });

  it('email and phone are optional at the transport boundary', async () => {
    await call({ body: { records: [{ externalId: 'CRM-1', email: 'a@x.test' }] } } as Partial<NextApiRequest>);
    expect(ingestLeadBatch).toHaveBeenCalledTimes(1);
  });

  it('passes an ingestionRunId through when supplied', async () => {
    await call({ body: { records: [{ externalId: 'CRM-1' }], ingestionRunId: 'run-7' } } as Partial<NextApiRequest>);
    expect(ingestLeadBatch.mock.calls[0][0].ingestionRunId).toBe('run-7');
  });

  it('registers the built-in adapters at module load, not per request', async () => {
    const before = registeredAtImport;
    await call();
    expect(registeredAtImport).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it('rejects a non-POST method', async () => {
    const res = await call({ method: 'GET' } as Partial<NextApiRequest>);
    expect(res._status).toBe(405);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });
});

describe('LI-5E.4 — the tenant is never the body’s', () => {
  it('requires company_id', async () => {
    const res = await call({ query: {} } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-uuid'], ['00000000-0000-4000-8000-0000000000a'], ["' OR 1=1--"], [''],
  ])('refuses a malformed company_id (%s) with 400, before any membership lookup', async (bad) => {
    const res = await call({ query: { company_id: bad } } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('refuses a repeated company_id parameter rather than picking one', async () => {
    const res = await call({ query: { company_id: [ORG_A, ORG_B] } } as unknown as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('an unauthenticated request never reaches the adapter', async () => {
    enforceCompanyAccess.mockResolvedValue(null);
    await call();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('an authorization failure never reaches the adapter', async () => {
    enforceCompanyAccess.mockResolvedValue(null);
    const res = await call({ query: { company_id: ORG_B } } as Partial<NextApiRequest>);
    expect(res._status).toBe(0);        // enforceCompanyAccess wrote its own response
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('membership is verified against the company_id actually used', async () => {
    await call({ query: { company_id: ORG_B } } as Partial<NextApiRequest>);
    expect(enforceCompanyAccess.mock.calls[0][0].companyId).toBe(ORG_B);
    expect(ingestLeadBatch.mock.calls[0][0].organizationId).toBe(ORG_B);
  });

  it.each(['organizationId', 'organization_id', 'companyId', 'company_id'])(
    'REFUSES a %s tenant override in the body rather than ignoring it', async (key) => {
      const res = await call({ body: { records: [{ externalId: 'CRM-1' }], [key]: ORG_B } } as Partial<NextApiRequest>);
      expect(res._status).toBe(400);
      expect(ingestLeadBatch).not.toHaveBeenCalled();
    });

  it('tenant A naming tenant B in the body cannot write to B', async () => {
    const res = await call({
      query: { company_id: ORG_A },
      body: { records: [{ externalId: 'CRM-1' }], organizationId: ORG_B },
    } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('the route never derives the tenant from the body', async () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../pages/api/lead-ingestion/crm.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toContain('extractTenantIdFromRequest');
    expect(src).not.toMatch(/body\.(organizationId|companyId|company_id)/);
    expect(src).toContain('req.query.company_id');
  });
});

describe('LI-5E.4 — input validation', () => {
  it('rejects a non-object body', async () => {
    const res = await call({ body: 'nope' } as unknown as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('rejects a missing records array', async () => {
    const res = await call({ body: {} } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('rejects a non-array records', async () => {
    const res = await call({ body: { records: 'x' } } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('rejects an empty batch', async () => {
    const res = await call({ body: { records: [] } } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('rejects a non-object record', async () => {
    const res = await call({ body: { records: [{ externalId: 'CRM-1' }, 'x'] } } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('rejects a batch over the existing limit with 413', async () => {
    const records = Array.from({ length: 1001 }, (_, i) => ({ externalId: `CRM-${i}` }));
    const res = await call({ body: { records } } as Partial<NextApiRequest>);
    expect(res._status).toBe(413);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });
});

describe('LI-5E.4 — the existing pipeline is reused, not reimplemented', () => {
  const src = () => require('fs').readFileSync(
    require('path').join(__dirname, '../../../pages/api/lead-ingestion/crm.ts'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the route contains no ingestion, identity, provenance or duplicate logic', () => {
    for (const forbidden of [
      'resolveUnifiedPerson', 'ingestSourceRecord', 'detectAndParkDuplicates',
      'writeExternalIdentityClaims', 'identity_claims', 'unified_persons',
      'source_records', 'source_assertions', 'external_keys',
    ]) {
      expect(src()).not.toContain(forbidden);
    }
  });

  it('performs no database access of its own', () => {
    for (const forbidden of ['supabase', 'ownedDbTable', 'createClient', '.from(', '.insert(', '.rpc(']) {
      expect(src()).not.toContain(forbidden);
    }
  });

  it('activates no CRM and performs no network call', () => {
    for (const forbidden of [
      'crmIngestionService', 'crmActivationService', 'ingestionScheduler',
      'triggerCrmSync', 'ingestCrmData', 'CRM_ENABLED', 'COMMERCIAL_EVIDENCE_ENABLED',
      'fetch(', 'axios', 'hubspot', 'salesforce', 'zoho',
    ]) {
      expect(src()).not.toContain(forbidden);
    }
  });

  it('uses the existing crm source key — no new identity namespace', () => {
    expect(src()).toContain('CRM_SOURCE');
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('leaves the manual route untouched — it is a separate file', () => {
    const fs = require('fs'); const path = require('path');
    expect(fs.existsSync(path.join(__dirname, '../../../pages/api/lead-ingestion/manual.ts'))).toBe(true);
    expect(src()).not.toContain('MANUAL_SOURCE');
  });
});

describe('LI-5E.4 — response safety and error handling', () => {
  it('returns identifiers, counts and outcomes only — no PII', async () => {
    const res = await call();
    expect(Object.keys(res._json).sort()).toEqual(['failed', 'outcomes', 'source', 'succeeded', 'total']);
  });

  it('does not echo the orchestrator’s organizationId back to the caller', async () => {
    ingestLeadBatch.mockResolvedValue({ ...OK, organizationId: ORG_A });
    const res = await call();
    expect(res._json.organizationId).toBeUndefined();
  });

  it('surfaces per-record failures as outcomes, not as an error', async () => {
    ingestLeadBatch.mockResolvedValue({
      source: 'crm', total: 2, succeeded: 1, failed: 1,
      outcomes: [{ status: 'ingested' }, { status: 'rejected', rejection: 'normalization_failed' }],
    });
    const res = await call();
    expect(res._status).toBe(200);
    expect(res._json.failed).toBe(1);
  });

  it('an orchestrator throw propagates safely as a 400, not a 500 leak', async () => {
    ingestLeadBatch.mockRejectedValue(new Error('bad envelope'));
    const res = await call();
    expect(res._status).toBe(400);
    expect(String(res._json.error)).toBe('bad envelope');
  });
});

/**
 * P2N — the twelve P2D firmographics actually reach the orchestrator.
 *
 * CRM inherits the firmographic surface through the TYPE
 * (`CrmLeadInput = Omit<ManualLeadInput, 'referenceId'> & { externalId }`), and
 * types are erased at runtime — so inheritance proves nothing about what this
 * HTTP route forwards. The existing pass-through test uses a three-field record
 * and would still pass if a `pick()` were introduced that happened to keep
 * those three. These tests would not.
 *
 * The route's job ends at forwarding; normalisation is `toAccountAttributes`'
 * job and is proven in the P2D suite.
 */
describe('LI-5E.4 — the twelve firmographics reach the orchestrator', () => {
  const RECORD = {
    externalId: 'CRM-9',
    email: 'ops@acme.test',
    companyName: 'Acme',
    companyDomain: 'acme.test',
    ...FIRMOGRAPHICS,
  };

  /** A fresh copy each time, so the assertions compare VALUES, not one object to itself. */
  const forwarded = async (): Promise<Record<string, unknown>> => {
    await call({ body: { records: [{ ...RECORD }] } } as Partial<NextApiRequest>);
    return ingestLeadBatch.mock.calls[0][0].records[0] as Record<string, unknown>;
  };

  it.each(FIRMOGRAPHIC_ENTRIES)('forwards %s verbatim to ingestLeadBatch', async (field, value) => {
    expect((await forwarded())[field]).toEqual(value);
  });

  it('forwards all twelve on ONE record, and drops nothing else either', async () => {
    const sent = await forwarded();
    // The assertion that catches an allowlist: a `pick()` or a fixed
    // destructuring produces a NARROWER key set, and this fails naming the
    // missing keys rather than silently passing on the subset that survived.
    expect(Object.keys(sent).sort()).toEqual(Object.keys(RECORD).sort());
    expect(sent).toEqual(RECORD);
  });

  it('forwards them UNNORMALISED — the route transports, it does not interpret', async () => {
    const sent = await forwarded();
    expect(sent.employeeCount).toBe('250');                       // still a string, not 250
    expect(sent.annualRevenue).toBe('12500000');
    expect(sent.foundedYear).toBe('2014');
    expect(sent.companyCountryCode).toBe('us');                   // still lowercase, not 'US'
    expect(sent.lastFundingAt).toBe('2026-01-15T10:30:00Z');      // not a UTC-normalised instant
    expect(sent.technologies).toEqual(['postgres', 'nextjs']);    // still an array, not JSON text
  });

  it('the CRM external id still travels alongside the firmographics', async () => {
    // The firmographics must not displace the record's provenance identity,
    // which is what makes a re-submission idempotent rather than a duplicate.
    const sent = await forwarded();
    expect(sent.externalId).toBe('CRM-9');
    expect(ingestLeadBatch.mock.calls[0][0].source).toBe('crm');
  });
});
