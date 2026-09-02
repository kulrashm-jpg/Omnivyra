/**
 * PI-P1-W02 — the CSV ingestion entry point.
 *
 * A transport shell over machinery that is already proven, so these tests are
 * mostly about what it REFUSES. The tenant matters most: `company_id` comes from
 * the authenticated query parameter and is membership-verified, and a body
 * attempting to name a tenant is rejected outright rather than quietly ignored.
 *
 * Two assertions are unique to this route: that it hands the orchestrator the
 * `csv` source, and that it accepts records rather than a file — the approved
 * design parses client-side, so there is no upload path to test because there is
 * no upload path at all.
 */

const enforceCompanyAccess = jest.fn();
const requireCapability = jest.fn();
const trackEvent = jest.fn();
const ingestLeadBatch = jest.fn();
const registerBuiltInLeadSources = jest.fn();
/** The feature gate. Enabled for every existing case; the gate's own tests flip
 *  it, so the disabled path is exercised through the SAME handler. */
let ingestionEnabled = true;

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
}));

jest.mock('../../services/telemetry/telemetryDispatcher', () => ({
  trackEvent: (...a: unknown[]) => trackEvent(...a),
}));

jest.mock('../../services/leadIngestion/orchestrator', () => ({
  ingestLeadBatch: (...a: unknown[]) => ingestLeadBatch(...a),
  isLeadIngestionEnabled: () => ingestionEnabled,
  MAX_BATCH_SIZE: 1000,
}));

jest.mock('../../services/leadIngestion', () => ({
  registerBuiltInLeadSources: () => registerBuiltInLeadSources(),
}));

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import handler from '../../../pages/api/lead-ingestion/csv';
import { PROSPECT_INGEST } from '../../../shared/contracts/security';
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
    body: { records: [{ email: 'dana@example.com' }] },
    url: '/api/lead-ingestion/csv',
    ...over,
  } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res;
};

const OK = { source: 'csv', total: 1, succeeded: 1, failed: 0, outcomes: [{ externalId: 'csv:abc', status: 'ingested' }] };

beforeEach(() => {
  jest.clearAllMocks();
  ingestionEnabled = true;
  enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });
  requireCapability.mockResolvedValue({ ok: true, principal: { userId: 'u-1' } });
  ingestLeadBatch.mockResolvedValue(OK);
});

describe('PI-P1-W02 — the feature gate', () => {
  it('disabled: 404 with exactly the two-field disabled contract', async () => {
    ingestionEnabled = false;
    const res = await call();
    expect(res._status).toBe(404);
    expect(res._json).toEqual({
      error: 'Lead ingestion is not enabled.',
      code: 'LEAD_INGESTION_DISABLED',
    });
  });

  it('disabled: authentication is never reached, so no membership lookup is spent', async () => {
    ingestionEnabled = false;
    await call();
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('disabled: the method check still comes FIRST — a GET is 405, not 404', async () => {
    ingestionEnabled = false;
    const res = await call({ method: 'GET' });
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
  });

  it('answers with the SAME code as the other entry points — one gate, not one per transport', async () => {
    ingestionEnabled = false;
    expect((await call())._json.code).toBe('LEAD_INGESTION_DISABLED');
  });
});

describe('PI-P1-W02 — the tenant is never taken from the body', () => {
  it('a missing company_id is 400', async () => {
    expect((await call({ query: {} as never }))._status).toBe(400);
  });

  it('a malformed company_id is 400 and never reaches the membership lookup', async () => {
    const res = await call({ query: { company_id: 'not-a-uuid' } as never });
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  it.each(['organizationId', 'organization_id', 'companyId', 'company_id'])(
    'a body carrying %s is REFUSED, not ignored',
    async (key) => {
      const res = await call({ body: { records: [{ email: 'd@e.com' }], [key]: ORG_B } as never });
      expect(res._status).toBe(400);
      expect(String(res._json.error)).toContain(key);
      expect(ingestLeadBatch).not.toHaveBeenCalled();
    },
  );

  it('the orchestrator receives the VERIFIED query tenant', async () => {
    await call();
    expect(ingestLeadBatch).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A }));
  });
});

describe('PI-P1-W02 — authentication and capability', () => {
  it('an unauthenticated request never reaches the orchestrator', async () => {
    // enforceCompanyAccess writes its own 401 and returns null.
    enforceCompanyAccess.mockResolvedValue(null);
    await call();
    expect(requireCapability).not.toHaveBeenCalled();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });

  it('membership is checked BEFORE the capability', async () => {
    const order: string[] = [];
    enforceCompanyAccess.mockImplementation(async () => { order.push('membership'); return { userId: 'u-1' }; });
    requireCapability.mockImplementation(async () => { order.push('capability'); return { ok: true, principal: { userId: 'u-1' } }; });
    await call();
    expect(order).toEqual(['membership', 'capability']);
  });

  it('requires PROSPECT_INGEST, bound to the verified tenant', async () => {
    await call();
    expect(requireCapability).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ capability: PROSPECT_INGEST, organizationId: ORG_A }),
    );
  });

  it('a denied capability stops the request before the orchestrator', async () => {
    requireCapability.mockResolvedValue({ ok: false });
    await call();
    expect(ingestLeadBatch).not.toHaveBeenCalled();
  });
});

describe('PI-P1-W02 — the records contract', () => {
  it('hands the orchestrator the csv source — the reason this route exists', async () => {
    await call();
    expect(ingestLeadBatch).toHaveBeenCalledWith(expect.objectContaining({ source: 'csv' }));
  });

  it('a non-array records is 400', async () => {
    expect((await call({ body: { records: 'a,b,c' } as never }))._status).toBe(400);
  });

  it('an empty batch is 400', async () => {
    expect((await call({ body: { records: [] } as never }))._status).toBe(400);
  });

  it('a batch over the limit is 413', async () => {
    const records = Array.from({ length: 1001 }, () => ({ email: 'd@e.com' }));
    expect((await call({ body: { records } as never }))._status).toBe(413);
  });

  it('a non-object row is 400 — a bare CSV line is not a record', async () => {
    expect((await call({ body: { records: ['dana,scully,d@e.com'] } as never }))._status).toBe(400);
  });

  it('no body is 400', async () => {
    expect((await call({ body: undefined as never }))._status).toBe(400);
  });
});

describe('PI-P1-W02 — the response and telemetry', () => {
  it('returns the orchestrator result verbatim', async () => {
    const res = await call();
    expect(res._status).toBe(200);
    expect(res._json).toEqual(OK);
  });

  it('emits ONE batch event carrying counts only — never a row payload', async () => {
    await call();
    expect(trackEvent).toHaveBeenCalledTimes(1);
    const meta = trackEvent.mock.calls[0][0].metadata;
    expect(meta).toEqual({ source: 'csv', total: 1, succeeded: 1, failed: 0 });
    expect(JSON.stringify(trackEvent.mock.calls[0][0])).not.toContain('dana@example.com');
  });

  it('a refused request emits no telemetry', async () => {
    ingestionEnabled = false;
    await call();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('a malformed batch envelope is 400, not a 500', async () => {
    ingestLeadBatch.mockRejectedValue(new Error('adapter refused'));
    const res = await call();
    expect(res._status).toBe(400);
    expect(res._json.error).toBe('adapter refused');
  });

  it('per-record failures are outcomes, not errors — the batch still returns 200', async () => {
    ingestLeadBatch.mockResolvedValue({
      source: 'csv', total: 2, succeeded: 1, failed: 1,
      outcomes: [{ externalId: 'csv:a', status: 'ingested' }, { externalId: null, status: 'rejected' }],
    });
    const res = await call({ body: { records: [{ email: 'd@e.com' }, { fullName: 'No Identity' }] } as never });
    expect(res._status).toBe(200);
    expect(res._json.failed).toBe(1);
    expect(res._json.succeeded).toBe(1);
  });
});
