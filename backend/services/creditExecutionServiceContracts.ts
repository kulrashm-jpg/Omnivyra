/** Credit execution — contracts, pricing specs, reservation confirm — split from creditExecutionService.ts (barrel preserved; importers unchanged). */
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
import { createUsageScope } from './aiUsageCollector';
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
import { resolveActivityEconomics } from './activityEconomyCatalog';
import { buildHoldPolicySnapshot, freezeHoldPolicySnapshot } from './billing/holdPolicySnapshot';
import { evaluateCreditSafetyGate } from './billing/creditSafetyGate';
import { resolveBillingPolicy } from './billing/billingPolicyResolver';
import { assertUuid, canonicalizeReference, type Uuid } from '@/lib/shared/uuid';

/** Fire credit threshold alerts in the background — non-blocking, swallows errors. */

export function fireAlerts(orgId: string): void {
  checkCreditAlerts(orgId).catch(err =>
    logger.warn('credit_alert_check_failed', { orgId, message: err?.message ?? 'unknown' }),
  );
  // Consumption-based warnings (80/90/95 in-app + 85%+forecast email). Best-effort, isolated,
  // runs only after a successful deduction (this helper is invoked post-CONFIRM). Never blocks.
  import('./creditConsumptionWarningService')
    .then(m => m.notifyConsumptionWarnings(orgId))
    .catch(err => logger.warn('credit_consumption_warning_failed', { orgId, message: err?.message ?? 'unknown' }));
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

export interface ExecuteBase {
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
export function scaleSplitToActual(held: CategorySplit, actual: number): CategorySplit {
  const total = held.free + held.incentive + held.paid;
  if (total <= 0 || actual <= 0) return { free: 0, incentive: 0, paid: 0 };
  const freeA       = Math.floor((held.free      * actual) / total);
  const paidA       = Math.floor((held.paid      * actual) / total);
  const incentiveA  = Math.max(0, actual - freeA - paidA);   // remainder bucket
  return { free: freeA, incentive: incentiveA, paid: paidA };
}

export function getReservationKeys(idempotencyKey: string): { holdKey: string; confirmKey: string; releaseKey: string } {
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
export function assertCanonicalBillingIdentifiers(input: {
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

export function assertCanonicalCreditAction(input: {
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

  // Low-balance check on the SUCCESSFUL deduction path (non-blocking).
  // Previously alerts only fired on failure/insufficiency paths, so the
  // "below 100 credits" warning could not arrive until an activity had
  // already been refused. Firing post-confirm warns at the crossing point.
  fireAlerts(handle.orgId);

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

/**
 * Phase 10F — settle an existing HOLD reservation to its ACTUAL cost instead of
 * confirming the full held amount. Reuses the SAME settlement primitive as the
 * entry-consumption engine (scaleSplitToActual + apply_credit_partial_confirm):
 * the actual is consumed from reserved and the unused remainder is released, in
 * one atomic, idempotent RPC. For the async report pipeline, whose reserve and
 * settle are split across the HTTP response (it cannot use the single-call
 * executeWithEntryConsumption) — token usage collected during generation prices
 * `actualCredits`, and this settles the report's HOLD against it.
 *
 * Idempotent + replay-safe via the SAME confirm key as confirmCreditReservation,
 * so a flat-confirmed or partial-confirmed reservation is never double-settled.
 * No new ledger/settlement primitive; lineage (parent HOLD) is preserved by the
 * RPC.
 */
export async function confirmCreditReservationToActual(
  handle: CreditReservationHandle & { note?: string },
  actualCredits: number,
): Promise<CreditReservationSettlement> {
  const { confirmKey, releaseKey } = getReservationKeys(handle.idempotencyKey);
  const [existingConfirm, existingRelease] = await Promise.all([
    findCreditTransaction(confirmKey),
    findCreditTransaction(releaseKey),
  ]);
  if (existingConfirm) return { status: 'already_confirmed' };
  if (existingRelease) return { status: 'already_released' };

  const actual = Math.max(0, Math.floor(actualCredits));
  const actualSplit = scaleSplitToActual(handle.split, actual);
  const { error, data } = await callCreditPartialConfirm({
    orgId:          handle.orgId,
    holdTxnId:      handle.holdTransactionId,
    actualSplit,
    idempotencyKey: confirmKey,
    referenceType:  handle.referenceType,
    referenceId:    handle.referenceId,
    note:           handle.note ?? handle.action.replace(/_/g, ' '),
    performedBy:    handle.userId,
  });
  if (error) {
    const msg = (error as any).message ?? '';
    logger.error('credit_reservation_partial_confirm_failed', { orgId: handle.orgId, action: handle.action, message: msg });
    throw new Error(`[creditReservation] partial confirm failed: ${msg}`);
  }

  const confirmId = (data as any)?.id ?? null;
  const consumed = Number((data as any)?.total_consumed ?? actual);
  if (confirmId) {
    await trackUsage({
      orgId:                handle.orgId,
      userId:               handle.userId,
      action:               handle.action,
      credits:              consumed,
      split:                actualSplit,
      referenceType:        handle.referenceType,
      referenceId:          handle.referenceId,
      confirmTransactionId: confirmId,
    });
  }
  // Low-balance check on the successful partial-confirm path too (non-blocking).
  fireAlerts(handle.orgId);
  return { status: 'confirmed', confirmTransactionId: confirmId, creditsCharged: consumed };
}

