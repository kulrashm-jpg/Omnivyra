/**
 * /api/admin/credits/company-wallet — unit test
 *
 * Verifies the composite wallet endpoint:
 *   - 401/403 enforcement
 *   - 400 on missing orgId
 *   - 200 + composite payload on success
 */

jest.mock('../../services/requestAccessService', () => ({
  requireAuthenticatedInternalUser: jest.fn(),
}));
jest.mock('../../services/billing/financeRbacService', () => ({
  isFinanceAuditor: jest.fn(),
}));
jest.mock('../../services/billing/payments/billingWalletService', () => ({
  getBillingWalletSnapshot: jest.fn(),
}));
jest.mock('../../services/billing/contracts/usageForecastingService', () => ({
  forecastUsage:           jest.fn(),
  detectBurnRateAnomaly:   jest.fn(),
}));
jest.mock('../../services/billing/contracts/invoiceProjectionEngine', () => ({
  projectInvoice: jest.fn(),
}));
jest.mock('../../services/billing/contracts/enterpriseContractResolver', () => ({
  resolveActiveContract: jest.fn(),
}));
jest.mock('../../services/billing/billingFeatureFlags', () => ({
  evaluateAllBillingFlags: jest.fn(),
}));
jest.mock('../../services/billing/orgFinancialControlService', () => ({
  checkFinancialControls: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import handler from '../../../pages/api/admin/credits/company-wallet';
import * as access from '../../services/requestAccessService';
import * as rbac from '../../services/billing/financeRbacService';
import * as wallet from '../../services/billing/payments/billingWalletService';
import * as forecast from '../../services/billing/contracts/usageForecastingService';
import * as invoice from '../../services/billing/contracts/invoiceProjectionEngine';
import * as contracts from '../../services/billing/contracts/enterpriseContractResolver';
import * as flags from '../../services/billing/billingFeatureFlags';
import * as control from '../../services/billing/orgFinancialControlService';
import { supabase } from '../../db/supabaseClient';

type AnyMock = jest.Mock;
type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
  const res: Res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('/api/admin/credits/company-wallet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'u1' });
  });

  it('returns 403 when caller lacks auditor', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValueOnce(false);
    const res = makeRes();
    await handler({ method: 'GET', query: { orgId: 'o' } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 400 on missing orgId', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValueOnce(true);
    const res = makeRes();
    await handler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns composite payload', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValueOnce(true);
    (wallet.getBillingWalletSnapshot as AnyMock).mockResolvedValueOnce({
      freeBalance: 100, paidBalance: 50, incentiveBalance: 25,
      reservedFree: 0, reservedPaid: 0, reservedIncentive: 0,
      lifetimePurchased: 200, lifetimeConsumed: 25,
      creditRateUsd: 0.01, totalAvailable: 175, estimatedUsdValue: 1.75,
      lastTransactionAt: '2026-05-15T00:00:00Z',
    });
    (forecast.forecastUsage as AnyMock).mockResolvedValueOnce({
      observedCredits: 30, projectedCredits: 200, dailyBurnRate: 5,
      daysRemaining: 15, isAccelerating: false,
    });
    (forecast.detectBurnRateAnomaly as AnyMock).mockResolvedValueOnce({ anomaly: false });
    (invoice.projectInvoice as AnyMock).mockResolvedValueOnce({
      projectedTotalUsd: 2.0, currency: 'USD',
      contract: { id: '', number: '', status: 'none', allotment: 0 },
      lineItems: [],
    });
    (contracts.resolveActiveContract as AnyMock).mockResolvedValueOnce(null);
    (flags.evaluateAllBillingFlags as AnyMock).mockResolvedValueOnce({
      'billing.ai_enforced': { enabled: false, reason: 'flag_disabled' },
    });
    (control.checkFinancialControls as AnyMock).mockResolvedValueOnce({
      allowed: true, emergencyFreeze: false, billingLock: false,
    });
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { open_holds: 0, holds_older_1h: 0, holds_older_6h: 0, holds_older_24h: 0, total_reserved: 0 },
            error: null,
          }),
        }),
      }),
    });

    const res = makeRes();
    await handler({ method: 'GET', query: { orgId: 'o1' } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.organizationId).toBe('o1');
    expect(body.wallet.totalAvailable).toBe(175);
    expect(body.reservations.openHolds).toBe(0);
    expect(body.financialControls.allowed).toBe(true);
  });
});
