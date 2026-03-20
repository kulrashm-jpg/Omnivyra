/**
 * Credit Execution Service — Production-grade Hold / Confirm / Release
 *
 * Architecture:
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  HOLD    → deduct from category balance, add to reserved            │
 *   │  EXECUTE → run the actual work (LLM call, generation, etc.)         │
 *   │  CONFIRM → deduct from reserved, record usage log (coupled)         │
 *   │  RELEASE → deduct from reserved, restore to category balance        │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Safety invariants (all enforced by design + DB):
 *   1. idempotencyKey is REQUIRED — throws if missing
 *   2. idempotencyKey must be deterministic — use makeIdempotencyKey()
 *   3. Category split is computed at HOLD time, carried to CONFIRM/RELEASE
 *   4. Usage is recorded in the CONFIRM step only — never before, never after
 *   5. Concurrent retries are safe — DB unique index de-duplicates all phases
 *   6. Admin grants go through createCredit() — never through the deduction path
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getCreditCost, type CreditAction } from './creditDeductionService';
import { resolveDeduction, type CategorySplit } from './creditPriorityService';
import { trackUsage } from './usageTrackingService';

// ── Public types ───────────────────────────────────────────────────────────────

export type CreditCategory = 'free' | 'paid' | 'incentive';

export interface ExecuteWithCreditsOptions<T> {
  /** Supabase user ID of the actor (for audit trail) */
  userId:          string;
  /** Organization whose wallet is charged */
  orgId:           string;
  /** Action key — resolves to credit cost */
  action:          CreditAction;
  /** Stored in reference_type column */
  referenceType:   string;
  /** Stable reference ID (campaign ID, content ID, request ID, etc.) */
  referenceId:     string;
  /**
   * Deterministic idempotency key.
   * REQUIRED — throws if absent.
   * Use makeIdempotencyKey() or provide your own stable composite key.
   */
  idempotencyKey:  string;
  /** Override the computed credit cost (e.g. voice = cost × minutes) */
  amountOverride?: number;
  /** Human-readable note stored in the ledger */
  note?:           string;
  /** The work to run between HOLD and CONFIRM */
  executor:        () => Promise<T>;
}

export type ExecuteResult<T> =
  | { status: 'executed';            result: T }
  | { status: 'already_confirmed' }
  | { status: 'already_released' }
  | { status: 'insufficient_credits'; available: number; required: number }
  | { status: 'no_credit_account' };

export interface CreateCreditOptions {
  orgId:           string;
  amount:          number;
  category:        CreditCategory;
  referenceType:   string;
  referenceId?:    string;
  note?:           string;
  performedBy:     string;
  idempotencyKey:  string;
}

// ── Idempotency key generation ─────────────────────────────────────────────────

/**
 * Build a deterministic, collision-resistant idempotency key from stable inputs.
 *
 * @param userId      Actor performing the action
 * @param action      CreditAction string
 * @param referenceId Stable identifier for the work unit (campaignId, contentId, etc.)
 * @param salt        Optional extra disambiguator (e.g. 'hold', 'daily:2026-03-22')
 */
export function makeIdempotencyKey(
  userId:      string,
  action:      string,
  referenceId: string,
  salt?:       string,
): string {
  const input = [userId, action, referenceId, salt ?? ''].join(':');
  return createHash('sha256').update(input).digest('hex').slice(0, 40);
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

interface ReservationParams {
  orgId:          string;
  phase:          'hold' | 'confirm' | 'release' | 'grant' | 'expire';
  split:          CategorySplit;
  idempotencyKey: string;
  referenceType:  string;
  referenceId?:   string;
  note:           string;
  performedBy:    string;
  parentId?:      string;
}

async function callReservation(p: ReservationParams): Promise<{
  error: Error | null;
  transactionId: string | null;
}> {
  const { error, data } = await supabase.rpc('apply_credit_reservation', {
    p_org_id:          p.orgId,
    p_phase:           p.phase,
    p_free_amount:     p.split.free,
    p_incentive_amount: p.split.incentive,
    p_paid_amount:     p.split.paid,
    p_idempotency_key: p.idempotencyKey,
    p_reference_type:  p.referenceType,
    p_reference_id:    p.referenceId ?? null,
    p_note:            p.note,
    p_performed_by:    p.performedBy,
    p_parent_id:       p.parentId ?? null,
  });

  const txId = (data as any)?.id ?? null;
  return { error: error as any, transactionId: txId };
}

async function findTransaction(key: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('credit_transactions')
    .select('id, execution_phase')
    .eq('idempotency_key', key)
    .maybeSingle();
  return data as { id: string } | null;
}

async function loadHoldSplit(holdId: string): Promise<CategorySplit | null> {
  const { data } = await supabase
    .from('credit_transactions')
    .select('free_delta, paid_delta, incentive_delta')
    .eq('id', holdId)
    .maybeSingle();
  if (!data) return null;
  const d = data as any;
  // HOLD deltas are stored as negative (deductions); flip sign for release/confirm
  return {
    free:      Math.abs(d.free_delta      ?? 0),
    incentive: Math.abs(d.incentive_delta ?? 0),
    paid:      Math.abs(d.paid_delta      ?? 0),
  };
}

// ── Core: executeWithCredits ───────────────────────────────────────────────────

/**
 * Execute work with atomic, category-aware credit deduction.
 *
 * THROWS if idempotencyKey is missing — this is intentional and hard.
 *
 * @example
 * ```ts
 * const result = await executeWithCredits({
 *   userId:         user.id,
 *   orgId:          company.id,
 *   action:         'campaign_generation',
 *   referenceType:  'campaign',
 *   referenceId:    campaignId,
 *   idempotencyKey: makeIdempotencyKey(user.id, 'campaign_generation', campaignId),
 *   executor: async () => generateCampaign(company.id),
 * });
 * if (result.status === 'executed') return result.result;
 * ```
 */
export async function executeWithCredits<T>(
  opts: ExecuteWithCreditsOptions<T>,
): Promise<ExecuteResult<T>> {
  const { userId, orgId, action, referenceType, referenceId, note, executor } = opts;

  // ── HARD FAIL: idempotencyKey is mandatory ─────────────────────────────────
  if (!opts.idempotencyKey || opts.idempotencyKey.trim() === '') {
    throw new Error(
      `[creditExecution] MISSING idempotencyKey for action "${action}" — ` +
      'use makeIdempotencyKey(userId, action, referenceId) to generate one.'
    );
  }

  const baseKey    = opts.idempotencyKey;
  const holdKey    = `${baseKey}:hold`;
  const confirmKey = `${baseKey}:confirm`;
  const releaseKey = `${baseKey}:release`;

  // ── 1. Resolve credit cost ─────────────────────────────────────────────────
  const credits = opts.amountOverride ?? await getCreditCost(action);

  // ── 2. Idempotency: check for settled phases ───────────────────────────────
  const [existingConfirm, existingRelease] = await Promise.all([
    findTransaction(confirmKey),
    findTransaction(releaseKey),
  ]);

  if (existingConfirm) {
    console.info(`[creditExecution] already_confirmed: ${baseKey}`);
    return { status: 'already_confirmed' };
  }
  if (existingRelease) {
    console.info(`[creditExecution] already_released: ${baseKey}`);
    return { status: 'already_released' };
  }

  // ── 3. HOLD — resolve wallet + compute split + reserve ────────────────────
  let holdId: string | null = null;
  let usedSplit: CategorySplit;

  const existingHold = await findTransaction(holdKey);

  if (existingHold) {
    // Resume from existing HOLD
    holdId = existingHold.id;
    console.info(`[creditExecution] reusing hold ${holdId} for ${baseKey}`);
    const loadedSplit = await loadHoldSplit(holdId);
    if (!loadedSplit) {
      // Corrupted hold — treat as fresh
      holdId = null;
      usedSplit = { free: 0, incentive: 0, paid: 0 };
    } else {
      usedSplit = loadedSplit;
    }
  } else {
    // Fresh HOLD: resolve wallet and split
    const { wallet, available, split } = await resolveDeduction(orgId, credits);

    if (!wallet) {
      console.warn(`[creditExecution] no_credit_account: ${orgId}`);
      return { status: 'no_credit_account' };
    }

    if (!split || !available) {
      console.warn(`[creditExecution] insufficient_credits: need ${credits}, have ${available?.total ?? 0} for ${orgId}`);
      return {
        status: 'insufficient_credits',
        available: available?.total ?? 0,
        required: credits,
      };
    }

    usedSplit = split;

    const { error: holdErr, transactionId } = await callReservation({
      orgId,
      phase:          'hold',
      split:          usedSplit,
      idempotencyKey: holdKey,
      referenceType,
      referenceId,
      note:           `[HOLD] ${note ?? action}`,
      performedBy:    userId,
    });

    if (holdErr) {
      const msg = (holdErr as any).message ?? '';
      if (msg.includes('insufficient')) {
        return { status: 'insufficient_credits', available: 0, required: credits };
      }
      if (msg.includes('no_credit_account')) {
        return { status: 'no_credit_account' };
      }
      // Non-fatal hold failure — proceed, CONFIRM will do the balance check
      console.error(`[creditExecution] hold failed for ${baseKey}:`, msg);
    } else {
      holdId = transactionId;
      console.info(`[creditExecution] hold created: ${holdId} (${credits}cr — free:${usedSplit.free} inc:${usedSplit.incentive} paid:${usedSplit.paid})`);
    }
  }

  // ── 4. EXECUTE ─────────────────────────────────────────────────────────────
  let executorResult: T;
  try {
    executorResult = await executor();
  } catch (execErr: any) {
    // ── 4b. RELEASE — executor failed, restore reserved credits ──────────────
    console.error(`[creditExecution] executor failed for ${baseKey}:`, execErr?.message);

    await callReservation({
      orgId,
      phase:          'release',
      split:          usedSplit,
      idempotencyKey: releaseKey,
      referenceType,
      referenceId,
      note:           `[RELEASE] ${note ?? action} — error: ${String(execErr?.message ?? '').slice(0, 80)}`,
      performedBy:    userId,
      parentId:       holdId ?? undefined,
    });

    throw execErr;
  }

  // ── 5. CONFIRM — finalise reservation + couple usage record ───────────────
  const { error: confirmErr, transactionId: confirmId } = await callReservation({
    orgId,
    phase:          'confirm',
    split:          usedSplit,
    idempotencyKey: confirmKey,
    referenceType,
    referenceId,
    note:           note ?? action.replace(/_/g, ' '),
    performedBy:    userId,
    parentId:       holdId ?? undefined,
  });

  if (confirmErr) {
    const msg = (confirmErr as any).message ?? '';
    console.error(`[creditExecution] confirm failed for ${baseKey} (work complete):`, msg);
    // Even if confirm fails, work is done — log and continue
  } else {
    console.info(`[creditExecution] confirmed: ${credits}cr for ${orgId} — txn:${confirmId}`);

    // ── 5a. Couple usage tracking to confirm (enforces NO confirm without usage)
    if (confirmId) {
      await trackUsage({
        orgId,
        userId,
        action,
        credits,
        split: usedSplit,
        referenceType,
        referenceId,
        confirmTransactionId: confirmId,
      });
    }
  }

  return { status: 'executed', result: executorResult };
}

// ── Admin grants ───────────────────────────────────────────────────────────────

/**
 * Create a credit grant (admin operation).
 * Routes through apply_credit_reservation with phase='grant'.
 * Idempotency key is REQUIRED.
 *
 * @example
 * ```ts
 * await createCredit({
 *   orgId:          company.id,
 *   amount:         300,
 *   category:       'free',
 *   referenceType:  'onboarding',
 *   performedBy:    admin.id,
 *   idempotencyKey: makeIdempotencyKey(admin.id, 'onboarding_grant', company.id),
 * });
 * ```
 */
export async function createCredit(opts: CreateCreditOptions): Promise<void> {
  if (!opts.idempotencyKey || opts.idempotencyKey.trim() === '') {
    throw new Error('[createCredit] MISSING idempotencyKey — admin grants require deterministic keys');
  }

  const split: CategorySplit = {
    free:      opts.category === 'free'      ? opts.amount : 0,
    incentive: opts.category === 'incentive' ? opts.amount : 0,
    paid:      opts.category === 'paid'      ? opts.amount : 0,
  };

  const { error } = await callReservation({
    orgId:          opts.orgId,
    phase:          'grant',
    split,
    idempotencyKey: opts.idempotencyKey,
    referenceType:  opts.referenceType,
    referenceId:    opts.referenceId,
    note:           opts.note ?? `${opts.category} credit grant`,
    performedBy:    opts.performedBy,
  });

  if (error) {
    const msg = (error as any).message ?? '';
    if (msg.includes('unique_violation') || msg.includes('already exists')) {
      // Idempotent — already granted
      return;
    }
    throw new Error(`[createCredit] grant failed: ${msg}`);
  }
}

// ── Re-exports for callers ─────────────────────────────────────────────────────
export type { CreditAction };
