/**
 * POST /api/campaigns/planner/apply-opportunity
 * Applies an opportunity from opportunity_radar to a campaign planner.
 * Input: campaignId, opportunityId
 * 1. Fetch opportunity, 2. Generate planner modification, 3. Update opportunity_radar, 4. Optionally update planner
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { generateCampaignSuggestions } from '../../../../backend/services/plannerOpportunityAdvisor';
import { getLatestDraftPlan, saveDraftBlueprint } from '../../../../backend/db/campaignPlanStore';
import type { CampaignBlueprint } from '../../../../backend/types/CampaignBlueprint';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { campaignId, opportunityId } = req.body as { campaignId?: string; opportunityId?: string };
  if (!campaignId || !opportunityId) {
    return res.status(400).json({ error: 'campaignId and opportunityId are required' });
  }

  try {
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: req.body?.companyId as string | undefined,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    const { data: opp, error: oppError } = await supabase
      .from('opportunity_radar')
      .select('id, organization_id, opportunity_type, title, description, signal_count, confidence_score, topic_keywords, related_campaign_id')
      .eq('id', opportunityId)
      .maybeSingle();

    if (oppError || !opp) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    const suggestions = generateCampaignSuggestions({
      opportunity_type: opp.opportunity_type,
      title: opp.title,
      description: opp.description,
      signal_count: opp.signal_count,
      confidence_score: opp.confidence_score,
      topic_keywords: opp.topic_keywords ?? [],
      related_campaign_id: opp.related_campaign_id,
    });

    const suggestion = suggestions[0];
    const topic = suggestion?.topic || opp.topic_keywords?.[0] || opp.title;
    const weekNumber = suggestion?.week_hint ?? 4;

    const { error: updateError } = await supabase
      .from('opportunity_radar')
      .update({
        status: 'applied_to_campaign',
        applied_campaign_id: campaignId,
        applied_at: new Date().toISOString(),
      })
      .eq('id', opportunityId);

    if (updateError) {
      return res.status(500).json({ error: `Failed to update opportunity: ${updateError.message}` });
    }

    let planUpdated = false;
    const draft = await getLatestDraftPlan(campaignId);
    if (draft?.weeks?.length) {
      const week = draft.weeks.find(
        (w: { week_number?: number; week?: number }) =>
          (w.week_number ?? w.week) === weekNumber
      );
      if (week && topic) {
        const topicsToCover = Array.isArray(week.topics_to_cover) ? [...week.topics_to_cover] : [];
        if (!topicsToCover.includes(topic)) {
          topicsToCover.push(topic);
          (week as Record<string, unknown>).topics_to_cover = topicsToCover;
          const blueprint: CampaignBlueprint = {
            campaign_id: campaignId,
            duration_weeks: draft.weeks.length,
            weeks: draft.weeks,
          };
          await saveDraftBlueprint({ campaignId, blueprint });
          planUpdated = true;
        }
      }
    }

    return res.status(200).json({
      success: true,
      modification: {
        weekNumber,
        topic,
        action: suggestion?.action ?? `Add Week ${weekNumber} content focused on ${topic}`,
      },
      planUpdated,
      opportunityId,
      campaignId,
    });
  } catch (err) {
    console.error('[planner/apply-opportunity]', err);
    return res.status(500).json({
      error: (err as Error)?.message ?? 'Failed to apply opportunity',
    });
  }
}
