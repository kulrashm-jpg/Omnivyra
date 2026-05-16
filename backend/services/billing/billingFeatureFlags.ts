/**
 * Billing Feature Flags — Phase I
 *
 * Five staged rollout flags governing the Phase 2 migration. They piggy-back
 * on the existing org-scoped `feature_flags` table + `evaluateFeatureFlag()`
 * resolver, so cohort/percent rollout works the same as elsewhere.
 *
 * Rollout posture (default = OFF for safety):
 *
 *   billing.orchestrator_enforced
 *     When ON: legacy paths that call `executeWithCredits` directly are still
 *     allowed (the orchestrator delegates to it), but new code MUST go through
 *     `runBilledOperation`. CI check `scripts/audit/no-direct-credit-deductions`
 *     enforces this at PR time even when this flag is OFF.
 *
 *   billing.ai_enforced
 *     Mirror of the env var `BILLING_REQUIRE_AI_HANDLE`. When the per-org flag
 *     is ON, the guard throws on unguarded `runCompletionWithOperation` calls
 *     even if the env var is unset. Useful for canary orgs.
 *
 *   billing.reservations_required
 *     When ON for an org, any long-running work (queue / cron / worker) MUST
 *     hold a credit reservation before executing. Enforced by orchestrator +
 *     queue middleware.
 *
 *   billing.reconciliation_blocking
 *     When ON, ledger reconciliation runs synchronously inside high-value
 *     operation paths (admin grants, large adjustments) and BLOCKS on drift.
 *     Default OFF — reconciliation is async via cron.
 *
 *   billing.dual_approval_required
 *     When ON for an org, ALL admin financial actions (regardless of amount)
 *     require 2-of-N signatures. Overrides the threshold ladder for that org.
 *
 * Each flag has a "shadow" reading utility that always returns the evaluated
 * state without throwing — for dashboard / readiness reports.
 */

import { evaluateFeatureFlag } from '../featureFlagService';
import { logger } from '../logger';

export const BILLING_FLAGS = {
  ORCHESTRATOR_ENFORCED:    'billing.orchestrator_enforced',
  AI_ENFORCED:              'billing.ai_enforced',
  RESERVATIONS_REQUIRED:    'billing.reservations_required',
  RECONCILIATION_BLOCKING:  'billing.reconciliation_blocking',
  DUAL_APPROVAL_REQUIRED:   'billing.dual_approval_required',
  REFINE_VARIANT_BILLING:   'billing.refine_variant_enabled',
} as const;

export type BillingFlagKey = typeof BILLING_FLAGS[keyof typeof BILLING_FLAGS];

export interface FlagEvaluation {
  flag:    BillingFlagKey;
  enabled: boolean;
  reason:  string;
}

export async function isBillingFlagEnabled(args: {
  organizationId: string;
  flag:           BillingFlagKey;
  cohortKey?:     string;
  cohortValue?:   string;
}): Promise<FlagEvaluation> {
  try {
    const r = await evaluateFeatureFlag({
      organizationId: args.organizationId,
      flagKey:        args.flag,
      cohortKey:      args.cohortKey ?? args.organizationId,
      cohortValue:    args.cohortValue,
    });
    return { flag: args.flag, enabled: r.enabled, reason: r.reason };
  } catch (err: unknown) {
    logger.warn('billing_flag_eval_failed', {
      flag: args.flag,
      org:  args.organizationId,
      message: err instanceof Error ? err.message : String(err),
    });
    return { flag: args.flag, enabled: false, reason: 'eval_error_fail_closed' };
  }
}

/**
 * Batch-evaluate all five flags for an org. Used by the readiness dashboard.
 */
export async function evaluateAllBillingFlags(organizationId: string): Promise<Record<BillingFlagKey, FlagEvaluation>> {
  const keys = Object.values(BILLING_FLAGS);
  const results = await Promise.all(
    keys.map(flag => isBillingFlagEnabled({ organizationId, flag })),
  );
  const map: Partial<Record<BillingFlagKey, FlagEvaluation>> = {};
  for (const r of results) map[r.flag] = r;
  return map as Record<BillingFlagKey, FlagEvaluation>;
}

/**
 * Customer-impact gate for refine_variant billing.
 *
 * Backward compatibility is deliberate: when REFINE_VARIANT_BILLING_ENABLED is
 * absent, existing behavior is preserved and refine_variant remains billable.
 *
 * Supported modes:
 *   - unset / "true" / "1": enabled except orgs in REFINE_VARIANT_BILLING_GRACE_ORGS
 *   - "false" / "0": disabled globally
 *   - "canary": enabled only when the org feature flag is enabled
 */
export async function isRefineVariantBillingEnabled(args: {
  organizationId: string;
  cohortValue?: string;
}): Promise<FlagEvaluation> {
  const rawMode = String(process.env.REFINE_VARIANT_BILLING_ENABLED ?? 'true').trim().toLowerCase();
  const graceOrgs = new Set(
    String(process.env.REFINE_VARIANT_BILLING_GRACE_ORGS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  if (graceOrgs.has(args.organizationId)) {
    return {
      flag: BILLING_FLAGS.REFINE_VARIANT_BILLING,
      enabled: false,
      reason: 'org_grace_exemption',
    };
  }

  if (rawMode === 'false' || rawMode === '0' || rawMode === 'off') {
    return {
      flag: BILLING_FLAGS.REFINE_VARIANT_BILLING,
      enabled: false,
      reason: 'env_disabled',
    };
  }

  if (rawMode === 'canary' || rawMode === 'staged') {
    return isBillingFlagEnabled({
      organizationId: args.organizationId,
      flag: BILLING_FLAGS.REFINE_VARIANT_BILLING,
      cohortValue: args.cohortValue,
    });
  }

  return {
    flag: BILLING_FLAGS.REFINE_VARIANT_BILLING,
    enabled: true,
    reason: rawMode === 'true' || rawMode === '1' ? 'env_enabled' : 'default_enabled_preserve_current_behavior',
  };
}

/**
 * Migration completeness indicator. Returns a 0..1 score reflecting how much
 * of the org's billing surface is on the new orchestrator. Computed from
 * billing_operations rows over the last 24h (signal: orchestrator coverage)
 * vs total credit_transactions in the same window. Computed downstream in the
 * dashboard route — this module exports the contract only.
 */
export interface MigrationReadiness {
  flagsEnabled:          Partial<Record<BillingFlagKey, boolean>>;
  orchestratorCoverage:  number;
  pendingApprovalsCount: number;
  recentDriftCount:      number;
  reservationLeakCount:  number;
}
