import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getResolvedCampaignPlanContext } from '../../../backend/services/campaignBlueprintService';
import { validateCampaignHealth } from '../../../backend/services/campaignHealthService';
import {
  getTrendSnapshots,
  saveCampaignHealthReport,
} from '../../../backend/db/campaignVersionStore';
import { supabase } from '../../../backend/db/supabaseClient';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { getLatestAnalyticsReport, getLatestLearningInsights } from '../../../backend/db/performanceStore';
import { ALL_ROLES } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let { companyId, campaignId } = req.body || {};
    if (!companyId && campaignId) {
      const { data, error } = await supabase
        .from('campaign_versions')
        .select('company_id')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) {
        return res.status(500).json({ error: 'Failed to resolve company for campaign' });
      }
      companyId = data?.[0]?.company_id;
    }

    if (!companyId || !campaignId) {
      return res.status(404).json({ status: 'blocked', reason: 'campaign not found' });
    }

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

    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
    if (!profile) {
      return res.status(404).json({ status: 'blocked', reason: 'company profile not found' });
    }

    const resolved = await getResolvedCampaignPlanContext(companyId, campaignId);
    if (!resolved) {
      return res.status(404).json({ status: 'blocked', reason: 'campaign not found' });
    }
    const weeklyPlans = resolved.weekly_plan;
    const dailyPlans = resolved.daily_plan;
    const trendSnapshots = await getTrendSnapshots(companyId, campaignId);
    const contentAssets = await listAssetsWithLatestContent({ campaignId });
    const analyticsReport = await getLatestAnalyticsReport(companyId, campaignId);
    const learningInsights = await getLatestLearningInsights(companyId, campaignId);

    const report = validateCampaignHealth({
      companyProfile: profile,
      trends: trendSnapshots,
      campaign: resolved.campaign,
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

export default withRBAC(handler, ALL_ROLES);
