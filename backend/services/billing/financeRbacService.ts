/**
 * Finance RBAC — Phase D
 *
 * Three new roles introduced in this phase, layered on top of the existing
 * Role enum. They share the `user_company_roles` table; no separate auth
 * surface is needed.
 *
 *   FINANCE_ADMIN     — can propose and execute admin financial actions
 *                       below threshold; can manage org_controls billing-side
 *                       (emergency freeze, billing lock).
 *   FINANCE_APPROVER  — can sign approvals (proposer cannot self-sign — DB-enforced)
 *   FINANCE_AUDITOR   — read-only across all financial tables + dashboards
 *
 * SUPER_ADMIN is a superset — anyone with SUPER_ADMIN can act in any of the
 * three roles. The new helpers below check both the dedicated role AND the
 * SUPER_ADMIN fallback.
 *
 * Note on dual-control: when an org has `billing.dual_approval_required=true`,
 * the approval threshold ladder is overridden to require 2 approvers
 * regardless of amount. That gate lives in creditApprovalService — see the
 * `evaluateRequiredApprovals` helper below for shared logic.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import {
  isSuperAdmin,
  isPlatformSuperAdmin,
} from '../rbacService';
import { isBillingFlagEnabled, BILLING_FLAGS } from './billingFeatureFlags';

export const FINANCE_ROLES = {
  FINANCE_ADMIN:    'FINANCE_ADMIN',
  FINANCE_APPROVER: 'FINANCE_APPROVER',
  FINANCE_AUDITOR:  'FINANCE_AUDITOR',
} as const;

export type FinanceRole = typeof FINANCE_ROLES[keyof typeof FINANCE_ROLES];

async function hasRoleAnywhere(userId: string, role: FinanceRole): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', role)
    .eq('status', 'active')
    .limit(1);
  if (error) {
    logger.warn('finance_role_check_failed', { userId, role, message: error.message });
    return false;
  }
  return !!data && data.length > 0;
}

export async function isFinanceAdmin(userId: string): Promise<boolean> {
  if (await isPlatformSuperAdmin(userId)) return true;
  if (await isSuperAdmin(userId))         return true;
  return hasRoleAnywhere(userId, FINANCE_ROLES.FINANCE_ADMIN);
}

export async function isFinanceApprover(userId: string): Promise<boolean> {
  if (await isPlatformSuperAdmin(userId)) return true;
  if (await isSuperAdmin(userId))         return true;
  return hasRoleAnywhere(userId, FINANCE_ROLES.FINANCE_APPROVER);
}

export async function isFinanceAuditor(userId: string): Promise<boolean> {
  if (await isPlatformSuperAdmin(userId)) return true;
  if (await isSuperAdmin(userId))         return true;
  if (await hasRoleAnywhere(userId, FINANCE_ROLES.FINANCE_AUDITOR)) return true;
  // Auditor role is a strict subset — admin & approver implicitly include audit read.
  return (await isFinanceAdmin(userId)) || (await isFinanceApprover(userId));
}

/**
 * Determine the effective required-approvals count for an action. Combines the
 * DB threshold ladder with the org's dual-approval feature flag.
 */
export async function evaluateRequiredApprovals(args: {
  organizationId: string;
  actionType:     'admin_grant' | 'admin_adjust' | 'admin_refund' | 'admin_rate_change';
  amount:         number;
}): Promise<{ required: number; reason: string }> {
  // 1. Org-level dual-approval flag — always wins if enabled.
  const dual = await isBillingFlagEnabled({
    organizationId: args.organizationId,
    flag:           BILLING_FLAGS.DUAL_APPROVAL_REQUIRED,
  });
  if (dual.enabled) {
    return { required: 2, reason: 'org_dual_approval_required_flag' };
  }

  // 2. Otherwise consult the threshold ladder.
  const { data, error } = await supabase.rpc('required_approvals_for_action', {
    p_action_type: args.actionType,
    p_amount:      Math.abs(args.amount),
  });
  if (error) {
    logger.warn('required_approvals_lookup_failed', {
      action: args.actionType, amount: args.amount, message: error.message,
    });
    return { required: 2, reason: 'fallback_conservative' };
  }
  return { required: Number(data ?? 1), reason: 'threshold_ladder' };
}
