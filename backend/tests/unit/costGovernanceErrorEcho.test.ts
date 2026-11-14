/**
 * e9 owner-rule follow-up (same class as the reject-preemption echo): the cost-governance POST 500 branch returned
 * err.message to the client - internal detail such as "cost_event_insert_failed:<postgres message>" (table /
 * constraint names). Now the detail is logged and the client gets a generic message.
 * Real route; company access and the service are faked.
 */
const st: { record: () => Promise<unknown> } = { record: async () => ({ id: 'ev-1' }) };

jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-1' }) }));
jest.mock('../../services/rbacService', () => ({ getUserRole: async () => ({ role: 'COMPANY_ADMIN', error: null }) }));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({ hasCommunityAiCapability: () => true }));
jest.mock('../../services/realtimePublisherService', () => ({ publishRealtime: async () => undefined }));
jest.mock('../../services/costGovernanceService', () => ({
  evaluateCost: async () => ({ decision: 'allowed', alert_triggered: false }),
  getCostSnapshot: async () => ({}),
  listBudgets: async () => [],
  upsertBudget: async () => ({}),
  recordCost: () => st.record(),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const handler = require('../../../pages/api/active-leads/cost-governance').default;

function post(body: Record<string, unknown>) {
  const out: any = { status: 0, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; }, setHeader() { return res; } };
  return Promise.resolve(handler({ method: 'POST', body, query: {} } as any, res)).then(() => out);
}

let errSpy: jest.SpyInstance;
beforeEach(() => {
  st.record = async () => ({ id: 'ev-1' });
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('an unexpected error -> 500 with a GENERIC message; the internal text is logged, never sent', async () => {
  st.record = async () => { throw new Error('cost_event_insert_failed:duplicate key value violates unique constraint "cost_events_pkey"'); };
  const r = await post({ companyId: 'co-1', action: 'record', category: 'execution', units: 3 });
  expect(r.status).toBe(500);
  expect(r.body).toEqual({ error: 'Cost governance action failed' });
  expect(JSON.stringify(r.body)).not.toMatch(/cost_events|constraint|cost_event_insert_failed/);
  expect(errSpy).toHaveBeenCalledWith('[cost-governance POST] failed:', expect.stringContaining('cost_events_pkey'));
});

it('CONTROL: the happy path records and answers 200', async () => {
  const r = await post({ companyId: 'co-1', action: 'record', category: 'execution', units: 3 });
  expect(r).toMatchObject({ status: 200, body: { ok: true, event: { id: 'ev-1' } } });
});
