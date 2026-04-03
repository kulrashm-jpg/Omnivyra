
/**
 * GET /api/governance/campaign-analytics
 * Stage 22 — Campaign-level governance analytics. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getCampaignGovernanceAnalytics } from '../../../backend/services/GovernanceAnalyticsService';
import { listDecisionObjects } from '../../../backend/services/decisionObjectService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';

function deriveRoiFromDecisions(decisions: Array<{ priority_score?: number | null; impact_conversion?: number | null; issue_type?: string | null; recommendation?: string | null }>) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return {
      roiScore: 50,
      performanceScore: 50,
      governanceStabilityScore: 80,
      executionReliabilityScore: 80,
      optimizationSignal: 'STABLE' as const,
      recommendation: 'No active decision signals for this campaign.',
    };
  }

  const avgPriority = decisions.reduce((sum, d) => sum + Number(d.priority_score ?? 0), 0) / decisions.length;
  const avgConversionImpact = decisions.reduce((sum, d) => sum + Number(d.impact_conversion ?? 0), 0) / decisions.length;
  const governanceCount = decisions.filter((d) => String(d.issue_type ?? '').toLowerCase().includes('governance') || String(d.issue_type ?? '').toLowerCase().includes('drift')).length;
  const executionCount = decisions.filter((d) => String(d.issue_type ?? '').toLowerCase().includes('execution') || String(d.issue_type ?? '').toLowerCase().includes('dropoff')).length;

  const performanceScore = Math.max(0, Math.min(100, Math.round(100 - avgConversionImpact * 0.6)));
  const governanceStabilityScore = Math.max(0, Math.min(100, Math.round(100 - governanceCount * 12)));
  const executionReliabilityScore = Math.max(0, Math.min(100, Math.round(100 - executionCount * 10 - avgPriority * 0.25)));
  const roiScore = Math.max(0, Math.min(100, Math.round(0.4 * performanceScore + 0.3 * governanceStabilityScore + 0.3 * executionReliabilityScore)));

  return {
    roiScore,
    performanceScore,
    governanceStabilityScore,
    executionReliabilityScore,
    optimizationSignal: roiScore >= 80 ? 'HIGH_POTENTIAL' as const : roiScore < 50 ? 'AT_RISK' as const : 'STABLE' as const,
    recommendation: decisions[0]?.recommendation ?? 'Review top active decisions to improve campaign outcomes.',
  };
}

function deriveOptimizationInsights(campaignId: string, decisions: Array<{ priority_score?: number | null; issue_type?: string | null; title?: string | null; description?: string | null; recommendation?: string | null }>) {
  return decisions
    .sort((a, b) => Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0))
    .slice(0, 10)
    .map((decision) => ({
      campaignId,
      priority: Number(decision.priority_score ?? 0) >= 70 ? 'HIGH' : Number(decision.priority_score ?? 0) >= 45 ? 'MEDIUM' : 'LOW',
      category:
        String(decision.issue_type ?? '').toLowerCase().includes('governance')
          ? 'GOVERNANCE'
          : String(decision.issue_type ?? '').toLowerCase().includes('execution')
            ? 'EXECUTION'
            : String(decision.issue_type ?? '').toLowerCase().includes('revenue') || String(decision.issue_type ?? '').toLowerCase().includes('conversion')
              ? 'PERFORMANCE'
              : 'CONTENT_STRATEGY',
      headline: String(decision.title ?? '').trim(),
      explanation: String(decision.description ?? '').trim(),
      recommendedAction: String(decision.recommendation ?? '').trim(),
    }))
    .filter((item) => item.headline.length > 0);
}

function deriveOptimizationProposal(campaignId: string, durationWeeks: number, decisions: Array<{ priority_score?: number | null; impact_revenue?: number | null; title?: string | null; issue_type?: string | null }>) {
  if (!Array.isArray(decisions) || decisions.length === 0) return null;
  const avgPriority = decisions.reduce((sum, d) => sum + Number(d.priority_score ?? 0), 0) / decisions.length;
  const avgRevenueImpact = decisions.reduce((sum, d) => sum + Number(d.impact_revenue ?? 0), 0) / decisions.length;
  const reasoning = decisions
    .slice(0, 3)
    .map((d) => String(d.title ?? d.issue_type ?? '').trim())
    .filter(Boolean);

  return {
    campaignId,
    summary: reasoning[0] ?? 'Optimization proposal generated from active decision objects.',
    proposedDurationWeeks:
      avgRevenueImpact >= 65
        ? Math.max(1, Math.round(durationWeeks * 1.15))
        : avgRevenueImpact <= 35
          ? Math.max(1, Math.round(durationWeeks * 0.9))
          : durationWeeks,
    proposedPostsPerWeek: avgPriority >= 70 ? 4 : avgPriority >= 45 ? 5 : 6,
    reasoning: reasoning.length > 0 ? reasoning : ['Optimization proposal generated from active decision objects.'],
    confidenceScore: Math.max(50, Math.min(95, Math.round(avgPriority))),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  const analytics = await getCampaignGovernanceAnalytics(campaignId);
  if (!analytics) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const [campaignRow] =
    await Promise.all([
      supabase
        .from('campaigns')
        .select('auto_optimize_enabled, company_id, duration_weeks')
        .eq('id', campaignId)
        .maybeSingle()
        .then((r) => (r.error ? null : r.data)),
    ]);

  const decisionRows = campaignRow?.company_id
    ? await runInApiReadContext('governanceCampaignAnalyticsApi', async () =>
        listDecisionObjects({
          viewName: 'deep_view',
          companyId: campaignRow.company_id,
          entityType: 'campaign',
          entityId: campaignId,
          status: ['open'],
          limit: 100,
        })
      )
    : [];

  const roiIntelligence = deriveRoiFromDecisions(decisionRows);
  const optimizationInsights = deriveOptimizationInsights(campaignId, decisionRows);
  const optimizationProposal = deriveOptimizationProposal(
    campaignId,
    Number(campaignRow?.duration_weeks ?? 12) || 12,
    decisionRows
  );

  const autoOptimizeEnabled = Boolean((campaignRow as { auto_optimize_enabled?: boolean } | null)?.auto_optimize_enabled);

  return res.status(200).json({
    ...analytics,
    roiIntelligence,
    optimizationInsights,
    optimizationProposal,
    autoOptimizationEligibility: {
      eligible: false,
      reason: 'Inline optimization evaluation disabled in API; use background decision pipeline.',
    },
    autoOptimizeEnabled,
  });
}
