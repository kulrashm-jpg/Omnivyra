/** Credit execution runtime — executeWithCredits (reserve → execute → settle) — split from creditExecutionServiceRuntime.ts (barrel preserved; importers unchanged). */
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

// ── Phase 8B: entry-consumption orchestration ───────────────────────────────────
//
// Converts a single activity from HOLD(MAX) → CONSUME(ENTRY) + RESERVE(MAX−ENTRY),
// composing ONLY the existing certified primitives (reserveCreditsForWork /
// confirmCreditReservation / releaseCreditReservation / callCreditPartialConfirm).
// The ledger, RPCs, idempotency, immutability, and orphan reaper are unchanged
// and remain authoritative.
//
// DARK BY DEFAULT: nothing in any route calls executeWithEntryConsumption — it is
// built, tested, and unwired, so production behavior is byte-identical until a
// later, separately-approved phase routes traffic to it. executeWithCredits (the
// path the live routes use) is NOT modified.
//
// Lifecycle (mirrors the Phase-8 target flow):
//   CONFIRM(entry)          — reserveCreditsForWork(entryKey) → confirmCreditReservation
//                             → non-refundable, visible as consumed
//   HOLD(max − entry)       — reserveCreditsForWork(exposureKey) → exposure reservation
//   EXECUTE
//   CONFIRM(actual − entry) — callCreditPartialConfirm on the exposure hold
//   RELEASE(unused)         — the same partial_confirm releases the remainder
//   abandon → RELEASE exposure (entry kept). If the process dies, the EXISTING
//             orphan reaper releases the orphaned exposure hold (the entry hold
//             has a :confirm sibling, so the reaper leaves it consumed).

