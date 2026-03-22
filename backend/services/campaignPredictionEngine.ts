/**
 * Campaign Prediction Engine
 *
 * Predicts campaign outcome BEFORE execution using a weighted scoring model.
 * If predictions are below thresholds, triggers the optimization loop.
 *
 * Weights are loaded from `prediction_config` DB table (admin-tunable).
 *
 * Outputs:
 *   predicted_engagement_rate — weighted composite (0–1)
 *   predicted_reach           — estimated from authority + platform mix
 *   predicted_leads           — estimated from reach × conversion factor
 *   confidence_score          — data completeness score (0–1)
 *   platform_breakdown        — per-platform expected engagement
 *   content_type_breakdown    — per-content-type expected engagement
 *   warnings                  — low-confidence or threshold flags
 */

import { supabase } from '../db/supabaseClient';
import { extractFeatures, type FeatureInput, type FeatureVector } from './predictionFeatureExtractor';
import { aggregateCampaignPerformance } from './performanceFeedbackService';
import { generatePerformanceInsights } from './performanceInsightGenerator';
import { getPredictionConfig } from './configService';
import { deductCreditsAwaited as deductCredits } from './creditExecutionService';
import type { StrategyContext } from '../types/campaignPlanning';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformPrediction = {
  platform: string;
  predicted_engagement_rate: number;
  predicted_reach: number;
  content_types: string[];
  fit_score: number;
};

export type ContentTypePrediction = {
  content_type: string;
  predicted_engagement_rate: number;
  volume: number;
};

export type CampaignPrediction = {
  campaign_id: string;
  predicted_engagement_rate: number;
  predicted_reach: number;
  predicted_leads: number;
  confidence_score: number;
  platform_breakdown: PlatformPrediction[];
  content_type_breakdown: ContentTypePrediction[];
  feature_vector: FeatureVector;
  optimization_applied: boolean;
  optimization_rounds: number;
  warnings: string[];
};

export type CampaignPlanInput = {
  campaign_id: string;
  company_id: string;
  description: string;
  strategy_context: StrategyContext;
  /** Sample posts or hooks if available. */
  content_samples?: string[];
  /** Account authority 0–1. */
  account_authority?: number;
  /** Sentiment score from prior engagement analysis 0–1. */
  sentiment_score?: number;
  /** Override historical engagement rate (skips DB lookup). */
  historical_performance?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Reach multiplier by platform authority tier. */
function estimateReach(platform: string, authority: number, postsPerWeek: number, durationWeeks: number): number {
  // Base reach: 1000 followers assumed at authority 0.5
  // Authority scales 100x linearly: 0→100, 0.5→10000, 1.0→100000
  const baseFollowers = Math.round(100 * Math.pow(1000, authority));
  // Organic reach: 3–12% of followers per post depending on platform
  const platformReachRate: Record<string, number> = {
    linkedin: 0.10, instagram: 0.06, twitter: 0.04, x: 0.04,
    tiktok: 0.12, facebook: 0.05, youtube: 0.08, pinterest: 0.07, reddit: 0.05,
  };
  const reachRate = platformReachRate[platform.toLowerCase()] ?? 0.05;
  const totalPosts = postsPerWeek * durationWeeks;
  return Math.round(baseFollowers * reachRate * totalPosts);
}

/** Leads conversion: 0.5–3% of reach depending on engagement quality. */
function estimateLeads(reach: number, engagementRate: number): number {
  const conversionRate = Math.min(0.03, Math.max(0.005, engagementRate * 0.4));
  return Math.round(reach * conversionRate);
}

/** Confidence: penalised when features rely on defaults (no historical data, no authority). */
function computeConfidence(
  hasHistorical: boolean,
  hasAuthority: boolean,
  hasSentiment: boolean,
  hasSamples: boolean,
): number {
  let score = 0.5; // base
  if (hasHistorical) score += 0.2;
  if (hasAuthority) score += 0.15;
  if (hasSentiment) score += 0.10;
  if (hasSamples) score += 0.05;
  return parseFloat(Math.min(1, score).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Core prediction
// ─────────────────────────────────────────────────────────────────────────────

async function buildPrediction(
  plan: CampaignPlanInput,
  historicalRate: number,
  weights: { hook: number; platform_fit: number; readability: number; authority: number; historical: number },
): Promise<{ vector: FeatureVector; engagementRate: number; platformBreakdown: PlatformPrediction[]; contentTypeBreakdown: ContentTypePrediction[] }> {

  const sc = plan.strategy_context;
  const primaryPlatform = sc.platforms[0] ?? 'linkedin';
  const primaryContentType = Object.keys(sc.content_mix ?? {})[0] ?? 'post';

  // Use best available content sample for feature extraction
  const contentSample = plan.content_samples?.[0] ?? plan.description;

  const featureInput: FeatureInput = {
    content: contentSample,
    platform: primaryPlatform,
    content_type: primaryContentType,
    account_authority: plan.account_authority,
    sentiment_score: plan.sentiment_score,
    historical_performance: historicalRate,
  };

  const vector = extractFeatures(featureInput);

  // Weighted composite engagement prediction
  const predicted = (
    vector.hook_strength  * weights.hook +
    vector.platform_fit   * weights.platform_fit +
    vector.readability    * weights.readability +
    vector.authority_score * weights.authority +
    vector.historical     * weights.historical
  );

  // Scale to realistic engagement range: 0–10% (0.0–0.10)
  // composite 0–1 → engagement 0–0.10
  const engagementRate = parseFloat((predicted * 0.10).toFixed(4));

  // Per-platform breakdown
  const platformBreakdown: PlatformPrediction[] = sc.platforms.map(p => {
    const postingFreq = sc.posting_frequency?.[p] ?? 1;
    const platformVec = extractFeatures({ ...featureInput, platform: p });
    const platformEngagement = (
      platformVec.hook_strength * weights.hook +
      platformVec.platform_fit  * weights.platform_fit +
      platformVec.readability   * weights.readability +
      platformVec.authority_score * weights.authority +
      platformVec.historical    * weights.historical
    ) * 0.10;
    const reach = estimateReach(p, vector.authority_score, postingFreq, sc.duration_weeks);
    const contentTypes = Object.entries(sc.content_mix ?? {})
      .filter(([, pct]) => pct > 0)
      .map(([ct]) => ct);
    return {
      platform: p,
      predicted_engagement_rate: parseFloat(platformEngagement.toFixed(4)),
      predicted_reach: reach,
      content_types: contentTypes,
      fit_score: platformVec.platform_fit,
    };
  });

  // Per-content-type breakdown
  const contentTypeBreakdown: ContentTypePrediction[] = Object.entries(sc.content_mix ?? {}).map(([ct, pct]) => {
    const ctVec = extractFeatures({ ...featureInput, content_type: ct });
    const ctEngagement = (
      ctVec.hook_strength   * weights.hook +
      ctVec.platform_fit    * weights.platform_fit +
      ctVec.readability     * weights.readability +
      ctVec.authority_score * weights.authority +
      ctVec.historical      * weights.historical
    ) * 0.10;
    const totalPosts = sc.duration_weeks * (sc.posting_frequency?.[primaryPlatform] ?? 3);
    return {
      content_type: ct,
      predicted_engagement_rate: parseFloat(ctEngagement.toFixed(4)),
      volume: Math.round(totalPosts * (pct / 100)),
    };
  });

  return { vector, engagementRate, platformBreakdown, contentTypeBreakdown };
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempts to improve prediction by mutating the plan's strategy context.
 * Adjustments: prioritise highest-fit platforms, shift content mix toward top types.
 * Returns modified plan copy and optimization notes.
 */
function optimizePlan(
  plan: CampaignPlanInput,
  platformBreakdown: PlatformPrediction[],
  contentTypeBreakdown: ContentTypePrediction[],
): { optimizedPlan: CampaignPlanInput; notes: string[] } {
  const notes: string[] = [];
  const sc = { ...plan.strategy_context };

  // Re-order platforms by fit_score descending
  const sortedPlatforms = [...platformBreakdown].sort((a, b) => b.fit_score - a.fit_score);
  const reorderedPlatforms = sortedPlatforms.map(p => p.platform);
  if (reorderedPlatforms[0] !== sc.platforms[0]) {
    notes.push(`Prioritised ${reorderedPlatforms[0]} — highest platform-content fit score`);
    sc.platforms = reorderedPlatforms;
  }

  // Shift content mix: boost top performer by 10%, reduce bottom by 10%
  if (contentTypeBreakdown.length >= 2) {
    const sorted = [...contentTypeBreakdown].sort((a, b) => b.predicted_engagement_rate - a.predicted_engagement_rate);
    const top = sorted[0].content_type;
    const bottom = sorted[sorted.length - 1].content_type;
    const newMix = { ...(sc.content_mix ?? {}) };
    if (newMix[top] !== undefined && newMix[bottom] !== undefined && top !== bottom) {
      const shift = Math.min(10, newMix[bottom]);
      newMix[top] = Math.min(100, newMix[top] + shift);
      newMix[bottom] = Math.max(0, newMix[bottom] - shift);
      sc.content_mix = newMix;
      notes.push(`Shifted content mix: +${shift}% ${top}, -${shift}% ${bottom}`);
    }
  }

  return {
    optimizedPlan: { ...plan, strategy_context: sc },
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function predictCampaignOutcome(plan: CampaignPlanInput): Promise<CampaignPrediction> {
  // Non-blocking credit deduction — prediction runs regardless
  if (plan.company_id) {
    await deductCredits(plan.company_id, 'prediction', { referenceId: plan.campaign_id, note: 'Campaign outcome prediction' });
  }

  const cfg = await getPredictionConfig();

  const weights = {
    hook:         cfg.weight_hook_strength,
    platform_fit: cfg.weight_platform_fit,
    readability:  cfg.weight_readability,
    authority:    cfg.weight_authority,
    historical:   cfg.weight_historical,
  };

  // Load historical engagement from prior campaigns for this company
  let historicalRate = plan.historical_performance ?? 0;
  if (historicalRate === 0) {
    const insights = await generatePerformanceInsights(plan.campaign_id).catch(() => null);
    if (insights) {
      historicalRate = insights.avg_engagement_rate;
    } else {
      const perf = await aggregateCampaignPerformance(plan.campaign_id).catch(() => null);
      historicalRate = perf?.engagement_rate ?? 0;
    }
  }

  const hasHistorical = historicalRate > 0;
  const hasAuthority  = plan.account_authority !== undefined;
  const hasSentiment  = plan.sentiment_score !== undefined;
  const hasSamples    = (plan.content_samples?.length ?? 0) > 0;

  const confidence = computeConfidence(hasHistorical, hasAuthority, hasSentiment, hasSamples);

  let currentPlan = plan;
  let optimizationRounds = 0;
  let optimizationApplied = false;
  const warnings: string[] = [];

  let { vector, engagementRate, platformBreakdown, contentTypeBreakdown } =
    await buildPrediction(currentPlan, historicalRate, weights);

  // Pre-launch validation + optimization loop
  const maxRounds = cfg.max_optimization_rounds;
  while (
    optimizationRounds < maxRounds &&
    (engagementRate < cfg.min_engagement_threshold || confidence < cfg.min_confidence_threshold)
  ) {
    if (confidence < cfg.min_confidence_threshold) {
      warnings.push(`Low confidence score (${confidence}) — prediction based on limited historical data`);
      break; // Can't optimize away missing data
    }

    const { optimizedPlan, notes } = optimizePlan(currentPlan, platformBreakdown, contentTypeBreakdown);
    notes.forEach(n => warnings.push(`Optimization round ${optimizationRounds + 1}: ${n}`));

    currentPlan = optimizedPlan;
    optimizationRounds++;
    optimizationApplied = true;

    ({ vector, engagementRate, platformBreakdown, contentTypeBreakdown } =
      await buildPrediction(currentPlan, historicalRate, weights));
  }

  if (engagementRate < cfg.min_engagement_threshold) {
    warnings.push(`Predicted engagement (${(engagementRate * 100).toFixed(2)}%) is below the ${(cfg.min_engagement_threshold * 100).toFixed(1)}% target — review content hooks and platform selection`);
  }

  if (confidence < cfg.min_confidence_threshold) {
    warnings.push(`Confidence score (${confidence}) is low — run at least one campaign cycle to improve predictions`);
  }

  // Aggregate reach and leads across platforms
  const totalReach = platformBreakdown.reduce((s, p) => s + p.predicted_reach, 0);
  const predictedLeads = estimateLeads(totalReach, engagementRate);

  const prediction: CampaignPrediction = {
    campaign_id: plan.campaign_id,
    predicted_engagement_rate: engagementRate,
    predicted_reach: totalReach,
    predicted_leads: predictedLeads,
    confidence_score: confidence,
    platform_breakdown: platformBreakdown,
    content_type_breakdown: contentTypeBreakdown,
    feature_vector: vector,
    optimization_applied: optimizationApplied,
    optimization_rounds: optimizationRounds,
    warnings,
  };

  // Persist to DB (non-blocking)
  try {
    await supabase.from('campaign_predictions').insert({
      campaign_id:               plan.campaign_id,
      predicted_engagement_rate: engagementRate,
      predicted_reach:           totalReach,
      predicted_leads:           predictedLeads,
      confidence_score:          confidence,
      platform_breakdown:        platformBreakdown,
      content_type_breakdown:    contentTypeBreakdown,
      feature_vector:            vector,
      optimization_applied:      optimizationApplied,
      optimization_rounds:       optimizationRounds,
      warnings,
      created_at:                new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[campaignPredictionEngine] Failed to persist prediction', err);
  }

  return prediction;
}
