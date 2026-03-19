/**
 * AI Model Router — GAP 6: Budget Control & Model Tiering
 *
 * Resolves which OpenAI model to use for a given operation based on:
 *  1. Organization plan tier (free/starter → always mini)
 *  2. Monthly usage level (>90% of token budget → force mini)
 *
 * This prevents unintended cost escalation and ensures heavier models
 * are only used by plans that pay for them.
 *
 * Model hierarchy (cheapest → most capable):
 *   gpt-4o-mini  →  gpt-4o  →  gpt-4-turbo
 *
 * Plan tiers:
 *   free / starter  → gpt-4o-mini only
 *   growth          → gpt-4o-mini by default; gpt-4o allowed for planning ops
 *   pro / enterprise → requested model honoured
 */

import { resolveOrganizationPlanLimits } from './planResolutionService';
import { supabase } from '../db/supabaseClient';

const MINI_MODEL = 'gpt-4o-mini';

// Plans capped at mini regardless of what was requested
const MINI_ONLY_PLANS = new Set(['free', 'starter', 'trial', 'basic']);

// Plans allowed to use full models — everything else defaults to mini
const FULL_MODEL_PLANS = new Set(['pro', 'professional', 'enterprise', 'unlimited']);

// Operations that may use a larger model on growth plans
const PLANNING_OPS = new Set([
  'generateCampaignPlan',
  'previewStrategy',
  'generateDailyDistributionPlan',
  'optimizeWeek',
  'profileEnrichment',
  'profileExtraction',
  'refineProblemTransformation',
]);

// Usage fraction above which we force mini regardless of plan
const USAGE_DOWNGRADE_THRESHOLD = 0.90;

/** Simple in-process TTL cache to avoid hitting DB on every AI call */
const _planCache = new Map<string, { planKey: string; usageFraction: number; at: number }>();
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function resolveOrgMeta(orgId: string): Promise<{ planKey: string; usageFraction: number }> {
  const UNKNOWN = '00000000-0000-0000-0000-000000000000';
  if (!orgId || orgId === UNKNOWN) return { planKey: 'free', usageFraction: 0 };

  const cached = _planCache.get(orgId);
  if (cached && Date.now() - cached.at < PLAN_CACHE_TTL_MS) {
    return { planKey: cached.planKey, usageFraction: cached.usageFraction };
  }

  try {
    const resolved = await resolveOrganizationPlanLimits(orgId);
    const planKey = (resolved.plan_key ?? 'free').toLowerCase();
    const tokenLimit = resolved.limits.llm_tokens;

    let usageFraction = 0;
    if (tokenLimit != null && tokenLimit > 0) {
      const now = new Date();
      const { data: meter } = await supabase
        .from('usage_meter_monthly')
        .select('llm_total_tokens')
        .eq('organization_id', orgId)
        .eq('year', now.getUTCFullYear())
        .eq('month', now.getUTCMonth() + 1)
        .maybeSingle();
      const used = Number(meter?.llm_total_tokens ?? 0);
      usageFraction = used / tokenLimit;
    }

    _planCache.set(orgId, { planKey, usageFraction, at: Date.now() });
    return { planKey, usageFraction };
  } catch {
    return { planKey: 'free', usageFraction: 0 };
  }
}

/**
 * Resolve the effective model for a given operation and organization.
 *
 * @param requestedModel - The model the caller wanted to use
 * @param operation      - The AI operation (e.g. 'generateCampaignPlan')
 * @param orgId          - Organization ID (used to look up plan)
 * @returns              - Effective model string to pass to OpenAI
 */
export async function resolveEffectiveModel(
  requestedModel: string,
  operation: string,
  orgId: string | null | undefined,
): Promise<string> {
  const id = orgId ?? '';
  const { planKey, usageFraction } = await resolveOrgMeta(id);

  // Usage-based downgrade: above threshold, force mini regardless of plan
  if (usageFraction >= USAGE_DOWNGRADE_THRESHOLD) {
    if (process.env.NODE_ENV !== 'test') {
      console.info('[model-router] usage-downgrade', {
        orgId: id.slice(0, 8),
        usageFraction: usageFraction.toFixed(2),
        from: requestedModel,
        to: MINI_MODEL,
      });
    }
    return MINI_MODEL;
  }

  // Mini-only plans: always downgrade
  if (MINI_ONLY_PLANS.has(planKey)) {
    return MINI_MODEL;
  }

  // Full model plans: honour request
  if (FULL_MODEL_PLANS.has(planKey)) {
    return requestedModel;
  }

  // Growth / intermediate plans: mini by default, larger allowed for planning
  if (PLANNING_OPS.has(operation)) {
    return requestedModel; // allow requested model for planning ops
  }
  return MINI_MODEL;
}
