/**
 * CLASS-2 (e9 sweep, A16): POST /api/whatsapp/broadcasts with enqueue:true creates a broadcast and
 * messages every contact. A double-clicked or re-sent create used to do that TWICE - nothing
 * stood behind it. The route now runs behind the REAL withIdempotency middleware (a reserved key
 * in api_idempotency_keys): a create without an Idempotency-Key is refused before anything is
 * created; a replay of a key is answered from the first request (withIdempotency's own suites).
 * GET (the list) needs no key.
 */
const mockSvc = { create: jest.fn(async () => 'b1') };

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const q: any = {};
      q.select = () => q; q.eq = () => q; q.order = () => q; q.range = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(res);
      return q;
    },
  },
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u1' }) }));
jest.mock('../../services/rbacService', () => ({ Role: { COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' }, enforceRole: async () => true }));
jest.mock('../../services/whatsappBroadcastService', () => ({
  ...jest.requireActual('../../services/whatsappBroadcastService'),
  createBroadcast: (...a: unknown[]) => (mockSvc.create as any)(...a),
  expandRecipients: async () => ({ inserted: 1, skipped: 0 }),
  enqueueBroadcast: async () => ({ batches: 1 }),
  refreshDirtyBroadcastCounts: async () => false,
}));

import route from '../../../pages/api/whatsapp/broadcasts/index';

async function call(req: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  await (route as any)({ headers: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const createBody = { company_id: 'co-a', social_account_id: 'sa1', name: 'Promo', message_type: 'template', template_name: 'tpl', contacts: [{ phone_number: '+14155552671' }], enqueue: true };

beforeEach(() => mockSvc.create.mockClear());

it('a create WITHOUT an Idempotency-Key is refused (400) and nothing is created or sent', async () => {
  const res = await call({ method: 'POST', body: createBody });
  expect(res.statusCode).toBe(400);
  expect(res.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  expect(mockSvc.create).not.toHaveBeenCalled();
});

it('NEGATIVE CONTROL: the list (GET) needs no key', async () => {
  const res = await call({ method: 'GET', query: { company_id: 'co-a' } });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ broadcasts: [] });
});
