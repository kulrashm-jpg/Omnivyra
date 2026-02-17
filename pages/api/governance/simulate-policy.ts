/**
 * GET /api/governance/simulate-policy
 * Stage 26 — Policy simulation. Run evaluation under specified policy version.
 * No mutation. No event emission. Read-only.
 * RBAC: COMPANY_ADMIN minimum.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import { supabase } from '../../../backend/db/supabaseClient';
import { getLatestCampaignVersionByCampaignId } from '../../../backend/db/campaignVersionStore';
import { runPrePlanning } from '../../../backend/services/CampaignPrePlanningService';
import { getGovernancePolicy, PolicyVersionNotFoundError } from '../../../backend/governance/GovernancePolicyRegistry';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const campaignId = (req.query.campaignId as string)?.trim?.();
  const policyVersion = (req.query.policyVersion as string)?.trim?.();
  const companyId = (req.query.companyId as string)?.trim?.();

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }
  if (!policyVersion) {
    return res.status(400).json({ error: 'policyVersion is required' });
  }
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  let policy;
  try {
    policy = getGovernancePolicy(policyVersion);
  } catch (err) {
    if (err instanceof PolicyVersionNotFoundError) {
      return res.status(404).json({
        code: 'POLICY_VERSION_NOT_FOUND',
        error: err.message,
      });
    }
    throw err;
  }

  try {
    const cv = await getLatestCampaignVersionByCampaignId(campaignId);
    if (!cv?.company_id) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (cv.company_id !== companyId) {
      return res.status(403).json({ error: 'Campaign not in company scope' });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, duration_weeks')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    let requested_weeks = (campaign as any).duration_weeks;
    if (requested_weeks == null || requested_weeks < 1) {
      const { data: latestEvent } = await supabase
        .from('campaign_governance_events')
        .select('metadata')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const meta = (latestEvent as any)?.metadata ?? {};
      const ctx = meta.evaluation_context ?? meta;
      requested_weeks = ctx.requested_weeks ?? meta.requested_weeks ?? 12;
    }
    requested_weeks = Math.max(1, Math.min(52, Number(requested_weeks) || 12));

    const evaluation = await runPrePlanning({
      companyId,
      campaignId,
      requested_weeks,
      suppressEvents: true,
      policyVersion,
    });

    const limitingCount = evaluation.limiting_constraints?.length ?? 0;
    const blockingCount = evaluation.blocking_constraints?.length ?? 0;
    const explanation =
      evaluation.status === 'APPROVED'
        ? `Approved for ${requested_weeks} weeks. No constraints limit duration.`
        : evaluation.status === 'REJECTED'
          ? `Rejected: ${blockingCount} blocking constraint(s), max ${evaluation.max_weeks_allowed} weeks.`
          : `Negotiate: ${limitingCount} limiting constraint(s), max ${evaluation.max_weeks_allowed} weeks.`;

    return res.status(200).json({
      policyVersion,
      status: evaluation.status,
      trade_off_options: evaluation.tradeOffOptions ?? [],
      explanation,
      policyHash: policy.hash,
      requested_weeks,
      max_weeks_allowed: evaluation.max_weeks_allowed,
      min_weeks_required: evaluation.min_weeks_required,
    });
  } catch (err: any) {
    console.error('[governance/simulate-policy]', err);
    return res.status(500).json({
      error: err?.message ?? 'Internal server error',
    });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.SUPER_ADMIN]);
