/**
 * Autonomous Campaign Agent — Step 2
 *
 * Generates the next campaign plan for a company without human input,
 * using: last campaign performance, engagement insights, trend signals,
 * platform ranking, and accumulated learnings.
 *
 * This agent does NOT call the full AI orchestrator (too heavy for automation).
 * Instead it produces a structured campaign_plan object ready for:
 *   a) Human approval (approval_required = true) → stored in pending_campaigns
 *   b) Auto-activation (approval_required = false) → creates campaign directly
 *
 * The plan schema matches the existing campaign creation contract.
 */

import { supabase } from '../db/supabaseClient';
import { generatePerformanceInsights } from './performanceInsightGenerator';
import { rankPlatformsByPerformance } from './platformPerformanceRanker';
import { generateEngagementInsights } from './engagementInsightService';
import { evaluateCampaignDecision } from './campaignDecisionEngine';
import { getTopLearnings, formatLearningsForPrompt } from './campaignLearningsStore';
import { logDecision } from './autonomousDecisionLogger';
import { predictCampaignOutcome } from './campaignPredictionEngine';
import { hasEnoughCredits } from './creditDeductionService';
import { deductCreditsAwaited } from './creditExecutionService';

export type AutonomousCampaignPlan = {
  company_id: string;
  name: string;
  description: string;
  platforms: string[];
  posting_frequency: Record<string, number>;
  content_mix: Record<string, number>;
  duration_weeks: number;
  campaign_goal: string;
  generation_meta: {
    generated_by: 'autonomous_agent';
    generated_at: string;
    based_on_campaign_id: string | null;
    platform_ranking: string[];
    avg_historical_engagement: number;
    learnings_applied: number;
    predicted_engagement_rate: number;
    confidence_score: number;
    optimization_notes: string[];
    risk_tolerance: RiskTolerance;
  };
};

export type RiskTolerance = 'aggressive' | 'balanced' | 'conservative';

// ── Risk profiles — control how aggressively the agent adjusts strategy ───────
const RISK_PROFILES: Record<RiskTolerance, {
  platform_count: number;
  posting_frequency_multiplier: number;
  duration_weeks: number;
  content_diversity: number; // number of content types in mix
}> = {
  aggressive:   { platform_count: 4, posting_frequency_multiplier: 1.4, duration_weeks: 12, content_diversity: 4 },
  balanced:     { platform_count: 3, posting_frequency_multiplier: 1.0, duration_weeks: 12, content_diversity: 3 },
  conservative: { platform_count: 2, posting_frequency_multiplier: 0.7, duration_weeks: 8,  content_diversity: 2 },
};

// ── Default posting frequencies per platform (posts/week) ─────────────────────
const BASE_FREQUENCY: Record<string, number> = {
  linkedin: 3, instagram: 5, twitter: 7, x: 7,
  tiktok: 5, facebook: 4, youtube: 1, pinterest: 3, reddit: 2,
};

// ── Content mix presets ──────────────────────────────────────────────────────
const CONTENT_MIX_PRESETS: Record<number, Record<string, number>> = {
  2: { post: 70, carousel: 30 },
  3: { post: 60, carousel: 25, video: 15 },
  4: { post: 50, carousel: 25, video: 15, thread: 10 },
};

/** Load the last active campaign for this company. */
async function getLastCampaign(companyId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; name: string } | null;
}

/** Load company profile for name and description. */
async function getCompanyProfile(companyId: string): Promise<{ name: string; description: string } | null> {
  const { data } = await supabase
    .from('companies')
    .select('name, description')
    .eq('id', companyId)
    .maybeSingle();
  return data as { name: string; description: string } | null;
}

/** Load autonomous settings for a company. */
export async function getAutonomousSettings(companyId: string): Promise<{
  autonomous_mode: boolean;
  approval_required: boolean;
  risk_tolerance: RiskTolerance;
} | null> {
  const { data } = await supabase
    .from('company_settings')
    .select('autonomous_mode, approval_required, risk_tolerance')
    .eq('company_id', companyId)
    .maybeSingle();

  if (!data) return null;
  return {
    autonomous_mode:  Boolean((data as any).autonomous_mode),
    approval_required: Boolean((data as any).approval_required ?? true),
    risk_tolerance:   ((data as any).risk_tolerance ?? 'balanced') as RiskTolerance,
  };
}

/**
 * Generate the next campaign plan using all available intelligence signals.
 * Returns a structured plan ready for approval or auto-activation.
 */
export async function generateNextCampaign(companyId: string): Promise<AutonomousCampaignPlan> {
  // Credit gate — 50 credits required for autonomous campaign generation
  const creditCheck = await hasEnoughCredits(companyId, 'campaign_generation');
  if (!creditCheck.sufficient) {
    throw new Error(`Insufficient credits for campaign_generation: need ${creditCheck.required}, have ${creditCheck.balance ?? 0}`);
  }

  const [lastCampaign, company, settings] = await Promise.all([
    getLastCampaign(companyId),
    getCompanyProfile(companyId),
    getAutonomousSettings(companyId),
  ]);

  const riskTolerance: RiskTolerance = settings?.risk_tolerance ?? 'balanced';
  const profile = RISK_PROFILES[riskTolerance];
  const lastCampaignId = lastCampaign?.id ?? null;

  // ── Gather all signals in parallel ────────────────────────────────────────
  const [perfInsights, platformRanks, engagementInsights, learnings] = await Promise.all([
    lastCampaignId ? generatePerformanceInsights(lastCampaignId) : Promise.resolve(null),
    lastCampaignId ? rankPlatformsByPerformance(lastCampaignId) : Promise.resolve([]),
    generateEngagementInsights(companyId).catch(() => null),
    getTopLearnings(companyId, { limit: 10 }),
  ]);

  // ── Platform selection — top performers first, padded with defaults ────────
  const rankedPlatforms = platformRanks.map(r => r.platform);
  const defaultPlatforms = ['linkedin', 'instagram', 'twitter'];
  const allPlatforms = [...new Set([...rankedPlatforms, ...defaultPlatforms])];
  const selectedPlatforms = allPlatforms.slice(0, profile.platform_count);

  // ── Posting frequency — base × risk multiplier ────────────────────────────
  const postingFrequency: Record<string, number> = {};
  for (const p of selectedPlatforms) {
    const base = BASE_FREQUENCY[p] ?? 3;
    postingFrequency[p] = Math.round(base * profile.posting_frequency_multiplier);
  }

  // ── Content mix ───────────────────────────────────────────────────────────
  const contentMix = CONTENT_MIX_PRESETS[profile.content_diversity] ?? CONTENT_MIX_PRESETS[3];

  // ── Campaign goal — from decision engine or default ────────────────────────
  let campaignGoal = 'Grow brand awareness and generate qualified leads';
  let optimizationNotes: string[] = [];

  if (lastCampaignId) {
    const decision = await evaluateCampaignDecision(lastCampaignId).catch(() => null);
    if (decision) {
      if (decision.action === 'OPTIMIZE') {
        campaignGoal = 'Optimise engagement on underperforming channels and improve content quality';
        optimizationNotes.push(`Previous campaign action: ${decision.action} — ${decision.reasoning[0] ?? ''}`);
      } else if (decision.action === 'CONTINUE') {
        campaignGoal = 'Scale winning content patterns and increase reach on top platforms';
        optimizationNotes.push('Previous campaign performed well — maintaining and scaling strategy');
      }
      if (decision.platform_priority.length > 0) {
        optimizationNotes.push(`Top platform: ${decision.platform_priority[0]}`);
      }
    }
  }

  if (perfInsights?.recommendations) {
    optimizationNotes = [...optimizationNotes, ...perfInsights.recommendations.slice(0, 3)];
  }

  // ── Campaign description — incorporates learnings ─────────────────────────
  const learningsText = formatLearningsForPrompt(learnings);
  const companyName = company?.name ?? 'the company';
  const description = [
    `Autonomous campaign for ${companyName}.`,
    perfInsights ? `Previous avg engagement: ${(perfInsights.avg_engagement_rate * 100).toFixed(2)}%.` : '',
    perfInsights?.platform_bias ? `Top platform: ${perfInsights.platform_bias}.` : '',
    learningsText ? `\n${learningsText}` : '',
  ].filter(Boolean).join(' ');

  const generatedAt = new Date().toISOString();
  const campaignNumber = await getCampaignCount(companyId) + 1;

  const plan: AutonomousCampaignPlan = {
    company_id: companyId,
    name: `${companyName} — Auto Campaign #${campaignNumber}`,
    description,
    platforms: selectedPlatforms,
    posting_frequency: postingFrequency,
    content_mix: contentMix,
    duration_weeks: profile.duration_weeks,
    campaign_goal: campaignGoal,
    generation_meta: {
      generated_by: 'autonomous_agent',
      generated_at: generatedAt,
      based_on_campaign_id: lastCampaignId,
      platform_ranking: rankedPlatforms,
      avg_historical_engagement: perfInsights?.avg_engagement_rate ?? 0,
      learnings_applied: learnings.length,
      predicted_engagement_rate: 0,  // filled below
      confidence_score: 0,            // filled below
      optimization_notes: optimizationNotes,
      risk_tolerance: riskTolerance,
    },
  };

  // ── Run prediction on the generated plan ──────────────────────────────────
  try {
    const prediction = await predictCampaignOutcome({
      campaign_id:  lastCampaignId ?? companyId,
      company_id:   companyId,
      description,
      strategy_context: {
        platforms:         selectedPlatforms,
        posting_frequency: postingFrequency,
        content_mix:       contentMix,
        duration_weeks:    profile.duration_weeks,
        campaign_goal:     campaignGoal,
      },
      historical_performance: perfInsights?.avg_engagement_rate,
    });
    plan.generation_meta.predicted_engagement_rate = prediction.predicted_engagement_rate;
    plan.generation_meta.confidence_score          = prediction.confidence_score;
    if (prediction.warnings.length > 0) {
      plan.generation_meta.optimization_notes = [
        ...plan.generation_meta.optimization_notes,
        ...prediction.warnings,
      ];
    }
  } catch (_) { /* non-blocking */ }

  // Deduct credits after successful plan assembly
  await deductCreditsAwaited(companyId, 'campaign_generation', { note: `Auto campaign #${campaignNumber}` });

  await logDecision({
    company_id:    companyId,
    campaign_id:   lastCampaignId,
    decision_type: 'generate',
    reason:        `Auto-generated campaign #${campaignNumber} using ${learnings.length} learnings`,
    metrics_used:  {
      avg_historical_engagement: plan.generation_meta.avg_historical_engagement,
      predicted_engagement_rate: plan.generation_meta.predicted_engagement_rate,
      platform_ranking:          rankedPlatforms,
      risk_tolerance:            riskTolerance,
    },
  });

  return plan;
}

async function getCampaignCount(companyId: string): Promise<number> {
  const { count } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  return count ?? 0;
}
