/**
 * Job Cost Estimator — #1 Game-Changer
 *
 * Estimates token usage and USD cost BEFORE a job is enqueued or an AI call
 * is executed. Enables three enforcement modes:
 *
 *   1. BLOCK  — reject the job entirely (free/trial users hitting heavy ops)
 *   2. DOWNGRADE — swap to a cheaper model (approaching budget threshold)
 *   3. WARN   — allow, but log + surface to billing dashboard
 *
 * Token estimation strategy:
 *   - System prompt: character count / 4 (GPT tokeniser approximation)
 *   - User payload: JSON string character count / 3.5 (denser content)
 *   - Output budget: operation-specific upper bounds (conservative)
 *   - Batch multiplier: × item count for batched calls
 *
 * Pricing (as of 2025 — update PRICE_PER_1K_TOKENS when OpenAI changes rates):
 *   gpt-4o-mini  input  $0.000150 / 1K tokens
 *   gpt-4o-mini  output $0.000600 / 1K tokens
 *   gpt-4o       input  $0.002500 / 1K tokens
 *   gpt-4o       output $0.010000 / 1K tokens
 *   gpt-4-turbo  input  $0.010000 / 1K tokens
 *   gpt-4-turbo  output $0.030000 / 1K tokens
 */

import { resolveOrganizationPlanLimits } from './planResolutionService';
import { supabase } from '../db/supabaseClient';

// ── Pricing table ─────────────────────────────────────────────────────────────

interface ModelPricing {
  inputPer1K:  number; // USD
  outputPer1K: number; // USD
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini':    { inputPer1K: 0.000150, outputPer1K: 0.000600 },
  'gpt-4o':         { inputPer1K: 0.002500, outputPer1K: 0.010000 },
  'gpt-4-turbo':    { inputPer1K: 0.010000, outputPer1K: 0.030000 },
  'gpt-4':          { inputPer1K: 0.010000, outputPer1K: 0.030000 },
  'gpt-3.5-turbo':  { inputPer1K: 0.000050, outputPer1K: 0.000150 },
};

const DEFAULT_PRICING: ModelPricing = { inputPer1K: 0.002500, outputPer1K: 0.010000 };

// ── Per-operation output token budget ─────────────────────────────────────────
// Conservative upper-bound estimates for output length

const OPERATION_OUTPUT_TOKENS: Record<string, number> = {
  generateCampaignPlan:              3_000,
  previewStrategy:                   2_000,
  prePlanningExplanation:            1_000,
  suggestDuration:                     300,
  refineCampaignIdea:                1_200,
  parsePlanToWeeks:                  2_500,
  optimizeWeek:                      1_500,
  generateDailyPlan:                 1_500,
  generateDailyDistributionPlan:     2_000,
  generateContentBlueprint:           600,
  generateContentForDay:             1_200,
  regenerateContent:                   800,
  generateMasterContent:             1_200,
  generatePlatformVariants:          1_500,
  generateRecommendation:              600,
  generateCampaignRecommendations:   1_200,
  generateAdditionalStrategicThemes: 1_000,
  generateContentIdeas:              1_500,
  profileEnrichment:                 1_500,
  profileExtraction:                 2_000,
  refineProblemTransformation:       1_000,
  refineLanguageOutput:                500,
  chatModeration:                      100,
  responseGeneration:                  800,
};

const DEFAULT_OUTPUT_TOKENS = 800;

// ── Plan-level cost limits (USD per call) ─────────────────────────────────────

const PLAN_COST_LIMITS: Record<string, number> = {
  free:         0.005,  // $0.005 max per call — block heavy calls
  trial:        0.005,
  starter:      0.010,
  basic:        0.010,
  growth:       0.050,
  pro:          0.200,
  professional: 0.200,
  enterprise:   1.000,
  unlimited:    1.000,
};

const DEFAULT_PLAN_COST_LIMIT = 0.050; // growth equivalent

// Operations that free/trial users are never allowed to run (too expensive)
const BLOCKED_OPS_FOR_FREE: Set<string> = new Set([
  'generateCampaignPlan',
  'parsePlanToWeeks',
  'generateDailyDistributionPlan',
  'profileEnrichment',
  'profileExtraction',
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CostEstimate {
  inputTokens:  number;
  outputTokens: number;
  totalTokens:  number;
  estimatedUsd: number;
  model:        string;
}

export type CostDecision =
  | { action: 'allow';     estimate: CostEstimate; effectiveModel: string }
  | { action: 'downgrade'; estimate: CostEstimate; effectiveModel: string; reason: string }
  | { action: 'block';     estimate: CostEstimate; reason: string };

// ── Simple 5-min plan cache (matches aiModelRouter pattern) ──────────────────

const _planCache = new Map<string, { planKey: string; usedTokens: number; tokenLimit: number | null; at: number }>();
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveOrgPlan(orgId: string): Promise<{ planKey: string; usedTokens: number; tokenLimit: number | null }> {
  const UNKNOWN = '00000000-0000-0000-0000-000000000000';
  if (!orgId || orgId === UNKNOWN) return { planKey: 'free', usedTokens: 0, tokenLimit: null };

  const cached = _planCache.get(orgId);
  if (cached && Date.now() - cached.at < PLAN_CACHE_TTL_MS) {
    return { planKey: cached.planKey, usedTokens: cached.usedTokens, tokenLimit: cached.tokenLimit };
  }

  try {
    const resolved = await resolveOrganizationPlanLimits(orgId);
    const planKey    = (resolved.plan_key ?? 'free').toLowerCase();
    const tokenLimit = resolved.limits.llm_tokens ?? null;

    let usedTokens = 0;
    if (tokenLimit != null && tokenLimit > 0) {
      const now = new Date();
      const { data: meter } = await supabase
        .from('usage_meter_monthly')
        .select('llm_total_tokens')
        .eq('organization_id', orgId)
        .eq('year', now.getUTCFullYear())
        .eq('month', now.getUTCMonth() + 1)
        .maybeSingle();
      usedTokens = Number(meter?.llm_total_tokens ?? 0);
    }

    _planCache.set(orgId, { planKey, usedTokens, tokenLimit, at: Date.now() });
    return { planKey, usedTokens, tokenLimit };
  } catch {
    return { planKey: 'free', usedTokens: 0, tokenLimit: null };
  }
}

// ── Core estimation ───────────────────────────────────────────────────────────

/**
 * Estimate token counts from raw message strings.
 * Uses character-based approximation (no tiktoken dependency).
 *
 * @param messages   - Chat messages array
 * @param operation  - Operation name (for output budget lookup)
 * @param batchSize  - For batched calls; multiplies output token estimate
 */
export function estimateTokens(
  messages: Array<{ role: string; content: string }>,
  operation: string,
  batchSize = 1,
): Pick<CostEstimate, 'inputTokens' | 'outputTokens' | 'totalTokens'> {
  // GPT tokeniser ~= chars/4 for English prose; system prompts tend to be denser
  const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const inputTokens = Math.ceil(inputChars / 3.8) + 10; // +10 overhead per msg

  const outputTokens = (OPERATION_OUTPUT_TOKENS[operation] ?? DEFAULT_OUTPUT_TOKENS) * batchSize;
  const totalTokens  = inputTokens + outputTokens;

  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Compute USD cost from token counts.
 */
export function computeCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens / 1000) * pricing.inputPer1K + (outputTokens / 1000) * pricing.outputPer1K;
}

/**
 * Full cost estimate for a model + messages combination.
 */
export function estimateCost(
  model: string,
  messages: Array<{ role: string; content: string }>,
  operation: string,
  batchSize = 1,
): CostEstimate {
  const { inputTokens, outputTokens, totalTokens } = estimateTokens(messages, operation, batchSize);
  const estimatedUsd = computeCost(inputTokens, outputTokens, model);
  return { inputTokens, outputTokens, totalTokens, estimatedUsd, model };
}

// ── Decision engine ───────────────────────────────────────────────────────────

const MINI_MODEL   = 'gpt-4o-mini';
const DOWNGRADE_AT = 0.80; // downgrade model when >80% of token budget used

/**
 * Determine whether to allow, downgrade, or block an AI call based on
 * the org's plan, current usage, and estimated cost.
 *
 * @param requestedModel - The model the caller wants to use
 * @param operation      - Operation name (e.g. 'generateCampaignPlan')
 * @param orgId          - Organization ID
 * @param messages       - Chat messages (used for token estimation)
 * @param batchSize      - Number of items in a batch call
 */
export async function evaluateJobCost(
  requestedModel: string,
  operation: string,
  orgId: string | null | undefined,
  messages: Array<{ role: string; content: string }>,
  batchSize = 1,
): Promise<CostDecision> {
  const UNKNOWN = '00000000-0000-0000-0000-000000000000';
  const id = orgId ?? '';
  const isKnownOrg = !!id && id !== UNKNOWN;
  const { planKey, usedTokens, tokenLimit } = await resolveOrgPlan(id);

  const estimate = estimateCost(requestedModel, messages, operation, batchSize);

  // 1. Block free/trial users from heavy operations — only when org is positively identified
  if (BLOCKED_OPS_FOR_FREE.has(operation) && isKnownOrg && (planKey === 'free' || planKey === 'trial')) {
    return {
      action: 'block',
      estimate,
      reason: `Operation "${operation}" is not available on the ${planKey} plan. Upgrade to access this feature.`,
    };
  }

  // 2. Check per-call cost limit for the plan
  const callLimit = PLAN_COST_LIMITS[planKey] ?? DEFAULT_PLAN_COST_LIMIT;
  if (estimate.estimatedUsd > callLimit) {
    // For lower plans, block outright. For higher plans, downgrade model.
    if (planKey === 'free' || planKey === 'trial' || planKey === 'starter' || planKey === 'basic') {
      return {
        action: 'block',
        estimate,
        reason: `Estimated cost $${estimate.estimatedUsd.toFixed(4)} exceeds ${planKey} plan limit of $${callLimit.toFixed(4)} per call.`,
      };
    }
    // Downgrade model to reduce cost
    if (requestedModel !== MINI_MODEL) {
      const miniEstimate = estimateCost(MINI_MODEL, messages, operation, batchSize);
      return {
        action: 'downgrade',
        estimate: miniEstimate,
        effectiveModel: MINI_MODEL,
        reason: `Cost estimate $${estimate.estimatedUsd.toFixed(4)} > plan limit $${callLimit.toFixed(4)}; downgraded to ${MINI_MODEL}`,
      };
    }
  }

  // 3. Token budget exhaustion: downgrade if >80% used
  if (tokenLimit != null && tokenLimit > 0) {
    const usageFraction = usedTokens / tokenLimit;
    if (usageFraction >= DOWNGRADE_AT && requestedModel !== MINI_MODEL) {
      const miniEstimate = estimateCost(MINI_MODEL, messages, operation, batchSize);
      return {
        action: 'downgrade',
        estimate: miniEstimate,
        effectiveModel: MINI_MODEL,
        reason: `Token usage at ${(usageFraction * 100).toFixed(0)}% of monthly limit; downgraded to ${MINI_MODEL}`,
      };
    }
  }

  return { action: 'allow', estimate, effectiveModel: requestedModel };
}

/**
 * Lightweight synchronous check — no DB, no async.
 * Use this to pre-screen jobs before enqueue (e.g. in API route handlers).
 *
 * Returns estimated cost in USD without any plan enforcement.
 */
export function quickEstimateCost(
  model: string,
  payloadJson: string,
  operation: string,
): number {
  const inputTokens  = Math.ceil(payloadJson.length / 3.8);
  const outputTokens = OPERATION_OUTPUT_TOKENS[operation] ?? DEFAULT_OUTPUT_TOKENS;
  return computeCost(inputTokens, outputTokens, model);
}
