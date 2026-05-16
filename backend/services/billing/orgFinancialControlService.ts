/**
 * Org Financial Control Service — Phase D
 *
 * Emergency freeze and billing lock on top of the existing org_controls
 * table. Two distinct surfaces because they exist for different reasons:
 *
 *   emergency_freeze — operational kill switch. Set when fraud is suspected
 *                      or the org is causing platform-wide instability.
 *                      Blocks ALL paid actions AND prevents new admin grants.
 *
 *   billing_lock     — finance lock. Prevents any credit balance mutation
 *                      (grant / adjust / consumption / expiry). Used during
 *                      end-of-period close, contract renegotiation, etc.
 *
 * Both are super-admin OR finance_admin gated, both write to the
 * super_admin_audit_logs + admin_financial_audit_events tables, both are
 * idempotent at the application layer (the column update is idempotent
 * because we always read-modify-write the full set of fields).
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { recordAdminFinancialOperation } from './enterpriseBillingOrchestrator';
import { emitAnomaly } from './billingAuditEmitter';

export type FinancialControlAction = 'freeze' | 'unfreeze' | 'lock' | 'unlock';

export interface FinancialControlOpts {
  organizationId: string;
  actorUserId:    string;
  action:         FinancialControlAction;
  reason:         string;
  metadata?:      Record<string, unknown>;
}

export interface FinancialControlResult {
  ok:             boolean;
  state:          {
    emergency_freeze: boolean;
    billing_lock:     boolean;
  };
  error?:         string;
}

export async function applyFinancialControl(opts: FinancialControlOpts): Promise<FinancialControlResult> {
  if (!opts.reason?.trim()) {
    return { ok: false, state: { emergency_freeze: false, billing_lock: false }, error: 'reason required' };
  }

  const nowIso = new Date().toISOString();
  let patch: Record<string, unknown> = {};

  switch (opts.action) {
    case 'freeze':
      patch = {
        emergency_freeze:        true,
        emergency_freeze_reason: opts.reason,
        emergency_freeze_at:     nowIso,
        emergency_freeze_by:     opts.actorUserId,
      };
      break;
    case 'unfreeze':
      patch = {
        emergency_freeze:        false,
        emergency_freeze_reason: null,
        emergency_freeze_at:     null,
        emergency_freeze_by:     null,
      };
      break;
    case 'lock':
      patch = {
        billing_lock:        true,
        billing_lock_reason: opts.reason,
        billing_lock_at:     nowIso,
        billing_lock_by:     opts.actorUserId,
      };
      break;
    case 'unlock':
      patch = {
        billing_lock:        false,
        billing_lock_reason: null,
        billing_lock_at:     null,
        billing_lock_by:     null,
      };
      break;
  }

  const { data, error } = await supabase
    .from('org_controls')
    .upsert(
      {
        organization_id: opts.organizationId,
        ...patch,
      },
      { onConflict: 'organization_id', ignoreDuplicates: false },
    )
    .select('emergency_freeze, billing_lock')
    .single();

  if (error) {
    logger.error('financial_control_failed', {
      action: opts.action, org: opts.organizationId, message: error.message,
    });
    return { ok: false, state: { emergency_freeze: false, billing_lock: false }, error: error.message };
  }

  // Emit audit + anomaly (freeze and lock are high-severity ops events)
  emitAnomaly({
    organizationId: opts.organizationId,
    kind: 'untracked_ai_call_blocked',  // reuse closest existing kind for governance event
    severity: 'warn',
    message: `financial_control:${opts.action}: ${opts.reason}`,
    metadata: { action: opts.action, actor: opts.actorUserId, ...(opts.metadata ?? {}) },
  });

  await recordAdminFinancialOperation({
    module:          'http:admin_financial_control',
    actorUserId:     opts.actorUserId,
    organizationId:  opts.organizationId,
    action:          'admin_adjust',  // closest existing audit action; metadata carries the specific event
    reason:          opts.reason,
    metadata:        { control_action: opts.action, ...(opts.metadata ?? {}) },
  });

  const state = data as { emergency_freeze: boolean; billing_lock: boolean };
  return { ok: true, state };
}

/**
 * Pre-flight check — invoked from creditExecutionService's
 * preflightCheck and from admin grant endpoints. Returns a normalized
 * "blocked" result that the orchestrator handles as an `org_control_blocked`
 * outcome.
 *
 * The existing `preflightCheck` in orgControlService already reads
 * is_blocked / is_high_risk / daily_credit_limit. This helper adds the new
 * Phase 2 fields. Callers should invoke BOTH (orgControlService first, then
 * this) until a follow-up PR consolidates them.
 */
export async function checkFinancialControls(orgId: string): Promise<{
  allowed: boolean;
  emergencyFreeze: boolean;
  billingLock: boolean;
  reason?: string;
}> {
  const { data, error } = await supabase
    .from('org_controls')
    .select('emergency_freeze, emergency_freeze_reason, billing_lock, billing_lock_reason')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error || !data) {
    return { allowed: true, emergencyFreeze: false, billingLock: false };
  }
  const row = data as {
    emergency_freeze: boolean;
    emergency_freeze_reason: string | null;
    billing_lock: boolean;
    billing_lock_reason: string | null;
  };
  if (row.emergency_freeze) {
    return {
      allowed: false,
      emergencyFreeze: true,
      billingLock: row.billing_lock,
      reason: `EMERGENCY_FREEZE: ${row.emergency_freeze_reason ?? 'no reason recorded'}`,
    };
  }
  if (row.billing_lock) {
    return {
      allowed: false,
      emergencyFreeze: false,
      billingLock: true,
      reason: `BILLING_LOCK: ${row.billing_lock_reason ?? 'no reason recorded'}`,
    };
  }
  return { allowed: true, emergencyFreeze: false, billingLock: false };
}
