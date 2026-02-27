import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { runCampaignAiPlan } from '../../../backend/services/campaignAiOrchestrator';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { getCampaignPlanningInputs } from '../../../backend/services/campaignPlanningInputsService';
import {
  DEFAULT_BUILD_MODE_RECOMMENDATION,
  normalizeCampaignTypes,
  normalizeCampaignWeights,
} from '../../../backend/services/campaignContextConfig';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      company_id,
      selected_recommendations,
      groups,
      suggested_platform_mix,
      suggested_frequency,
    } = req.body || {};

    if (!company_id || !Array.isArray(selected_recommendations) || selected_recommendations.length === 0) {
      return res.status(400).json({ error: 'company_id and selected_recommendations are required' });
    }
    if (!Array.isArray(groups) || groups.length === 0) {
      return res.status(400).json({ error: 'groups are required' });
    }

    const snapshotHashes = selected_recommendations
      .map((item: any) => item?.snapshot_hash)
      .filter(Boolean);
    if (snapshotHashes.length === 0) {
      return res.status(400).json({ error: 'snapshot_hash values are required' });
    }

    const { data: snapshots } = await supabase
      .from('recommendation_snapshots')
      .select('*')
      .eq('company_id', company_id)
      .in('snapshot_hash', snapshotHashes);

    const { data: opinionLogs } = await supabase
      .from('audit_logs')
      .select('actor_user_id, created_at, metadata')
      .eq('company_id', company_id)
      .eq('action', 'RECOMMENDATION_STATE_CHANGED')
      .in(
        'metadata->>recommendation_id',
        (snapshots || []).map((row: any) => row.id)
      )
      .order('created_at', { ascending: false });

    const summarySets = {
      shortlisted: new Set<string>(),
      discarded: new Set<string>(),
      active: new Set<string>(),
    };
    (opinionLogs || []).forEach((log: any) => {
      const state = log?.metadata?.state ? String(log.metadata.state) : 'active';
      const actorUserId = log.actor_user_id ? String(log.actor_user_id) : null;
      if (actorUserId) {
        if (state === 'shortlisted') summarySets.shortlisted.add(actorUserId);
        if (state === 'discarded') summarySets.discarded.add(actorUserId);
        if (state === 'active') summarySets.active.add(actorUserId);
      }
    });

    const teamOpinionSummary = {
      shortlisted_count: summarySets.shortlisted.size,
      discarded_count: summarySets.discarded.size,
      active_count: summarySets.active.size,
    };

    const campaignName = `Grouped Campaign: ${groups[0]?.theme_name || 'Strategy'}`;
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        name: campaignName,
        description: `Grouped from ${snapshotHashes.length} recommendations`,
        status: 'draft',
        current_stage: 'planning',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (campaignError || !campaign) {
      return res.status(500).json({ error: 'Failed to create campaign' });
    }

    const campaign_types = normalizeCampaignTypes(req.body?.campaign_types ?? req.body?.campaignTypes);
    const campaign_weights = normalizeCampaignWeights(
      campaign_types,
      req.body?.campaign_weights ?? req.body?.campaignWeights
    );

    const market_scope = req.body?.market_scope ?? req.body?.marketScope ?? 'niche';
    const company_stage = req.body?.company_stage ?? req.body?.companyStage ?? 'early_stage';

    const { error: versionError } = await supabase.from('campaign_versions').insert({
      company_id: company_id,
      campaign_id: campaign.id,
      campaign_snapshot: {
        campaign,
      },
      status: 'draft',
      version: 1,
      created_at: new Date().toISOString(),
      build_mode: req.body?.build_mode ?? req.body?.buildMode ?? DEFAULT_BUILD_MODE_RECOMMENDATION,
      context_scope: Array.isArray(req.body?.context_scope) ? req.body.context_scope : null,
      campaign_types,
      campaign_weights,
      company_stage,
      market_scope,
    });

    if (versionError) {
      console.warn('Failed to create campaign_versions mapping:', versionError.message);
    }

    const message =
      'Create a campaign strategy based on grouped trend recommendations.\n' +
      'Use the provided grouping to propose platforms, content types, weekly frequency, and reuse opportunities.\n' +
      'After proposing, ask for confirmation one field at a time.\n' +
      `Grouping:\n${JSON.stringify(groups, null, 2)}\n` +
      `Suggested platform mix:\n${JSON.stringify(suggested_platform_mix || [], null, 2)}\n` +
      `Suggested frequency:\n${JSON.stringify(suggested_frequency || {}, null, 2)}\n` +
      `Selected recommendations:\n${JSON.stringify(selected_recommendations, null, 2)}\n` +
      `Team opinion summary:\n${JSON.stringify(teamOpinionSummary, null, 2)}`;

    const planningInputs = await getCampaignPlanningInputs(campaign.id);
    const deterministicPlanningContext = planningInputs
      ? {
          available_content: planningInputs.available_content,
          content_capacity: planningInputs.weekly_capacity,
          exclusive_campaigns: planningInputs.exclusive_campaigns,
          platforms: planningInputs.selected_platforms,
          platform_content_requests: planningInputs.platform_content_requests,
        }
      : {};
    const existingCollectedPlanningContext: Record<string, unknown> | undefined = undefined;
    const finalCollectedPlanningContext = {
      ...(existingCollectedPlanningContext ?? {}),
      ...deterministicPlanningContext,
    };

    console.log('[PLAN INPUT SOURCE]', JSON.stringify(finalCollectedPlanningContext, null, 2));

    const planResult = await runCampaignAiPlan({
      campaignId: campaign.id,
      mode: 'generate_plan',
      message,
      collectedPlanningContext: finalCollectedPlanningContext,
    });

    const { error: linkError } = await supabase
      .from('recommendation_snapshots')
      .update({ campaign_id: campaign.id })
      .eq('company_id', company_id)
      .in('snapshot_hash', snapshotHashes);
    if (linkError) {
      console.warn('Failed to link recommendations to campaign', linkError.message);
    }

    try {
      const actorUserId = (req as any)?.rbac?.userId ?? null;
      await supabase.from('audit_logs').insert({
        action: 'RECOMMENDATIONS_GROUPED_TO_CAMPAIGN',
        actor_user_id: actorUserId,
        company_id: company_id,
        metadata: {
          campaign_id: campaign.id,
          snapshot_hashes: snapshotHashes,
          groups,
        },
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('AUDIT_LOG_FAILED', error);
    }

    return res.status(200).json({
      campaign_id: campaign.id,
      snapshot_hash: planResult.snapshot_hash,
      omnivyre_decision: planResult.omnivyre_decision,
    });
  } catch (error: any) {
    console.error('Group campaign creation failed', error);
    return res.status(500).json({ error: 'Failed to create grouped campaign' });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.SUPER_ADMIN]);
