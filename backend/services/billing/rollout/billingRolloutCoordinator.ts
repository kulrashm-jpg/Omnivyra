import { createHash } from 'crypto';
import { upsertFeatureFlag } from '../../featureFlagService';
import { logger } from '../../logger';
import { BILLING_FLAGS, evaluateAllBillingFlags, type BillingFlagKey } from '../billingFeatureFlags';
import { snapshotBillingMetrics } from '../billingMetrics';
import { auditRegistry } from '../nonBillableRegistry';
import { verifyBillingConsistency, type BillingConsistencyReport } from './billingConsistencyVerifier';
import { emergencyDisableBillingCanary } from './billingRollbackService';

export interface BillingRolloutPlanEntry {
  organizationId: string;
  selected: boolean;
  bucket: number;
  reason: string;
}

export interface BillingRolloutValidation {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface BillingCanaryResult {
  organizationId: string;
  flagsApplied: BillingFlagKey[];
  consistency: BillingConsistencyReport;
  autoDisabled: boolean;
  metricsSnapshot: ReturnType<typeof snapshotBillingMetrics>;
}

export const BILLING_CANARY_FLAGS: BillingFlagKey[] = [
  BILLING_FLAGS.AI_ENFORCED,
  BILLING_FLAGS.RESERVATIONS_REQUIRED,
  BILLING_FLAGS.REFINE_VARIANT_BILLING,
];

export function planPercentageRollout(args: {
  organizationIds: string[];
  percent: number;
  salt?: string;
}): BillingRolloutPlanEntry[] {
  const percent = Math.max(0, Math.min(100, Math.floor(args.percent)));
  const salt = args.salt ?? 'billing-ga-rollout';
  return args.organizationIds.map((organizationId) => {
    const digest = createHash('sha256').update(`${salt}|${organizationId}`).digest();
    const bucket = digest.readUInt32BE(0) % 100;
    const selected = bucket < percent;
    return {
      organizationId,
      selected,
      bucket,
      reason: selected ? `bucket_${bucket}_below_${percent}` : `bucket_${bucket}_above_${percent}`,
    };
  });
}

export async function validateBillingRolloutDependencies(args: {
  organizationId: string;
}): Promise<BillingRolloutValidation> {
  const [flags, registry, consistency] = await Promise.all([
    evaluateAllBillingFlags(args.organizationId),
    auditRegistry(),
    verifyBillingConsistency({ organizationId: args.organizationId }),
  ]);

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (registry.expiredCount > 0) blockers.push(`expired_non_billable_entries:${registry.expiredCount}`);
  if (registry.missingReasonCount > 0) blockers.push(`missing_registry_reasons:${registry.missingReasonCount}`);
  if (registry.missingOwnerCount > 0) blockers.push(`missing_registry_owners:${registry.missingOwnerCount}`);
  if (consistency.overallStatus === 'fail') blockers.push('billing_consistency_failed');
  if (consistency.overallStatus === 'degraded') warnings.push('billing_consistency_degraded');
  if (!flags[BILLING_FLAGS.ORCHESTRATOR_ENFORCED]?.enabled) warnings.push('orchestrator_enforcement_flag_off');

  return { ok: blockers.length === 0, blockers, warnings };
}

export async function enableBillingCanaryForOrg(args: {
  organizationId: string;
  actorUserId: string | null;
  cohort?: string | null;
  flags?: BillingFlagKey[];
  requireCleanConsistency?: boolean;
}): Promise<BillingCanaryResult> {
  const flags = args.flags ?? BILLING_CANARY_FLAGS;
  const validation = await validateBillingRolloutDependencies({ organizationId: args.organizationId });
  if (!validation.ok) {
    throw new Error(`billing_rollout_blocked:${validation.blockers.join(',')}`);
  }

  const consistencyBefore = await verifyBillingConsistency({ organizationId: args.organizationId });
  if (args.requireCleanConsistency !== false && consistencyBefore.overallStatus !== 'pass') {
    throw new Error(`billing_rollout_consistency_not_clean:${consistencyBefore.overallStatus}`);
  }

  for (const flag of flags) {
    await upsertFeatureFlag({
      organizationId: args.organizationId,
      flagKey: flag,
      enabled: true,
      rolloutCohort: args.cohort ?? null,
      rolloutPercent: 100,
      rationale: 'Pre-GA billing canary enablement',
      createdBy: args.actorUserId,
    });
  }

  const consistency = await verifyBillingConsistency({ organizationId: args.organizationId });
  let autoDisabled = false;
  if (consistency.rollbackRequired) {
    autoDisabled = true;
    await emergencyDisableBillingCanary({
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      reason: 'post_enablement_consistency_failure',
    });
  }

  const result: BillingCanaryResult = {
    organizationId: args.organizationId,
    flagsApplied: flags,
    consistency,
    autoDisabled,
    metricsSnapshot: snapshotBillingMetrics(),
  };

  logger.info('billing_canary_enablement_completed', {
    org: args.organizationId,
    flags,
    status: consistency.overallStatus,
    auto_disabled: autoDisabled,
  });

  return result;
}

export async function applyPercentageRollout(args: {
  organizationIds: string[];
  percent: number;
  actorUserId: string | null;
  flags?: BillingFlagKey[];
  salt?: string;
}): Promise<BillingCanaryResult[]> {
  const plan = planPercentageRollout({
    organizationIds: args.organizationIds,
    percent: args.percent,
    salt: args.salt,
  });
  const results: BillingCanaryResult[] = [];
  for (const entry of plan.filter((p) => p.selected)) {
    results.push(await enableBillingCanaryForOrg({
      organizationId: entry.organizationId,
      actorUserId: args.actorUserId,
      flags: args.flags,
    }));
  }
  return results;
}
