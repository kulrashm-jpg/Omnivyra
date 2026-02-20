/**
 * POST /api/campaigns/suggest-duration
 * AI suggests viable duration (weeks) for new campaigns from opportunity.
 * Used when pre-planning: topic, content types, frequency → suggested weeks.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  suggestDurationForOpportunity,
  suggestDurationFromQuestionnaire,
} from '../../../backend/services/aiGateway';
import { getLatestCampaignVersion } from '../../../backend/db/campaignVersionStore';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      campaignId,
      companyId,
      availableContent,
      contentSuited,
      creationCapacity,
      inHouseNotes,
    } = req.body || {};

    if (!campaignId || !companyId) {
      return res.status(400).json({ error: 'campaignId and companyId are required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    // DB first: if campaign already has duration (e.g. after restart), return it — never contradict
    const { data: campRow } = await supabase
      .from('campaigns')
      .select('duration_weeks')
      .eq('id', campaignId)
      .maybeSingle();
    const dbWeeks = typeof campRow?.duration_weeks === 'number' && campRow.duration_weeks >= 1 && campRow.duration_weeks <= 52
      ? campRow.duration_weeks
      : null;
    if (dbWeeks != null) {
      return res.status(200).json({
        suggested_weeks: dbWeeks,
        rationale: 'Campaign duration is already set. Use the existing value.',
      });
    }

    const version = await getLatestCampaignVersion(companyId, campaignId);
    const snapshot = version?.campaign_snapshot;
    const sourceOpportunityId =
      snapshot?.source_opportunity_id ?? snapshot?.metadata?.source_opportunity_id;

    if (!sourceOpportunityId) {
      return res.status(400).json({
        error: 'Campaign is not from an opportunity. AI duration suggestion applies only to opportunity-origin campaigns.',
      });
    }

    const campaign = snapshot?.campaign ?? snapshot;
    const campaignName = campaign?.name ?? snapshot?.name ?? 'Campaign';
    const campaignDescription = campaign?.description ?? snapshot?.description ?? null;
    const contextPayload = snapshot?.context_payload ?? snapshot?.metadata?.context_payload ?? null;
    const targetRegions = snapshot?.target_regions ?? null;

    const hasQuestionnaire =
      availableContent != null ||
      contentSuited != null ||
      creationCapacity != null ||
      (typeof inHouseNotes === 'string' && inHouseNotes.trim().length > 0);

    const result = hasQuestionnaire
      ? await suggestDurationFromQuestionnaire({
          companyId,
          campaignName,
          campaignDescription,
          contextPayload,
          targetRegions,
          availableContent:
            typeof availableContent === 'object' && availableContent !== null
              ? availableContent
              : undefined,
          contentSuited: typeof contentSuited === 'boolean' ? contentSuited : undefined,
          creationCapacity:
            typeof creationCapacity === 'object' && creationCapacity !== null
              ? creationCapacity
              : undefined,
          inHouseNotes: typeof inHouseNotes === 'string' ? inHouseNotes : null,
        })
      : await suggestDurationForOpportunity({
          companyId,
          campaignName,
          campaignDescription,
          contextPayload,
          targetRegions,
        });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[suggest-duration]', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error',
    });
  }
}

export default handler;
