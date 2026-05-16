/**
 * Super Admin Financial Overview + Global Ledger — RBAC + aggregation tests
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/requestAccessService', () => ({
  requireAuthenticatedInternalUser: jest.fn(),
}));
jest.mock('../../services/billing/financeRbacService', () => ({
  isFinanceAuditor: jest.fn(),
}));
jest.mock('../../services/billing/contracts/usageForecastingService', () => ({
  detectBurnRateAnomaly: jest.fn().mockResolvedValue({ anomaly: false }),
}));
jest.mock('../../services/billing/contracts/enterpriseContractResolver', () => ({
  resolveActiveContract: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/billing/orgFinancialControlService', () => ({
  checkFinancialControls: jest.fn().mockResolvedValue({ emergencyFreeze: false, billingLock: false }),
}));

import overviewHandler from '../../../pages/api/super-admin/financial-overview';
import ledgerHandler from '../../../pages/api/super-admin/global-ledger';
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

describe('financial-overview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'u1' });
  });

  it('403 when caller lacks FINANCE_AUDITOR', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValueOnce(false);
    const res = makeRes();
    await overviewHandler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  /**
   * Handler query order:
   *   1. companies            .select('id, name').is('deleted_at', null)
   *   2. company_profiles     .select(...).in('company_id', [...])  (fallback names)
   *   3. organization_credits .select(...).limit(N)
   *   4. credit_transactions  per-row last-tx .eq().order().limit(1).maybeSingle()
   *
   * Key behavior under test: org-3 has a wallet row but is NOT a real active
   * company → it must be EXCLUDED from rows + the count (the "26" bug).
   */
  function installOverviewMocks(opts: {
    companies: Array<{ id: string; name: string | null }>;
    profiles?: Array<{ company_id: string; name: string | null; website_url: string | null }>;
    wallets: Array<Record<string, number | string>>;
  }) {
    (supabase.from as AnyMock).mockImplementation((table: string) => {
      if (table === 'companies') {
        return { select: () => ({ is: () => Promise.resolve({ data: opts.companies, error: null }) }) };
      }
      if (table === 'company_profiles') {
        return { select: () => ({ in: () => Promise.resolve({ data: opts.profiles ?? [], error: null }) }) };
      }
      if (table === 'organization_credits') {
        return { select: () => ({ limit: () => Promise.resolve({ data: opts.wallets, error: null }) }) };
      }
      // credit_transactions last-tx lookup
      return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }) }) };
    });
  }

  it('uses company names, excludes non-company wallet rows, accurate count', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValue(true);
    const controls = jest.requireMock('../../services/billing/orgFinancialControlService') as { checkFinancialControls: AnyMock };
    // Only org-1 + org-2 are real companies; org-3 is an orphan credit row.
    controls.checkFinancialControls
      .mockResolvedValueOnce({ emergencyFreeze: true, billingLock: false })   // org-1
      .mockResolvedValueOnce({ emergencyFreeze: false, billingLock: false }); // org-2

    installOverviewMocks({
      companies: [
        { id: 'org-1', name: 'Acme Corp' },
        { id: 'org-2', name: null },               // falls back to profile / 'Unnamed company'
      ],
      profiles: [
        { company_id: 'org-2', name: 'Beta LLC', website_url: null },
      ],
      wallets: [
        { organization_id: 'org-1', free_balance: 100, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0, lifetime_purchased: 0, lifetime_consumed: 0, credit_rate_usd: 0.01 },
        { organization_id: 'org-2', free_balance: 200, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0, lifetime_purchased: 0, lifetime_consumed: 0, credit_rate_usd: 0.01 },
        { organization_id: 'org-3-orphan', free_balance: 999, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0, lifetime_purchased: 0, lifetime_consumed: 0, credit_rate_usd: 0.01 },
      ],
    });

    const res = makeRes();
    await overviewHandler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];

    // org-3-orphan excluded → count is 2, NOT 3 (the "26" inflation bug)
    expect(body.companies.count).toBe(2);
    expect(body.aggregate.totalOrgs).toBe(2);
    expect(body.aggregate.totalActiveCompanies).toBe(2);
    // names resolved (companies.name then company_profiles.name)
    const byId = Object.fromEntries(body.companies.rows.map((r: any) => [r.organizationId, r.companyName]));
    expect(byId['org-1']).toBe('Acme Corp');
    expect(byId['org-2']).toBe('Beta LLC');
    expect(body.aggregate.frozenCount).toBe(1);
    // aggregate available is summed from the active set only (300, not 1299)
    expect(body.aggregate.totalAvailableCredits).toBe(300);
  });

  it('frozen filter narrows to frozen orgs only', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValue(true);
    const controls = jest.requireMock('../../services/billing/orgFinancialControlService') as { checkFinancialControls: AnyMock };
    controls.checkFinancialControls
      .mockResolvedValueOnce({ emergencyFreeze: true, billingLock: false })
      .mockResolvedValueOnce({ emergencyFreeze: false, billingLock: false });
    installOverviewMocks({
      companies: [{ id: 'org-1', name: 'Acme Corp' }, { id: 'org-2', name: 'Beta LLC' }],
      wallets: [
        { organization_id: 'org-1', free_balance: 100, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0, lifetime_purchased: 0, lifetime_consumed: 0, credit_rate_usd: 0.01 },
        { organization_id: 'org-2', free_balance: 200, paid_balance: 0, incentive_balance: 0, reserved_free: 0, reserved_paid: 0, reserved_incentive: 0, lifetime_purchased: 0, lifetime_consumed: 0, credit_rate_usd: 0.01 },
      ],
    });
    const res = makeRes();
    await overviewHandler({ method: 'GET', query: { status: 'frozen' } } as any, res as any);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.companies.count).toBe(1);
    expect(body.companies.rows[0].organizationId).toBe('org-1');
    expect(body.companies.rows[0].companyName).toBe('Acme Corp');
  });
});

describe('global-ledger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access.requireAuthenticatedInternalUser as AnyMock).mockResolvedValue({ id: 'u1' });
  });

  it('403 when caller lacks FINANCE_AUDITOR', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValueOnce(false);
    const res = makeRes();
    await ledgerHandler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns rows tagged immutable, cross-company by default', async () => {
    (rbac.isFinanceAuditor as AnyMock).mockResolvedValue(true);
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        order: () => ({
          range: () => Promise.resolve({
            data: [{ id: 't1', organization_id: 'org-9', execution_phase: 'confirm', credits_delta: -5 }],
            error: null,
            count: 1,
          }),
        }),
      }),
    });
    const res = makeRes();
    await ledgerHandler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.rows[0].immutable).toBe(true);
    expect(body.totalCount).toBe(1);
  });
});
