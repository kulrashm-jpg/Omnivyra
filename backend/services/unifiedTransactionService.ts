/**
 * Unified Transactions Service — single writer for the consolidated ledger.
 *
 * Called dual-write from logUsageEvent AND the credit-execution CONFIRM path.
 * One usage_events row = one unified_transactions row. Credit-only rows
 * (source_type='internal' from executeWithCredits) are their own rows.
 *
 * Enforcement: DB-level CHECKs reject rows missing action_key (non-internal)
 * or missing api_cost on costed sources. If a CHECK fires, we catch the
 * error, emit a critical cost_anomalies row, and drop the unified row. The
 * parallel usage_events write stays intact so visibility isn't lost.
 */

import { supabase } from '../db/supabaseClient';
import { recordCostAnomaly } from './pricingService';
import { logger } from './logger';

// In-memory cache of per-org credit_rate_usd. The rate changes rarely; per-write
// DB lookup would double the unified ledger's insert cost.
const _creditRateCache = new Map<string, { rate: number; fetchedAt: number }>();
const CREDIT_RATE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CREDIT_RATE_USD = 0.001;

async function getCreditRateUsd(orgId: string): Promise<number> {
  const cached = _creditRateCache.get(orgId);
  if (cached && Date.now() - cached.fetchedAt < CREDIT_RATE_TTL_MS) {
    return cached.rate;
  }
  try {
    const { data } = await supabase
      .from('organization_credits')
      .select('credit_rate_usd')
      .eq('organization_id', orgId)
      .maybeSingle();
    const raw = Number((data as any)?.credit_rate_usd);
    const rate = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CREDIT_RATE_USD;
    _creditRateCache.set(orgId, { rate, fetchedAt: Date.now() });
    return rate;
  } catch {
    return DEFAULT_CREDIT_RATE_USD;
  }
}

export interface UnifiedTransactionInput {
  organization_id:  string;
  user_id?:         string | null;

  action_key:       string | null;
  source_type:
    | 'llm' | 'embedding' | 'cache'
    | 'external_api' | 'automation_execution'
    | 'system' | 'internal';

  provider_name?:   string | null;
  model_name?:      string | null;

  input_tokens?:    number | null;
  output_tokens?:   number | null;
  total_tokens?:    number | null;

  api_cost_usd?:    number | null;
  input_cost_usd?:  number | null;
  output_cost_usd?: number | null;
  final_price_usd?: number | null;
  credits_charged?: number | null;

  retry_attempt?:   number;
  final_attempt?:   boolean;

  error_flag?:      boolean;
  error_type?:      string | null;

  reference_type?:  string | null;
  reference_id?:    string | null;

  pricing_snapshot?: Record<string, unknown> | null;
  metadata?:         Record<string, unknown>;
}

/**
 * Write one row to unified_transactions. Never throws; on CHECK violation,
 * records a cost_anomalies row with severity=critical and drops the unified
 * row so the caller's user-facing flow continues.
 */
export async function recordUnifiedTransaction(input: UnifiedTransactionInput): Promise<void> {
  try {
    // Compute credits_value_usd at write time using the org's rate.
    let credits_value_usd: number | null = null;
    if (input.credits_charged != null && Number.isFinite(input.credits_charged)) {
      const rate = await getCreditRateUsd(input.organization_id);
      credits_value_usd = Number(input.credits_charged) * rate;
    }

    // Phase 7 final: pre-insert invariant check. Reject negative values
    // BEFORE hitting the DB CHECK so we can emit a rich anomaly. The DB
    // constraint still exists as defense-in-depth — any caller that
    // bypasses this service would still be rejected at the DB layer.
    const apiCost     = input.api_cost_usd ?? null;
    const creditsUsd  = credits_value_usd;
    if ((apiCost != null && apiCost < 0) || (creditsUsd != null && creditsUsd < 0)) {
      logger.error('unified_txn_rejected_negative_value', {
        orgId: input.organization_id,
        source: input.source_type,
        api_cost_usd: apiCost,
        credits_value_usd: creditsUsd,
      });
      void recordCostAnomaly({
        organizationId: input.organization_id,
        type:           'cost_credit_mismatch',
        severity:       'critical',
        apiCostUsd:     apiCost,
        creditsValueUsd: creditsUsd,
        actionKey:      input.action_key ?? null,
        modelName:      input.model_name ?? null,
        metadata: {
          source_type:      input.source_type,
          violation:        'negative_value_invariant',
          credits_charged:  input.credits_charged,
        },
      });
      return;  // refuse write
    }

    const row = {
      organization_id:   input.organization_id,
      user_id:           input.user_id ?? null,
      action_key:        input.action_key,
      source_type:       input.source_type,
      provider_name:     input.provider_name ?? null,
      model_name:        input.model_name ?? null,
      input_tokens:      input.input_tokens ?? null,
      output_tokens:     input.output_tokens ?? null,
      total_tokens:      input.total_tokens ?? null,
      api_cost_usd:      input.api_cost_usd ?? null,
      input_cost_usd:    input.input_cost_usd  ?? null,
      output_cost_usd:   input.output_cost_usd ?? null,
      final_price_usd:   input.final_price_usd ?? null,
      credits_charged:   input.credits_charged ?? null,
      credits_value_usd,
      retry_attempt:     input.retry_attempt ?? 1,
      final_attempt:     input.final_attempt !== false,   // default true
      error_flag:        input.error_flag === true,
      error_type:        input.error_type ?? null,
      reference_type:    input.reference_type ?? null,
      reference_id:      input.reference_id ?? null,
      pricing_snapshot:  input.pricing_snapshot ?? null,
      metadata:          input.metadata ?? {},
    };

    const { error } = await supabase.from('unified_transactions').insert(row);
    if (error) {
      // CHECK violations manifest as 23514; rethink and emit anomaly, not a
      // fatal log. Anything else is an insert-level problem (network, etc.).
      const code = (error as any).code;
      const msg  = error.message ?? 'unknown';

      if (code === '23514') {
        // Phase 7 final: distinguish the negative-value CHECK from the
        // action_key / cost_required CHECKs so analytics see the right
        // anomaly type. Constraint name lives in the error message.
        const isNegativeValue = msg.includes('unified_txn_cost_non_negative');
        void recordCostAnomaly({
          organizationId: input.organization_id,
          type:           isNegativeValue ? 'cost_credit_mismatch' : 'unknown_action_key',
          severity:       'critical',
          apiCostUsd:     input.api_cost_usd ?? null,
          processType:    input.action_key ?? null,
          actionKey:      input.action_key ?? null,
          modelName:      input.model_name ?? null,
          metadata: {
            source_type:     input.source_type,
            violation:       isNegativeValue ? 'negative_value_db_check' : 'check_constraint',
            constraint_hint: msg.slice(0, 200),
          },
        });
        logger.warn('unified_txn_check_violation', {
          orgId: input.organization_id,
          source: input.source_type,
          action: input.action_key,
          message: msg.slice(0, 200),
        });
        return;
      }

      logger.error('unified_txn_insert_failed', {
        orgId: input.organization_id,
        source: input.source_type,
        code,
        message: msg,
      });
    }
  } catch (err: any) {
    // Never surface writer errors to the caller.
    logger.error('unified_txn_write_error', {
      orgId: input.organization_id,
      message: err?.message,
    });
  }
}
