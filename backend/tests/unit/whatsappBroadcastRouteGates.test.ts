/**
 * Resume (?action=enqueue) and Retry (?action=retry) are permission-checked exactly as
 * create is (e9, property 4): company access, then a COMPANY_ADMIN / SUPER_ADMIN role gate,
 * before any service call. For the id routes, company access is judged against the
 * BROADCAST's company, loaded by id - never a company the caller names.
 */
const gates = { roleAllowed: true, accessAllowed: true, roleCalls: [] as unknown[][], accessCalls: [] as unknown[] };
const mockSvc = { enqueue: jest.fn(), retry: jest.fn(), create: jest.fn() };

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const q: any = {};
      q.select = () => q; q.eq = () => q;
      q.single = async () => ({ data: { id: 'b1', company_id: 'co-of-broadcast' }, error: null });
      return q;
    },
  },
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: async (a: { companyId: string; res: any }) => {
    gates.accessCalls.push(a.companyId);
    if (!gates.accessAllowed) { a.res.status(403).json({ error: 'forbidden' }); return null; }
    return { userId: 'u1' };
  },
}));
jest.mock('../../services/rbacService', () => ({
  Role: { COMPANY_ADMIN: 'COMPANY_ADMIN', SUPER_ADMIN: 'SUPER_ADMIN' },
  enforceRole: async (a: { allowedRoles: unknown[]; res: any }) => {
    gates.roleCalls.push(a.allowedRoles);
    if (!gates.roleAllowed) { a.res.status(403).json({ error: 'role' }); return false; }
    return true;
  },
}));
jest.mock('../../services/whatsappBroadcastService', () => {
  const actual = jest.requireActual('../../services/whatsappBroadcastService');
  return {
    ...actual,
    enqueueBroadcast: (...a: unknown[]) => mockSvc.enqueue(...a),
    retryFailed: (...a: unknown[]) => mockSvc.retry(...a),
    createBroadcast: (...a: unknown[]) => mockSvc.create(...a),
    expandRecipients: async () => ({ inserted: 1, skipped: 0 }),
  };
});

import createRoute from '../../../pages/api/whatsapp/broadcasts/index';
import idRoute from '../../../pages/api/whatsapp/broadcasts/[id]';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(handler: unknown, req: Record<string, unknown>) {
  const res = mockRes();
  await (handler as (q: unknown, s: unknown) => Promise<void>)({ headers: {}, query: {}, body: {}, ...req }, res);
  return res;
}

const ADMIN_ROLES = ['COMPANY_ADMIN', 'SUPER_ADMIN'];
const resume = () => call(idRoute, { method: 'POST', query: { id: 'b1', action: 'enqueue' }, body: { company_id: 'co-the-caller-names' } });
const retry  = () => call(idRoute, { method: 'POST', query: { id: 'b1', action: 'retry' }, body: { company_id: 'co-the-caller-names' } });
const create = () => call(createRoute, { method: 'POST', body: { company_id: 'co-a', social_account_id: 'sa1', name: 'n', message_type: 'text', body: 'hi' } });

beforeEach(() => {
  gates.roleAllowed = true; gates.accessAllowed = true;
  gates.roleCalls.length = 0; gates.accessCalls.length = 0;
  mockSvc.enqueue.mockReset().mockResolvedValue({ run_id: 'r', batches: 1, recipients: 1 });
  mockSvc.retry.mockReset().mockResolvedValue({ retried: 1 });
  mockSvc.create.mockReset().mockResolvedValue('b-new');
});

describe('Resume and Retry are gated exactly as create', () => {
  it('all three require the same admin roles', async () => {
    await create(); await resume(); await retry();
    expect(gates.roleCalls).toEqual([ADMIN_ROLES, ADMIN_ROLES, ADMIN_ROLES]);
  });

  it('Resume and Retry judge company access against the BROADCAST’s company, not one the caller names', async () => {
    await resume(); await retry();
    expect(gates.accessCalls).toEqual(['co-of-broadcast', 'co-of-broadcast']);
  });

  it.each([['Resume', resume, () => mockSvc.enqueue], ['Retry', retry, () => mockSvc.retry], ['create', create, () => mockSvc.create]] as const)(
    '%s: a caller without the role is refused (403) and the service is never called', async (_n, run, svc) => {
      gates.roleAllowed = false;
      expect((await run()).statusCode).toBe(403);
      expect(svc()).not.toHaveBeenCalled();
    },
  );

  it.each([['Resume', resume, () => mockSvc.enqueue], ['Retry', retry, () => mockSvc.retry]] as const)(
    '%s: a caller without access to the broadcast’s company is refused (403) and the service is never called', async (_n, run, svc) => {
      gates.accessAllowed = false;
      expect((await run()).statusCode).toBe(403);
      expect(svc()).not.toHaveBeenCalled();
    },
  );

  it('NEGATIVE CONTROL: an admin with access reaches the service on every path', async () => {
    await create(); await resume(); await retry();
    expect(mockSvc.create).toHaveBeenCalledTimes(1);
    expect(mockSvc.enqueue).toHaveBeenCalledTimes(1);
    expect(mockSvc.retry).toHaveBeenCalledTimes(1);
  });
});
