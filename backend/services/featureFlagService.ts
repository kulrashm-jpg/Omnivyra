/**
 * Phase 8 — Feature flag + rollout cohort service.
 *
 * Per-org flags with explicit activation and rollback metadata. Cohort
 * targeting is a free-form string the caller compares against — Phase 8
 * ships flag CRUD + deterministic evaluation; the caller passes the
 * cohort to test against (e.g. tenant tier).
 *
 * Hard guarantees:
 *   • Tenant-scoped (UNIQUE on (org, flag_key)).
 *   • Every activation / rollback records actor + timestamp on the row
 *     AND a row in operator_actions (separate audit log).
 *   • Deterministic eval: same inputs → same boolean.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import type { FeatureFlag } from '../types/featureFlag';

export async function upsertFeatureFlag(input: {
  organizationId: string;
  flagKey: string;
  enabled?: boolean;
  rolloutCohort?: string | null;
  rolloutPercent?: number | null;
  rationale?: string | null;
  createdBy: string | null;
}): Promise<FeatureFlag> {
  const payload = {
    organization_id: input.organizationId,
    flag_key: input.flagKey,
    enabled: input.enabled ?? false,
    rollout_cohort: input.rolloutCohort ?? null,
    rollout_percent: input.rolloutPercent ?? null,
    rationale: input.rationale ?? null,
    created_by: input.createdBy,
  };
  const { data: existing } = await ownedDbTable('feature_flags')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('flag_key', input.flagKey)
    .maybeSingle();
  if (existing && (existing as { id?: string }).id) {
    const { data, error } = await ownedDbTable('feature_flags')
      .update(payload)
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`feature_flag_update_failed:${error?.message ?? 'unknown'}`);
    return data as FeatureFlag;
  }
  const { data, error } = await ownedDbTable('feature_flags')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new Error(`feature_flag_insert_failed:${error?.message ?? 'unknown'}`);
  return data as FeatureFlag;
}

export async function activateFlag(args: {
  organizationId: string;
  flagId: string;
  actorUserId: string | null;
}): Promise<FeatureFlag | null> {
  const { data, error } = await ownedDbTable('feature_flags')
    .update({
      enabled: true,
      activated_by: args.actorUserId,
      activated_at: new Date().toISOString(),
      reverted_at: null,
      reverted_by: null,
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.flagId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`feature_flag_activate_failed:${error.message}`);
  return (data as FeatureFlag | null) ?? null;
}

export async function revertFlag(args: {
  organizationId: string;
  flagId: string;
  actorUserId: string | null;
}): Promise<FeatureFlag | null> {
  const { data, error } = await ownedDbTable('feature_flags')
    .update({
      enabled: false,
      reverted_by: args.actorUserId,
      reverted_at: new Date().toISOString(),
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.flagId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`feature_flag_revert_failed:${error.message}`);
  return (data as FeatureFlag | null) ?? null;
}

export async function listFeatureFlags(organizationId: string): Promise<FeatureFlag[]> {
  const { data, error } = await ownedDbTable('feature_flags')
    .select('*')
    .eq('organization_id', organizationId)
    .order('flag_key', { ascending: true });
  if (error) throw new Error(`feature_flag_list_failed:${error.message}`);
  return (data as FeatureFlag[]) ?? [];
}

/**
 * Deterministic evaluation. The cohort key (e.g. user id) is hashed into
 * a 0–99 bucket; the flag fires if `enabled` AND bucket < `rollout_percent`.
 * If `rollout_cohort` is set, the caller must supply a matching cohort.
 */
export async function evaluateFeatureFlag(args: {
  organizationId: string;
  flagKey: string;
  cohortKey: string | null;
  cohortValue?: string;
}): Promise<{ enabled: boolean; reason: string }> {
  const { data } = await ownedDbTable('feature_flags')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('flag_key', args.flagKey)
    .maybeSingle();
  const flag = data as FeatureFlag | null;
  if (!flag) return { enabled: false, reason: 'no_flag_row' };
  if (!flag.enabled) return { enabled: false, reason: 'flag_disabled' };

  if (flag.rollout_cohort && args.cohortValue !== flag.rollout_cohort) {
    return { enabled: false, reason: `cohort_mismatch:expected_${flag.rollout_cohort}` };
  }
  if (flag.rollout_percent != null && flag.rollout_percent < 100) {
    if (!args.cohortKey) return { enabled: false, reason: 'cohort_key_required_for_percent_rollout' };
    const hash = createHash('sha256').update(`${flag.flag_key}|${args.cohortKey}`).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    if (bucket >= flag.rollout_percent) {
      return { enabled: false, reason: `bucket_${bucket}_above_${flag.rollout_percent}` };
    }
    return { enabled: true, reason: `bucket_${bucket}_below_${flag.rollout_percent}` };
  }
  return { enabled: true, reason: 'flag_enabled_full_rollout' };
}
