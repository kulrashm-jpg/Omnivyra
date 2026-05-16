/**
 * /api/admin/credits/revoke — unit test
 *
 * Covers:
 *   - 403 when not super-admin
 *   - 400 on missing fields
 *   - 202 + approvalId when threshold > 1 (refund always 2-sig)
 *   - 200 + revoke result on auto-approval path
 *   - 400 on revokeCredit failure
 */

jest.mock('../../middleware/withIdempotency', () => ({
  withIdempotency: <T,>(handler: T) => handler,
}));
jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: jest.fn(),
  isSuperAdmin:         jest.fn(),
}));
jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit:           jest.fn().mockResolvedValue(true),
  requireAuthenticatedInternalUser: jest.fn(),
}));
jest.mock('../../services/adminAuditService', () => ({
  recordAdminAudit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/billing', () => ({
  proposeApproval:                 jest.fn(),
  markApprovalExecuted:            jest.fn().mockResolvedValue({ ok: true }),
  recordAdminFinancialOperation:   jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/creditRevoke', () => ({
  revokeCredit: jest.fn(),
}));

import handler from '../../../pages/api/admin/credits/revoke';
import * as rbac from '../../services/rbacService';
import * as access from '../../services/requestAccessService';
import * as billing from '../../services/billing';
import * as revokeMod from '../../services/creditRevoke';

type AnyMock = jest.Mock;
type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
  const res: Res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const baseBody = {
  organizationId: 'org-1',
  credits:        100,
  category:       'free',
  reason:         'fraud correction',
};

describe('/api/admin/credits/revoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'super-1' });
  });

  it('returns 403 for non-super-admin', async () => {
    (rbac.isPlatformSuperAdmin as AnyMock).mockResolvedValueOnce(false);
    (rbac.isSuperAdmin as AnyMock).mockResolvedValueOnce(false);
    const res = makeRes();
    await handler({ method: 'POST', body: baseBody, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 on missing reason', async () => {
    (rbac.isPlatformSuperAdmin as AnyMock).mockResolvedValueOnce(true);
    const res = makeRes();
    await handler({ method: 'POST', body: { ...baseBody, reason: '' }, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 on invalid category', async () => {
    (rbac.isPlatformSuperAdmin as AnyMock).mockResolvedValueOnce(true);
    const res = makeRes();
    await handler({ method: 'POST', body: { ...baseBody, category: 'paid' }, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 202 with approvalId when refund threshold not auto-approved', async () => {
    (rbac.isPlatformSuperAdmin as AnyMock).mockResolvedValueOnce(true);
    (billing.proposeApproval as AnyMock).mockResolvedValueOnce({
      ok: true, approvalId: 'app-99', requiredApprovals: 2, status: 'pending', autoApproved: false,
    });
    const res = makeRes();
    await handler({ method: 'POST', body: baseBody, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(202);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.status).toBe('pending_approval');
    expect(body.approvalId).toBe('app-99');
  });

  it('returns 200 on auto-approved revoke', async () => {
    (rbac.isPlatformSuperAdmin as AnyMock).mockResolvedValueOnce(true);
    (billing.proposeApproval as AnyMock).mockResolvedValueOnce({
      ok: true, approvalId: 'app-100', requiredApprovals: 1, status: 'approved', autoApproved: true,
    });
    (revokeMod.revokeCredit as AnyMock).mockResolvedValueOnce({
      success: true, revoked: 100, requested: 100, idempotencyKey: 'key-xyz', transactionId: 't-1',
    });
    const res = makeRes();
    await handler({ method: 'POST', body: baseBody, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.revoked).toBe(100);
    expect(body.approvalId).toBe('app-100');
    expect(billing.markApprovalExecuted).toHaveBeenCalled();
    expect(billing.recordAdminFinancialOperation).toHaveBeenCalled();
  });

  it('returns 400 on revokeCredit insufficient balance', async () => {
    (rbac.isPlatformSuperAdmin as AnyMock).mockResolvedValueOnce(true);
    (billing.proposeApproval as AnyMock).mockResolvedValueOnce({
      ok: true, approvalId: 'app-101', requiredApprovals: 1, status: 'approved', autoApproved: true,
    });
    (revokeMod.revokeCredit as AnyMock).mockResolvedValueOnce({
      success: false, reason: 'INSUFFICIENT_BALANCE', detail: 'available=10',
    });
    const res = makeRes();
    await handler({ method: 'POST', body: baseBody, headers: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.code).toBe('INSUFFICIENT_BALANCE');
  });
});
