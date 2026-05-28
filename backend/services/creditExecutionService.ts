/**
 * Credit Execution Service — SINGLE AUTHORITY for all credit mutations
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
 *   7. ALL credit mutations flow through this service — no bypasses
 */

import { createHash } from 'crypto';
import {
  type CreditAction,
  type DeductOptions,
  type DeductResult,
  getCreditCost,
  getSmartModeDedupSeconds,
  wasRecentlyRun,
} from './creditDeductionService';
import { getTotalAvailable, resolveDeduction, type CategorySplit } from './creditPriorityService';
import { trackUsage } from './usageTrackingService';
import { checkCreditAlerts } from './creditAlertService';
import { logUsageEvent } from './usageLedgerService';
import { logger } from './logger';
import {
  resolveLlmCost as resolveExecutionLlmCost,
  estimateLlmHoldCredits,
  recordCostAnomaly,
  type ResolvedLlmCost,
} from './pricingService';
import {
  callCreditPartialConfirm,
  callCreditReservation,
  findCreditTransaction,
  loadCreditHoldSplit,
} from '../repositories/creditExecutionRepository';
import { resolveMonetizationFeature } from '../../shared/monetization/featureRegistry';
import { buildHoldPolicySnapshot, freezeHoldPolicySnapshot } from './billing/holdPolicySnapshot';
import { evaluateCreditSafetyGate } from './billing/creditSafetyGate';
import { resolveBillingPolicy } from './billing/billingPolicyResolver';
import { assertUuid, canonicalizeReference, type Uuid } from '@/lib/shared/uuid';

/** Fire credit threshold alerts in the background — non-blocking, swallows errors. */
function fireAlerts(orgId: string): void {
  checkCreditAlerts(orgId).catch(err =>
    logger.warn('credit_alert_check_failed', { orgId, message: err?.message ?? 'unknown' }),
  );
}

// ── Public types ───────────────────────────────────────────────────────────────

export type CreditCategory = 'free' | 'paid' | 'incentive';

/**
 * Source of the usage numbers on an LLM executor result.
 *   'provider' — tokens came back from an actual LLM call; positive required
 *   'cache'    — cached completion returned without hitting the provider;
 *                zero tokens are valid and will settle at the minimum charge
 */
export type LlmUsageSource = 'provider' | 'cache';

/**
 * Contract every LLM executor must satisfy. `result` is the value returned
 * to the caller; `usage` + `provider` + `model` drive token-priced settlement.
 * There is no extractUsage callback — the executor MUST produce this shape.
 */
export interface LlmExecutorResult<T> {
  result:   T;
  usage:    { inputTokens: number; outputTokens: number; source: LlmUsageSource };
  provider: string;
  model:    string;
}

export interface LlmPricingSpec {
  provider:        string;
  model:           string;
  actionKey:       string;
  /** HOLD upper bound — drives dynamic reservation via estimateLlmHoldCredits. */
  maxInputTokens:  number;
  maxOutputTokens: number;
  timestamp?:      string | Date;
}

interface ExecuteBase {
  userId:             string;
  orgId:              string;
  action:             CreditAction;
  referenceType:      string;
  referenceId:        string;
  idempotencyKey:     string;
  amountOverride?:    number;
  note?:              string;
  validateMembership?: boolean;
}

/**
 * Fixed-price variant: executor returns T directly. HOLD uses action_pricing_config
 * credit_cost or fallback via getCreditCost(action).
 */
export interface ExecuteWithCreditsOptionsFixed<T> extends ExecuteBase {
  llmPricing?: undefined;
  executor:   () => Promise<T>;
}

/**
 * Token-priced LLM variant: executor returns LlmExecutorResult<T>. HOLD is
 * dynamic (estimateLlmHoldCredits using maxTokens + multiplier + ceiling).
 * Post-execution, apply_credit_partial_confirm settles to the actual amount.
 */
export interface ExecuteWithCreditsOptionsLlm<T> extends ExecuteBase {
  llmPricing: LlmPricingSpec;
  executor:   () => Promise<LlmExecutorResult<T>>;
}

export type ExecuteWithCreditsOptions<T> =
  | ExecuteWithCreditsOptionsFixed<T>
  | ExecuteWithCreditsOptionsLlm<T>;

export interface SettlementReport {
  /** Final credits actually charged (held - released + underfunded_pull). */
  creditsCharged:  number;
  /** Credits released back to the wallet because HOLD was an over-estimate. */
  creditsReleased: number;
  /**
   * True if the actual cost exceeded the HOLD and the wallet could not fully
   * cover the excess. Partial settlement; org owes the shortfall (currently
   * just logged — no negative balance carried).
   */
  underfunded:     boolean;
  /** USD cost breakdown from resolveLlmCost when llmPricing was provided. */
  pricing?:        ResolvedLlmCost;
}

export type ExecuteResult<T> =
  | { status: 'executed';            result: T; settlement?: SettlementReport }
  | { status: 'already_confirmed' }
  | { status: 'already_released' }
  | { status: 'insufficient_credits'; available: number; required: number }
  | { status: 'no_credit_account' }
  | { status: 'not_a_member'; userId: string; orgId: string }
  | { status: 'org_control_blocked'; code: 'ORG_BLOCKED' | 'HIGH_RISK_ACTION_GATED' | 'DAILY_LIMIT_EXCEEDED'; reason: string };

export interface CreditReservationHandle {
  orgId: string;
  userId: string;
  action: CreditAction;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  holdTransactionId: string;
  creditsReserved: number;
  split: CategorySplit;
}

export type CreditReservationResult =
  | ({ status: 'reserved' | 'already_reserved' } & CreditReservationHandle)
  | { status: 'already_confirmed' }
  | { status: 'already_released' }
  | { status: 'insufficient_credits'; available: number; required: number }
  | { status: 'no_credit_account' }
  | { status: 'not_a_member'; userId: string; orgId: string }
  | { status: 'org_control_blocked'; code: 'ORG_BLOCKED' | 'HIGH_RISK_ACTION_GATED' | 'DAILY_LIMIT_EXCEEDED'; reason: string };

export type CreditReservationSettlement =
  | { status: 'confirmed'; confirmTransactionId: string | null; creditsCharged: number }
  | { status: 'already_confirmed' }
  | { status: 'already_released' };

export type CreditReservationRelease =
  | { status: 'released'; releaseTransactionId: string | null }
  | { status: 'already_released' }
  | { status: 'already_confirmed' };

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

/**
 * Scale a HOLD split down (or up) to match an actual credit amount, keeping
 * per-category proportions. Used to feed apply_credit_partial_confirm when
 * the LLM's actual credits differ from the HOLD ceiling.
 */
function scaleSplitToActual(held: CategorySplit, actual: number): CategorySplit {
  const total = held.free + held.incentive + held.paid;
  if (total <= 0 || actual <= 0) return { free: 0, incentive: 0, paid: 0 };
  const freeA       = Math.floor((held.free      * actual) / total);
  const paidA       = Math.floor((held.paid      * actual) / total);
  const incentiveA  = Math.max(0, actual - freeA - paidA);   // remainder bucket
  return { free: freeA, incentive: incentiveA, paid: paidA };
}

function getReservationKeys(idempotencyKey: string): { holdKey: string; confirmKey: string; releaseKey: string } {
  return {
    holdKey: `${idempotencyKey}:hold`,
    confirmKey: `${idempotencyKey}:confirm`,
    releaseKey: `${idempotencyKey}:release`,
  };
}

/**
 * Canonical UUID anti-corruption boundary for ALL billing entry points.
 *
 * Asserts `orgId` and `userId` carry RFC 4122 UUID shape (these are real
 * foreign keys and MUST be UUIDs by construction — a failure here means an
 * upstream bug, not a legitimate semantic key).
 *
 * Coerces `referenceId` via `canonicalizeReference`: real UUIDs pass through
 * unchanged; semantic keys (e.g. "workspace-linkedin", planner composites)
 * are deterministically projected onto a stable UUID v5-shaped value so they
 * can live in `credit_transactions.reference_id` (UUID column) without losing
 * dedup behavior. The original semantic value is returned in `.semantic` so
 * callers can preserve it in idempotency keys, notes, and telemetry.
 *
 * Namespace is keyed on `referenceType` so two different reference_types
 * never collide on the same semantic string (e.g. "workspace-linkedin" as a
 * "master_content" reference vs. as a "workspace_content_variants" reference
 * derive distinct UUIDs).
 */
function assertCanonicalBillingIdentifiers(input: {
  userId: unknown;
  orgId: unknown;
  referenceType: string;
  referenceId: unknown;
}): { userId: Uuid; orgId: Uuid; referenceId: Uuid; semanticReferenceId: string; referenceDerived: boolean } {
  assertUuid(input.userId, 'userId');
  assertUuid(input.orgId, 'orgId');
  if (typeof input.referenceId !== 'string' || input.referenceId.trim() === '') {
    throw new Error(`[billing-payload-invalid] referenceId must be a non-empty string for referenceType="${input.referenceType}"`);
  }
  const canonical = canonicalizeReference(input.referenceId, `billing:${input.referenceType}`);
  return {
    userId: input.userId,
    orgId: input.orgId,
    referenceId: canonical.uuid,
    semanticReferenceId: canonical.semantic,
    referenceDerived: canonical.derived,
  };
}

function assertCanonicalCreditAction(input: {
  action: CreditAction;
  referenceType: string;
  referenceId: string;
  orgId: string;
  userId: string;
}): NonNullable<ReturnType<typeof resolveMonetizationFeature>> {
  const registryResolution = resolveMonetizationFeature({ action_key: input.action });
  if (!registryResolution?.feature_key || !registryResolution.action_key || !registryResolution.pricing_key) {
    logger.error('monetization_registry_unresolved_credit_action_hard_fail', {
      action: input.action,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      orgId: input.orgId,
      userId: input.userId,
      resolved: registryResolution
        ? {
            feature_key: registryResolution.feature_key,
            action_key: registryResolution.action_key,
            pricing_key: registryResolution.pricing_key,
          }
        : null,
    });
    void recordCostAnomaly({
      organizationId: input.orgId,
      type: 'unknown_action_key',
      severity: 'critical',
      actionKey: input.action,
      metadata: {
        reference_type: input.referenceType,
        reference_id: input.referenceId,
        user_id: input.userId,
        reason: 'credit_execution_registry_hard_fail',
      },
    });
    throw new Error(`[creditExecution] action "${input.action}" is not fully mapped in the monetization registry`);
  }
  if (registryResolution.action_key !== input.action) {
    logger.warn('monetization_registry_legacy_action_alias_used', {
      requested_action: input.action,
      resolved_action: registryResolution.action_key,
      feature_key: registryResolution.feature_key,
      pricing_key: registryResolution.pricing_key,
    });
  }
  return registryResolution;
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
export async function reserveCreditsForWork(opts: {
  userId: string;
  orgId: string;
  action: CreditAction;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  amountOverride?: number;
  note?: string;
  validateMembership?: boolean;
}): Promise<CreditReservationResult> {
  const { action, referenceType } = opts;
  // Canonical UUID anti-corruption boundary (see executeWithCredits).
  const ids = assertCanonicalBillingIdentifiers({
    userId:        opts.userId,
    orgId:         opts.orgId,
    referenceType: opts.referenceType,
    referenceId:   opts.referenceId,
  });
  const userId = ids.userId;
  const orgId = ids.orgId;
  const referenceId = ids.referenceId;
  const semanticReferenceId = ids.semanticReferenceId;
  if (!opts.idempotencyKey || opts.idempotencyKey.trim() === '') {
    throw new Error(`[creditReservation] MISSING idempotencyKey for action "${action}"`);
  }
  assertCanonicalCreditAction({ action, referenceType, referenceId, orgId, userId });

  const shouldValidateMembership = opts.validateMembership !== false && userId !== orgId;
  if (shouldValidateMembership) {
    const { assertOrgMembership } = await import('./requestAccessService');
    const isMember = await assertOrgMembership(userId, orgId);
    if (!isMember) {
      logger.warn('credit_tenant_violation', { userId, orgId, action });
      return { status: 'not_a_member', userId, orgId };
    }
  }

  const { holdKey, confirmKey, releaseKey } = getReservationKeys(opts.idempotencyKey);
  const [existingConfirm, existingRelease, existingHold] = await Promise.all([
    findCreditTransaction(confirmKey),
    findCreditTransaction(releaseKey),
    findCreditTransaction(holdKey),
  ]);

  if (existingConfirm) return { status: 'already_confirmed' };
  if (existingRelease) return { status: 'already_released' };

  const credits = opts.amountOverride ?? await getCreditCost(action);

  const { preflightCheck } = await import('./orgControlService');
  const verdict = await preflightCheck(orgId, credits);
  if (verdict.allowed === false) {
    const blocked = verdict as Extract<typeof verdict, { allowed: false }>;
    logger.warn('credit_org_control_block', { orgId, action, code: blocked.code });
    return { status: 'org_control_blocked', code: blocked.code, reason: blocked.reason };
  }

  if (existingHold) {
    const split = await loadCreditHoldSplit(existingHold.id);
    if (split) {
      logger.info('credit_hold_reused_for_long_running_work', {
        orgId,
        action,
        holdId: existingHold.id,
        idempotencyKey: opts.idempotencyKey,
      });
      return {
        status: 'already_reserved',
        orgId,
        userId,
        action,
        referenceType,
        referenceId,
        idempotencyKey: opts.idempotencyKey,
        holdTransactionId: existingHold.id,
        creditsReserved: split.free + split.incentive + split.paid,
        split,
      };
    }
  }

  const { wallet, available, split } = await resolveDeduction(orgId, credits);
  if (!wallet) {
    logger.warn('credit_no_account', { orgId, action });
    return { status: 'no_credit_account' };
  }
  if (!split || !available) {
    logger.warn('credit_insufficient', { orgId, action, required: credits, available: available?.total ?? 0 });
    fireAlerts(orgId);
    return { status: 'insufficient_credits', available: available?.total ?? 0, required: credits };
  }

  // Task 5H — pre-HOLD 80% executable-balance safety gate (additive, default
  // OFF → byte-identical). Same model as the executeWithCredits path; reuses
  // already-resolved `available`/`credits`; on block returns the existing
  // insufficient_credits result.
  const billingPolicy = await resolveBillingPolicy(orgId);
  if (
    evaluateCreditSafetyGate({
      orgId,
      action,
      availableTotal: available?.total ?? 0,
      projectedCredits: credits,
      policy: billingPolicy,
    }) === 'block'
  ) {
    fireAlerts(orgId);
    return { status: 'insufficient_credits', available: available?.total ?? 0, required: credits };
  }

  const baseNote = opts.note ?? action;
  const noteWithSemantic = ids.referenceDerived
    ? `${baseNote} [semanticRef=${semanticReferenceId}]`
    : baseNote;
  const { error: holdErr, transactionId } = await callCreditReservation({
    orgId,
    phase: 'hold',
    split,
    idempotencyKey: holdKey,
    referenceType,
    referenceId,
    note: `[HOLD] ${noteWithSemantic}`,
    performedBy: userId,
  });

  if (holdErr) {
    const msg = (holdErr as any).message ?? '';
    if (msg.includes('insufficient')) {
      fireAlerts(orgId);
      return { status: 'insufficient_credits', available: 0, required: credits };
    }
    if (msg.includes('no_credit_account')) return { status: 'no_credit_account' };
    logger.error('credit_hold_failed', { orgId, action, idempotencyKey: opts.idempotencyKey, message: msg });
    throw new Error(`[creditReservation] hold failed: ${msg}`);
  }
  if (!transactionId) throw new Error('[creditReservation] hold failed: no transaction id returned');

  return {
    status: 'reserved',
    orgId,
    userId,
    action,
    referenceType,
    referenceId,
    idempotencyKey: opts.idempotencyKey,
    holdTransactionId: transactionId,
    creditsReserved: credits,
    split,
  };
}

export async function confirmCreditReservation(handle: CreditReservationHandle & {
  note?: string;
}): Promise<CreditReservationSettlement> {
  const { confirmKey, releaseKey } = getReservationKeys(handle.idempotencyKey);
  const [existingConfirm, existingRelease] = await Promise.all([
    findCreditTransaction(confirmKey),
    findCreditTransaction(releaseKey),
  ]);
  if (existingConfirm) return { status: 'already_confirmed' };
  if (existingRelease) return { status: 'already_released' };

  const { error: confirmErr, transactionId } = await callCreditReservation({
    orgId: handle.orgId,
    phase: 'confirm',
    split: handle.split,
    idempotencyKey: confirmKey,
    referenceType: handle.referenceType,
    referenceId: handle.referenceId,
    note: handle.note ?? handle.action.replace(/_/g, ' '),
    performedBy: handle.userId,
    parentId: handle.holdTransactionId,
  });
  if (confirmErr) {
    const msg = (confirmErr as any).message ?? '';
    logger.error('credit_confirm_failed_for_long_running_work', {
      orgId: handle.orgId,
      action: handle.action,
      idempotencyKey: handle.idempotencyKey,
      message: msg,
    });
    throw new Error(`[creditReservation] confirm failed: ${msg}`);
  }

  const creditsCharged = handle.split.free + handle.split.incentive + handle.split.paid;
  if (transactionId) {
    await trackUsage({
      orgId: handle.orgId,
      userId: handle.userId,
      action: handle.action,
      credits: creditsCharged,
      split: handle.split,
      referenceType: handle.referenceType,
      referenceId: handle.referenceId,
      confirmTransactionId: transactionId,
    });
    void logUsageEvent({
      organization_id: handle.orgId,
      user_id: handle.userId,
      source_type: 'internal',
      source_name: 'credit_reservation',
      ledger_hold_transaction_id: handle.holdTransactionId,
      process_type: handle.action,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      unit_cost: 0,
      total_cost: 0,
      total_cost_usd: 0,
      final_price_usd: null,
      error_flag: false,
      retry_attempt: 1,
      final_attempt: true,
      credits_charged: creditsCharged,
      reference_type: handle.referenceType,
      reference_id: handle.referenceId,
      metadata: {
        hold_transaction_id: handle.holdTransactionId,
        confirm_transaction_id: transactionId,
        pricing_hold_credits: handle.creditsReserved,
      },
    });
  }

  return { status: 'confirmed', confirmTransactionId: transactionId, creditsCharged };
}

export async function releaseCreditReservation(handle: CreditReservationHandle & {
  note?: string;
}): Promise<CreditReservationRelease> {
  const { confirmKey, releaseKey } = getReservationKeys(handle.idempotencyKey);
  const [existingConfirm, existingRelease] = await Promise.all([
    findCreditTransaction(confirmKey),
    findCreditTransaction(releaseKey),
  ]);
  if (existingRelease) return { status: 'already_released' };
  if (existingConfirm) return { status: 'already_confirmed' };

  const { error: releaseErr, transactionId } = await callCreditReservation({
    orgId: handle.orgId,
    phase: 'release',
    split: handle.split,
    idempotencyKey: releaseKey,
    referenceType: handle.referenceType,
    referenceId: handle.referenceId,
    note: `[RELEASE] ${handle.note ?? handle.action}`,
    performedBy: handle.userId,
    parentId: handle.holdTransactionId,
  });
  if (releaseErr) {
    const msg = (releaseErr as any).message ?? '';
    logger.error('credit_release_failed_for_long_running_work', {
      orgId: handle.orgId,
      action: handle.action,
      idempotencyKey: handle.idempotencyKey,
      message: msg,
    });
    throw new Error(`[creditReservation] release failed: ${msg}`);
  }

  return { status: 'released', releaseTransactionId: transactionId };
}

export async function executeWithCredits<T>(
  opts: ExecuteWithCreditsOptions<T>,
): Promise<ExecuteResult<T>> {
  const { action, referenceType, executor } = opts;
  // Canonical UUID anti-corruption boundary. orgId + userId asserted; the
  // semantic referenceId is coerced into a stable UUID for the DB column and
  // the original is preserved in `semanticReferenceId` for note/telemetry.
  const ids = assertCanonicalBillingIdentifiers({
    userId:        opts.userId,
    orgId:         opts.orgId,
    referenceType: opts.referenceType,
    referenceId:   opts.referenceId,
  });
  const userId = ids.userId;
  const orgId = ids.orgId;
  const referenceId = ids.referenceId;
  const semanticReferenceId = ids.semanticReferenceId;
  const note = ids.referenceDerived && opts.note
    ? `${opts.note} [semanticRef=${semanticReferenceId}]`
    : opts.note;
  assertCanonicalCreditAction({ action, referenceType, referenceId, orgId, userId });

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

  // ── 0. Tenant ownership check ──────────────────────────────────────────────
  // Verify the actor is an active member of the org BEFORE any credit work.
  // Default is `true`; explicit `false` is required for system contexts.
  // Legacy system sentinel (userId === orgId) also skips, preserving
  // behaviour of the best-effort deduction path below.
  const shouldValidateMembership = opts.validateMembership !== false && userId !== orgId;
  if (shouldValidateMembership) {
    const { assertOrgMembership } = await import('./requestAccessService');
    const isMember = await assertOrgMembership(userId, orgId);
    if (!isMember) {
      logger.warn('credit_tenant_violation', { userId, orgId, action });
      return { status: 'not_a_member', userId, orgId };
    }
  }

  // ── 1. Resolve credit cost ─────────────────────────────────────────────────
  // Token-priced (llmPricing) actions HOLD a dynamic upper bound computed
  // from provider+model pricing, max tokens, action multiplier, and the
  // action's ceiling_usd. The actual is settled via apply_credit_partial_confirm
  // after the LLM returns. Fixed actions use the fixed-per-action credit cost.
  let dynamicHoldCredits: number | null = null;
  if (opts.amountOverride == null && opts.llmPricing) {
    const holdEstimate = await estimateLlmHoldCredits({
      provider:        opts.llmPricing.provider,
      model:           opts.llmPricing.model,
      maxInputTokens:  opts.llmPricing.maxInputTokens,
      maxOutputTokens: opts.llmPricing.maxOutputTokens,
      actionKey:       opts.llmPricing.actionKey,
      orgId,
      timestamp:       opts.llmPricing.timestamp,
    });
    dynamicHoldCredits = holdEstimate.credits;
    logger.info('credit_dynamic_hold_estimated', {
      orgId,
      action,
      provider:        opts.llmPricing.provider,
      model:           opts.llmPricing.model,
      maxInputTokens:  opts.llmPricing.maxInputTokens,
      maxOutputTokens: opts.llmPricing.maxOutputTokens,
      baseCostUsd:     holdEstimate.total_cost_usd,
      holdUsd:         holdEstimate.final_price_usd,
      holdCredits:     dynamicHoldCredits,
    });
  }
  const credits = opts.amountOverride
    ?? dynamicHoldCredits
    ?? await getCreditCost(action);

  // ── 1a. Pre-flight org-control check (Phase 7) ────────────────────────────
  // Rejects BEFORE any reservation so blocked/high-risk/over-limit orgs
  // can't start work they aren't allowed to finish.
  {
    const { preflightCheck } = await import('./orgControlService');
    const verdict = await preflightCheck(orgId, credits);
    if (verdict.allowed === false) {
      // TS narrows here in theory but has been flaky in this project; grab
      // the fields via an explicit type assertion to keep the build stable.
      const blocked = verdict as Extract<typeof verdict, { allowed: false }>;
      logger.warn('credit_org_control_block', { orgId, action, code: blocked.code });
      return {
        status: 'org_control_blocked',
        code:   blocked.code,
        reason: blocked.reason,
      };
    }
  }

  // ── 2. Idempotency: check for settled phases ───────────────────────────────
  const [existingConfirm, existingRelease] = await Promise.all([
    findCreditTransaction(confirmKey),
    findCreditTransaction(releaseKey),
  ]);

  if (existingConfirm) {
    logger.info('credit_already_confirmed', { idempotencyKey: baseKey });
    return { status: 'already_confirmed' };
  }
  if (existingRelease) {
    logger.info('credit_already_released', { idempotencyKey: baseKey });
    return { status: 'already_released' };
  }

  // ── 3. HOLD — resolve wallet + compute split + reserve ────────────────────
  let holdId: string | null = null;
  let usedSplit: CategorySplit;

  const existingHold = await findCreditTransaction(holdKey);

  if (existingHold) {
    // Resume from existing HOLD
    holdId = existingHold.id;
    logger.info('credit_reusing_hold', { holdId, idempotencyKey: baseKey });
    const loadedSplit = await loadCreditHoldSplit(holdId);
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
      logger.warn('credit_no_account', { orgId, action });
      return { status: 'no_credit_account' };
    }

    if (!split || !available) {
      logger.warn('credit_insufficient', { orgId, action, required: credits, available: available?.total ?? 0 });
      fireAlerts(orgId);
      return {
        status: 'insufficient_credits',
        available: available?.total ?? 0,
        required: credits,
      };
    }

    // Task 5H — pre-HOLD 80% executable-balance safety gate (additive,
    // default OFF → byte-identical). Reuses the already-resolved `available`
    // + `credits`; on block returns the EXISTING insufficient_credits result
    // (callers/wirePhase2Route already map it → 402). Runs only on the fresh
    // HOLD path, so resumed HOLDs are never double-gated.
    if (
      evaluateCreditSafetyGate({
        orgId,
        action,
        availableTotal: available.total ?? 0,
        projectedCredits: credits,
        policy: await resolveBillingPolicy(orgId),
      }) === 'block'
    ) {
      fireAlerts(orgId);
      return { status: 'insufficient_credits', available: available.total ?? 0, required: credits };
    }

    usedSplit = split;

    const { error: holdErr, transactionId } = await callCreditReservation({
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
        fireAlerts(orgId);
        return { status: 'insufficient_credits', available: 0, required: credits };
      }
      if (msg.includes('no_credit_account')) {
        return { status: 'no_credit_account' };
      }
      logger.error('credit_hold_failed', { orgId, action, idempotencyKey: baseKey, message: msg });
      throw new Error(`[creditExecution] hold failed: ${msg}`);
    } else {
      holdId = transactionId;
      logger.info('credit_hold_created', {
        orgId,
        holdId,
        credits,
        free: usedSplit.free,
        incentive: usedSplit.incentive,
        paid: usedSplit.paid,
      });
    }
  }

  // ── 3b. Freeze deterministic policy snapshot at HOLD (Phase 2 Task 7) ─────
  // BEFORE execution; covers both fresh + resumed HOLD (holdId/usedSplit set
  // in both branches). Best-effort, idempotent, never throws — a snapshot
  // failure must not affect HOLD→EXECUTE or settlement.
  if (holdId) {
    await freezeHoldPolicySnapshot({
      holdTransactionId: holdId,
      organizationId:    orgId,
      snapshot:          buildHoldPolicySnapshot({
        action,
        credits,
        opts: {
          amountOverride: opts.amountOverride ?? null,
          referenceType,
          llmPricing:     opts.llmPricing ?? null,
        },
        split:              usedSplit,
        referenceType,
        referenceId,
        idempotencyBaseKey: baseKey,
      }),
    });
  }

  // ── 4. EXECUTE ─────────────────────────────────────────────────────────────
  // For token-priced flows (llmPricing present), the executor must return
  //   LlmExecutorResult<T> = { result, usage: {inputTokens, outputTokens}, provider, model }
  // Usage is read ONLY from this return shape — no extractUsage callback.
  // Tokens must be > 0 (both input and output); zero is rejected as invalid.
  let executorResult: T;
  let resolvedFinalPricing: ResolvedLlmCost | null = null;
  let finalInputTokens  = 0;
  let finalOutputTokens = 0;
  let finalProvider: string | null = null;
  let finalModel:    string | null = null;

  try {
    const rawResult = await (executor as () => Promise<T | LlmExecutorResult<T>>)();

    if (opts.llmPricing) {
      const wrapped = rawResult as LlmExecutorResult<T>;
      if (!wrapped || typeof wrapped !== 'object' || !('result' in wrapped) || !('usage' in wrapped)) {
        throw new Error('[creditExecution] executor for llmPricing must return { result, usage, provider, model }');
      }

      // Token validation
      //   Shape: inputTokens + outputTokens MUST be finite non-negative integers
      //   Source: must be 'provider' or 'cache'
      //   source='provider' → both tokens must be > 0 (provider should meter us)
      //   source='cache'    → tokens may be 0 (no LLM call executed); settle at
      //                       minimum_charge_usd via resolveLlmCost.
      const source = wrapped.usage?.source as LlmUsageSource | undefined;
      if (source !== 'provider' && source !== 'cache') {
        throw new Error(`[creditExecution] executor usage.source must be 'provider' or 'cache', got ${JSON.stringify(source)}`);
      }
      const inTok  = Number(wrapped.usage?.inputTokens);
      const outTok = Number(wrapped.usage?.outputTokens);
      if (!Number.isFinite(inTok)  || inTok  < 0 || !Number.isInteger(inTok)) {
        throw new Error(`[creditExecution] executor returned invalid inputTokens=${wrapped.usage?.inputTokens} — expected non-negative integer`);
      }
      if (!Number.isFinite(outTok) || outTok < 0 || !Number.isInteger(outTok)) {
        throw new Error(`[creditExecution] executor returned invalid outputTokens=${wrapped.usage?.outputTokens} — expected non-negative integer`);
      }
      if (source === 'provider' && (inTok === 0 || outTok === 0)) {
        throw new Error(`[creditExecution] source='provider' but tokens are zero (in=${inTok}, out=${outTok}) — provider did not meter us`);
      }
      if (!wrapped.provider || !wrapped.model) {
        throw new Error('[creditExecution] executor must return provider + model');
      }
      // Sanity: the provider+model returned must match the HOLD pricing inputs.
      if (wrapped.provider.toLowerCase() !== opts.llmPricing.provider.toLowerCase()
          || wrapped.model.toLowerCase()    !== opts.llmPricing.model.toLowerCase()) {
        throw new Error(`[creditExecution] executor provider/model mismatch: hold=${opts.llmPricing.provider}/${opts.llmPricing.model} actual=${wrapped.provider}/${wrapped.model}`);
      }

      executorResult    = wrapped.result;
      finalInputTokens  = inTok;
      finalOutputTokens = outTok;
      finalProvider     = wrapped.provider;
      finalModel        = wrapped.model;

      resolvedFinalPricing = await resolveExecutionLlmCost({
        provider:      opts.llmPricing.provider,
        model:         opts.llmPricing.model,
        inputTokens:   finalInputTokens,
        outputTokens:  finalOutputTokens,
        actionKey:     opts.llmPricing.actionKey,
        orgId,
        timestamp:     opts.llmPricing.timestamp,
      });
    } else {
      executorResult = rawResult as T;
    }
  } catch (execErr: any) {
    // ── 4b. RELEASE — executor failed, restore reserved credits ──────────────
    logger.error('credit_executor_failed', { orgId, action, idempotencyKey: baseKey, message: execErr?.message ?? 'unknown' });

    const releaseResult = await callCreditReservation({
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

    if (releaseResult.error) {
      throw new Error(`[creditExecution] release failed after executor error: ${(releaseResult.error as any).message ?? 'unknown'}`);
    }

    throw execErr;
  }

  // ── 5. CONFIRM — two paths:
  //   (a) Token-priced path: resolvedFinalPricing is known → partial_confirm
  //       consumes the actual amount and releases the HOLD remainder in one
  //       atomic PG call. Marks underfunded if actual > HOLD + wallet balance.
  //   (b) Fixed-cost path: no llmPricing, CONFIRM the full usedSplit.
  // ──────────────────────────────────────────────────────────────────────────
  let confirmId: string | null = null;
  let settlement: SettlementReport | undefined;

  if (resolvedFinalPricing && holdId) {
    const actualCredits = Math.max(0, resolvedFinalPricing.credits);
    const actualSplit   = scaleSplitToActual(usedSplit, actualCredits);

    const { error: partialErr, data: partialData } = await callCreditPartialConfirm({
      orgId,
      holdTxnId:      holdId,
      actualSplit,
      idempotencyKey: confirmKey,
      referenceType,
      referenceId,
      note:           note ?? action.replace(/_/g, ' '),
      performedBy:    userId,
    });

    if (partialErr) {
      const msg = (partialErr as any).message ?? '';
      logger.error('credit_partial_confirm_failed', { orgId, action, idempotencyKey: baseKey, message: msg });
      const releaseResult = await callCreditReservation({
        orgId,
        phase:          'release',
        split:          usedSplit,
        idempotencyKey: releaseKey,
        referenceType,
        referenceId,
        note:           `[RELEASE] ${note ?? action} — partial_confirm failed`,
        performedBy:    userId,
        parentId:       holdId ?? undefined,
      });
      if (releaseResult.error) {
        throw new Error(`[creditExecution] partial_confirm failed and release failed: ${msg} | release=${(releaseResult.error as any).message ?? 'unknown'}`);
      }
      throw new Error(`[creditExecution] partial_confirm failed: ${msg}`);
    }

    confirmId = (partialData as any)?.id ?? null;
    const underfunded = !!(partialData as any)?.is_underfunded;
    const consumedTotal = Number((partialData as any)?.total_consumed ?? actualCredits);
    const releasedTotal = Number((partialData as any)?.total_released ?? Math.max(0, credits - actualCredits));

    settlement = {
      creditsCharged:  consumedTotal,
      creditsReleased: releasedTotal,
      underfunded,
      pricing:         resolvedFinalPricing,
    };

    logger.info('credit_partial_confirmed', {
      orgId, action,
      heldCredits:     credits,
      actualCredits,
      creditsCharged:  consumedTotal,
      creditsReleased: releasedTotal,
      underfunded,
      confirmId,
    });

    if (confirmId) {
      await trackUsage({
        orgId,
        userId,
        action,
        credits:              consumedTotal,
        split:                actualSplit,
        referenceType,
        referenceId,
        confirmTransactionId: confirmId,
      });
    }
  } else {
    const { error: confirmErr, transactionId } = await callCreditReservation({
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
      logger.error('credit_confirm_failed', { orgId, action, idempotencyKey: baseKey, message: msg });
      const releaseResult = await callCreditReservation({
        orgId,
        phase:          'release',
        split:          usedSplit,
        idempotencyKey: releaseKey,
        referenceType,
        referenceId,
        note:           `[RELEASE] ${note ?? action} — confirm failed`,
        performedBy:    userId,
        parentId:       holdId ?? undefined,
      });
      if (releaseResult.error) {
        throw new Error(`[creditExecution] confirm failed and release failed: ${msg} | release=${(releaseResult.error as any).message ?? 'unknown'}`);
      }
      throw new Error(`[creditExecution] confirm failed: ${msg}`);
    }

    confirmId = transactionId;
    logger.info('credit_confirmed', { orgId, action, credits, confirmId });

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

  // ── 5b. Post-settlement invariant: actual MUST NOT exceed HOLD.
  //   If actual > hold, we consumed more than we reserved. This can only happen
  //   for token-priced flows where token count exceeds the HOLD estimate.
  //   Always a critical anomaly; independent of whether the wallet could cover
  //   the excess (is_underfunded).
  if (settlement && settlement.creditsCharged > credits) {
    const excess = settlement.creditsCharged - credits;
    logger.error('credit_invariant_violation_actual_exceeds_hold', {
      orgId, action, confirmId,
      heldCredits:    credits,
      chargedCredits: settlement.creditsCharged,
      excess,
      provider:       finalProvider,
      model:          finalModel,
    });
    void recordCostAnomaly({
      organizationId: orgId,
      type:           'cost_credit_mismatch',
      severity:       'critical',
      actionKey:      opts.llmPricing?.actionKey ?? action,
      modelName:      finalModel,
      metadata: {
        violation:       'actual_exceeds_hold',
        hold_credits:    credits,
        charged_credits: settlement.creditsCharged,
        excess_credits:  excess,
        provider:        finalProvider,
        input_tokens:    finalInputTokens,
        output_tokens:   finalOutputTokens,
        confirm_transaction_id: confirmId,
      },
    });
  }

  // ── 5c. Underfunded handling: wallet couldn't cover excess → flag org,
  //   record anomaly, log error. Still returns success so the user sees the
  //   LLM output, but ops is paged via the anomaly + org flag.
  if (settlement?.underfunded) {
    logger.error('credit_settlement_underfunded', {
      orgId, action, confirmId,
      heldCredits:    credits,
      chargedCredits: settlement.creditsCharged,
      provider:       finalProvider,
      model:          finalModel,
    });
    void recordCostAnomaly({
      organizationId: orgId,
      type:           'cost_credit_mismatch',
      severity:       'critical',
      actionKey:      opts.llmPricing?.actionKey ?? action,
      modelName:      finalModel,
      metadata: {
        violation:       'underfunded_settlement',
        hold_credits:    credits,
        charged_credits: settlement.creditsCharged,
        provider:        finalProvider,
        input_tokens:    finalInputTokens,
        output_tokens:   finalOutputTokens,
        confirm_transaction_id: confirmId,
      },
    });
    // Immediately restrict the org — next preflightCheck returns ORG_BLOCKED.
    // This blocks further credit-consuming calls until an admin reviews and
    // lifts the block via applyOrgControl({block:false, ...}).
    try {
      const { autoBlockLlm } = await import('./orgControlService');
      await autoBlockLlm(orgId, `Underfunded settlement on action=${action} (hold=${credits}, charged=${settlement.creditsCharged})`);
    } catch (blockErr: any) {
      logger.error('credit_auto_block_failed', { orgId, action, message: blockErr?.message ?? 'unknown' });
    }
  }

  // ── 5d. usage_events row — ONLY for non-LLM (fixed) flows.
  //   For LLM flows (llmPricing present), aiGateway already wrote the
  //   authoritative usage_events row with provider, model, tokens, and cost.
  //   Writing another row here would double-count. For fixed-cost flows,
  //   there's no aiGateway call, so executeWithCredits writes the single
  //   'internal' row that records credits_charged.
  if (confirmId && !opts.llmPricing) {
    void logUsageEvent({
      organization_id: orgId,
      user_id:         userId,
      source_type:     'internal',
      source_name:     'credit_execution',
      ledger_hold_transaction_id: holdId,
      process_type:    action,
      input_tokens:    0,
      output_tokens:   0,
      total_tokens:    0,
      unit_cost:       0,
      total_cost:      0,
      total_cost_usd:  0,
      final_price_usd: null,
      error_flag:      false,
      retry_attempt:   1,
      final_attempt:   true,
      credits_charged: settlement?.creditsCharged ?? credits,
      reference_type:  referenceType,
      reference_id:    referenceId,
      metadata: {
        confirm_transaction_id: confirmId,
        pricing_hold_credits:   credits,
      },
    });
  }

  return { status: 'executed', result: executorResult, settlement };
}

// ── Admin grants ───────────────────────────────────────────────────────────────

/**
 * Create a credit grant (admin operation or onboarding).
 * Routes through apply_credit_reservation with phase='grant'.
 * Idempotency key is REQUIRED.
 *
 * @example
 * ```ts
 * await createCredit({
 *   orgId:          company.id,
 *   amount:         300,
 *   category:       'free',
 *   referenceType:  'free_credits',
 *   performedBy:    user.id,
 *   idempotencyKey: makeIdempotencyKey(user.id, 'onboarding_grant', company.id),
 * });
 * ```
 */
export async function createCredit(opts: CreateCreditOptions): Promise<void> {
  if (!opts.idempotencyKey || opts.idempotencyKey.trim() === '') {
    throw new Error('[createCredit] MISSING idempotencyKey — credit grants require deterministic keys');
  }

  // Canonical UUID anti-corruption boundary. orgId + performedBy MUST be
  // UUIDs (real foreign keys); referenceId is optional for grants — when
  // present we coerce it through the same path as executeWithCredits so
  // semantic keys never reach the credit_transactions.reference_id column.
  assertUuid(opts.orgId, 'orgId');
  assertUuid(opts.performedBy, 'performedBy');
  let canonicalReferenceId: string | undefined;
  let grantNote = opts.note ?? `${opts.category} credit grant`;
  if (opts.referenceId != null && opts.referenceId !== '') {
    const canonical = canonicalizeReference(opts.referenceId, `billing:${opts.referenceType}`);
    canonicalReferenceId = canonical.uuid;
    if (canonical.derived) {
      grantNote = `${grantNote} [semanticRef=${canonical.semantic}]`;
    }
  }

  const split: CategorySplit = {
    free:      opts.category === 'free'      ? opts.amount : 0,
    incentive: opts.category === 'incentive' ? opts.amount : 0,
    paid:      opts.category === 'paid'      ? opts.amount : 0,
  };

  const { error } = await callCreditReservation({
    orgId:          opts.orgId,
    phase:          'grant',
    split,
    idempotencyKey: opts.idempotencyKey,
    referenceType:  opts.referenceType,
    referenceId:    canonicalReferenceId,
    note:           grantNote,
    performedBy:    opts.performedBy,
    // Pass the caller's declared category through. The RPC defaults to 'paid'
    // when this is missing, which silently mislabeled every free/incentive
    // grant. createCredit's amount is single-category by construction so we
    // can trust opts.category as the source of truth.
    category:       opts.category,
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

// ── Best-effort deduction wrappers ────────────────────────────────────────────
//
// These wrappers use executeWithCredits internally, ensuring ALL deductions
// go through the HOLD → EXECUTE → CONFIRM/RELEASE path.
//
// Idempotency key strategy for best-effort callers:
//   - Use opts.referenceId or opts.campaignId when available (most precise)
//   - Fall back to a time-bucket salt sized to the action's smart-mode window
//     (e.g. 1-hour bucket for trend_analysis, 24-hour bucket for website_audit)
//   This ensures: same org+action within the dedup window = idempotent;
//   different work items with distinct referenceIds = separate charges.

function buildBestEffortKey(
  orgId:  string,
  action: CreditAction,
  opts:   DeductOptions,
  windowSec: number,
): { idempotencyKey: string; referenceId: string } {
  const actorId    = opts.userId ?? orgId;
  const refId      = opts.referenceId ?? opts.campaignId;

  if (refId) {
    return {
      idempotencyKey: makeIdempotencyKey(actorId, action, refId),
      referenceId:    refId,
    };
  }

  // No referenceId — bucket by the action's dedup window (or 1 h default)
  const bucketMs   = windowSec * 1000;
  const bucket     = Math.floor(Date.now() / bucketMs).toString();

  return {
    idempotencyKey: makeIdempotencyKey(actorId, action, `${orgId}:${bucket}`),
    referenceId:    `${orgId}:${bucket}`,
  };
}

/**
 * Deduct credits in a best-effort, non-blocking way.
 *
 * Used by high-level workflows where execution should continue regardless of
 * credit status. All deductions are routed through executeWithCredits (HOLD →
 * no-op executor → CONFIRM/RELEASE), ensuring full atomicity and idempotency.
 *
 * Callers should pass opts.referenceId (campaignId, contentId, etc.) for the
 * most precise idempotency. Without it, a time-bucket key is generated.
 */
export async function deductCreditsAwaited(
  orgId: string,
  action: CreditAction,
  opts: DeductOptions = {},
  smartMode = true,
): Promise<DeductResult> {
  try {
    // Smart Mode dedup — skip charge if same action ran recently
    if (smartMode) {
      const dedupWindow = await getSmartModeDedupSeconds(action);
      if (dedupWindow && await wasRecentlyRun(orgId, action, dedupWindow)) {
        return { success: true, skipped: true, reason: 'smart_mode_dedup' };
      }
    }

    const credits = Math.round((await getCreditCost(action)) * (opts.multiplier ?? 1));
    const dedupWindow = await getSmartModeDedupSeconds(action);
    const { idempotencyKey, referenceId } = buildBestEffortKey(orgId, action, opts, dedupWindow ?? 3_600);

    const result = await executeWithCredits({
      userId:         opts.userId ?? orgId,
      orgId,
      action,
      referenceType:  action,
      referenceId,
      idempotencyKey,
      amountOverride: credits,
      note:           opts.note,
      executor:       async () => { /* best-effort: work already done by caller */ },
    });

    if (result.status === 'executed' || result.status === 'already_confirmed') {
      const balanceAfter = await getTotalAvailable(orgId);
      return { success: true, creditsCharged: credits, balanceAfter: balanceAfter ?? 0 };
    }
    if (result.status === 'already_released') {
      return { success: true, skipped: true, reason: 'smart_mode_dedup' };
    }
    if (result.status === 'insufficient_credits') {
      return {
        success: false,
        reason:  'insufficient_credits',
        detail:  `Need ${result.required}, have ${result.available}`,
      };
    }
    if (result.status === 'no_credit_account') {
      return { success: false, reason: 'no_credit_account' };
    }
    return { success: false, reason: 'error' };
  } catch (err: unknown) {
    logger.error('credit_deduct_unexpected_error', {
      orgId,
      action,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      reason:  'error',
      detail:  err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Deduct credits when a value condition is true.
 * If valueFound is false, deduction is skipped entirely (no hold placed).
 * If valueFound is true, routes through executeWithCredits like deductCreditsAwaited.
 */
export async function deductCreditsIfValueAwaited(
  orgId: string,
  action: CreditAction,
  valueFound: boolean,
  opts: DeductOptions = {},
  smartMode = true,
): Promise<DeductResult & { valueFound: boolean }> {
  try {
    if (!valueFound) {
      return { success: true, skipped: true, reason: 'smart_mode_dedup', valueFound: false };
    }
    const result = await deductCreditsAwaited(orgId, action, opts, smartMode);
    if (!result.success) {
      const reason = result.reason ?? 'unknown';
      const detail = result.detail ? ` detail=${result.detail}` : '';
      logger.warn('credit_deduct_if_value_failed', {
        orgId,
        action,
        valueFound,
        reason,
        detail,
      });
    }
    return { ...result, valueFound: true };
  } catch (err: unknown) {
    logger.error('credit_deduct_if_value_unexpected_error', {
      orgId,
      action,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      reason:  'error',
      detail:  err instanceof Error ? err.message : String(err),
      valueFound,
    };
  }
}

// ── Re-exports for callers ─────────────────────────────────────────────────────
export type { CreditAction, DeductOptions, DeductResult };
