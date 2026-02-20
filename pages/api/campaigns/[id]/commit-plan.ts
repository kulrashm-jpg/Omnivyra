/**
 * POST /api/campaigns/[id]/commit-plan
 * Commits a structured AI-generated plan to the blueprint (twelve_week_plan)
 * so it appears in the work/commit view (campaign-details, recommendations).
 * Does NOT schedule posts — use schedule-structured-plan for that.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../../backend/services/GovernanceLockdownService';
import { saveCampaignBlueprintFromLegacy } from '../../../../backend/db/campaignPlanStore';
import { fromStructuredPlan } from '../../../../backend/services/campaignBlueprintAdapter';
import { assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError } from '../../../../backend/services/campaignBlueprintService';
import { assertCampaignNotFinalized, CampaignFinalizedError } from '../../../../backend/services/CampaignFinalizationGuard';
import { normalizeExecutionState } from '../../../../backend/governance/ExecutionStateMachine';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';

async function getCompanyId(campaignId: string): Promise<string | null> {
  const { data } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  return (data as any)?.company_id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (await isGovernanceLocked()) {
    return res.status(423).json({
      code: 'GOVERNANCE_LOCKED',
      message: 'Governance lockdown active. Mutations disabled.',
    });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const { plan } = req.body || {};
  if (!plan || !Array.isArray(plan.weeks)) {
    return res.status(400).json({ error: 'Structured plan with weeks is required' });
  }

  const companyId = typeof req.body.companyId === 'string' ? req.body.companyId : await getCompanyId(id);
  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: companyId ?? '',
    campaignId: id,
    requireCampaignId: true,
  });
  if (!access) return;

  try {
    const { data: campaign, error: campError } = await supabase
      .from('campaigns')
      .select('execution_status, blueprint_status')
      .eq('id', id)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const executionStatus = normalizeExecutionState((campaign as any).execution_status);
    try {
      assertCampaignNotFinalized(executionStatus);
    } catch (err: any) {
      if (err instanceof CampaignFinalizedError) {
        return res.status(409).json({
          code: 'CAMPAIGN_FINALIZED',
          message: 'Campaign is finalized and cannot be modified',
        });
      }
      throw err;
    }

    try {
      await assertBlueprintMutable(id);
    } catch (err: any) {
      if (err instanceof BlueprintExecutionFreezeError) {
        return res.status(409).json({
          code: 'EXECUTION_WINDOW_FROZEN',
          message: 'Blueprint modifications are locked within 24 hours of execution.',
        });
      }
      if (err instanceof BlueprintImmutableError) {
        return res.status(409).json({
          code: 'BLUEPRINT_IMMUTABLE',
          message: 'Blueprint cannot be modified while campaign is in execution.',
        });
      }
      throw err;
    }

    const blueprint = fromStructuredPlan({ weeks: plan.weeks, campaign_id: id });
    await saveCampaignBlueprintFromLegacy({
      campaignId: id,
      blueprint,
      source: 'ai-commit-plan',
    });

    await supabase
      .from('campaigns')
      .update({
        status: 'active',
        current_stage: 'schedule',
        blueprint_status: 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (companyId) {
      void syncCampaignVersionStage(id, 'schedule', companyId).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'Plan committed. It now appears in your campaign view and recommendations.',
    });
  } catch (error: any) {
    console.error('[commit-plan]', error);
    return res.status(500).json({
      error: error?.message || 'Failed to commit plan',
    });
  }
}
