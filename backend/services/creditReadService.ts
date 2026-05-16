/**
 * creditReadService — THE single canonical, reconciliation-aware reader for
 * org credit state. `getOrgCreditSummary` here is the ONLY sanctioned
 * org-credit-summary implementation.
 *
 * Do NOT:
 *   • add a second `getOrgCreditSummary` anywhere (the prior duplicate in
 *     consumptionAnalyticsService silently returned zeroed/`null` balances
 *     and bypassed the Phase-D self-heal — it now re-exports from here).
 *   • read `organization_credits` directly for a USER-FACING balance/summary
 *     without going through this module (direct reads skip the gated
 *     projection self-heal; see "Remaining direct readers" in the Phase-F
 *     report for the classified exceptions that are intentionally raw).
 */
import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import {
  reconcileOrgCreditProjection,
  projectionIsBroken,
} from './creditProjectionReconciler';

const CREDIT_COLUMNS =
  'free_balance, paid_balance, incentive_balance, lifetime_purchased, lifetime_consumed, credit_rate_usd';

async function readCreditRow(
  organizationId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await ownedDbTable('organization_credits')
    .select(CREDIT_COLUMNS)
    .eq('organization_id', organizationId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export interface CreditTransaction {
  id: string;
  transaction_type: string;
  credits_delta: number;
  balance_after: number;
  usd_equivalent: number | null;
  reference_type: string | null;
  note: string | null;
  created_at: string;
}

export interface OrgCreditSummary {
  organization_id: string;
  balance_credits: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  credit_rate_usd: number;
  balance_usd_equivalent: number;
  recent_transactions: CreditTransaction[];
}

export async function getOrgCreditSummary(organizationId: string): Promise<OrgCreditSummary | null> {
  let credit = await readCreditRow(organizationId);

  // Gated self-heal: only when the projection is structurally broken (row
  // absent OR impossible negative balances). A healthy row — including a
  // legitimate all-zero one — is left untouched, so normal RPC operation
  // and genuine zero balances are never disturbed.
  if (projectionIsBroken(credit)) {
    const result = await reconcileOrgCreditProjection(organizationId);
    if (result.outcome === 'created_zero') {
      // No ledger activity and no row → genuinely no credit account yet.
      // Surface explicitly (caller maps null → "unavailable"); never faked.
      return null;
    }
    if (result.outcome === 'rebuilt') {
      credit = await readCreditRow(organizationId); // retry read exactly ONCE
    }
    // Still inconsistent after one reconcile + reread → fail explicitly.
    // No infinite retry, no synthesized balances.
    if (projectionIsBroken(credit)) {
      logger.warn('credit_projection_reconcile_failed', {
        organizationId,
        outcome: result.outcome,
      });
      return null;
    }
  }

  if (!credit) return null;

  const { data: txRows } = await ownedDbTable('credit_transactions')
    .select('id, transaction_type, credits_delta, balance_after, usd_equivalent, reference_type, note, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  const c = credit as unknown as {
    free_balance: number;
    paid_balance: number;
    incentive_balance: number;
    lifetime_purchased: number;
    lifetime_consumed: number;
    credit_rate_usd: number;
  };

  const totalBalance = (c.free_balance ?? 0) + (c.paid_balance ?? 0) + (c.incentive_balance ?? 0);

  return {
    organization_id: organizationId,
    balance_credits: totalBalance,
    lifetime_purchased: c.lifetime_purchased,
    lifetime_consumed: c.lifetime_consumed,
    credit_rate_usd: c.credit_rate_usd,
    balance_usd_equivalent: totalBalance * c.credit_rate_usd,
    recent_transactions: (txRows ?? []) as CreditTransaction[],
  };
}
