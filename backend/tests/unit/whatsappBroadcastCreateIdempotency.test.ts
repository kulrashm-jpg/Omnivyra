/**
 * CLASS-2 (e9 sweep, A16): POST /api/whatsapp/broadcasts with enqueue:true creates a broadcast and
 * messages every contact. A double-clicked or re-sent create used to do that TWICE - nothing
 * stood behind it. The route now runs behind the REAL withIdempotency middleware (a reserved key
 * in api_idempotency_keys): a create without an Idempotency-Key is refused before anything is
 * created; a replay of a key is answered from the first request (withIdempotency's own suites).
 * GET (the list) needs no key.
 *
 * A refusal that depends on STATE (sending stopped, a disconnected / shared / missing account, an
 * unreadable lookup) is never cached: lifting the condition and re-sending the SAME form must run
 * the create (05). The reservation store is a stateful fake keyed as api_idempotency_keys' unique
 * index (the closure-014 harness).
 */
const mockSvc = { create: jest.fn(async (): Promise<string> => 'b1') };

type KeyRow = Record<string, any>;
const mockKeys: KeyRow[] = [];
function mockKeyTable() {
  const filters: Array<(r: KeyRow) => boolean> = [];
  let patch: KeyRow | null = null;
  const key = (r: KeyRow) => `${r.scope}|${r.caller_id}|${r.idempotency_key}`;
  const api: any = {
    select: () => api,
    insert: (row: KeyRow) => {
      if (mockKeys.some((r) => key(r) === key(row))) { const e: any = new Error('duplicate key'); e.code = '23505'; return Promise.reject(e); }
      mockKeys.push(row); return Promise.resolve({ data: row, error: null });
    },
    update: (p: KeyRow) => { patch = p; return api; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return api; },
    lt: (c: string, v: string) => { filters.push((r) => String(r[c]) < String(v)); return api; },
    is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return api; },
    maybeSingle: () => {
      const m = mockKeys.filter((r) => filters.every((f) => f(r)));
      if (patch) m.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: m[0] ?? null, error: null });
    },
    then: (res: (v: unknown) => unknown) => {
      const m = mockKeys.filter((r) => filters.every((f) => f(r)));
      if (patch) m.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ data: m, error: null }).then(res);
    },
  };
  return api;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => mockKeyTable() }));
jest.mock('../../services/requestContext', () => ({
  getOrCreateRequestId: () => 'req-1',
  runWithRequestContext: (_c: unknown, fn: () => unknown) => fn(),
}));
jest.mock('../../security/IdentityResolver', () => ({ resolvePrincipal: async () => ({ ok: true, principal: { userId: 'u1' } }) }));

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
import { WhatsAppSendStoppedError, WhatsAppSenderAccountError } from '../../services/whatsappBroadcastService';

async function call(req: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  await (route as any)({ headers: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const createBody = { company_id: 'co-a', social_account_id: 'sa1', name: 'Promo', message_type: 'template', template_name: 'tpl', contacts: [{ phone_number: '+14155552671' }], enqueue: true };

beforeEach(() => { mockSvc.create.mockReset(); mockSvc.create.mockImplementation(async () => 'b1'); mockKeys.length = 0; });

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

describe('a refusal that depends on STATE is not replayed: fixing the condition lets the SAME form through (05)', () => {
  const KEY = { 'idempotency-key': 'wa-broadcast-create-k1' };
  it.each([
    ['409 sending stopped (the Super Admin stop)', () => new WhatsAppSendStoppedError('super_admin_stop'), 409],
    ['409 account disconnected', () => new WhatsAppSenderAccountError('disconnected'), 409],
    ['404 account not found', () => new WhatsAppSenderAccountError('not_found'), 404],
    ['503 account lookup unreadable', () => new WhatsAppSenderAccountError('unreadable'), 503],
  ] as const)('%s, then the condition is fixed: the same key RUNS the create', async (_l, refusal, status) => {
    mockSvc.create.mockImplementationOnce(async () => { throw refusal(); });
    const first = await call({ method: 'POST', headers: KEY, body: createBody });
    expect(first.statusCode).toBe(status);
    const again = await call({ method: 'POST', headers: KEY, body: createBody });
    expect(again.statusCode).toBe(201);
    expect(mockSvc.create).toHaveBeenCalledTimes(2);
  });

  it('NEGATIVE CONTROL: a completed create with the same key is REPLAYED, never created twice', async () => {
    const first = await call({ method: 'POST', headers: KEY, body: createBody });
    const again = await call({ method: 'POST', headers: KEY, body: createBody });
    expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
    expect(mockSvc.create).toHaveBeenCalledTimes(1);
  });
});
