/**
 * Credit Revocation
 *
 * Operator-driven reversal of a previously-granted credit batch. Used
 * when an admin grant was issued in error, when a promotional batch is
 * being clawed back, or when free credits should be retired ahead of
 * their natural expiry.
 *
 * Scope of THIS module:
 *   - Free-credit revocation via the canonical `apply_credit_reservation`
 *     RPC's `expire` phase (drains free_balance only).
 *   - Incentive-credit revocation via `expire_incentive` phase.
 *
 * NOT in scope (requires schema change to add a 'refund' phase):
 *   - Paid-credit revocation. Refunds for paid credits must flow through
 *     a future Stripe refund webhook + dedicated 'refund' phase that
 *     decrements paid_balance + lifetime_purchased atomically. Until
 *     then, paid revocations require an explicit ops escalation and a
 *     direct DB adjustment under audit.
 *
 * Safety invariants:
 *   - Every revocation is bounded by the current available balance — we
 *     never push the wallet negative.
 *   - Every revocation carries a deterministic idempotency key derived
 *     from the original grant's idempotency key, so retries are safe.
 *   - Every revocation records a `credit_admin_grants`-style audit row
 *     via `logSecurityEvent` with the operator id and the reason.
 *   - The 'expire' phase is the canonical mutation surface — we do NOT
 *     write directly to organization_credits or credit_transactions.
 */

import { ownedDbTable } from '../db/writeOwner';
import { callCreditReservation } from '../repositories/creditExecutionRepository';
import { logSecurityEvent } from '../security/audit/SecurityAuditService';
import { logger } from './logger';

export type RevocableCategory = 'free' | 'incentive';

export interface RevokeCreditInput {
  /** Organization whose credits to revoke. */
  orgId: string;
  /** How many credits to revoke. Capped at the available balance for safety. */
  amount: number;
  /** Which category to drain. Paid credits cannot be revoked through this path. */
  category: RevocableCategory;
  /** Operator user_id performing the revocation — recorded in the ledger. */
  performedBy: string;
  /** Free-text reason. Stored in the ledger note + audit row. */
  reason: string;
  /**
   * Optional link to the original grant. When provided, the revocation
   * idempotency key is derived from it so repeated revoke calls collapse
   * to one ledger entry. When omitted, a unique key is minted from the
   * (orgId, category, amount, reason) tuple plus a timestamp bucket so
   * concurrent operator clicks within 60s collapse.
   */
  originalGrantIdempotencyKey?: string;
}

export type RevokeCreditResult =
  | {
      success: true;
      revoked:        number;       // actual credits drained (capped at balance)
      requested:      number;       // what the caller asked for
      idempotencyKey: string;
      transactionId:  string | null;
    }
  | { success: false; reason: 'INVALID_AMOUNT' | 'NO_WALLET' | 'INSUFFICIENT_BALANCE' | 'RPC_FAILED'; detail?: string };

const REVOKE_BUCKET_SECONDS = 60;

export async function revokeCredit(input: RevokeCreditInput): Promise<RevokeCreditResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0 || !Number.isInteger(input.amount)) {
    return { success: false, reason: 'INVALID_AMOUNT' };
  }

  // Fetch wallet to clamp the requested amount to the available balance.
  // Direct read is safe — we are NOT mutating outside the canonical RPC.
  const { data: wallet } = await ownedDbTable('organization_credits')
    .select('free_balance, incentive_balance')
    .eq('organization_id', input.orgId)
    .maybeSingle();

  if (!wallet) {
    return { success: false, reason: 'NO_WALLET' };
  }

  const available = input.category === 'free'
    ? Number((wallet as { free_balance?: number | null }).free_balance ?? 0)
    : Number((wallet as { incentive_balance?: number | null }).incentive_balance ?? 0);

  if (available <= 0) {
    return { success: false, reason: 'INSUFFICIENT_BALANCE', detail: `available=${available}` };
  }

  const drain = Math.min(input.amount, available);

  // Build the idempotency key. If the caller supplied the original grant
  // key, deterministically suffix with the category — the same operator
  // hitting "revoke" twice on the same grant should produce one ledger
  // row. Otherwise, time-bucket so concurrent UI clicks within a minute
  // collapse to one revocation.
  const baseKey = input.originalGrantIdempotencyKey
    ? `${input.originalGrantIdempotencyKey}:revoke:${input.category}:${drain}`
    : `revoke:${input.category}:${input.orgId}:${drain}:${
        Math.floor(Date.now() / (REVOKE_BUCKET_SECONDS * 1000))
      }`;

  const phase = input.category === 'free' ? 'expire' : 'expire_incentive';

  const { error: rpcErr, transactionId } = await callCreditReservation({
    orgId:          input.orgId,
    phase,
    split: input.category === 'free'
      ? { free: drain, paid: 0, incentive: 0 }
      : { free: 0,     paid: 0, incentive: drain },
    idempotencyKey: baseKey,
    referenceType:  'credit_revoke',
    referenceId:    input.orgId,
    note:           `[REVOKE] operator=${input.performedBy} reason=${input.reason} amount=${drain}/${input.amount}`,
    performedBy:    input.performedBy,
    category:       input.category,
  });

  if (rpcErr) {
    logger.error('credit_revoke_rpc_failed', {
      orgId:    input.orgId,
      category: input.category,
      drain,
      message:  (rpcErr as { message?: string }).message,
    });
    return { success: false, reason: 'RPC_FAILED', detail: (rpcErr as { message?: string }).message };
  }

  void logSecurityEvent({
    capability:      'billing.audit.view',
    decision:        'allowed',
    actorUserId:     input.performedBy,
    principalUserId: input.performedBy,
    resourceId:      input.orgId,
    reason:          `credit_revoke category=${input.category} drained=${drain}/${input.amount} reason=${input.reason}`,
  });

  return {
    success:        true,
    revoked:        drain,
    requested:      input.amount,
    idempotencyKey: baseKey,
    transactionId,
  };
}
