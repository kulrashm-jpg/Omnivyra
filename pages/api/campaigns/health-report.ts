import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { validateCampaignHealth } from '../../../backend/services/campaignHealthService';
import {
  getLatestCampaignVersion,
  getTrendSnapshots,
  saveCampaignHealthReport,
} from '../../../backend/db/campaignVersionStore';
import { supabase } from '../../../backend/db/supabaseClient';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { getLatestAnalyticsReport, getLatestLearningInsights } from '../../../backend/db/performanceStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let { companyId, campaignId } = req.body || {};
    if (!companyId && campaignId) {
      const { data } = await supabase
        .from('campaigns')
        .select('company_id')
        .eq('id', campaignId)
        .single();
      companyId = data?.company_id;
    }

    if (!companyId) {
      return res.status(404).json({ status: 'blocked', reason: 'campaign not found' });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ status: 'blocked', reason: 'company profile not found' });
    }

    const campaignVersion = await getLatestCampaignVersion(companyId, campaignId);
    if (!campaignVersion?.campaign_snapshot) {
      return res.status(404).json({ status: 'blocked', reason: 'campaign not found' });
    }

    const weeklyPlans = campaignVersion.campaign_snapshot.weekly_plan ?? [];
    const dailyPlans = campaignVersion.campaign_snapshot.daily_plan ?? [];
    const trendSnapshots = await getTrendSnapshots(companyId, campaignId);
    const contentAssets = await listAssetsWithLatestContent({ campaignId });
    const analyticsReport = await getLatestAnalyticsReport(companyId, campaignId);
    const learningInsights = await getLatestLearningInsights(companyId, campaignId);

    const report = validateCampaignHealth({
      companyProfile: profile,
      trends: trendSnapshots,
      campaign: campaignVersion.campaign_snapshot.campaign ?? campaignVersion.campaign_snapshot,
      weeklyPlans,
      dailyPlans,
      contentAssets,
      analyticsReport: analyticsReport?.report_json ?? null,
      learningInsights: learningInsights?.insights_json ?? null,
    });

    await saveCampaignHealthReport({
      companyId,
      campaignId,
      status: report.status,
      confidence: report.confidence,
      issues: report.issues,
      scores: report.scores,
    });

    return res.status(200).json(report);
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to generate health report' });
  }
}
