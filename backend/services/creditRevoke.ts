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
   * to one ledger entry.
   */
  originalGrantIdempotencyKey?: string;
  /**
   * The operator REQUEST's Idempotency-Key. Required when there is no
   * originalGrantIdempotencyKey: one logical revoke = one key, so a retry of the
   * same request can never revoke twice. (Replaces a 60 s time bucket, which
   * revoked again on a retry after the bucket rolled over and collapsed two
   * distinct revokes inside one minute into one while both reported success.)
   */
  requestIdempotencyKey?: string;
}

export type RevokeCreditResult =
  | {
      success: true;
      revoked:        number;       // actual credits drained (capped at balance)
      requested:      number;       // what the caller asked for
      idempotencyKey: string;
      transactionId:  string | null;
      /** True when this grant had ALREADY been revoked: nothing was drained by this call. */
      alreadyRevoked?: boolean;
    }
  | { success: false; reason: 'INVALID_AMOUNT' | 'NO_WALLET' | 'WALLET_READ_FAILED' | 'INSUFFICIENT_BALANCE' | 'RPC_FAILED' | 'IDEMPOTENCY_KEY_REQUIRED' | 'PRIOR_REVOKE_READ_FAILED'; detail?: string };

/** Escape SQL LIKE metacharacters for PostgreSQL's default '\' escape. */
function escapeLike(v: string): string {
  return v.replace(/([\\%_])/g, '\\$1');
}

export async function revokeCredit(input: RevokeCreditInput): Promise<RevokeCreditResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0 || !Number.isInteger(input.amount)) {
    return { success: false, reason: 'INVALID_AMOUNT' };
  }

  // MONEY (2026-11-12, class 2): the key is built from the REQUEST, never from
  // the balance read below. It used to embed `drain` (= min(amount, balance)):
  // a retry after a successful revoke read a LOWER balance -> a different drain
  // -> a different key -> a SECOND revoke (over-revoking customer credits).
  const grantKey = input.originalGrantIdempotencyKey?.trim() || null;
  const requestKey = input.requestIdempotencyKey?.trim() || null;
  if (!grantKey && !requestKey) {
    return { success: false, reason: 'IDEMPOTENCY_KEY_REQUIRED' };
  }

  if (grantKey) {
    // Business identity, any key format: has THIS grant already been revoked
    // in this category? Rows written under the old drain-embedding key
    // (`<grant>:revoke:<category>:<drain>`) share the prefix, so they are
    // honoured too - a key-format change must never re-run a destructive op.
    const { data: prior, error: priorErr } = await ownedDbTable('credit_transactions')
      .select('id, idempotency_key')
      .eq('organization_id', input.orgId)
      .eq('reference_type', 'credit_revoke')
      // grantKey is caller-supplied (an operator Idempotency-Key): escape the
      // LIKE metacharacters (backslash is PG's default LIKE escape; PostgREST
      // has no ESCAPE clause) - an '_' in a key must not match ANY character
      // and hit ANOTHER grant's revoke (a false "already revoked" leaves the
      // credits in place). category is a closed union (no metacharacters).
      // RELIES ON: a grant key never contains ':revoke:' (else grant B's key
      // could begin with `<grantA>:revoke:<cat>:`).
      .like('idempotency_key', `${escapeLike(grantKey)}:revoke:${input.category}:%`)
      .limit(1);
    if (priorErr) return { success: false, reason: 'PRIOR_REVOKE_READ_FAILED', detail: priorErr.message };
    const hit = (prior ?? [])[0] as { id: string; idempotency_key: string } | undefined;
    if (hit) {
      return { success: true, revoked: 0, requested: input.amount, idempotencyKey: hit.idempotency_key, transactionId: hit.id, alreadyRevoked: true };
    }
  }

  // Fetch wallet to clamp the requested amount to the available balance.
  // Direct read is safe — we are NOT mutating outside the canonical RPC.
  // A failed read is not NO_WALLET: report it as what it is (nothing revoked).
  const { data: wallet, error: walletErr } = await ownedDbTable('organization_credits')
    .select('free_balance, incentive_balance')
    .eq('organization_id', input.orgId)
    .maybeSingle();
  if (walletErr) {
    return { success: false, reason: 'WALLET_READ_FAILED', detail: walletErr.message };
  }

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

  // Idempotency key from the REQUEST (see the top of this function): the
  // requested amount, never the balance-derived drain.
  const baseKey = grantKey
    ? `${grantKey}:revoke:${input.category}:${input.amount}`
    : `revoke:${input.category}:${input.orgId}:req:${requestKey}`;

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
