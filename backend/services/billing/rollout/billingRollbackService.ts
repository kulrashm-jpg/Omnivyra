import { listFeatureFlags, revertFlag, upsertFeatureFlag } from '../../featureFlagService';
import { logger } from '../../logger';
import { BILLING_FLAGS, type BillingFlagKey } from '../billingFeatureFlags';

export interface BillingRollbackResult {
  organizationId: string;
  rolledBackFlags: string[];
  failedFlags: Array<{ flag: string; error: string }>;
  reason: string;
  completedAt: string;
}

const DEFAULT_ROLLBACK_FLAGS: BillingFlagKey[] = [
  BILLING_FLAGS.AI_ENFORCED,
  BILLING_FLAGS.RESERVATIONS_REQUIRED,
  BILLING_FLAGS.RECONCILIATION_BLOCKING,
  BILLING_FLAGS.REFINE_VARIANT_BILLING,
];

export async function rollbackBillingForOrg(args: {
  organizationId: string;
  actorUserId: string | null;
  reason: string;
  flags?: BillingFlagKey[];
}): Promise<BillingRollbackResult> {
  const desired = new Set<string>(args.flags ?? DEFAULT_ROLLBACK_FLAGS);
  const existing = await listFeatureFlags(args.organizationId);
  const rolledBackFlags: string[] = [];
  const failedFlags: Array<{ flag: string; error: string }> = [];

  for (const flag of existing.filter((f) => desired.has(f.flag_key) && f.enabled)) {
    try {
      await revertFlag({
        organizationId: args.organizationId,
        flagId: flag.id,
        actorUserId: args.actorUserId,
      });
      rolledBackFlags.push(flag.flag_key);
    } catch (err) {
      failedFlags.push({
        flag: flag.flag_key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.warn('billing_rollout_rollback_completed', {
    org: args.organizationId,
    reason: args.reason,
    rolled_back: rolledBackFlags,
    failed: failedFlags.length,
  });

  return {
    organizationId: args.organizationId,
    rolledBackFlags,
    failedFlags,
    reason: args.reason,
    completedAt: new Date().toISOString(),
  };
}

export async function emergencyDisableBillingCanary(args: {
  organizationId: string;
  actorUserId: string | null;
  reason: string;
}): Promise<BillingRollbackResult> {
  await upsertFeatureFlag({
    organizationId: args.organizationId,
    flagKey: BILLING_FLAGS.AI_ENFORCED,
    enabled: false,
    rolloutPercent: 0,
    rationale: `Emergency canary disable: ${args.reason}`,
    createdBy: args.actorUserId,
  });

  return rollbackBillingForOrg({
    organizationId: args.organizationId,
    actorUserId: args.actorUserId,
    reason: args.reason,
    flags: [BILLING_FLAGS.AI_ENFORCED, BILLING_FLAGS.REFINE_VARIANT_BILLING],
  });
}
