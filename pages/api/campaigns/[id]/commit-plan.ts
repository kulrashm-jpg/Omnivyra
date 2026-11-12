import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { CampaignStatusFields } from '../../../../lib/campaign/campaignStage';
import { campaignLifecycleSelect, isCampaignFinalized } from '../../../../lib/campaign/executionStatusCompat';

/**
 * POST /api/campaigns/[id]/commit-plan
 * Commits a structured AI-generated plan to the blueprint (campaign_week_plan)
 * so it appears in the work/commit view (campaign-details, recommendations).
 * Does NOT schedule posts — use schedule-structured-plan for that.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { isGovernanceLocked } from '../../../../backend/services/GovernanceLockdownService';
import { saveCampaignBlueprintFromLegacy } from '../../../../backend/db/campaignPlanStore';
import { fromStructuredPlan } from '../../../../backend/services/campaignBlueprintAdapter';
import { assertBlueprintMutable, BlueprintImmutableError, BlueprintExecutionFreezeError, BlueprintMutabilityReadError } from '../../../../backend/services/campaignBlueprintService';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';
import { activateScheduledCampaign } from '../../../../backend/services/campaignScheduleActivation';

/** error is the PostgREST read error (returned, never thrown): a failed read is not "no company". */
async function getCompanyId(campaignId: string): Promise<{ companyId: string | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('campaign_versions')
    .select('company_id')
    .eq('campaign_id', campaignId)
    .limit(1)
    .maybeSingle();
  if (error) return { companyId: null, error: { message: error.message } };
  return { companyId: (data as any)?.company_id ?? null, error: null };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  let companyId: string | null;
  if (typeof req.body.companyId === 'string') {
    companyId = req.body.companyId;
  } else {
    const companyRead = await getCompanyId(id);
    // Unread, the company would be '' and access would answer a misleading 403 (unread-error pkg 2).
    if (companyRead.error) {
      console.error('[commit-plan] company lookup failed; nothing saved', { campaignId: id, message: companyRead.error.message });
      return res.status(503).json({
        code: 'CAMPAIGN_COMPANY_READ_FAILED',
        message: 'Could not read the company for this campaign. Nothing was saved. Please try again.',
      });
    }
    companyId = companyRead.companyId;
  }
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
      // R5: `execution_status` is absent in production, and naming it made
      // PostgREST fail the WHOLE read (42703) — so this route answered 404
      // "Campaign not found" for every campaign that exists.
      .select(campaignLifecycleSelect())
      .eq('id', id)
      .maybeSingle();

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // R5: was assertCampaignNotFinalized(normalizeExecutionState(
    // campaign.execution_status)). Two defects in one line: the select above
    // 42703-failed so this was unreachable, and had it been reached the absent
    // column normalizes to 'DRAFT' — never terminal — making the guard a
    // silent no-op. isCampaignFinalized expresses the SAME protection through
    // the canonical read model over columns that exist in production.
    // Response vocabulary (409 CAMPAIGN_FINALIZED) is unchanged.
    if (isCampaignFinalized(campaign as unknown as CampaignStatusFields)) {
      return res.status(409).json({
        code: 'CAMPAIGN_FINALIZED',
        message: 'Campaign is finalized and cannot be modified',
      });
    }

    try {
      await assertBlueprintMutable(id);
    } catch (err: any) {
      if (err instanceof BlueprintMutabilityReadError) {
        return res.status(503).json({
          code: 'BLUEPRINT_STATE_READ_FAILED',
          message: 'Blueprint state could not be read. Try again shortly.',
        });
      }
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

    // The same activation write as schedule-structured-plan (one implementation: retried, and an
    // alert-ready event on final failure). It was unchecked here, so a failed write answered 200 while
    // the campaign stayed inactive, and publishAuthorization refuses every post of an inactive campaign
    // (unread-error pkg 2). The blueprint IS saved; re-sending is safe: it re-commits the same draft,
    // and an inactive campaign's blueprint is still mutable.
    const activated = await activateScheduledCampaign(id, { companyId, source: 'commit-plan' });
    if (!activated.ok) {
      console.error('[commit-plan] blueprint saved but the campaign was not activated', { campaignId: id, message: activated.error?.message, attempts: activated.attempts });
      return res.status(503).json({
        code: 'CAMPAIGN_ACTIVATION_FAILED',
        saved: true,
        error: 'The plan was saved, but the campaign could not be activated, so its posts will not publish yet. Please commit again; it is safe to retry.',
      });
    }

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/commit-plan' });
