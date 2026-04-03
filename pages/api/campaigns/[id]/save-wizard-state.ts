
/**
 * POST /api/campaigns/[id]/save-wizard-state
 * Saves pre-planning wizard state to campaign_versions.campaign_snapshot.wizard_state.
 * Debounced by client (5s); used for durable draft persistence.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import {
  updateWizardStateInSnapshot,
  getLatestCampaignVersionByCampaignId,
} from '../../../../backend/db/campaignVersionStore';

async function getCompanyIdForCampaign(campaignId: string): Promise<string | null> {
  const version = await getLatestCampaignVersionByCampaignId(campaignId);
  return version?.company_id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id: campaignId } = req.query;
  if (!campaignId || typeof campaignId !== 'string') {
    return res.status(400).json({ error: 'Campaign ID is required' });
  }

  const companyId = await getCompanyIdForCampaign(campaignId);
  if (!companyId) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    campaignId,
    requireCampaignId: true,
  });
  if (!access) return;

  const body = req.body || {};
  const step = typeof body.step === 'number' ? body.step : 0;
  const questionnaire_answers =
    body.questionnaire_answers && typeof body.questionnaire_answers === 'object'
      ? body.questionnaire_answers
      : {};
  const planned_start_date =
    typeof body.planned_start_date === 'string' ? body.planned_start_date : new Date().toISOString().split('T')[0];
  const pre_planning_result =
    body.pre_planning_result && typeof body.pre_planning_result === 'object' ? body.pre_planning_result : null;
  const cross_platform_sharing_enabled = body.cross_platform_sharing_enabled !== false;
  const updated_at = typeof body.updated_at === 'string' ? body.updated_at : new Date().toISOString();

  try {
    await updateWizardStateInSnapshot({
      campaignId,
      companyId,
      wizardState: {
        wizard_state_version: 1,
        step,
        questionnaire_answers,
        planned_start_date,
        pre_planning_result,
        cross_platform_sharing_enabled,
        updated_at,
      },
    });
    return res.status(200).json({
      success: true,
      campaign_id: campaignId,
      message: 'Wizard state saved',
    });
  } catch (error) {
    console.error('save-wizard-state failed:', error);
    return res.status(500).json({
      error: 'Failed to save wizard state',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
