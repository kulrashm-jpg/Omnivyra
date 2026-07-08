/** Credit execution runtime — entry-consumption settlement (Phase 12E) — split from creditExecutionServiceRuntime.ts (barrel preserved; importers unchanged). */
/** Credit execution — executeWithCredits + entry-consumption runtime — split from creditExecutionService.ts (barrel preserved; importers unchanged). */
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
import { fireAlerts, type LlmUsageSource, type LlmExecutorResult, type LlmPricingSpec, type ExecuteBase, type ExecuteWithCreditsOptions, type SettlementReport, type ExecuteResult, type CreditReservationHandle, type CreditReservationResult, type CreateCreditOptions, makeIdempotencyKey, scaleSplitToActual, getReservationKeys, assertCanonicalBillingIdentifiers, assertCanonicalCreditAction, reserveCreditsForWork, confirmCreditReservation, releaseCreditReservation } from './creditExecutionServiceContracts';

import { executeWithCredits } from './creditExecutionServiceRuntimeCore';

export interface EntryConsumptionSettlement {
  /** Non-refundable credits consumed up front at the first billable resource. */
  entryConsumed: number;
  /** Exposure held after the entry charge (catalog max − entry). */
  exposureReserved: number;
  /** Credits drawn from the exposure during settlement (actual − entry, clamped). */
  additionalConsumed: number;
  /** Exposure returned to the wallet (exposure − additional). */
  exposureReleased: number;
  /** entryConsumed + additionalConsumed. */
  totalConsumed: number;
  /** True if actual exceeded entry + exposure (i.e. > catalog max). */
  underfunded: boolean;
  pricing?: ResolvedLlmCost;
}

export type ExecuteWithEntryConsumptionResult<T> =
  | { status: 'executed'; result: T; settlement: EntryConsumptionSettlement }
  | { status: 'already_settled' }
  | { status: 'already_released' }
  | { status: 'insufficient_credits'; available: number; required: number }
  | { status: 'no_credit_account' }
  | { status: 'not_a_member'; userId: string; orgId: string }
  | { status: 'org_control_blocked'; code: 'ORG_BLOCKED' | 'HIGH_RISK_ACTION_GATED' | 'DAILY_LIMIT_EXCEEDED'; reason: string };

export interface ExecuteWithEntryConsumptionOptionsFixed<T> extends ExecuteBase {
  llmPricing?: undefined;
  executor:   () => Promise<T>;
}
export interface ExecuteWithEntryConsumptionOptionsLlm<T> extends ExecuteBase {
  llmPricing: LlmPricingSpec;
  executor:   () => Promise<LlmExecutorResult<T>>;
}
/**
 * Phase 10B/12E — token-metered variant. The executor returns the result
 * directly (its natural type) and runs inside the ENGINE's usage scope, so
 * ACTUAL token usage is collected by the engine (no caller threading) and the
 * first provider completion fires the deferred entry consumer. Settlement is
 * token-actual (resolveLlmCost on the collected tokens) — the same pricing +
 * partial-confirm primitives as the LLM variant. For paths (e.g. queue
 * processors) that aggregate tokens across several AI calls and don't want to
 * reshape their executor's return as LlmExecutorResult.
 */
export interface ExecuteWithEntryConsumptionOptionsTokenMetered<T> extends ExecuteBase {
  llmPricing: LlmPricingSpec;
  executor:   () => Promise<T>;
  /**
   * Phase 12E — the engine runs the executor inside its OWN usage scope and
   * collects ACTUAL provider usage from it (so the caller no longer threads
   * usage). The first provider/asset event in that scope fires the deferred
   * entry consumer. Non-token artifact credits recorded via recordAssetCredits
   * in scope (Phase 10E) are folded into the settled amount. This flag
   * discriminates the token-metered variant from the LLM variant.
   */
  collectViaCollector: true;
}
export type ExecuteWithEntryConsumptionOptions<T> =
  | ExecuteWithEntryConsumptionOptionsTokenMetered<T>
  | ExecuteWithEntryConsumptionOptionsFixed<T>
  | ExecuteWithEntryConsumptionOptionsLlm<T>;

/**
 * PURE settlement planner — the arithmetic core of TASK 4. Given the entry
 * already consumed, the exposure reserved, and the actual cost, compute how much
 * additional to draw from exposure and how much to release.
 *
 *   additionalConsumption = clamp(actual − entry, 0, reservation)
 *   exposureReleased      = reservation − additionalConsumption
 *   underfunded           = (actual − entry) > reservation   // actual > catalog max
 *
 * Exported so it can be unit-tested without any DB.
 */
export function planEntryConsumptionSettlement(input: {
  entry: number;
  reservation: number;
  actualCredits: number;
}): { additionalConsumption: number; exposureReleased: number; underfunded: boolean } {
  const entry       = Math.max(0, Math.floor(input.entry));
  const reservation = Math.max(0, Math.floor(input.reservation));
  const actual      = Math.max(0, Math.floor(input.actualCredits));
  const rawAdditional       = Math.max(0, actual - entry);
  const additionalConsumption = Math.min(rawAdditional, reservation);
  const exposureReleased      = reservation - additionalConsumption;
  const underfunded           = rawAdditional > reservation;
  return { additionalConsumption, exposureReleased, underfunded };
}

/** Map a non-reserved reservation outcome onto the orchestrator's result type. */
function mapReservationFailure(
  r: CreditReservationResult,
): Extract<ExecuteWithEntryConsumptionResult<never>,
  { status: 'insufficient_credits' | 'no_credit_account' | 'not_a_member' | 'org_control_blocked' | 'already_settled' | 'already_released' }> {
  switch (r.status) {
    case 'insufficient_credits': return { status: 'insufficient_credits', available: r.available, required: r.required };
    case 'no_credit_account':    return { status: 'no_credit_account' };
    case 'not_a_member':         return { status: 'not_a_member', userId: r.userId, orgId: r.orgId };
    case 'org_control_blocked':  return { status: 'org_control_blocked', code: r.code, reason: r.reason };
    case 'already_confirmed':    return { status: 'already_settled' };
    case 'already_released':     return { status: 'already_released' };
    default:
      // 'reserved' | 'already_reserved' never reach here (handled by callers).
      throw new Error(`[entryConsumption] unexpected reservation status: ${r.status}`);
  }
}

/**
 * Phase 10A — shared selector for adopting the entry-consumption engine on a
 * customer-activity path. Default OFF (PHASE2_ENTRY_CONSUMPTION unset) → the
 * path keeps its existing executeWithCredits / orchestrator behavior, byte-
 * identical. Doubly dark: a path also needs its own enforcement gate ON. This
 * is the single source of truth for the flag (phase2RouteWiring re-uses it).
 */
export function isEntryConsumptionEnabled(): boolean {
  return String(process.env.PHASE2_ENTRY_CONSUMPTION ?? '').toLowerCase() === 'true';
}

/**
 * Execute work under the entry-consumption economy. See the block comment above.
 * Replay-safe (deterministic per-stage idempotency keys), immutability- and
 * lineage-preserving (parent_transaction_id flows through the primitives), and
 * abandonment-safe (entry kept, exposure released — by the existing reaper if
 * the process dies).
 */
export async function executeWithEntryConsumption<T>(
  opts: ExecuteWithEntryConsumptionOptions<T>,
): Promise<ExecuteWithEntryConsumptionResult<T>> {
  const { action, referenceType } = opts;

  if (!opts.idempotencyKey || opts.idempotencyKey.trim() === '') {
    throw new Error(`[entryConsumption] MISSING idempotencyKey for action "${action}"`);
  }

  // TASK 1 — economics from the Phase 8A catalog.
  const econ        = resolveActivityEconomics(action);
  const entry       = econ.entryConsumption;          // TASK 2
  const reservation = econ.reservationCredits;        // TASK 3 (= max − entry)
  const maxExposure = econ.maximumCredits;            // admission ceiling

  // Distinct, deterministic per-stage idempotency roots (TASK 6 replay safety).
  const entryKey    = `${opts.idempotencyKey}:entry`;
  const exposureKey = `${opts.idempotencyKey}:exposure`;
  const { confirmKey: exposureConfirmKey, releaseKey: exposureReleaseKey } = getReservationKeys(exposureKey);

  // Idempotency gate: if the exposure was already settled/released on a prior
  // attempt, do NOT re-execute the work.
  const [settledTxn, releasedTxn] = await Promise.all([
    findCreditTransaction(exposureConfirmKey),
    findCreditTransaction(exposureReleaseKey),
  ]);
  if (settledTxn)  return { status: 'already_settled' };
  if (releasedTxn) return { status: 'already_released' };

  // Admission control (Phase 8 TASK 2): require effective balance ≥ MAX exposure
  // BEFORE consuming the non-refundable entry, so we never charge entry on an
  // activity that cannot reserve its full exposure.
  const availableTotal = await getTotalAvailable(opts.orgId);
  if ((availableTotal ?? 0) < maxExposure) {
    fireAlerts(opts.orgId);
    return { status: 'insufficient_credits', available: availableTotal ?? 0, required: maxExposure };
  }

  const reserveCommon = {
    userId:             opts.userId,
    orgId:              opts.orgId,
    action,
    referenceType,
    referenceId:        opts.referenceId,
    validateMembership: opts.validateMembership,
  };

  // ── STAGE 1 — ENTRY CONSUMER (Phase 12E: DEFERRED to the first consumable
  // event). The non-refundable entry is NOT charged at launch. Instead we define
  // a consumer that the first provider/asset event fires (STAGE 3), composing the
  // SAME reserve→confirm primitives + the SAME deterministic entryKey, so it is
  // idempotent/replay-safe and consumed at most once even across retries.
  let entryConsumed = 0;
  const consumeEntry = async (): Promise<number> => {
    if (entry <= 0) return 0;
    const entryRes = await reserveCreditsForWork({
      ...reserveCommon,
      idempotencyKey: entryKey,
      amountOverride: entry,
      note: `[ENTRY] ${opts.note ?? action}`,
    });
    if (entryRes.status === 'reserved' || entryRes.status === 'already_reserved') {
      const entryConfirm = await confirmCreditReservation({ ...entryRes, note: `[ENTRY] ${opts.note ?? action}` });
      if (entryConfirm.status === 'already_released') return 0;
      return entry;
    }
    if (entryRes.status === 'already_confirmed') return entry; // resume: already consumed
    // Admission already guaranteed effective balance >= MAX exposure, so entry
    // (<= max, and affordable after the exposure HOLD) should reserve; treat an
    // unexpected failure as cost-from-exposure rather than blocking post-work.
    logger.error('entry_consumption_first_event_reserve_failed', { orgId: opts.orgId, action, status: entryRes.status });
    return 0;
  };

  // ── STAGE 2 — EXPOSURE RESERVATION — HOLD(max − entry) ───────────────────────
  let exposureHandle: CreditReservationHandle | null = null;
  if (reservation > 0) {
    const expRes = await reserveCreditsForWork({
      ...reserveCommon,
      idempotencyKey: exposureKey,
      amountOverride: reservation,
      note: `[EXPOSURE] ${opts.note ?? action}`,
    });
    if (expRes.status === 'reserved' || expRes.status === 'already_reserved') {
      exposureHandle = expRes;
    } else {
      // Entry is already consumed (kept, by design). Exposure could not be
      // reserved — surface the failure; the entry charge stands.
      logger.error('entry_consumption_exposure_reservation_failed', {
        orgId: opts.orgId, action, status: expRes.status, entryConsumed,
      });
      return mapReservationFailure(expRes);
    }
  }

  // ── STAGE 3 — EXECUTE (entry is consumed lazily at the FIRST consumable event) ─
  // The executor runs inside an engine-owned usage scope. The first provider
  // completion / billable artifact fires the armed consumer, which charges the
  // non-refundable entry exactly once — never at launch, validation, or setup.
  const scope = createUsageScope();
  let entryPromise: Promise<number> | null = null;
  if (entry > 0) scope.armFirstConsumable(() => { entryPromise = consumeEntry(); });

  let executorResult: T;
  let actualCredits: number;
  let pricing: ResolvedLlmCost | undefined;
  try {
    if ('collectViaCollector' in opts && opts.collectViaCollector) {
      // Phase 10B/12E — token-metered: engine collects ACTUAL usage from its own
      // scope; the first provider completion fires the entry consumer.
      executorResult = await scope.run(() => (opts.executor as () => Promise<T>)());
      const u = scope.usage;
      pricing = await resolveExecutionLlmCost({
        provider:     opts.llmPricing.provider,
        model:        opts.llmPricing.model,
        inputTokens:  Math.max(0, u.inputTokens),
        outputTokens: Math.max(0, u.outputTokens),
        actionKey:    opts.llmPricing.actionKey,
        orgId:        opts.orgId,
        timestamp:    opts.llmPricing.timestamp,
      });
      // Phase 10E — token credits + non-token artifact credits (e.g. images).
      actualCredits = Math.max(0, pricing.credits) + Math.max(0, u.assetCredits);
    } else if (opts.llmPricing) {
      const wrapped = await scope.run(() => (opts.executor as () => Promise<LlmExecutorResult<T>>)());
      executorResult = wrapped.result;
      pricing = await resolveExecutionLlmCost({
        provider:     opts.llmPricing.provider,
        model:        opts.llmPricing.model,
        inputTokens:  wrapped.usage.inputTokens,
        outputTokens: wrapped.usage.outputTokens,
        actionKey:    opts.llmPricing.actionKey,
        orgId:        opts.orgId,
        timestamp:    opts.llmPricing.timestamp,
      });
      actualCredits = Math.max(0, pricing.credits);
    } else {
      executorResult = await scope.run(() => (opts.executor as () => Promise<T>)());
      actualCredits  = opts.amountOverride ?? await getCreditCost(action);
    }
  } catch (execErr: any) {
    // ── ABANDONMENT (Phase 12E): entry kept ONLY if a consumable event fired;
    // exposure released. A failure BEFORE the first provider call consumes
    // NOTHING (entry not charged) — the requirement's core guarantee.
    let abandonEntry = 0;
    if (entryPromise) { try { abandonEntry = await entryPromise; } catch { /* ignore */ } }
    if (exposureHandle) {
      await releaseCreditReservation({ ...exposureHandle, note: `[EXPOSURE][RELEASE] ${action} — executor error` });
    }
    void import('./billing/creditEconomyObservability')
      .then((m) => m.recordSettlementObservation({
        activity:         action,
        entryConsumed:    abandonEntry,
        exposureReleased: reservation,
        abandoned:        true,
        dedupeKey:        `${opts.idempotencyKey}:abandon`,
      }))
      .catch(() => {});
    throw execErr;
  }

  // Resolve the entry actually consumed. FIXED-price activities owe their price
  // on SUCCESS even if no provider call occurred (deterministic completion), so
  // consume entry now if the trigger never fired. Token-priced activities with
  // NO consumable event consume NOTHING (final charge resolves to ~0).
  if (entry > 0 && !entryPromise && !opts.llmPricing) {
    entryPromise = consumeEntry();
  }
  if (entryPromise) entryConsumed = await entryPromise;

  // ── STAGE 4 — SETTLEMENT (TASK 4): consume actual−entry from exposure ────────
  const plan = planEntryConsumptionSettlement({ entry: entryConsumed, reservation, actualCredits });
  let additionalConsumed = 0;
  let exposureReleased   = reservation;

  if (exposureHandle) {
    const actualSplit = scaleSplitToActual(exposureHandle.split, plan.additionalConsumption);
    const { error: settleErr, data: settleData } = await callCreditPartialConfirm({
      orgId:          exposureHandle.orgId,
      holdTxnId:      exposureHandle.holdTransactionId,
      actualSplit,
      idempotencyKey: exposureConfirmKey,
      referenceType:  exposureHandle.referenceType,
      referenceId:    exposureHandle.referenceId,
      note:           `[SETTLE] ${opts.note ?? action}`,
      performedBy:    exposureHandle.userId,
    });
    if (settleErr) {
      const msg = (settleErr as any).message ?? '';
      logger.error('entry_consumption_settle_failed', { orgId: opts.orgId, action, message: msg });
      await releaseCreditReservation({ ...exposureHandle, note: `[EXPOSURE][RELEASE] ${action} — settle failed` });
      throw new Error(`[entryConsumption] exposure settle failed: ${msg}`);
    }
    additionalConsumed = Number((settleData as any)?.total_consumed ?? plan.additionalConsumption);
    exposureReleased   = Number((settleData as any)?.total_released ?? plan.exposureReleased);

    const settleConfirmId = (settleData as any)?.id ?? null;
    if (settleConfirmId) {
      await trackUsage({
        orgId:                exposureHandle.orgId,
        userId:               exposureHandle.userId,
        action,
        credits:              additionalConsumed,
        split:                actualSplit,
        referenceType:        exposureHandle.referenceType,
        referenceId:          exposureHandle.referenceId,
        confirmTransactionId: settleConfirmId,
      });
    }
  } else {
    exposureReleased = 0; // no exposure was held (entry == max)
  }

  // Underfunded = actual exceeded the catalog max. Mirror executeWithCredits:
  // record a critical anomaly (the entry/exposure flow caps draw at the
  // reserved exposure, so no negative balance is carried).
  if (plan.underfunded) {
    logger.error('entry_consumption_underfunded', {
      orgId: opts.orgId, action,
      entryConsumed, exposureReserved: reservation, actualCredits, maxExposure,
    });
    void recordCostAnomaly({
      organizationId: opts.orgId,
      type:           'cost_credit_mismatch',
      severity:       'critical',
      actionKey:      opts.llmPricing?.actionKey ?? action,
      modelName:      opts.llmPricing?.model,
      metadata: {
        violation:        'entry_consumption_exceeds_max',
        entry_credits:    entryConsumed,
        exposure_credits: reservation,
        actual_credits:   actualCredits,
        max_credits:      maxExposure,
      },
    });
  }

  // Phase 11C — durable observation of the completed settlement (fire-and-forget;
  // the recorder swallows all errors, never blocks, never mutates billing). The
  // financial settlement above is already committed and is NOT affected. Keyed by
  // the settlement idempotency key so a replay (already_settled, returned far
  // above) can never double-count.
  void import('./billing/creditEconomyObservability')
    .then((m) => m.recordSettlementObservation({
      activity:           action,
      entryConsumed,
      exposureReserved:   reservation,
      exposureReleased,
      actualConsumed:     actualCredits,
      underfunded:        plan.underfunded,
      settlementVariance: maxExposure - actualCredits,
      dedupeKey:          opts.idempotencyKey,
    }))
    .catch(() => {});

  return {
    status: 'executed',
    result: executorResult,
    settlement: {
      entryConsumed,
      exposureReserved: reservation,
      additionalConsumed,
      exposureReleased,
      totalConsumed: entryConsumed + additionalConsumed,
      underfunded: plan.underfunded,
      pricing,
    },
  };
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


