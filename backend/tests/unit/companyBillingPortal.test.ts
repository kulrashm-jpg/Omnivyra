/**
 * Company Billing Portal — isolation + RBAC tests
 *
 * The single most important property: a company user can NEVER read another
 * org's billing data. This is enforced by assertOrgAccess (which writes
 * 401/403/404 + audit and returns null on rejection). These tests assert the
 * endpoints DO NOT proceed when assertOrgAccess denies, and DO pin every
 * query to the validated companyId.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/requestAccessService', () => ({
  assertOrgAccess: jest.fn(),
  requireAdminRateLimit: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../services/billing/payments/billingWalletService', () => ({
  getBillingWalletSnapshot: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/billing/contracts/usageForecastingService', () => ({
  forecastUsage: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/billing/contracts/invoiceProjectionEngine', () => ({
  projectInvoice: jest.fn().mockResolvedValue({ projectedTotalUsd: 0, currency: 'USD', lineItems: [] }),
}));
jest.mock('../../services/billing/contracts/enterpriseContractResolver', () => ({
  resolveActiveContract: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/billing/payments/subscriptionProjectionService', () => ({
  projectOrgSubscriptions: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/billing/billingFeatureFlags', () => ({
  evaluateAllBillingFlags: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../middleware/withIdempotency', () => ({
  withIdempotency: <T,>(h: T) => h,
}));
jest.mock('../../services/billing/exports/ledgerExportService', () => ({
  exportCompanyUsage: jest.fn().mockResolvedValue({ body: 'a,b\n1,2', rowCount: 1, manifest: { manifestId: 'm1', contentSha256: 'sha' } }),
  exportReservationLifecycle: jest.fn().mockResolvedValue({ body: '[]', rowCount: 0, manifest: { manifestId: 'm2', contentSha256: 'sha2' } }),
}));

import summaryHandler from '../../../pages/api/company/billing/summary';
import ledgerHandler from '../../../pages/api/company/billing/ledger';
import exportHandler from '../../../pages/api/company/billing/export';
import { supabase } from '../../db/supabaseClient';
import * as access from '../../services/requestAccessService';

type AnyMock = jest.Mock;
type Res = { status: jest.Mock; json: jest.Mock };

function makeRes(): Res {
  const res: Res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

/** Chainable supabase mock that records every .eq() filter applied. */
function installSupabase(captured: Array<[string, unknown]>) {
  (supabase.from as AnyMock).mockImplementation(() => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { captured.push([col, val]); return chain; },
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      range: () => Promise.resolve({ data: [], error: null, count: 0 }),
      limit: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
    };
    return chain;
  });
}

describe('Company billing portal — org isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('summary: 400 when companyId missing', async () => {
    const res = makeRes();
    await summaryHandler({ method: 'GET', query: {} } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('summary: does NOT proceed when assertOrgAccess denies (cross-org blocked)', async () => {
    // assertOrgAccess writes its own 403 + returns null
    (access.assertOrgAccess as AnyMock).mockResolvedValueOnce(null);
    const res = makeRes();
    await summaryHandler({ method: 'GET', query: { companyId: 'other-org' } } as any, res as any);
    // Handler must not call getBillingWalletSnapshot etc — it returns early.
    const wallet = jest.requireMock('../../services/billing/payments/billingWalletService') as { getBillingWalletSnapshot: AnyMock };
    expect(wallet.getBillingWalletSnapshot).not.toHaveBeenCalled();
  });

  it('summary: proceeds + pins queries to the validated companyId', async () => {
    (access.assertOrgAccess as AnyMock).mockResolvedValueOnce({ userId: 'u1', superAdmin: false });
    const captured: Array<[string, unknown]> = [];
    installSupabase(captured);
    const res = makeRes();
    await summaryHandler({ method: 'GET', query: { companyId: 'my-org' } } as any, res as any);
    // Every organization_id filter must equal the validated companyId.
    const orgFilters = captured.filter(([c]) => c === 'organization_id');
    expect(orgFilters.length).toBeGreaterThan(0);
    expect(orgFilters.every(([, v]) => v === 'my-org')).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('ledger: cross-org request blocked by assertOrgAccess (no rows leaked)', async () => {
    (access.assertOrgAccess as AnyMock).mockResolvedValueOnce(null);
    const res = makeRes();
    await ledgerHandler({ method: 'GET', query: { companyId: 'victim-org' } } as any, res as any);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('ledger: query is hard-pinned to organization_id = validated companyId', async () => {
    (access.assertOrgAccess as AnyMock).mockResolvedValueOnce({ userId: 'u1', superAdmin: false });
    const captured: Array<[string, unknown]> = [];
    installSupabase(captured);
    const res = makeRes();
    await ledgerHandler({ method: 'GET', query: { companyId: 'my-org' } } as any, res as any);
    const orgFilters = captured.filter(([c]) => c === 'organization_id');
    expect(orgFilters.length).toBeGreaterThan(0);
    expect(orgFilters.every(([, v]) => v === 'my-org')).toBe(true);
  });

  it('export: rejects export type not in the company allowlist', async () => {
    (access.assertOrgAccess as AnyMock).mockResolvedValueOnce({ userId: 'u1', superAdmin: false });
    const res = makeRes();
    await exportHandler(
      { method: 'POST', headers: {}, body: { companyId: 'my-org', exportType: 'ledger', format: 'csv' } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(String(body.error)).toMatch(/exportType must be one of/);
  });

  it('export: cross-org blocked before any export runs', async () => {
    (access.assertOrgAccess as AnyMock).mockResolvedValueOnce(null);
    const res = makeRes();
    await exportHandler(
      { method: 'POST', headers: {}, body: { companyId: 'victim', exportType: 'company_usage', format: 'csv' } } as any,
      res as any,
    );
    const exp = jest.requireMock('../../services/billing/exports/ledgerExportService') as { exportCompanyUsage: AnyMock };
    expect(exp.exportCompanyUsage).not.toHaveBeenCalled();
  });

  it('export: company_usage succeeds + returns manifest for own org', async () => {
    (access.assertOrgAccess as AnyMock).mockResolvedValueOnce({ userId: 'u1', superAdmin: false });
    const res = makeRes();
    await exportHandler(
      { method: 'POST', headers: {}, body: { companyId: 'my-org', exportType: 'company_usage', format: 'csv' } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as AnyMock).mock.calls[0][0];
    expect(body.ok).toBe(true);
    expect(body.manifest.contentSha256).toBe('sha');
    const exp = jest.requireMock('../../services/billing/exports/ledgerExportService') as { exportCompanyUsage: AnyMock };
    // organizationId passed to the export service must be the validated org.
    expect(exp.exportCompanyUsage.mock.calls[0][0].organizationId).toBe('my-org');
  });
});
