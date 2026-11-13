/**
 * Preemption follow-ups (e9, owner rule; found in 6f's review of 55's S2 package):
 *  1. The 500 branch echoed err.message to the client - which can carry internal detail (table names, tenant-seam
 *     text). Now: logged, answered with a generic message.
 *  2. The request fetch mapped `fetchError || !request` to 404: a FAILED read became a permanent "not found". Now a
 *     failed read -> 503 + Retry-After (retryable); only a read that finds no row is 404.
 * Real route; the DB read, company access and the service are faked. The fake mirrors PostgREST (maybeSingle resolves
 * { data, error }, never throws).
 */
type Res = { data: unknown; error: { message: string } | null };
const st: { fetch: Res; reject: () => Promise<void>; rejected: string[] } = {
  fetch: { data: { id: 'req-1', initiator_campaign_id: 'camp-1' }, error: null },
  reject: async () => undefined,
  rejected: [],
};

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: () => { const b: any = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => st.fetch; return b; } },
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-1' }) }));
jest.mock('../../services/CampaignPreemptionService', () => {
  class PreemptionValidationError extends Error {}
  return {
    PreemptionValidationError,
    rejectPreemptionRequest: async (id: string) => { await st.reject(); st.rejected.push(id); },
  };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const handler = require('../../../pages/api/campaigns/reject-preemption').default;

function call() {
  const out: any = { status: 0, body: null, headers: {} as Record<string, string> };
  const res: any = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    setHeader(k: string, v: string) { out.headers[k] = v; return res; },
  };
  return Promise.resolve(handler({ method: 'POST', body: { requestId: 'req-1', companyId: 'co-1' } } as any, res)).then(() => out);
}

let errSpy: jest.SpyInstance;
beforeEach(() => {
  st.fetch = { data: { id: 'req-1', initiator_campaign_id: 'camp-1' }, error: null };
  st.reject = async () => undefined;
  st.rejected = [];
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('a FAILED request read -> 503 + Retry-After (retryable), nothing rejected', async () => {
  st.fetch = { data: null, error: { message: 'connection reset' } };
  const r = await call();
  expect(r.status).toBe(503);
  expect(r.headers['Retry-After']).toBe('5');
  expect(r.body).toMatchObject({ retryable: true });
  expect(st.rejected).toEqual([]);
});

it('CONTROL: a read that finds no request -> 404 (a real absence)', async () => {
  st.fetch = { data: null, error: null };
  const r = await call();
  expect(r.status).toBe(404);
  expect(st.rejected).toEqual([]);
});

it('an unexpected error -> 500 with a GENERIC message; the internal text is logged, never sent', async () => {
  st.reject = async () => { throw new Error('campaign_preemption_requests: parent campaigns unreadable (57014)'); };
  const r = await call();
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ error: 'Internal server error' });
  expect(JSON.stringify(r.body)).not.toContain('campaign_preemption_requests');
  expect(errSpy).toHaveBeenCalled();                          // the detail is still logged
});

it('CONTROL: the happy path rejects and answers 200', async () => {
  const r = await call();
  expect(r).toMatchObject({ status: 200, body: { status: 'REJECTED', requestId: 'req-1' } });
  expect(st.rejected).toEqual(['req-1']);
});
