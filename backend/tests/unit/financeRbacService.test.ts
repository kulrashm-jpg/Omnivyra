/**
 * financeRbacService — unit tests for Phase 2 D
 *
 * Covers the three role helpers + the dual-control evaluator integration.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/rbacService', () => ({
  isSuperAdmin:         jest.fn().mockResolvedValue(false),
  isPlatformSuperAdmin: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn().mockResolvedValue({ enabled: false, reason: 'flag_disabled' }),
}));

import { supabase } from '../../db/supabaseClient';
import {
  isFinanceAdmin,
  isFinanceApprover,
  isFinanceAuditor,
  evaluateRequiredApprovals,
} from '../../services/billing/financeRbacService';

type AnyMock = jest.Mock;

function stubRoleQuery(rows: Array<{ id: string }>) {
  (supabase.from as AnyMock).mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  });
}

describe('financeRbacService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('isFinanceAdmin returns true when role row exists', async () => {
    stubRoleQuery([{ id: 'r1' }]);
    await expect(isFinanceAdmin('u1')).resolves.toBe(true);
  });

  it('isFinanceAdmin returns false when no role and not super admin', async () => {
    stubRoleQuery([]);
    await expect(isFinanceAdmin('u1')).resolves.toBe(false);
  });

  it('isFinanceAuditor is permissive (admin/approver count as auditor too)', async () => {
    let calls = 0;
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => {
                calls += 1;
                // FINANCE_AUDITOR check returns empty; FINANCE_ADMIN check returns row
                return Promise.resolve({ data: calls === 1 ? [] : [{ id: 'r2' }], error: null });
              },
            }),
          }),
        }),
      }),
    });
    await expect(isFinanceAuditor('u1')).resolves.toBe(true);
  });

  it('isFinanceApprover returns false when no row', async () => {
    stubRoleQuery([]);
    await expect(isFinanceApprover('u1')).resolves.toBe(false);
  });

  it('evaluateRequiredApprovals respects org dual-approval flag', async () => {
    const { evaluateFeatureFlag } = jest.requireMock('../../services/featureFlagService') as { evaluateFeatureFlag: AnyMock };
    evaluateFeatureFlag.mockResolvedValueOnce({ enabled: true, reason: 'flag_enabled' });

    const r = await evaluateRequiredApprovals({ organizationId: 'o', actionType: 'admin_grant', amount: 100 });
    expect(r.required).toBe(2);
    expect(r.reason).toBe('org_dual_approval_required_flag');
  });

  it('evaluateRequiredApprovals falls back to threshold ladder', async () => {
    const { evaluateFeatureFlag } = jest.requireMock('../../services/featureFlagService') as { evaluateFeatureFlag: AnyMock };
    evaluateFeatureFlag.mockResolvedValueOnce({ enabled: false, reason: 'flag_disabled' });
    (supabase.rpc as AnyMock).mockResolvedValueOnce({ data: 3, error: null });

    const r = await evaluateRequiredApprovals({ organizationId: 'o', actionType: 'admin_grant', amount: 100_000 });
    expect(r.required).toBe(3);
    expect(r.reason).toBe('threshold_ladder');
  });
});
