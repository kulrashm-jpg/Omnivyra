/**
 * Stage 35 — AI Strategic Optimization Engine.
 * Deterministic, advisory only. No mutation. No auto-apply. Governance-safe.
 */

import { getCampaignRoiIntelligence } from './CampaignRoiIntelligenceService';
import { getCampaignGovernanceAnalytics } from './GovernanceAnalyticsService';
import { supabase } from '../db/supabaseClient';

export interface CampaignOptimizationInsight {
  campaignId: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  category: 'PERFORMANCE' | 'GOVERNANCE' | 'EXECUTION' | 'CONTENT_STRATEGY';
  headline: string;
  explanation: string;
  recommendedAction: string;
}

const CONTENT_COLLISION_EVENT = 'CONTENT_COLLISION_DETECTED';

/**
 * Generate campaign optimization insights. Read-only, never throws.
 */
export async function generateCampaignOptimizationInsights(
  campaignId: string
): Promise<CampaignOptimizationInsight[]> {
  try {
    if (!campaignId || typeof campaignId !== 'string') {
      return [];
    }

    const [roi, govAnalytics, events, posts] = await Promise.all([
      getCampaignRoiIntelligence(campaignId),
      getCampaignGovernanceAnalytics(campaignId),
      supabase
        .from('campaign_governance_events')
        .select('event_type')
        .eq('campaign_id', campaignId)
        .then((r) => (r.error ? [] : r.data || [])),
      supabase
        .from('scheduled_posts')
        .select('status')
        .eq('campaign_id', campaignId)
        .then((r) => (r.error ? [] : r.data || [])),
    ]);

    const insights: CampaignOptimizationInsight[] = [];

    if (roi.roiScore < 50) {
      insights.push({
        campaignId,
        priority: 'HIGH',
        category: 'PERFORMANCE',
        headline: 'Campaign performance under target',
        explanation: 'Engagement or CTR below optimal thresholds',
        recommendedAction:
          'Reduce frequency, refine CTA type, or adjust content mix toward higher engagement formats.',
      });
    }

    const driftCount = govAnalytics?.driftCount ?? 0;
    const replayCoverageRatio = govAnalytics?.replayCoverageRatio ?? 1;
    if (driftCount > 0 || replayCoverageRatio < 0.8) {
      insights.push({
        campaignId,
        priority: 'MEDIUM',
        category: 'GOVERNANCE',
        headline: 'Governance stability risk detected',
        explanation: driftCount > 0
          ? 'Policy drift detected from replay verification'
          : 'Replay coverage below 80% limits auditability',
        recommendedAction: 'Review negotiation patterns and policy upgrade recommendations.',
      });
    }

    const freezeBlocks = govAnalytics?.freezeBlocks ?? 0;
    const postList = Array.isArray(posts) ? posts : [];
    const schedulerFailures = postList.filter((p: any) =>
      /^failed$/i.test(String(p?.status || ''))
    ).length;

    if (freezeBlocks > 0 || schedulerFailures > 0) {
      insights.push({
        campaignId,
        priority: 'HIGH',
        category: 'EXECUTION',
        headline: 'Execution reliability risk',
        explanation:
          freezeBlocks > 0
            ? 'Freeze blocks indicate scheduling or mutation constraints'
            : 'Scheduled posts have failed to execute',
        recommendedAction: 'Audit schedule timing and execution windows.',
      });
    }

    const evts = Array.isArray(events) ? events : [];
    const hasContentCollision = evts.some(
      (e: any) => String(e?.event_type || '').toUpperCase() === CONTENT_COLLISION_EVENT
    );

    if (hasContentCollision) {
      insights.push({
        campaignId,
        priority: 'MEDIUM',
        category: 'CONTENT_STRATEGY',
        headline: 'Content overlap reducing differentiation',
        explanation: 'Content collision events indicate overlapping assets across campaigns',
        recommendedAction: 'Adjust content selection to avoid campaign asset collision.',
      });
    }

    if (insights.length === 0) {
      insights.push({
        campaignId,
        priority: 'LOW',
        category: 'PERFORMANCE',
        headline: 'Campaign operating within optimal range',
        explanation: 'No significant optimization signals detected',
        recommendedAction: 'Continue monitoring performance and governance metrics.',
      });
    }

    return insights;
  } catch {
    return [
      {
        campaignId: campaignId || '',
        priority: 'LOW',
        category: 'PERFORMANCE',
        headline: 'Campaign operating within optimal range',
        explanation: 'Unable to compute full optimization analysis',
        recommendedAction: 'Continue monitoring performance and governance metrics.',
      },
    ];
  }
}
