/**
 * Usage Tracking Service
 *
 * Records a usage event coupled to a confirmed credit transaction.
 *
 * Rules (enforced by design, not just convention):
 *   NO usage record without a confirm transaction ID.
 *   NO confirm transaction without a usage record.
 *   The DB unique index on credit_usage_log.confirm_transaction_id enforces
 *   exactly-one coupling at the database level.
 *
 * This service is called ONLY from the CONFIRM phase of executeWithCredits.
 * Never call it directly.
 */

import { supabase } from '../db/supabaseClient';
import type { CategorySplit } from './creditPriorityService';

export interface TrackUsageParams {
  orgId:                string;
  userId:               string;
  action:               string;
  credits:              number;
  split:                CategorySplit;
  referenceType:        string;
  referenceId?:         string;
  /** ID of the credit_transactions row produced by the CONFIRM phase */
  confirmTransactionId: string;
}

/**
 * Insert a usage record into credit_usage_log.
 *
 * The UNIQUE index on confirm_transaction_id makes this call idempotent:
 * a retry will produce a unique_violation which is swallowed — safe.
 */
export async function trackUsage(params: TrackUsageParams): Promise<void> {
  const { error } = await supabase.from('credit_usage_log').insert({
    organization_id:        params.orgId,
    user_id:                params.userId,
    action:                 params.action,
    credits_used:           params.credits,
    free_used:              params.split.free,
    incentive_used:         params.split.incentive,
    paid_used:              params.split.paid,
    reference_type:         params.referenceType,
    reference_id:           params.referenceId ?? null,
    confirm_transaction_id: params.confirmTransactionId,
  });

  if (error) {
    if (error.code === '23505') {
      // Duplicate confirm_transaction_id — idempotent, ignore
      return;
    }
    // Log but do not throw — usage tracking failure must never break the caller
    console.error('[usageTracking] insert failed:', error.message);
  }
}
