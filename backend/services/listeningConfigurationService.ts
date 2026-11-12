/**
 * Phase 2 — Listening configuration CRUD with explicit-confirmation activation.
 *
 * Activation contract:
 *   1. Caller obtains a fresh credit estimate via creditEstimationService.
 *   2. Caller submits the configuration along with the estimate's
 *      `estimate_hash` to `activateListeningConfiguration`.
 *   3. Service refuses if (a) hash doesn't match the recomputed estimate
 *      from the submitted inputs, (b) any platform fails eligibility,
 *      (c) consent is stale or missing, (d) estimated monthly burn exceeds
 *      the org-set ceiling.
 *   4. On success the row is persisted and the next planned run timestamp
 *      is computed (NOT enqueued — that's Phase 3).
 *
 * Mode `manual_only` is the safe default and is the only mode that does
 * NOT require eligibility/scope validation — manual runs go through the
 * existing /api/leads/job/create path and are gated there.
 */

import { tenantTable, type TenantContext } from '../db/tenantTable';
import { normalizePlatform } from '../constants/platforms';
import { invalidateCapabilityAggregate } from './capabilityCacheService';
import { buildCapabilityAggregate } from './capabilityAggregationService';
import { estimateCredits, verifyEstimateHash } from './creditEstimationService';
import {
  evaluateMonitoringEligibility,
  type EligibilityDecision,
} from './monitoringEligibilityService';
import type {
  IndustryVolatility,
  ListeningConfiguration,
  ListeningMode,
} from '../types/listeningConfiguration';
import {
  FREQUENCY_INTERVAL_HOURS,
  isListeningMode,
} from '../types/listeningConfiguration';

export type ConfigurationDraft = {
  mode: ListeningMode;
  platforms: string[];
  keywordCount: number;
  industryCategory: string | null;
  industryVolatility: IndustryVolatility | null;
  monthlyCreditCeiling: number;
  dailyRunCeiling: number;
  cooldownMinutes: number;
};

export type ActivationInput = ConfigurationDraft & {
  /** S2 tenant seam: the caller's tenant (replaces the raw organizationId). */
  tenant: TenantContext;
  confirmedBy: string | null;
  estimateHash: string;
  acknowledgeCreditEstimate: boolean;
  acknowledgeConsentRequirement: boolean;
};

export type ActivationRefusal = {
  ok: false;
  reason:
    | 'estimate_hash_mismatch'
    | 'acknowledgements_missing'
    | 'estimate_exceeds_ceiling'
    | 'ineligible_platforms'
    | 'invalid_mode'
    | 'no_platforms';
  detail: string;
  ineligible_platforms?: Array<{
    platform: string;
    decision: EligibilityDecision;
  }>;
};

export type ActivationSuccess = {
  ok: true;
  configuration: ListeningConfiguration;
};

export type ActivationResult = ActivationSuccess | ActivationRefusal;

export async function getListeningConfiguration(
  tenant: TenantContext,
): Promise<ListeningConfiguration | null> {
  const { data, error } = await tenantTable('listening_configurations', tenant)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to load configuration: ${error.message}`);
  return (data as ListeningConfiguration | null) ?? null;
}

/**
 * Activate or update a listening configuration. ALL writes that change
 * frequency / platforms / ceilings go through this function — there is no
 * partial-update path that bypasses confirmation.
 */
export async function activateListeningConfiguration(
  input: ActivationInput,
): Promise<ActivationResult> {
  const { tenant } = input;
  const organizationId = tenant.companyId;
  if (!isListeningMode(input.mode)) {
    return { ok: false, reason: 'invalid_mode', detail: String(input.mode) };
  }

  // manual_only is allowed without eligibility checks; it's a no-op for the
  // scheduler. Other modes require explicit acknowledgements + eligibility.
  const requiresActivationGates = input.mode !== 'manual_only';

  if (requiresActivationGates) {
    if (!input.acknowledgeCreditEstimate || !input.acknowledgeConsentRequirement) {
      return {
        ok: false,
        reason: 'acknowledgements_missing',
        detail: 'Both acknowledgeCreditEstimate and acknowledgeConsentRequirement must be true',
      };
    }
    if (input.platforms.length === 0) {
      return { ok: false, reason: 'no_platforms', detail: 'platforms must include at least one entry' };
    }
  }

  // Re-derive estimate server-side; refuse if the hash doesn't match what
  // the client showed the user. This prevents stale-modal activation.
  const estimate = estimateCredits({
    mode: input.mode,
    platforms: input.platforms,
    keywordCount: input.keywordCount,
    industryVolatility: input.industryVolatility ?? undefined,
  });

  if (requiresActivationGates && estimate.estimate_hash !== input.estimateHash) {
    return {
      ok: false,
      reason: 'estimate_hash_mismatch',
      detail: 'Submitted estimate hash does not match server-recomputed estimate',
    };
  }

  // Budget ceiling check: refuse activation if the expected monthly burn
  // exceeds the user-set ceiling. Ceiling 0 = "no ceiling" only for manual.
  if (
    requiresActivationGates
    && input.monthlyCreditCeiling > 0
    && estimate.monthly_max > input.monthlyCreditCeiling
  ) {
    return {
      ok: false,
      reason: 'estimate_exceeds_ceiling',
      detail: `Projected monthly_max (${estimate.monthly_max}) exceeds ceiling (${input.monthlyCreditCeiling}). Lower the cadence or raise the ceiling.`,
    };
  }

  // Per-platform eligibility check via the capability aggregate. Uses the
  // CACHE-MISS path on purpose — activation decisions never read from the
  // TTL cache (consistent with the cache service's documented contract).
  if (requiresActivationGates) {
    const aggregate = await buildCapabilityAggregate(organizationId);
    const ineligible: ActivationRefusal['ineligible_platforms'] = [];
    for (const rawPlatform of input.platforms) {
      const platform = normalizePlatform(rawPlatform);
      const decision = evaluateMonitoringEligibility(aggregate, platform);
      if (!decision.eligible) ineligible.push({ platform, decision });
    }
    if (ineligible.length > 0) {
      return {
        ok: false,
        reason: 'ineligible_platforms',
        detail: `${ineligible.length} platform(s) are not eligible for monitoring activation`,
        ineligible_platforms: ineligible,
      };
    }
  }

  const now = new Date();
  const nextPlannedRunAt = requiresActivationGates
    ? new Date(now.getTime() + FREQUENCY_INTERVAL_HOURS[input.mode] * 60 * 60 * 1000).toISOString()
    : null;

  const existing = await getListeningConfiguration(tenant);

  // organization_id is stamped by the tenant seam.
  const payload = {
    mode: input.mode,
    platforms: [...new Set(input.platforms.map(normalizePlatform))].sort(),
    keyword_count: input.keywordCount,
    industry_category: input.industryCategory,
    industry_volatility: input.industryVolatility,
    monthly_credit_ceiling: input.monthlyCreditCeiling,
    daily_run_ceiling: input.dailyRunCeiling,
    cooldown_minutes: input.cooldownMinutes,
    estimated_monthly_credits_min: estimate.monthly_min,
    estimated_monthly_credits_max: estimate.monthly_max,
    estimated_credits_per_run: estimate.per_run,
    next_planned_run_at: nextPlannedRunAt,
    last_confirmation_at: requiresActivationGates ? now.toISOString() : existing?.last_confirmation_at ?? null,
    confirmed_by: requiresActivationGates ? input.confirmedBy : existing?.confirmed_by ?? null,
    confirmed_estimate_hash: requiresActivationGates ? estimate.estimate_hash : existing?.confirmed_estimate_hash ?? null,
  };

  let configuration: ListeningConfiguration;
  if (existing) {
    const { data, error } = await tenantTable('listening_configurations', tenant)
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(`Failed to update listening configuration: ${error?.message ?? 'unknown'}`);
    }
    configuration = data as ListeningConfiguration;
  } else {
    const { data, error } = await tenantTable('listening_configurations', tenant)
      .insert(payload)
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(`Failed to insert listening configuration: ${error?.message ?? 'unknown'}`);
    }
    configuration = data as ListeningConfiguration;
  }

  // Cache invalidation: configuration affects monitoring eligibility, which
  // is part of the capability aggregate.
  invalidateCapabilityAggregate(organizationId);

  return { ok: true, configuration };
}

/**
 * Switch a configuration back to manual_only. Idempotent. Clears the next
 * planned run so any orchestration scan skips this org.
 */
export async function suspendListeningConfiguration(
  tenant: TenantContext,
): Promise<ListeningConfiguration | null> {
  const existing = await getListeningConfiguration(tenant);
  if (!existing) return null;
  const { data, error } = await tenantTable('listening_configurations', tenant)
    .update({
      mode: 'manual_only',
      next_planned_run_at: null,
    })
    .eq('id', existing.id)
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`Failed to suspend configuration: ${error?.message ?? 'unknown'}`);
  }
  invalidateCapabilityAggregate(tenant.companyId);
  return data as ListeningConfiguration;
}
