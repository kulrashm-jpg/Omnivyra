/**
 * Billing Wallet Service — Phase E
 *
 * Read-side wallet projection used by billing surfaces (invoicing,
 * dashboards, subscription renewal). Distinct from `creditReadService`
 * which serves the user-facing org credit summary — this one is finance-
 * oriented and joins wallet state to recent payment / invoice / approval
 * activity for a single org snapshot.
 *
 * Write paths NEVER flow through this service — wallet mutations are
 * exclusively through `apply_credit_reservation` via the orchestrator.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export interface BillingWalletSnapshot {
  organizationId:       string;
  freeBalance:          number;
  paidBalance:          number;
  incentiveBalance:     number;
  reservedFree:         number;
  reservedPaid:         number;
  reservedIncentive:    number;
  lifetimePurchased:    number;
  lifetimeConsumed:     number;
  creditRateUsd:        number;
  totalAvailable:       number;
  estimatedUsdValue:    number;
  lastTransactionAt:    string | null;
}

export async function getBillingWalletSnapshot(orgId: string): Promise<BillingWalletSnapshot | null> {
  const { data: wallet, error } = await supabase
    .from('organization_credits')
    .select(`
      free_balance, paid_balance, incentive_balance,
      reserved_free, reserved_paid, reserved_incentive,
      lifetime_purchased, lifetime_consumed, credit_rate_usd, updated_at
    `)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) {
    logger.warn('billing_wallet_read_failed', { orgId, message: error.message });
    return null;
  }
  if (!wallet) return null;

  const w = wallet as Record<string, unknown>;
  const free      = Number(w.free_balance ?? 0);
  const paid      = Number(w.paid_balance ?? 0);
  const incentive = Number(w.incentive_balance ?? 0);
  const reservedFree      = Number(w.reserved_free ?? 0);
  const reservedPaid      = Number(w.reserved_paid ?? 0);
  const reservedIncentive = Number(w.reserved_incentive ?? 0);
  const rate = Number(w.credit_rate_usd ?? 0.01);

  const totalAvailable =
    Math.max(0, free - reservedFree) +
    Math.max(0, paid - reservedPaid) +
    Math.max(0, incentive - reservedIncentive);

  const { data: lastTx } = await supabase
    .from('credit_transactions')
    .select('created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    organizationId:    orgId,
    freeBalance:       free,
    paidBalance:       paid,
    incentiveBalance:  incentive,
    reservedFree, reservedPaid, reservedIncentive,
    lifetimePurchased: Number(w.lifetime_purchased ?? 0),
    lifetimeConsumed:  Number(w.lifetime_consumed ?? 0),
    creditRateUsd:     rate,
    totalAvailable,
    estimatedUsdValue: totalAvailable * rate,
    lastTransactionAt: (lastTx as { created_at?: string } | null)?.created_at ?? null,
  };
}

export interface BillingWalletAggregate {
  totalOrgs:               number;
  totalAvailableCredits:   number;
  totalAvailableUsd:       number;
  totalReservedCredits:    number;
  topByConsumption:        Array<{ organizationId: string; lifetimeConsumed: number }>;
}

export async function getPortfolioWalletAggregate(limit = 100): Promise<BillingWalletAggregate> {
  const { data, error } = await supabase
    .from('organization_credits')
    .select('organization_id, free_balance, paid_balance, incentive_balance, reserved_free, reserved_paid, reserved_incentive, lifetime_consumed, credit_rate_usd')
    .limit(limit);
  if (error) {
    logger.error('billing_wallet_aggregate_failed', { message: error.message });
    return { totalOrgs: 0, totalAvailableCredits: 0, totalAvailableUsd: 0, totalReservedCredits: 0, topByConsumption: [] };
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  let totalAvail = 0, totalUsd = 0, totalReserved = 0;
  const consumption: Array<{ organizationId: string; lifetimeConsumed: number }> = [];
  for (const r of rows) {
    const free = Number(r.free_balance ?? 0);
    const paid = Number(r.paid_balance ?? 0);
    const inc  = Number(r.incentive_balance ?? 0);
    const rf   = Number(r.reserved_free ?? 0);
    const rp   = Number(r.reserved_paid ?? 0);
    const ri   = Number(r.reserved_incentive ?? 0);
    const rate = Number(r.credit_rate_usd ?? 0.01);
    const avail = Math.max(0, free - rf) + Math.max(0, paid - rp) + Math.max(0, inc - ri);
    totalAvail    += avail;
    totalUsd      += avail * rate;
    totalReserved += rf + rp + ri;
    consumption.push({ organizationId: String(r.organization_id), lifetimeConsumed: Number(r.lifetime_consumed ?? 0) });
  }
  consumption.sort((a, b) => b.lifetimeConsumed - a.lifetimeConsumed);
  return {
    totalOrgs:             rows.length,
    totalAvailableCredits: totalAvail,
    totalAvailableUsd:     totalUsd,
    totalReservedCredits:  totalReserved,
    topByConsumption:      consumption.slice(0, 10),
  };
}
