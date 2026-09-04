/**
 * LI-5E.2 — the manual ingestion entry point.
 *
 * This route is a transport shell over machinery that is already proven, so the
 * tests are mostly about what it REFUSES. The one that matters most is the
 * tenant: `company_id` comes from the authenticated query parameter and is
 * membership-verified, and a body attempting to name a tenant is rejected
 * outright rather than quietly ignored.
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

import handler from '../../../pages/api/lead-ingestion/manual';
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
    body: { records: [{ referenceId: 'OP-1', email: 'a@x.test' }] },
    url: '/api/lead-ingestion/manual',
    ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res;
};

const OK_RESULT = {
  organizationId: ORG_A, source: 'manual', total: 1, succeeded: 1, failed: 0,
  outcomes: [{ externalId: 'OP-1', ok: true, sourceRecordId: 'sr-1', personId: 'p-1', duplicatesParked: 0 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });   // authorized by default
  ingestLeadBatch.mockResolvedValue(OK_RESULT);
});

describe('LI-5E.2 — authorized ingestion', () => {
  it('an authenticated tenant can invoke manual ingestion', async () => {
    const res = await call();
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ source: 'manual', total: 1, succeeded: 1, failed: 0 });
  });

  it('calls the EXISTING orchestrator with the verified tenant and the manual source', async () => {
    await call();
    expect(ingestLeadBatch).toHaveBeenCalledTimes(1);
    expect(ingestLeadBatch.mock.calls[0][0]).toMatchObject({
      organizationId: ORG_A,
      source: 'manual',
      records: [{ referenceId: 'OP-1', email: 'a@x.test' }],
    });
  });

  it('registers the built-in adapters at module load, not per request', () => {
    // Registration is a module-level side effect, so it happens once at import —
    // before any beforeEach. A jest.fn() call count would be cleared by then.
    expect(registeredAtImport).toBe(1);
  });

  it('passes an ingestionRunId through when supplied', async () => {
    await call({ body: { records: [{ referenceId: 'OP-1', email: 'a@x.test' }], ingestionRunId: 'run-9' } } as Partial<NextApiRequest>);
    expect(ingestLeadBatch.mock.calls[0][0].ingestionRunId).toBe('run-9');
  });

  it('rejects a non-POST method', async () => {
    const res = await call({ method: 'GET' });
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });
});

describe('LI-5E.2 — tenant security', () => {
  it('requires company_id', async () => {
    const res = await call({ query: {} } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(String(res._json.error)).toMatch(/company_id is required/);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-uuid', 'plainly malformed'],
    ['00000000-0000-4000-8000-0000000000a', 'one character short'],
    ["' OR 1=1--", 'an injection attempt'],
    ['', 'empty'],
  ])('refuses a malformed company_id (%s) with 400, never a membership lookup', async (bad) => {
    const res = await call({ query: { company_id: bad } } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    // 400, NOT 403: left to the membership lookup, a malformed uuid raises 22P02,
    // which TenantGuard classifies as NOT_A_MEMBER — telling the caller the tenant
    // exists and refused them, which is a different and misleading claim.
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('does not spend a database round-trip on an unvalidated tenant id', async () => {
    await call({ query: { company_id: 'definitely-not-a-uuid' } } as Partial<NextApiRequest>);
    expect(enforceCompanyAccess).toHaveBeenCalledTimes(0);
  });

  it('refuses a repeated company_id parameter rather than picking one', async () => {
    const res = await call({ query: { company_id: [ORG_A, ORG_B] } } as unknown as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('an unauthenticated request never reaches the adapter', async () => {
    // enforceCompanyAccess writes its own 401 and returns null.
    enforceCompanyAccess.mockResolvedValue(null);
    await call();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('an authorization failure never reaches the adapter', async () => {
    enforceCompanyAccess.mockResolvedValue(null);
    await call({ query: { company_id: ORG_B } } as Partial<NextApiRequest>);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('membership is verified against the company_id actually used', async () => {
    await call({ query: { company_id: ORG_A } } as Partial<NextApiRequest>);
    expect(enforceCompanyAccess.mock.calls[0][0]).toMatchObject({ companyId: ORG_A });
    expect(ingestLeadBatch.mock.calls[0][0].organizationId).toBe(ORG_A);
  });

  it('REFUSES a tenant override in the body rather than ignoring it', async () => {
    for (const key of ['organizationId', 'organization_id', 'companyId', 'company_id']) {
      jest.clearAllMocks();
      enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });
      const res = await call({
        body: { records: [{ referenceId: 'OP-1', email: 'a@x.test' }], [key]: ORG_B },
      } as Partial<NextApiRequest>);
      expect(res._status).toBe(400);
      expect(String(res._json.error)).toMatch(new RegExp(`'${key}' is not accepted in the body`));
      expect(ingestLeadBatch).not.toHaveBeenCalled();
    }
  });

  it('tenant A naming tenant B in the body cannot write to B', async () => {
    const res = await call({
      query: { company_id: ORG_A },
      body: { records: [{ referenceId: 'OP-1', email: 'a@x.test' }], organizationId: ORG_B },
    } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('the route never derives the tenant from the body', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../pages/api/lead-ingestion/manual.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The only companyId assignment reads req.query.
    expect(code).toMatch(/const companyId = typeof req\.query\.company_id/);
    expect(code).not.toMatch(/body\.(organizationId|companyId|company_id)\s*\|\|/);
    expect(code).not.toMatch(/extractTenantIdFromRequest/);
  });
});

describe('LI-5E.2 — input validation', () => {
  const bad = async (body: unknown, status: number, match: RegExp) => {
    const res = await call({ body } as Partial<NextApiRequest>);
    expect(res._status).toBe(status);
    expect(String(res._json.error)).toMatch(match);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  };

  it('rejects a non-object body', () => bad('not-json', 400, /JSON object body/));
  it('rejects a missing records array', () => bad({}, 400, /records must be an array/));
  it('rejects a non-array records', () => bad({ records: 'x' }, 400, /records must be an array/));
  it('rejects an empty batch', () => bad({ records: [] }, 400, /must not be empty/));
  it('rejects a non-object record', () => bad({ records: ['x'] }, 400, /every record must be an object/));

  it('rejects a batch over the existing limit', async () => {
    const res = await call({ body: { records: Array.from({ length: 1001 }, () => ({ email: 'a@x.test' })) } } as Partial<NextApiRequest>);
    expect(res._status).toBe(413);
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });
});

describe('LI-5E.2 — the existing pipeline is reused, not reimplemented', () => {
  it('the route contains no ingestion logic of its own', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../pages/api/lead-ingestion/manual.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No resolver, no provenance, no duplicate handling, no database.
    for (const forbidden of [
      'resolveUnifiedPerson', 'ingestSourceRecord', 'detectAndParkDuplicates',
      'writeExternalIdentityClaims', 'ownedDbTable', 'identity_claims', 'external_keys',
      'unified_persons', 'source_records',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('uses the existing manual source key — no new identity namespace', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../pages/api/lead-ingestion/manual.ts'), 'utf8');
    expect(src).toMatch(/import \{ MANUAL_SOURCE \}/);
    expect(src).not.toMatch(/source: '(apollo|linkedin|rapidapi|crm|csv|xlsx)'/);
  });

  it('invents no second DTO — records pass through unchanged', async () => {
    const record = { referenceId: 'OP-7', email: 'x@y.test', companyDomain: 'acme.test', metadata: { note: 'ok' } };
    await call({ body: { records: [record] } } as Partial<NextApiRequest>);
    expect(ingestLeadBatch.mock.calls[0][0].records[0]).toEqual(record);
  });

  it('activates no provider and performs no network call', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../pages/api/lead-ingestion/manual.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const p of [/\bfetch\s*\(/, /\baxios\b/, /https?:\/\//, /apollo/i, /linkedin/i, /rapidapi/i]) {
      expect(code).not.toMatch(p);
    }
  });
});

describe('LI-5E.2 — response safety and error handling', () => {
  it('returns identifiers, counts and outcomes only — no PII', async () => {
    const res = await call();
    expect(Object.keys(res._json).sort()).toEqual(['failed', 'outcomes', 'source', 'succeeded', 'total']);
    const s = JSON.stringify(res._json);
    expect(s).not.toContain('a@x.test');
    expect(s).not.toContain('@');
  });

  it('does not echo the orchestrator\'s organizationId back to the caller', async () => {
    const res = await call();
    expect(res._json.organizationId).toBeUndefined();
  });

  it('surfaces per-record failures as outcomes, not as an error', async () => {
    ingestLeadBatch.mockResolvedValue({
      organizationId: ORG_A, source: 'manual', total: 2, succeeded: 1, failed: 1,
      outcomes: [
        { externalId: 'OP-1', ok: true, sourceRecordId: 'sr-1', personId: 'p-1' },
        { externalId: null, ok: false, rejection: 'normalization_failed', error: 'bad email' },
      ],
    });
    const res = await call();
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ succeeded: 1, failed: 1 });
  });

  it('an orchestrator throw propagates safely as a 400, not a 500 leak', async () => {
    ingestLeadBatch.mockRejectedValue(new Error('organizationId is required'));
    const res = await call();
    expect(res._status).toBe(400);
    expect(String(res._json.error)).toMatch(/organizationId is required/);
  });

  it('the same submission twice reaches the orchestrator identically — idempotency stays where it is enforced', async () => {
    await call();
    await call();
    expect(ingestLeadBatch).toHaveBeenCalledTimes(2);
    expect(ingestLeadBatch.mock.calls[0][0]).toEqual(ingestLeadBatch.mock.calls[1][0]);
  });
});
