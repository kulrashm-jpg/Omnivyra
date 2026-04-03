/**
 * Stage 36 — Structured Autonomous Optimization Proposals.
 * Advisory only. No automatic mutation. Read-only.
 */

import { supabase } from '../db/supabaseClient';
import { getCampaignRoiIntelligence } from './CampaignRoiIntelligenceService';
import { getCampaignGovernanceAnalytics } from './GovernanceAnalyticsService';
import { generateCampaignOptimizationInsights } from './CampaignOptimizationIntelligenceService';
import type { OptimizationProposal } from '../types/CampaignOptimization';

const CONTENT_COLLISION_EVENT = 'CONTENT_COLLISION_DETECTED';
const DEFAULT_POSTS_PER_WEEK = 5;

/**
 * Generate optimization proposal. Returns null when no optimization signals.
 * Read-only, never throws.
 */
export async function generateOptimizationProposal(
  campaignId: string
): Promise<OptimizationProposal | null> {
  try {
    if (!campaignId || typeof campaignId !== 'string') return null;

    const [roi, insights, campaign] = await Promise.all([
      getCampaignRoiIntelligence(campaignId),
      generateCampaignOptimizationInsights(campaignId),
      supabase
        .from('campaigns')
        .select('duration_weeks, start_date')
        .eq('id', campaignId)
        .maybeSingle()
        .then((r) => (r.error ? null : r.data)),
    ]);

    const durationWeeks = (campaign as any)?.duration_weeks ?? 12;
    const currentPostsPerWeek = DEFAULT_POSTS_PER_WEEK;
    const insightHeadlines = (insights || []).map((i) => i.headline).filter(Boolean);
    const hasGovInstability = (insights || []).some((i) => i.category === 'GOVERNANCE');
    const hasExecutionRisk = (insights || []).some((i) => i.category === 'EXECUTION');
    const hasRoiRisk = roi.roiScore < 50;
    const hasContentCollision = (insights || []).some((i) => i.category === 'CONTENT_STRATEGY');

    const govStability = roi.governanceStabilityScore ?? 80;
    const execReliability = roi.executionReliabilityScore ?? 80;

    // Rule 5 — HIGH_POTENTIAL: roiScore >= 80, governance >= 80, execution >= 75
    const isHighPotential =
      roi.roiScore >= 80 && govStability >= 80 && execReliability >= 75;

    if (isHighPotential) {
      const proposedWeeks = Math.max(1, Math.round(durationWeeks * 1.2));
      return {
        campaignId,
        summary: 'High-performing campaign — scaling opportunity detected.',
        proposedDurationWeeks: proposedWeeks,
        reasoning: ['High-performing campaign — scaling opportunity.'],
        confidenceScore: Math.min(100, 85 + Math.floor((roi.roiScore - 80) / 2)),
      };
    }

    // Check risk signals
    if (!hasRoiRisk && !hasGovInstability && !hasExecutionRisk && !hasContentCollision) {
      return null;
    }

    const reasoning: string[] = [];
    let proposedDurationWeeks: number | undefined;
    let proposedPostsPerWeek: number | undefined;
    let proposedContentMixAdjustment: Record<string, number> | undefined;
    let proposedStartDateShift: string | undefined;

    // Rule 1 — ROI < 50
    if (hasRoiRisk) {
      reasoning.push('Performance under target — reducing intensity to improve quality.');
      proposedPostsPerWeek = Math.max(1, Math.round(currentPostsPerWeek * 0.8));
      if (!hasGovInstability) {
        proposedDurationWeeks = Math.max(1, Math.round(durationWeeks * 1.25));
      }
    }

    // Rule 2 — Governance Instability: no duration change, only start date shift if freeze blocks
    if (hasGovInstability) {
      reasoning.push('Governance instability detected — stabilize before scaling.');
      proposedStartDateShift = '+7';
      proposedDurationWeeks = undefined; // override: do not propose duration change
    }

    // Rule 3 — Execution Risk
    if (hasExecutionRisk) {
      reasoning.push('Execution reliability risk — lowering operational load.');
      const reduced = Math.max(1, Math.round((proposedPostsPerWeek ?? currentPostsPerWeek) * 0.85));
      proposedPostsPerWeek = reduced;
    }

    // Rule 4 — Content Collision
    if (hasContentCollision) {
      reasoning.push('Content overlap detected — diversifying asset mix.');
      proposedContentMixAdjustment = {
        video: 0.35,
        post: 0.45,
        article: 0.2,
      };
    }

    const confidenceScore = computeConfidenceScore({
      severityAlignment: hasRoiRisk || hasExecutionRisk ? 0.7 : hasGovInstability ? 0.5 : 1,
      governanceStability: govStability / 100,
      executionReliability: execReliability / 100,
    });

    const summary =
      reasoning.length > 0
        ? reasoning[0]
        : insightHeadlines[0] ?? 'Optimization proposal based on persisted decision signals.';

    return {
      campaignId,
      summary,
      proposedDurationWeeks,
      proposedPostsPerWeek,
      proposedContentMixAdjustment,
      proposedStartDateShift,
      reasoning,
      confidenceScore,
    };
  } catch {
    return null;
  }
}

/**
 * Deterministic confidence: 40% severity + 30% gov + 30% exec. Clamp 0–100.
 */
function computeConfidenceScore(params: {
  severityAlignment: number;
  governanceStability: number;
  executionReliability: number;
}): number {
  const score =
    params.severityAlignment * 40 +
    params.governanceStability * 30 +
    params.executionReliability * 30;
  return Math.max(0, Math.min(100, Math.round(score)));
}
