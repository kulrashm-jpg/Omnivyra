/**
 * GET /api/analytics/campaign-optimization-proposal
 * Stage 36 — Structured optimization proposal. Advisory only. RBAC: COMPANY_ADMIN+
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';
import { listDecisionObjects } from '../../../backend/services/decisionObjectService';
import { runInApiReadContext } from '../../../backend/services/intelligenceExecutionContext';
import type { OptimizationProposal } from '../../../backend/types/CampaignOptimization';

function proposalFromDecisionObjects(input: {
  campaignId: string;
  durationWeeks: number;
  decisions: Array<{ priority_score?: number | null; impact_revenue?: number | null; recommendation?: string | null; title?: string | null; issue_type?: string | null }>;
}): OptimizationProposal | null {
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) return null;

  const avgPriority =
    input.decisions.reduce((sum, d) => sum + Number(d.priority_score ?? 0), 0) /
    Math.max(1, input.decisions.length);
  const avgRevenueImpact =
    input.decisions.reduce((sum, d) => sum + Number(d.impact_revenue ?? 0), 0) /
    Math.max(1, input.decisions.length);

  const topReasoning = input.decisions
    .slice(0, 3)
    .map((d) => String(d.title ?? d.issue_type ?? '').trim())
    .filter(Boolean);

  const proposedPostsPerWeek = avgPriority >= 70 ? 4 : avgPriority >= 45 ? 5 : 6;
  const proposedDurationWeeks = avgRevenueImpact >= 65
    ? Math.max(1, Math.round(input.durationWeeks * 1.15))
    : avgRevenueImpact <= 35
      ? Math.max(1, Math.round(input.durationWeeks * 0.9))
      : input.durationWeeks;

  return {
    campaignId: input.campaignId,
    summary: topReasoning[0] ?? 'Decision-object signals indicate campaign optimization opportunities.',
    proposedDurationWeeks,
    proposedPostsPerWeek,
    proposedContentMixAdjustment: undefined,
    proposedStartDateShift: undefined,
    reasoning: topReasoning.length > 0 ? topReasoning : ['Optimization proposal generated from active decision objects.'],
    confidenceScore: Math.max(50, Math.min(95, Math.round(avgPriority))),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from('campaigns')
    .select('company_id, duration_weeks')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError || !campaignRow?.company_id) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const decisions = await runInApiReadContext('campaignOptimizationProposalApi', async () =>
    listDecisionObjects({
      viewName: 'deep_view',
      companyId: campaignRow.company_id,
      entityType: 'campaign',
      entityId: campaignId,
      status: ['open'],
      limit: 100,
    })
  );

  const proposal = proposalFromDecisionObjects({
    campaignId,
    durationWeeks: Number(campaignRow.duration_weeks ?? 12) || 12,
    decisions,
  });

  return res.status(200).json({ proposal });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
