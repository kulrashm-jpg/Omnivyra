/**
 * POST /api/campaigns/proposals/convert
 * Convert proposal → campaign + twelve_week_plan, update proposal status = accepted
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { fromStructuredPlan } from '../../../../backend/services/campaignBlueprintAdapter';
import { saveCampaignBlueprintFromLegacy } from '../../../../backend/db/campaignPlanStore';
import { syncCampaignVersionStage } from '../../../../backend/db/campaignVersionStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { proposalId } = req.body || {};
  if (!proposalId || typeof proposalId !== 'string') {
    return res.status(400).json({ error: 'proposalId required' });
  }

  const { data: proposal, error: fetchError } = await supabase
    .from('campaign_proposals')
    .select('*')
    .eq('id', proposalId.trim())
    .maybeSingle();

  if (fetchError || !proposal) {
    return res.status(404).json({ error: 'Proposal not found' });
  }
  if (proposal.status === 'accepted') {
    return res.status(409).json({ error: 'Proposal already converted' });
  }
  if (proposal.status === 'rejected') {
    return res.status(400).json({ error: 'Proposal was rejected' });
  }

  const organizationId = proposal.organization_id as string;
  const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
  if (!access) return;

  const pd = (proposal.proposal_data as Record<string, unknown>) || {};
  const weeksRaw = (pd.weekly_structure as Array<{ week?: number; phase?: string; focus?: string }>) || [];
  const platforms = (pd.recommended_platforms as string[]) || ['linkedin', 'twitter'];
  const topicsToCover = (pd.topics_to_cover as string[]) || [];
  const postsPerPlatform = Math.max(1, Math.ceil(2 / platforms.length));
  const platformAllocation = Object.fromEntries(
    platforms.map((p) => [p, postsPerPlatform])
  );

  const weeks = weeksRaw.map((w, idx) => {
    const phase = w.phase ?? `Week ${idx + 1}`;
    const focus = w.focus ?? phase;
    const topicSlice = topicsToCover.slice(
      Math.floor((idx * topicsToCover.length) / weeksRaw.length),
      Math.floor(((idx + 1) * topicsToCover.length) / weeksRaw.length)
    );
    return {
      week: idx + 1,
      week_number: idx + 1,
      phase_label: phase,
      primary_objective: focus,
      topics_to_cover: topicSlice.length ? topicSlice : (pd.topics_to_cover as string[] ?? []).slice(0, 2),
      platform_allocation: platformAllocation,
      content_type_mix: ['post'],
      cta_type: idx === weeksRaw.length - 1 ? 'Conversion' : 'None',
      weekly_kpi_focus: 'Reach growth',
    };
  });

  const campaignId = crypto.randomUUID();
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .insert({
      id: campaignId,
      name: (pd.campaign_title as string) ?? (proposal.proposal_title as string) ?? 'Campaign from Proposal',
      description: (pd.campaign_objective as string) ?? '',
      status: 'planning',
      current_stage: 'planning',
      timeframe: 'quarter',
      start_date: startDate.toISOString().split('T')[0],
      duration_weeks: weeks.length || 6,
      ai_generated_summary: (pd.campaign_objective as string) ?? '',
      user_id: access.userId,
      thread_id: `thread_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (campaignError || !campaign) {
    console.error('[proposals/convert] campaign insert', campaignError);
    return res.status(500).json({ error: 'Failed to create campaign' });
  }

  const blueprint = fromStructuredPlan({
    campaign_id: campaignId,
    weeks: weeks.length ? weeks : [
      { week_number: 1, phase_label: 'Awareness', primary_objective: 'Awareness', topics_to_cover: [], platform_allocation: {} },
    ],
  });

  await supabase
    .from('campaigns')
    .update({
      current_stage: 'twelve_week_plan',
      duration_weeks: blueprint.duration_weeks,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);
  void syncCampaignVersionStage(campaignId, 'twelve_week_plan', organizationId).catch(() => {});

  await saveCampaignBlueprintFromLegacy({
    campaignId,
    blueprint,
    source: 'campaign-proposal-convert',
  });

  const { error: versionError } = await supabase.from('campaign_versions').insert({
    company_id: organizationId,
    campaign_id: campaignId,
    campaign_snapshot: {
      campaign,
      source_opportunity_id: proposal.opportunity_id,
      source_proposal_id: proposalId,
    },
    status: 'planning',
    version: 1,
    created_at: new Date().toISOString(),
  });
  if (versionError) {
    console.warn('[proposals/convert] campaign_versions insert', versionError);
  }

  const { error: updateError } = await supabase
    .from('campaign_proposals')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', proposalId);

  if (updateError) {
    console.warn('[proposals/convert] proposal status update', updateError);
  }

  return res.status(201).json({
    campaign_id: campaignId,
    campaign_name: (campaign as { name?: string }).name,
    proposal_id: proposalId,
  });
}
