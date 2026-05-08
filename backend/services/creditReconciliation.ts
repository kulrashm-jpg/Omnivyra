/**
 * Credit Reconciliation
 *
 * Verifies that the per-org wallet (`organization_credits`) matches the
 * sum of its ledger transactions (`credit_transactions`). Drift is the
 * primary financial-trust signal: if balances disagree with the ledger
 * by even one credit, the system has either a bug or an unauthorized
 * mutation, and operators need to know within minutes.
 *
 * Invariants enforced by `apply_credit_reservation`:
 *   - phase='grant'    → balance += amount, lifetime_purchased += amount
 *   - phase='hold'     → balance -= amount, reserved += amount
 *   - phase='confirm'  → reserved -= amount, lifetime_consumed += amount
 *   - phase='release'  → reserved -= amount, balance += amount
 *   - phase='expire'   → free_balance -= amount  (only free)
 *   - phase='expire_incentive' → incentive_balance -= amount (only incentive)
 *
 * Therefore for each category C ∈ {free, paid, incentive}:
 *
 *     C_balance      = grants_C - holds_C + releases_C - confirms_C
 *                       - expires_C
 *     reserved_C     = holds_C - releases_C - confirms_C
 *
 * Aggregate:
 *     lifetime_purchased = SUM of all grant deltas (free + paid + incentive)
 *     lifetime_consumed  = SUM of |confirm deltas| (deltas are negative;
 *                          take absolute value)
 *
 * This module computes both sides and reports the drift.
 */

import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';

export interface ReconciliationDelta {
  free_balance:      number;   // observed - expected; should be 0
  paid_balance:      number;
  incentive_balance: number;
  reserved_free:     number;
  reserved_paid:     number;
  reserved_incentive:number;
  lifetime_purchased:number;
  lifetime_consumed: number;
}

export interface OrgReconciliationReport {
  orgId: string;
  observed: {
    free_balance:      number;
    paid_balance:      number;
    incentive_balance: number;
    reserved_free:     number;
    reserved_paid:     number;
    reserved_incentive:number;
    lifetime_purchased:number;
    lifetime_consumed: number;
  };
  expected: {
    free_balance:      number;
    paid_balance:      number;
    incentive_balance: number;
    reserved_free:     number;
    reserved_paid:     number;
    reserved_incentive:number;
    lifetime_purchased:number;
    lifetime_consumed: number;
  };
  delta: ReconciliationDelta;
  /** True when every delta field is exactly 0. */
  inSync: boolean;
}

export interface ReconciliationSummary {
  orgsScanned: number;
  orgsInSync:  number;
  orgsDrifted: number;
  drifted: ReadonlyArray<OrgReconciliationReport>;
}

interface WalletRow {
  organization_id:    string;
  free_balance:       number | null;
  paid_balance:       number | null;
  incentive_balance:  number | null;
  reserved_free:      number | null;
  reserved_paid:      number | null;
  reserved_incentive: number | null;
  lifetime_purchased: number | null;
  lifetime_consumed:  number | null;
}

interface LedgerRow {
  execution_phase: string | null;
  free_delta:      number | null;
  paid_delta:      number | null;
  incentive_delta: number | null;
}

/**
 * Reconcile a single org. Pure read-only. Returns the observed wallet,
 * the ledger-derived expected balances, and the per-field delta.
 */
export async function reconcileOrg(orgId: string): Promise<OrgReconciliationReport> {
  const [walletRes, ledgerRes] = await Promise.all([
    ownedDbTable('organization_credits')
      .select('organization_id, free_balance, paid_balance, incentive_balance, reserved_free, reserved_paid, reserved_incentive, lifetime_purchased, lifetime_consumed')
      .eq('organization_id', orgId)
      .maybeSingle(),
    ownedDbTable('credit_transactions')
      .select('execution_phase, free_delta, paid_delta, incentive_delta')
      .eq('organization_id', orgId),
  ]);

  const wallet = (walletRes.data ?? null) as WalletRow | null;
  const rows   = (ledgerRes.data ?? []) as LedgerRow[];

  const observed = {
    free_balance:       wallet?.free_balance       ?? 0,
    paid_balance:       wallet?.paid_balance       ?? 0,
    incentive_balance:  wallet?.incentive_balance  ?? 0,
    reserved_free:      wallet?.reserved_free      ?? 0,
    reserved_paid:      wallet?.reserved_paid      ?? 0,
    reserved_incentive: wallet?.reserved_incentive ?? 0,
    lifetime_purchased: wallet?.lifetime_purchased ?? 0,
    lifetime_consumed:  wallet?.lifetime_consumed  ?? 0,
  };

  // Compute expected from the ledger.
  let grantsFree = 0, grantsPaid = 0, grantsIncentive = 0;
  let holdsFree = 0,  holdsPaid = 0,  holdsIncentive = 0;
  let releasesFree = 0, releasesPaid = 0, releasesIncentive = 0;
  let confirmsFree = 0, confirmsPaid = 0, confirmsIncentive = 0;
  let expiresFree = 0, expiresIncentive = 0;
  let lifetimePurchasedSum = 0;
  let lifetimeConsumedSum = 0;

  for (const r of rows) {
    const f = Math.abs(r.free_delta      ?? 0);
    const p = Math.abs(r.paid_delta      ?? 0);
    const i = Math.abs(r.incentive_delta ?? 0);
    switch (r.execution_phase) {
      case 'grant':
        grantsFree += f; grantsPaid += p; grantsIncentive += i;
        lifetimePurchasedSum += (f + p + i);
        break;
      case 'hold':
        holdsFree += f; holdsPaid += p; holdsIncentive += i;
        break;
      case 'release':
        releasesFree += f; releasesPaid += p; releasesIncentive += i;
        break;
      case 'confirm':
        confirmsFree += f; confirmsPaid += p; confirmsIncentive += i;
        lifetimeConsumedSum += (f + p + i);
        break;
      case 'expire':
        expiresFree += f;
        break;
      case 'expire_incentive':
        expiresIncentive += i;
        break;
      default:
        // Unknown phase — log but don't fail the reconciliation.
        logger.warn('reconciliation_unknown_phase', { orgId, phase: r.execution_phase });
    }
  }

  const expected = {
    free_balance:       grantsFree      - holdsFree      + releasesFree      - confirmsFree      - expiresFree,
    paid_balance:       grantsPaid      - holdsPaid      + releasesPaid      - confirmsPaid,
    incentive_balance:  grantsIncentive - holdsIncentive + releasesIncentive - confirmsIncentive - expiresIncentive,
    reserved_free:      holdsFree      - releasesFree      - confirmsFree,
    reserved_paid:      holdsPaid      - releasesPaid      - confirmsPaid,
    reserved_incentive: holdsIncentive - releasesIncentive - confirmsIncentive,
    lifetime_purchased: lifetimePurchasedSum,
    lifetime_consumed:  lifetimeConsumedSum,
  };

  const delta: ReconciliationDelta = {
    free_balance:       observed.free_balance       - expected.free_balance,
    paid_balance:       observed.paid_balance       - expected.paid_balance,
    incentive_balance:  observed.incentive_balance  - expected.incentive_balance,
    reserved_free:      observed.reserved_free      - expected.reserved_free,
    reserved_paid:      observed.reserved_paid      - expected.reserved_paid,
    reserved_incentive: observed.reserved_incentive - expected.reserved_incentive,
    lifetime_purchased: observed.lifetime_purchased - expected.lifetime_purchased,
    lifetime_consumed:  observed.lifetime_consumed  - expected.lifetime_consumed,
  };

  const inSync =
    delta.free_balance === 0 &&
    delta.paid_balance === 0 &&
    delta.incentive_balance === 0 &&
    delta.reserved_free === 0 &&
    delta.reserved_paid === 0 &&
    delta.reserved_incentive === 0 &&
    delta.lifetime_purchased === 0 &&
    delta.lifetime_consumed === 0;

  return { orgId, observed, expected, delta, inSync };
}

/**
 * Reconcile every org with a wallet row OR with ledger activity. Returns
 * a summary plus the full list of drifted orgs (in-sync orgs are NOT
 * returned to keep the response bounded). Read-only.
 *
 * Use from cron + an admin status endpoint.
 */
export async function reconcileAll(input?: {
  /** Cap orgs scanned per run. Default: 1000. */
  limit?: number;
}): Promise<ReconciliationSummary> {
  const limit = input?.limit ?? 1000;

  // Pull every org with a wallet row.
  const { data: wallets, error } = await ownedDbTable('organization_credits')
    .select('organization_id')
    .limit(limit);

  if (error) {
    logger.error('reconciliation_query_failed', { message: error.message });
    throw new Error(`reconciliation_query_failed: ${error.message}`);
  }

  const orgIds = ((wallets ?? []) as Array<{ organization_id: string }>).map((r) => r.organization_id);

  const drifted: OrgReconciliationReport[] = [];
  let inSyncCount = 0;
  for (const orgId of orgIds) {
    const r = await reconcileOrg(orgId);
    if (r.inSync) inSyncCount += 1;
    else drifted.push(r);
  }

  const summary: ReconciliationSummary = {
    orgsScanned: orgIds.length,
    orgsInSync:  inSyncCount,
    orgsDrifted: drifted.length,
    drifted,
  };

  if (summary.orgsDrifted > 0) {
    logger.error('reconciliation_drift_detected', {
      orgsDrifted: summary.orgsDrifted,
      orgsScanned: summary.orgsScanned,
      // Don't dump full drifted list here — too noisy for log streams.
      // First three so the on-call has something to act on at a glance.
      sample: drifted.slice(0, 3).map((d) => ({ orgId: d.orgId, delta: d.delta })),
    });
  }

  return summary;
}
