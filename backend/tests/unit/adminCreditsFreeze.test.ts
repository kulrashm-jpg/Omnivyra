/**
 * /api/admin/credits/freeze + unfreeze — unit tests
 *
 * Covers:
 *   - 403 when not finance admin
 *   - 400 on missing fields
 *   - 200 + state on success
 *   - audit row is recorded
 */

jest.mock('../../middleware/withIdempotency', () => ({
  withIdempotency: <T,>(handler: T) => handler,
}));
jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit:           jest.fn().mockResolvedValue(true),
  requireAuthenticatedInternalUser: jest.fn(),
}));
jest.mock('../../services/billing/financeRbacService', () => ({
  isFinanceAdmin: jest.fn(),
}));
jest.mock('../../services/billing/orgFinancialControlService', () => ({
  applyFinancialControl: jest.fn(),
}));
jest.mock('../../services/adminAuditService', () => ({
  recordAdminAudit: jest.fn().mockResolvedValue(undefined),
}));

import freezeHandler from '../../../pages/api/admin/credits/freeze';
import unfreezeHandler from '../../../pages/api/admin/credits/unfreeze';
import * as access from '../../services/requestAccessService';
import * as rbac from '../../services/billing/financeRbacService';
import * as control from '../../services/billing/orgFinancialControlService';
import * as audit from '../../services/adminAuditService';

type AnyMock = jest.Mock;
type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
  const res: Res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('/api/admin/credits/freeze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'admin-1' });
  });

  it('returns 403 when caller lacks FINANCE_ADMIN', async () => {
    (rbac.isFinanceAdmin as AnyMock).mockResolvedValueOnce(false);
    const res = makeRes();
    await freezeHandler({ method: 'POST', body: { organizationId: 'o', reason: 'r' }, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 on missing reason', async () => {
    (rbac.isFinanceAdmin as AnyMock).mockResolvedValueOnce(true);
    const res = makeRes();
    await freezeHandler({ method: 'POST', body: { organizationId: 'o', reason: '' }, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('200 on success + audit row', async () => {
    (rbac.isFinanceAdmin as AnyMock).mockResolvedValueOnce(true);
    (control.applyFinancialControl as AnyMock).mockResolvedValueOnce({
      ok: true, state: { emergency_freeze: true, billing_lock: false },
    });
    const res = makeRes();
    await freezeHandler({ method: 'POST', body: { organizationId: 'o', reason: 'suspected_fraud' }, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.state.emergency_freeze).toBe(true);
    expect(audit.recordAdminAudit).toHaveBeenCalled();
    expect((control.applyFinancialControl as AnyMock).mock.calls[0][0].action).toBe('freeze');
  });
});

describe('/api/admin/credits/unfreeze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'admin-1' });
  });

  it('200 on success', async () => {
    (rbac.isFinanceAdmin as AnyMock).mockResolvedValueOnce(true);
    (control.applyFinancialControl as AnyMock).mockResolvedValueOnce({
      ok: true, state: { emergency_freeze: false, billing_lock: false },
    });
    const res = makeRes();
    await unfreezeHandler({ method: 'POST', body: { organizationId: 'o', reason: 'cleared' }, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    expect((control.applyFinancialControl as AnyMock).mock.calls[0][0].action).toBe('unfreeze');
  });
});
