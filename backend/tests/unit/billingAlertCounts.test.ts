/**
 * /api/super-admin/billing-alert-counts — RBAC + aggregation tests
 *
 * Powers the Credits & Billing nav badge. Must:
 *   - 403 for non-FINANCE_AUDITOR
 *   - sum low-balance orgs + pending approvals + anomalies + frozen orgs
 *   - compute low-balance using available (balance − reserved) per category
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/requestAccessService', () => ({
  requireAuthenticatedInternalUser: jest.fn(),
}));
jest.mock('../../services/billing/financeRbacService', () => ({
  isFinanceAuditor: jest.fn(),
}));

import handler from '../../../pages/api/super-admin/billing-alert-counts';
import { supabase } from '../../db/supabaseClient';
import * as access from '../../services/requestAccessService';
import * as rbac from '../../services/billing/financeRbacService';

type AnyMock = jest.Mock;
type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
  const res: Res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

/**
 * The handler issues 4 parallel queries via supabase.from(...):
 *   credit_action_approvals (count head)
 *   cost_anomalies          (count head)
 *   org_controls            (count head)
 *   organization_credits    (.limit(1000) → wallet rows)
 */
function installSupabase(opts: {
  pendingCount: number;
  anomalyCount: number;
  frozenCount: number;
  wallets: Array<Record<string, number>>;
}) {
  (supabase.from as AnyMock).mockImplementation((table: string) => {
    if (table === 'organization_credits') {
      return { select: () => ({ limit: () => Promise.resolve({ data: opts.wallets, error: null }) }) };
    }
    const count =
      table === 'credit_action_approvals' ? opts.pendingCount :
      table === 'cost_anomalies'          ? opts.anomalyCount :
      table === 'org_controls'            ? opts.frozenCount : 0;
    // count-head chains: .select(...,{count,head}).eq()/.in()/.gte() → resolves
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq:     () => Promise.resolve({ count, error: null }),
      in:     () => chain,
      gte:    () => Promise.resolve({ count, error: null }),
      then:   (r: (v: unknown) => unknown) => Promise.resolve({ count, error: null }).then(r),
    };
    return chain;
  });
}

describe('billing-alert-counts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'u1' });
  });

  it('403 when not FINANCE_AUDITOR', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValueOnce(false);
    const res = makeRes();
    await handler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('405 on non-GET', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('sums all alert sources; low-balance uses available (balance − reserved)', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValue(true);
    installSupabase({
      pendingCount: 3,
      anomalyCount: 2,
      frozenCount: 1,
      wallets: [
        // available = (100-0)+(0)+(0) = 100  → NOT low (threshold default 100, strict <)
        { free_balance: 100, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0 },
        // available = (50-40)+(0)+(0) = 10   → LOW
        { free_balance: 50, paid_balance: 0, incentive_balance: 0, reserved_free: 40, reserved_paid: 0, reserved_incentive: 0 },
        // available = (0)+(0)+(0) = 0        → LOW
        { free_balance: 0, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0 },
      ],
    });
    const res = makeRes();
    await handler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.counts.pendingApprovals).toBe(3);
    expect(body.counts.anomalyCount).toBe(2);
    expect(body.counts.frozenOrgs).toBe(1);
    expect(body.counts.lowBalanceOrgs).toBe(2);          // the 10 and the 0
    expect(body.total).toBe(3 + 2 + 1 + 2);
  });

  it('respects a custom lowBalanceThreshold', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValue(true);
    installSupabase({
      pendingCount: 0, anomalyCount: 0, frozenCount: 0,
      wallets: [
        { free_balance: 500, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0 },
      ],
    });
    const res = makeRes();
    await handler({ method: 'GET', query: { lowBalanceThreshold: '1000' } } as any, res as any);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.counts.lowBalanceOrgs).toBe(1); // 500 < 1000
  });
});
