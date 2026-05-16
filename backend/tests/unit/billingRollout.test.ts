/**
 * Billing rollout services — unit tests
 *
 * Covers:
 *   - planPercentageRollout: deterministic bucket assignment
 *   - validateBillingRolloutDependencies: blockers + warnings
 *   - rollbackBillingForOrg: handles enabled flags
 *   - verifyBillingConsistency: composes signals into overallStatus
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../services/billing/jobs/financialIntegrityAuditJob', () => ({
  runFinancialIntegrityAudit: jest.fn(),
}));
jest.mock('../../services/billing/nonBillableRegistry', () => ({
  auditRegistry: jest.fn(),
}));
jest.mock('../../services/featureFlagService', () => ({
  evaluateFeatureFlag: jest.fn(),
  upsertFeatureFlag:   jest.fn(),
  listFeatureFlags:    jest.fn(),
  revertFlag:          jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import {
  planPercentageRollout,
  validateBillingRolloutDependencies,
} from '../../services/billing/rollout/billingRolloutCoordinator';
import { rollbackBillingForOrg } from '../../services/billing/rollout/billingRollbackService';
import { verifyBillingConsistency } from '../../services/billing/rollout/billingConsistencyVerifier';

type AnyMock = jest.Mock;

describe('planPercentageRollout', () => {
  it('produces deterministic bucket assignments for the same salt', () => {
    const ids = ['org-1', 'org-2', 'org-3', 'org-4', 'org-5'];
    const a = planPercentageRollout({ organizationIds: ids, percent: 50, salt: 'test' });
    const b = planPercentageRollout({ organizationIds: ids, percent: 50, salt: 'test' });
    expect(a).toEqual(b);
  });

  it('approximately respects the percent target on large samples', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `org-${i}`);
    const plan = planPercentageRollout({ organizationIds: ids, percent: 30 });
    const selected = plan.filter(p => p.selected).length;
    // 30% of 500 = 150; allow ±10% slop for the deterministic hash distribution
    expect(selected).toBeGreaterThan(120);
    expect(selected).toBeLessThan(180);
  });

  it('clamps percent into [0, 100]', () => {
    const ids = ['a', 'b', 'c'];
    const overshoot = planPercentageRollout({ organizationIds: ids, percent: 200 });
    expect(overshoot.every(p => p.selected)).toBe(true);
    const undershoot = planPercentageRollout({ organizationIds: ids, percent: -1 });
    expect(undershoot.every(p => !p.selected)).toBe(true);
  });
});

describe('validateBillingRolloutDependencies', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks when registry has expired entries', async () => {
    const { evaluateFeatureFlag } = jest.requireMock('../../services/featureFlagService') as { evaluateFeatureFlag: AnyMock };
    const { auditRegistry }       = jest.requireMock('../../services/billing/nonBillableRegistry') as { auditRegistry: AnyMock };
    const { runFinancialIntegrityAudit } = jest.requireMock('../../services/billing/jobs/financialIntegrityAuditJob') as { runFinancialIntegrityAudit: AnyMock };

    evaluateFeatureFlag.mockResolvedValue({ enabled: true, reason: 'flag_enabled' });
    auditRegistry.mockResolvedValue({ expiredCount: 3, missingOwnerCount: 0, missingReasonCount: 0, totalEntries: 10, byCategory: {}, expiringSoonCount: 0, expiredEntries: [] });
    runFinancialIntegrityAudit.mockResolvedValue({
      walletReconciliation: { orgsDrifted: 0, orgsScanned: 10, orgsInSync: 10, drifted: [] },
      reservationState:     { bookKeepingMismatches: 0, expiredHoldsAwaitingReap: 0, stuckOrchestratorCalls: 0, scanned: 0, details: { expiredHoldIds: [], mismatchedOpIds: [], stuckOpIds: [] } },
      orphanUsage:          { orphanCount: 0, scanned: 0, estimatedUntrackedUsd: 0, byOrgTop10: [], byOperationTop10: [] },
      stalePendingApprovals: 0,
      stuckFulfillments:     0,
      overallStatus:        'healthy',
      generatedAt: '2026-05-16T00:00:00Z',
    });
    (supabase.from as AnyMock).mockImplementation(() => chainableMock());

    const r = await validateBillingRolloutDependencies({ organizationId: 'org-1' });
    expect(r.ok).toBe(false);
    expect(r.blockers.some(b => b.startsWith('expired_non_billable_entries'))).toBe(true);
  });
});

/**
 * Returns a chain-fluent mock that's also a Thenable so awaiting it returns
 * `{ count: 0, data: [] }`. Supports `.eq()`, `.lt()`, `.in()`, `.select()`,
 * `.from()` in any order.
 */
function chainableMock(): any {
  const handler = {
    get(target: any, prop: string) {
      if (prop === 'then') return (resolve: any) => Promise.resolve({ count: 0, data: [] }).then(resolve);
      if (prop === 'catch') return (reject: any) => Promise.resolve({ count: 0, data: [] }).catch(reject);
      if (prop === 'finally') return (fn: any) => Promise.resolve({ count: 0, data: [] }).finally(fn);
      return (...args: unknown[]) => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

describe('rollbackBillingForOrg', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reverts only enabled flags from the desired set', async () => {
    const { listFeatureFlags, revertFlag } = jest.requireMock('../../services/featureFlagService') as {
      listFeatureFlags: AnyMock; revertFlag: AnyMock;
    };

    listFeatureFlags.mockResolvedValueOnce([
      { id: 'f1', flag_key: 'billing.ai_enforced', enabled: true },
      { id: 'f2', flag_key: 'billing.reservations_required', enabled: false },
      { id: 'f3', flag_key: 'billing.refine_variant_enabled', enabled: true },
      { id: 'f4', flag_key: 'unrelated.flag', enabled: true },
    ]);
    revertFlag.mockResolvedValue(undefined);

    const r = await rollbackBillingForOrg({
      organizationId: 'org-1',
      actorUserId:    'user-1',
      reason:         'test rollback',
    });

    expect(r.rolledBackFlags).toEqual(expect.arrayContaining(['billing.ai_enforced', 'billing.refine_variant_enabled']));
    expect(r.rolledBackFlags).not.toContain('billing.reservations_required'); // wasn't enabled
    expect(r.rolledBackFlags).not.toContain('unrelated.flag');                 // not in DEFAULT_ROLLBACK_FLAGS
    expect(revertFlag).toHaveBeenCalledTimes(2);
  });
});

describe('verifyBillingConsistency', () => {
  beforeEach(() => jest.clearAllMocks());

  it('overallStatus=pass when all signals pass', async () => {
    const { runFinancialIntegrityAudit } = jest.requireMock('../../services/billing/jobs/financialIntegrityAuditJob') as { runFinancialIntegrityAudit: AnyMock };
    runFinancialIntegrityAudit.mockResolvedValue({
      walletReconciliation: { orgsDrifted: 0, orgsScanned: 10, orgsInSync: 10, drifted: [] },
      reservationState:     { bookKeepingMismatches: 0, expiredHoldsAwaitingReap: 0, stuckOrchestratorCalls: 0, scanned: 0, details: { expiredHoldIds: [], mismatchedOpIds: [], stuckOpIds: [] } },
      orphanUsage:          { orphanCount: 0, scanned: 0, estimatedUntrackedUsd: 0, byOrgTop10: [], byOperationTop10: [] },
      stalePendingApprovals: 0,
      stuckFulfillments:     0,
      overallStatus:        'healthy',
      generatedAt: '2026-05-16T00:00:00Z',
    });
    (supabase.from as AnyMock).mockImplementation(() => chainableMock());

    const r = await verifyBillingConsistency();
    expect(r.overallStatus).toBe('pass');
    expect(r.rollbackRequired).toBe(false);
  });

  it('overallStatus=fail with rollbackRequired=true on drift', async () => {
    const { runFinancialIntegrityAudit } = jest.requireMock('../../services/billing/jobs/financialIntegrityAuditJob') as { runFinancialIntegrityAudit: AnyMock };
    runFinancialIntegrityAudit.mockResolvedValue({
      walletReconciliation: { orgsDrifted: 5, orgsScanned: 10, orgsInSync: 5, drifted: [] },
      reservationState:     { bookKeepingMismatches: 0, expiredHoldsAwaitingReap: 0, stuckOrchestratorCalls: 0, scanned: 0, details: { expiredHoldIds: [], mismatchedOpIds: [], stuckOpIds: [] } },
      orphanUsage:          { orphanCount: 0, scanned: 0, estimatedUntrackedUsd: 0, byOrgTop10: [], byOperationTop10: [] },
      stalePendingApprovals: 0,
      stuckFulfillments:     0,
      overallStatus:        'critical',
      generatedAt: '2026-05-16T00:00:00Z',
    });
    (supabase.from as AnyMock).mockImplementation(() => chainableMock());

    const r = await verifyBillingConsistency();
    expect(r.overallStatus).toBe('fail');
    expect(r.rollbackRequired).toBe(true);
    expect(r.signals.find(s => s.name === 'wallet_ledger_drift_zero')!.passed).toBe(false);
  });
});
