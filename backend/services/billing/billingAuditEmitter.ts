/**
 * Billing Audit Emitter — Phase A
 *
 * Structured emission of billing-specific audit events. Pairs with the
 * super_admin_audit_logs table (generic) and the new
 * admin_financial_audit_events table (financial only).
 *
 * This service is the only legal way to create financial audit rows from
 * application code. Tables are immutable at the DB layer (immutability
 * triggers in 20260663_ledger_immutability_and_governance.sql), so writes
 * are insert-only and accidental UPDATE/DELETE will RAISE EXCEPTION.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';

export interface FinancialAuditEvent {
  actorUserId:           string;
  actionType:            'admin_grant' | 'admin_adjust' | 'admin_refund' | 'admin_rate_change' | 'admin_revoke' | 'system_correction';
  organizationId:        string;
  amountCredits?:        number;
  usdEquivalent?:        number;
  currency?:             string;
  reasonType?:           string;
  reason?:               string;
  approvalId?:           string | null;
  ledgerIdempotencyKey?: string | null;
  correlationId?:        string;
  metadata?:             Record<string, unknown>;
}

export interface AnomalyEvent {
  organizationId?: string;
  kind:            'double_deduct_prevented' | 'untracked_ai_call_blocked' | 'queue_replay_blocked' | 'reservation_orphan_reaped' | 'approval_self_signature_attempt' | 'underfunded_settlement';
  severity:        'info' | 'warn' | 'critical';
  message:         string;
  correlationId?:  string;
  metadata?:       Record<string, unknown>;
}

/** Insert a financial audit row. Never throws — failures are logged. */
export async function emitFinancialAudit(event: FinancialAuditEvent): Promise<void> {
  try {
    const { error } = await supabase.from('admin_financial_audit_events').insert({
      actor_user_id:          event.actorUserId,
      action_type:            event.actionType,
      organization_id:        event.organizationId,
      amount_credits:         event.amountCredits ?? null,
      usd_equivalent:         event.usdEquivalent ?? null,
      currency:               event.currency ?? 'USD',
      reason_type:            event.reasonType ?? null,
      reason:                 event.reason ?? null,
      approval_id:            event.approvalId ?? null,
      ledger_idempotency_key: event.ledgerIdempotencyKey ?? null,
      correlation_id:         event.correlationId ?? null,
      metadata:               event.metadata ?? {},
    });
    if (error) {
      logger.error('financial_audit_emit_failed', {
        action: event.actionType,
        org: event.organizationId,
        message: error.message,
      });
    }
  } catch (err: unknown) {
    logger.error('financial_audit_emit_threw', {
      action: event.actionType,
      org: event.organizationId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Emit an anomaly to the structured logger. Wired into metrics in billingMetrics.ts. */
export function emitAnomaly(event: AnomalyEvent): void {
  const fn =
    event.severity === 'critical' ? logger.error :
    event.severity === 'warn'     ? logger.warn  :
                                    logger.info;
  fn('billing_anomaly', {
    kind: event.kind,
    severity: event.severity,
    message: event.message,
    organization_id: event.organizationId,
    correlation_id: event.correlationId,
    ...(event.metadata ?? {}),
  });
}
