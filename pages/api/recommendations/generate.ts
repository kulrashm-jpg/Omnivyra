import { NextApiRequest, NextApiResponse } from 'next';
import { generateRecommendations } from '../../../backend/services/recommendationEngineService';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, objective, durationWeeks, simulate } = req.body || {};
    if (!companyId || !campaignId) {
      return res.status(400).json({ error: 'companyId and campaignId are required' });
    }
    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;
    console.log('RECOMMENDATION_REQUEST', { companyId, campaignId });

    const { data: mappingRows, error: mappingError } = await supabase
      .from('campaign_versions')
      .select('id')
      .eq('company_id', companyId)
      .eq('campaign_id', campaignId);
    if (mappingError) {
      return res.status(500).json({ error: 'Failed to verify campaign link' });
    }
    if (!mappingRows || mappingRows.length === 0) {
      return res.status(403).json({ error: 'CAMPAIGN_NOT_IN_COMPANY' });
    }

    const result = await generateRecommendations({
      companyId,
      campaignId,
      objective,
      durationWeeks,
      simulate: Boolean(simulate),
      userId: access.userId,
    });

    if (!simulate) {
      const createdAt = new Date().toISOString();
      const fallbackTopic =
        result.daily_plan?.[0]?.topic ||
        result.weekly_plan?.[0]?.theme ||
        result.explanation ||
        'Recommendation snapshot';
      const topics =
        result.trends_used.length > 0
          ? result.trends_used.map((trend) => trend.topic)
          : [fallbackTopic];
      const records = topics.map((topic) => ({
        company_id: companyId,
        campaign_id: campaignId,
        trend_topic: topic,
        confidence: result.confidence_score,
        explanation: result.explanation,
        refresh_source: 'manual',
        refreshed_at: createdAt,
        created_at: createdAt,
      }));
      const { error: snapshotError } = await supabase
        .from('recommendation_snapshots')
        .insert(records);
      if (snapshotError) {
        return res.status(500).json({ error: 'Failed to persist recommendation snapshot' });
      }
    }

    return res.status(200).json(result);
  } catch (error: any) {
    if (error?.code === 'CAMPAIGN_NOT_IN_COMPANY') {
      return res.status(403).json({ error: 'CAMPAIGN_NOT_IN_COMPANY' });
    }
    console.error('Error generating recommendations:', error);
    return res.status(500).json({ error: 'Failed to generate recommendations' });
  }
}

export default withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR]);
