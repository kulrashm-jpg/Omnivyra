/**
 * WS-10 — the two prospect route shells.
 *
 * Transport only, so these tests are about what the routes REFUSE and in what
 * ORDER. Three properties matter more than the happy path:
 *   • the tenant is named in the query and NEVER trusted — authorization is the
 *     guard's answer, and it runs before the composer is reached at all;
 *   • a prospect in another tenant is a 404 produced by the composer's own
 *     tenant-scoped read, not by a second ownership check written here;
 *   • an unreadable repository is a 503, never an empty 200 — "there is nothing"
 *     and "we could not look" are different answers.
 */

const requireTenantAccess = jest.fn();
const listProspects = jest.fn();
const getProspectDetail = jest.fn();

jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccess(...a),
}));

jest.mock('../../apiHandlers/prospects/prospectIntelligenceRead', () => ({
  listProspects: (...a: unknown[]) => listProspects(...a),
  getProspectDetail: (...a: unknown[]) => getProspectDetail(...a),
}));

jest.mock('../../../lib/platform/routeFactory', () => ({
  createApiRoute: (h: unknown) => h,
}));

import listHandler from '../../../pages/api/prospects/index';
import detailHandler from '../../../pages/api/prospects/[id]';
import type { NextApiRequest, NextApiResponse } from 'next';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-00000000u001';
const LEAD = 'lead-1';

type Res = NextApiResponse & { _status: number; _json: Record<string, unknown>; _headers: Record<string, string> };

const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {}, _headers: {} };
  r.status = ((c: number) => { (r as Res)._status = c; return r as Res; }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => { (r as Res)._json = b; return r as Res; }) as Res['json'];
  r.setHeader = ((k: string, v: string) => { (r as Res)._headers[k] = v; return r as Res; }) as unknown as Res['setHeader'];
  return r as Res;
};

const req = (query: Record<string, unknown>, method = 'GET') =>
  ({ method, query } as unknown as NextApiRequest);

beforeEach(() => {
  jest.clearAllMocks();
  requireTenantAccess.mockResolvedValue({ userId: USER, companyId: ORG_A });
  listProspects.mockResolvedValue({ version: 'ws10.1', organizationId: ORG_A, rows: [], page: { limit: 25, offset: 0, returned: 0 } });
  getProspectDetail.mockResolvedValue({ version: 'ws10.1', prospectId: LEAD });
});

// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/prospects — authorization comes first', () => {
  it('refuses a non-GET without touching the repository', async () => {
    const res = makeRes();
    await (listHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(req({}, 'POST'), res);
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('GET');
    expect(requireTenantAccess).not.toHaveBeenCalled();
    expect(listProspects).not.toHaveBeenCalled();
  });

  it('requires a named tenant — it is never inferred', async () => {
    const res = makeRes();
    await (listHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(req({}), res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/companyId is required/);
    expect(listProspects).not.toHaveBeenCalled();
  });

  it('a denied guard stops the request BEFORE the repository is read', async () => {
    // The guard writes its own 401/403 and returns null; the route must return.
    requireTenantAccess.mockResolvedValue(null);
    const res = makeRes();
    await (listHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(req({ companyId: ORG_A }), res);
    expect(listProspects).not.toHaveBeenCalled();
    expect(res._status).toBe(0);            // the guard owns the response
  });

  it('passes the NAMED tenant to the guard and to the repository', async () => {
    const res = makeRes();
    await (listHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(req({ companyId: ORG_A }), res);
    expect(requireTenantAccess).toHaveBeenCalledWith(expect.anything(), res, ORG_A);
    expect(listProspects).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A }));
    expect(res._status).toBe(200);
  });

  it('forwards pagination verbatim and invents no default filter', async () => {
    const res = makeRes();
    await (listHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, limit: '10', offset: '20' }), res,
    );
    expect(listProspects).toHaveBeenCalledWith({ organizationId: ORG_A, limit: 10, offset: 20 });
  });

  it('an unreadable repository is 503 retryable, never an empty 200', async () => {
    listProspects.mockRejectedValue(new Error('connection reset'));
    const res = makeRes();
    await (listHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(req({ companyId: ORG_A }), res);
    expect(res._status).toBe(503);
    expect(res._json).toMatchObject({ error: 'prospect_repository_unavailable', retryable: true });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/prospects/:id — authorization, then composition', () => {
  it('a denied guard stops the request before any seam runs', async () => {
    requireTenantAccess.mockResolvedValue(null);
    const res = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD }), res,
    );
    expect(getProspectDetail).not.toHaveBeenCalled();
  });

  it('requires both a named tenant and a prospect id', async () => {
    const noTenant = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(req({ id: LEAD }), noTenant);
    expect(noTenant._status).toBe(400);

    const noId = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(req({ companyId: ORG_A }), noId);
    expect(noId._status).toBe(400);
    expect(getProspectDetail).not.toHaveBeenCalled();
  });

  it('a prospect the tenant cannot read is 404 — the composer decides that', async () => {
    getProspectDetail.mockResolvedValue(null);
    const res = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD }), res,
    );
    expect(res._status).toBe(404);
    expect(res._json.error).toBe('prospect_not_found');
  });

  it('injects a deterministic instant, and forwards a caller-supplied one', async () => {
    const auto = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD }), auto,
    );
    expect(typeof (getProspectDetail.mock.calls[0][0] as { now: string }).now).toBe('string');

    const pinned = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD, asOf: '2026-09-01T00:00:00.000Z' }), pinned,
    );
    expect((getProspectDetail.mock.calls[1][0] as { now: string }).now).toBe('2026-09-01T00:00:00.000Z');
  });

  it('P0/3A: historical intent is forwarded from the PRESENCE of asOf, and the public contract is unchanged', async () => {
    // This route is the only layer that can tell a replay from a live request:
    // after `asOf ?? new Date().toISOString()` both are just a timestamp. So the
    // presence of the parameter travels separately.
    const live = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD }), live,
    );
    const liveArg = getProspectDetail.mock.calls[0][0] as { historicalAsOf?: boolean };
    expect(liveArg.historicalAsOf).toBe(false);
    expect(live._status).toBe(200);

    const replay = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD, asOf: '2026-09-01T00:00:00.000Z' }), replay,
    );
    const replayArg = getProspectDetail.mock.calls[1][0] as { now: string; historicalAsOf?: boolean };
    expect(replayArg.historicalAsOf).toBe(true);
    // Unchanged public contract: same parameter, same forwarded instant, same
    // 200, and nothing named `historicalAsOf` in the response.
    expect(replayArg.now).toBe('2026-09-01T00:00:00.000Z');
    expect(replay._status).toBe(200);
    expect(JSON.stringify(replay._json)).not.toContain('historicalAsOf');
  });

  it('P0/3A: an asOf that happens to be very close to now is STILL historical', async () => {
    // Derived from presence, never from distance. The removed tolerance would
    // have classed this as live.
    const res = makeRes();
    const nearly = new Date(Date.now() - 30_000).toISOString();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD, asOf: nearly }), res,
    );
    const arg = getProspectDetail.mock.calls[0][0] as { historicalAsOf?: boolean };
    expect(arg.historicalAsOf).toBe(true);
  });

  it('an unparseable asOf is refused, not silently replaced with the clock', async () => {
    const res = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD, asOf: 'yesterday' }), res,
    );
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/asOf is not a parseable timestamp/);
    expect(getProspectDetail).not.toHaveBeenCalled();
  });

  it('rejects a negative or non-numeric staleness policy rather than guessing one', async () => {
    for (const bad of ['-1', 'soon']) {
      const res = makeRes();
      await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
        req({ companyId: ORG_A, id: LEAD, stalenessDays: bad }), res,
      );
      expect(res._status).toBe(400);
    }
    expect(getProspectDetail).not.toHaveBeenCalled();
  });

  it('an unreadable composition is 503 retryable', async () => {
    getProspectDetail.mockRejectedValue(new Error('downstream unavailable'));
    const res = makeRes();
    await (detailHandler as never as (q: NextApiRequest, r: Res) => Promise<void>)(
      req({ companyId: ORG_A, id: LEAD }), res,
    );
    expect(res._status).toBe(503);
    expect(res._json).toMatchObject({ error: 'prospect_intelligence_unavailable', retryable: true });
  });

  it('the routes hold no business logic of their own', () => {
    const path = require('path');
    const fs = require('fs');
    for (const f of ['index.ts', '[id].ts']) {
      const code = fs.readFileSync(path.join(__dirname, '../../../pages/api/prospects', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['ownedDbTable', 'mayContact', 'assembleLeadUnderstanding', 'combineScores']) {
        expect(code).not.toContain(forbidden);
      }
    }
  });
});
