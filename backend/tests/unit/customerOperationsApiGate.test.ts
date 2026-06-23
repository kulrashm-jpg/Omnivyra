/**
 * Phase 13J — capability-gate regression test for GET /api/super-admin/customer-operations.
 * Proves the read endpoint is admin-gated: the cockpit service is never invoked when the
 * capability guard denies, and is invoked (200) when it allows.
 */

const mockRequire = jest.fn();
jest.mock('../../security/requireCapability', () => ({ requireCapability: (...a: any[]) => mockRequire(...a) }));

const mockCockpit = jest.fn();
jest.mock('../../services/customerOperationsCockpitService', () => ({ getCustomerOperations: (...a: any[]) => mockCockpit(...a) }));

import handler from '../../../pages/api/super-admin/customer-operations';

const mkRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => { mockRequire.mockReset(); mockCockpit.mockReset(); });

describe('capability gate', () => {
  it('denied guard → cockpit NOT invoked, no 200', async () => {
    mockRequire.mockResolvedValue({ ok: false });
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as any, res as any);
    expect(mockCockpit).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  it('allowed guard → cockpit invoked, 200 returned', async () => {
    mockRequire.mockResolvedValue({ ok: true });
    mockCockpit.mockResolvedValue({ summary: {}, companies: [] });
    const res = mkRes();
    await handler({ method: 'GET', query: {} } as any, res as any);
    expect(mockCockpit).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('non-GET method → 405, gate not even reached', async () => {
    const res = mkRes();
    await handler({ method: 'POST', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockRequire).not.toHaveBeenCalled();
  });

  it('only whitelisted filter values are forwarded (invalid dropped)', async () => {
    mockRequire.mockResolvedValue({ ok: true });
    mockCockpit.mockResolvedValue({ summary: {}, companies: [] });
    const res = mkRes();
    await handler({ method: 'GET', query: { status: 'ACTIVE', priority: 'BOGUS', search: 'acme' } } as any, res as any);
    const filters = mockCockpit.mock.calls[0][0];
    expect(filters.status).toBe('ACTIVE');
    expect(filters.priority).toBeUndefined(); // invalid enum dropped
    expect(filters.search).toBe('acme');
  });
});
