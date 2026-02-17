/**
 * Stage 34 — Campaign ROI Intelligence Engine.
 * Analytical + advisory only. No writes, no governance events.
 * Never throws.
 */

import { supabase } from '../db/supabaseClient';
import {
  getCampaignGovernanceAnalytics,
  type GovernanceCampaignAnalytics,
} from './GovernanceAnalyticsService';

export interface CampaignRoiIntelligence {
  campaignId: string;
  roiScore: number;
  performanceScore: number;
  governanceStabilityScore: number;
  executionReliabilityScore: number;
  optimizationSignal: 'STABLE' | 'AT_RISK' | 'HIGH_POTENTIAL';
  recommendation?: string;
}

/** Default when no data. Safe defaults, no throws. */
const DEFAULT_INTELLIGENCE: Omit<CampaignRoiIntelligence, 'campaignId'> = {
  roiScore: 50,
  performanceScore: 50,
  governanceStabilityScore: 80,
  executionReliabilityScore: 80,
  optimizationSignal: 'STABLE',
  recommendation: 'Insufficient data to assess ROI. Add performance metrics and governance events.',
};

/**
 * Derive performance score from campaign_performance_metrics.
 * Engagement growth, CTR trend, completion rate. 0–100.
 */
async function computePerformanceScore(campaignId: string): Promise<number> {
  try {
    const { data: metrics, error } = await supabase
      .from('campaign_performance_metrics')
      .select('engagement_rate, click_through_rate, impressions, likes, comments, shares')
      .eq('campaign_id', campaignId)
      .order('date', { ascending: false })
      .limit(30);

    if (error || !metrics?.length) return 50;

    const avgEngagement = metrics.reduce((s, m) => s + (Number(m.engagement_rate) || 0), 0) / metrics.length;
    const avgCtr = metrics.reduce((s, m) => s + (Number(m.click_through_rate) || 0), 0) / metrics.length;
    const totalEngagement = metrics.reduce(
      (s, m) => s + (Number(m.likes) || 0) + (Number(m.comments) || 0) + (Number(m.shares) || 0),
      0
    );
    const hasEngagement = totalEngagement > 0;

    let engagementComponent = 50;
    if (avgEngagement > 0) {
      engagementComponent = Math.min(100, Math.round(avgEngagement * 500));
    } else if (hasEngagement) {
      engagementComponent = 60;
    }

    let ctrComponent = 50;
    if (avgCtr > 0) {
      ctrComponent = Math.min(100, Math.round(avgCtr * 2000));
    }

    const score = Math.round((engagementComponent * 0.6 + ctrComponent * 0.4));
    return Math.max(0, Math.min(100, score));
  } catch {
    return 50;
  }
}

/**
 * Governance stability: 100 − (driftCount*20) − (negotiations*5) − (freezeBlocks*10).
 * Clamp 0–100.
 */
function computeGovernanceStabilityScore(
  driftCount: number,
  negotiationCount: number,
  freezeBlocks: number
): number {
  let score = 100;
  score -= driftCount * 20;
  score -= negotiationCount * 5;
  score -= freezeBlocks * 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Execution reliability: scheduler failures, lock conflicts, preemptions, completion.
 * 0–100.
 */
function computeExecutionReliabilityScore(
  preemptionCount: number,
  freezeBlocks: number,
  failedPosts: number,
  totalScheduled: number,
  totalPublished: number,
  isCompleted: boolean
): number {
  let score = 100;
  score -= preemptionCount * 25;
  score -= freezeBlocks * 8;
  score -= failedPosts * 15;
  if (totalScheduled > 0) {
    const completionRate = totalPublished / totalScheduled;
    if (completionRate < 0.5) score -= 20;
    else if (completionRate < 0.8) score -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Determine optimization signal and recommendation.
 */
function deriveOptimizationSignal(
  performanceScore: number,
  governanceScore: number,
  executionScore: number
): { signal: CampaignRoiIntelligence['optimizationSignal']; recommendation?: string } {
  const highPerf = performanceScore >= 70;
  const lowPerf = performanceScore < 50;
  const stableGov = governanceScore >= 80;
  const highFriction = governanceScore < 70;

  if (highPerf && stableGov && executionScore >= 70) {
    return {
      signal: 'HIGH_POTENTIAL',
      recommendation: 'Consider scaling budget or extending duration.',
    };
  }
  if (lowPerf && (highFriction || executionScore < 60)) {
    return {
      signal: 'AT_RISK',
      recommendation: 'Reduce frequency or adjust content mix to improve engagement.',
    };
  }
  return { signal: 'STABLE', recommendation: 'Campaign is operating within expected parameters.' };
}

/**
 * Get campaign ROI intelligence. Read-only, never throws.
 * @param govAnalyticsPrecomputed - Optional pre-fetched governance analytics to avoid double fetch.
 */
export async function getCampaignRoiIntelligence(
  campaignId: string,
  govAnalyticsPrecomputed?: GovernanceCampaignAnalytics | null
): Promise<CampaignRoiIntelligence> {
  try {
    if (!campaignId || typeof campaignId !== 'string') {
      return { campaignId: campaignId || '', ...DEFAULT_INTELLIGENCE };
    }

    const [performanceScore, govAnalytics, postData] = await Promise.all([
      computePerformanceScore(campaignId),
      govAnalyticsPrecomputed !== undefined
        ? Promise.resolve(govAnalyticsPrecomputed)
        : getCampaignGovernanceAnalytics(campaignId),
      supabase
        .from('scheduled_posts')
        .select('status')
        .eq('campaign_id', campaignId)
        .then((r) => (r.error ? [] : r.data || [])),
    ]);

    const posts = Array.isArray(postData) ? postData : [];
    const totalScheduled = posts.length;
    const totalPublished = posts.filter((p: any) =>
      /^published$/i.test(String(p?.status || ''))
    ).length;
    const failedPosts = posts.filter((p: any) =>
      /^failed$/i.test(String(p?.status || ''))
    ).length;

    const driftCount = govAnalytics?.driftCount ?? 0;
    const negotiationCount = govAnalytics?.negotiationCount ?? 0;
    const freezeBlocks = govAnalytics?.freezeBlocks ?? 0;
    const preemptionCount = govAnalytics?.preemptionCount ?? 0;
    const isCompleted = govAnalytics?.executionState === 'COMPLETED' || !!govAnalytics?.completionTimestamp;

    const governanceStabilityScore = computeGovernanceStabilityScore(
      driftCount,
      negotiationCount,
      freezeBlocks
    );

    const executionReliabilityScore = computeExecutionReliabilityScore(
      preemptionCount,
      freezeBlocks,
      failedPosts,
      totalScheduled,
      totalPublished,
      isCompleted
    );

    const roiScore = Math.round(
      0.4 * performanceScore + 0.3 * governanceStabilityScore + 0.3 * executionReliabilityScore
    );
    const clampedRoi = Math.max(0, Math.min(100, roiScore));

    const { signal, recommendation } = deriveOptimizationSignal(
      performanceScore,
      governanceStabilityScore,
      executionReliabilityScore
    );

    return {
      campaignId,
      roiScore: clampedRoi,
      performanceScore,
      governanceStabilityScore,
      executionReliabilityScore,
      optimizationSignal: signal,
      recommendation,
    };
  } catch {
    return {
      campaignId: campaignId || '',
      ...DEFAULT_INTELLIGENCE,
    };
  }
}
