import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { fetchTrendsFromApis } from '../../../backend/services/externalApiService';
import { optimizeCampaignWeek } from '../../../backend/services/campaignOptimizationService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { validateCampaignHealth } from '../../../backend/services/campaignHealthService';
import { getLatestCampaignVersion, saveCampaignHealthReport } from '../../../backend/db/campaignVersionStore';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { getLatestLearningInsights, getLatestAnalyticsReport } from '../../../backend/db/performanceStore';
import { sendLearningSnapshot } from '../../../backend/services/omnivyraFeedbackService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, reason } = req.body || {};
    if (!campaignId || !weekNumber) {
      return res.status(400).json({ error: 'campaignId and weekNumber are required' });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, company_id, objective')
      .eq('id', campaignId)
      .single();

    if (!campaign?.company_id) {
      return res.status(404).json({ status: 'blocked', reason: 'campaign not found' });
    }

    const profile = await getProfile(campaign.company_id, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ status: 'blocked', reason: 'company profile not found' });
    }

    const geoHint = profile.geography_list?.[0] ?? profile.geography ?? undefined;
    const trendSignals = await fetchTrendsFromApis(geoHint, undefined, { recordHealth: false });
    const trendData = trendSignals.map((signal) => ({
      topic: signal.topic,
      platform: signal.source,
      geography: signal.geo,
    }));

    const learningInsights = await getLatestLearningInsights(campaign.company_id, campaignId);
    const analyticsReport = await getLatestAnalyticsReport(campaign.company_id, campaignId);
    const optimization = await optimizeCampaignWeek({
      companyId: campaign.company_id,
      campaignId,
      weekNumber: Number(weekNumber),
      reason,
      campaignObjective: campaign.objective ?? 'engagement',
      trendData,
      analyticsInsights: learningInsights?.insights_json ?? null,
    });

    const updatedVersion = await getLatestCampaignVersion(campaign.company_id, campaignId);
    const weeklyPlans = updatedVersion?.campaign_snapshot?.weekly_plan ?? [];
    const dailyPlans = updatedVersion?.campaign_snapshot?.daily_plan ?? [];
    const contentAssets = await listAssetsWithLatestContent({ campaignId });
    const healthReport = validateCampaignHealth({
      companyProfile: profile,
      trends: trendSignals,
      campaign: updatedVersion?.campaign_snapshot?.campaign ?? {},
      weeklyPlans,
      dailyPlans,
      contentAssets,
      analyticsReport: analyticsReport?.report_json ?? null,
      learningInsights: learningInsights?.insights_json ?? null,
    });

    await saveCampaignHealthReport({
      companyId: campaign.company_id,
      campaignId,
      status: healthReport.status,
      confidence: healthReport.confidence,
      issues: healthReport.issues,
      scores: healthReport.scores,
    });

    await sendLearningSnapshot({
      companyId: campaign.company_id,
      campaignId,
      trends_used: trendSignals.map((signal) => ({
        topic: signal.topic,
        source: signal.source,
        signal_confidence: signal.signal_confidence,
      })),
      trends_ignored: [],
      signal_confidence_summary: undefined,
      novelty_score: undefined,
      confidence_score: healthReport.confidence,
      placeholders: [],
      explanation: reason ? `Optimization reason: ${reason}` : 'Weekly optimization run',
      external_api_health_snapshot: [],
      performance_metrics: analyticsReport?.report_json ?? null,
      optimization_reason: reason,
      drift_flags: {
        status: healthReport.status,
        issues: healthReport.issues,
      },
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      updated_week: optimization.updated_week,
      change_summary: optimization.change_summary,
      confidence: optimization.confidence,
      health_report: healthReport,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to optimize week' });
  }
}
