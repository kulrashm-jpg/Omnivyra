/**
 * Phase 2 Task 7 — Immutable policy snapshot frozen at HOLD creation.
 *
 * Deterministic pricing truth captured BEFORE execution so historical
 * billing/invoice/audit never depends on future pricing reconstruction.
 *
 * STRICT: additive, best-effort (NEVER throws — a snapshot failure must not
 * break HOLD→EXECUTE or change settlement math), idempotent (ON CONFLICT DO
 * NOTHING keyed by hold_transaction_id ⇒ retries with the same idempotency
 * key never diverge), no RPC/ledger mutation. Lives in the append-only,
 * immutable side table credit_hold_policy_snapshots (migration 20260666).
 *
 * Inheritance: CONFIRM/RELEASE rows carry parent_transaction_id → the HOLD
 * id; consumers resolve policy for any settlement by looking up the snapshot
 * via that HOLD id. No copying.
 *
 * Rollback: delete the single call site + this file + the migration. Nothing
 * reads the table yet; absence = legacy row (reconstruct from pricing tables
 * = current behavior). No backfill.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';

const SNAPSHOT_VERSION = 1;

export interface BuildHoldSnapshotArgs {
  action: string;
  /** Resolved credit amount reserved by this HOLD. */
  credits: number;
  /** The executeWithCredits opts (read-only; only pricing-relevant fields used). */
  opts: {
    amountOverride?: number | null;
    referenceType?: string | null;
    /** Accepts the service's LlmPricingSpec as-is; fields read defensively. */
    llmPricing?: unknown;
  };
  split: { free: number; incentive: number; paid: number };
  referenceType: string;
  referenceId: string;
  idempotencyBaseKey: string;
}

/**
 * Pure, deterministic. Built ONLY from HOLD-time inputs — never from mutable
 * runtime state observed after the provider call.
 */
export function buildHoldPolicySnapshot(a: BuildHoldSnapshotArgs): Record<string, unknown> {
  const lp = (a.opts.llmPricing ?? null) as Record<string, unknown> | null;
  const isOverride = a.opts.amountOverride != null;
  const isToken = !isOverride && !!lp;
  const executionMode = isOverride ? 'override' : isToken ? 'token' : 'flat';
  const pricingSource = isOverride
    ? 'amount_override'
    : isToken
      ? 'llm_pricing_estimate'
      : 'credit_cost_config';

  return {
    v: SNAPSHOT_VERSION,
    frozen_at: new Date().toISOString(),
    action_key: a.action,
    reference_type: a.referenceType,
    reference_id: a.referenceId,
    resolved_credits: a.credits,
    execution_mode: executionMode,
    pricing_source: pricingSource,
    // Pricing "version": no formal version column exists yet (Audit Gap #1).
    // We freeze the resolved values themselves — the deterministic truth —
    // plus the resolver path, which is sufficient for reproducibility.
    cost_basis: 'hold_time_resolution',
    llm_pricing: isToken && lp
      ? {
          provider: lp.provider ?? null,
          model: lp.model ?? null,
          max_input_tokens: lp.maxInputTokens ?? null,
          max_output_tokens: lp.maxOutputTokens ?? null,
          action_key: lp.actionKey ?? null,
          pricing_timestamp: lp.timestamp ?? null,
        }
      : null,
    split: { free: a.split.free, incentive: a.split.incentive, paid: a.split.paid },
    idempotency_base_key: a.idempotencyBaseKey,
  };
}

/**
 * Persist the snapshot for a HOLD. Best-effort, idempotent, never throws.
 */
export async function freezeHoldPolicySnapshot(args: {
  holdTransactionId: string;
  organizationId: string;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase
      .from('credit_hold_policy_snapshots')
      .upsert(
        {
          hold_transaction_id: args.holdTransactionId,
          organization_id: args.organizationId,
          snapshot: args.snapshot,
        },
        { onConflict: 'hold_transaction_id', ignoreDuplicates: true },
      );
    if (error) {
      logger.warn('hold_policy_snapshot_write_failed', {
        holdTransactionId: args.holdTransactionId,
        message: error.message,
      });
    }
  } catch (err) {
    logger.warn('hold_policy_snapshot_write_threw', {
      holdTransactionId: args.holdTransactionId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
