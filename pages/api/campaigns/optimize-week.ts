import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { fetchTrendsFromApis } from '../../../backend/services/externalApiService';
import { optimizeCampaignWeek } from '../../../backend/services/campaignOptimizationService';
import {
  getResolvedCampaignPlanContext,
  PrePlanningRequiredError,
} from '../../../backend/services/campaignBlueprintService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { validateCampaignHealth } from '../../../backend/services/campaignHealthService';
import { getLatestCampaignVersion, saveCampaignHealthReport } from '../../../backend/db/campaignVersionStore';
import { getLatestApprovedCampaignVersion } from '../../../backend/db/campaignApprovedVersionStore';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { getLatestLearningInsights, getLatestAnalyticsReport } from '../../../backend/db/performanceStore';
import { sendLearningSnapshot } from '../../../backend/services/omnivyraFeedbackService';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { campaignId, weekNumber, reason, companyId } = req.body || {};
    if (!campaignId || !weekNumber || !companyId) {
      return res.status(400).json({ error: 'campaignId, weekNumber, and companyId are required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId,
      campaignId,
      requireCampaignId: true,
    });
    if (!access) return;

    const { data: ownershipRows, error: ownershipError } = await supabase
      .from('campaign_versions')
      .select('campaign_id')
      .eq('company_id', companyId)
      .eq('campaign_id', campaignId);

    if (ownershipError) {
      return res.status(500).json({ error: 'Failed to verify campaign ownership' });
    }

    if (!ownershipRows || ownershipRows.length === 0) {
      return res.status(403).json({
        error: 'CAMPAIGN_NOT_IN_COMPANY',
        code: 'CAMPAIGN_NOT_IN_COMPANY',
      });
    }

    const profile = await getProfile(companyId, { autoRefine: false });
    if (!profile) {
      return res.status(404).json({ status: 'blocked', reason: 'company profile not found' });
    }

    const geoHint = profile.geography_list?.[0] ?? profile.geography ?? undefined;
    const trendSignals = await fetchTrendsFromApis(companyId, geoHint, undefined, {
      recordHealth: false,
      userId: access.userId,
    });
    const trendData = trendSignals.map((signal) => ({
      topic: signal.topic,
      platform: signal.source,
      geography: signal.geo,
    }));

    const learningInsights = await getLatestLearningInsights(companyId, campaignId);
    const analyticsReport = await getLatestAnalyticsReport(companyId, campaignId);
    const resolved = await getResolvedCampaignPlanContext(companyId, campaignId);
    if (!resolved) {
      return res.status(404).json({ status: 'blocked', reason: 'campaign not found' });
    }
    const latestVersion = resolved.campaign_version;
    if (!latestVersion?.campaign_snapshot) {
      return res.status(404).json({ status: 'blocked', reason: 'campaign not found' });
    }
    console.debug('Approved strategy used for optimization', {
      campaignId,
      companyId,
      versionId: latestVersion?.id,
      status: latestVersion?.status,
    });
    const campaignObjective =
      latestVersion.campaign_snapshot?.campaign?.objective ??
      latestVersion.campaign_snapshot?.objective ??
      resolved.campaign?.objective ??
      'engagement';
    const optimization = await optimizeCampaignWeek({
      companyId,
      campaignId,
      weekNumber: Number(weekNumber),
      reason,
      campaignObjective,
      trendData,
      analyticsInsights: learningInsights?.insights_json ?? null,
      resolvedWeeklyPlan: resolved.weekly_plan,
    });

    const updatedVersion = await getLatestCampaignVersion(companyId, campaignId);
    const weeklyPlans = updatedVersion?.campaign_snapshot?.weekly_plan ?? [];
    const dailyPlans = updatedVersion?.campaign_snapshot?.daily_plan ?? [];
    const contentAssets = await listAssetsWithLatestContent({ campaignId });
    const healthReport = validateCampaignHealth({
      companyProfile: profile,
      trends: trendSignals,
      campaign: updatedVersion?.campaign_snapshot?.campaign ?? {},
      weeklyPlans,
      dailyPlans,
      expectedDurationWeeks: resolved.duration_weeks,
      contentAssets,
      analyticsReport: analyticsReport?.report_json ?? null,
      learningInsights: learningInsights?.insights_json ?? null,
    });

    await saveCampaignHealthReport({
      companyId,
      campaignId,
      status: healthReport.status,
      confidence: healthReport.confidence,
      issues: healthReport.issues,
      scores: healthReport.scores,
    });

    await sendLearningSnapshot({
      companyId,
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
    if (error instanceof PrePlanningRequiredError || error?.code === 'PRE_PLANNING_REQUIRED') {
      return res.status(412).json({ code: 'PRE_PLANNING_REQUIRED', message: error?.message });
    }
    return res.status(500).json({ error: error?.message || 'Failed to optimize week' });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN, Role.ADMIN, Role.CONTENT_PLANNER]);
