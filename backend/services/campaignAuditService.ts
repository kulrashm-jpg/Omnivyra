import { supabase } from '../db/supabaseClient';
import {
  getLatestCampaignVersion,
  getOptimizationHistory,
  getTrendSnapshots,
  getWeekVersions,
} from '../db/campaignVersionStore';
import { getLatestPlatformExecutionPlan } from '../db/platformExecutionStore';
import { listAssetsWithLatestContent } from '../db/contentAssetStore';
import { getLatestAnalyticsReport, getLatestLearningInsights } from '../db/performanceStore';
import { getCampaignMemory } from './campaignMemoryService';
import { getEnabledApis, getExternalApiRuntimeSnapshot } from './externalApiService';
import { getOmniVyraHealthReport } from './omnivyraClientV1';
import { getLastFallbackReason, getLastMeta } from './omnivyraHealthService';
import { getLearningStatus } from './omnivyraFeedbackService';
import { detectContentOverlap } from './contentOverlapService';
import { getLatestForecast, getLatestRoi, getLatestBusinessReport } from '../db/forecastStore';
import { getComplianceReport, getPlatformVariant, getPromotionMetadata } from '../db/platformPromotionStore';
import {
  buildTrendAssessments,
  getTrendAlerts,
} from './trends/trendAlignmentService';
import {
  CompanyProfile,
  getProfile,
  validateCompanyProfile,
} from './companyProfileService';
import { validateCampaignHealth } from './campaignHealthService';

type AuditStatus = 'healthy' | 'warning' | 'blocked';

const summarizeCompanyProfile = (profile: CompanyProfile) => ({
  industry: profile.industry_list ?? profile.industry ?? null,
  content_themes: profile.content_themes_list ?? profile.content_themes ?? null,
  target_audience: profile.target_audience_list ?? profile.target_audience ?? null,
  geography: profile.geography_list ?? profile.geography ?? null,
  goals: profile.goals_list ?? profile.goals ?? null,
  brand_voice: profile.brand_voice_list ?? profile.brand_voice ?? null,
  social_profiles: profile.social_profiles ?? [],
});

const deriveCampaignSnapshot = (snapshot: any) => snapshot?.campaign_snapshot ?? {};

const extractWeeklyPlan = (snapshot: any) => snapshot?.campaign_snapshot?.weekly_plan ?? [];

const extractDailyPlan = (snapshot: any) => snapshot?.campaign_snapshot?.daily_plan ?? [];

const extractScheduleHints = (snapshot: any) => snapshot?.campaign_snapshot?.schedule_hints ?? [];

const buildPlaceholderSummary = (dailyPlan: any[]) =>
  dailyPlan
    .filter((item) => item?.source === 'placeholder')
    .map((item) => ({
      date: item.date,
      platform: item.platform,
      content_type: item.content_type,
      reason: item.instruction || 'Content capability missing for content type',
    }));

const computeConfidenceScore = (input: {
  missingFields: string[];
  placeholders: number;
  lowConfidenceWeeks: number;
}): number => {
  const base = 100;
  const penalty =
    input.missingFields.length * 20 +
    input.placeholders * 3 +
    input.lowConfidenceWeeks * 5;
  return Math.max(0, Math.min(100, Math.round(base - penalty)));
};

const computeStatus = (input: {
  missingFields: string[];
  placeholders: number;
  lowConfidenceWeeks: number;
}): AuditStatus => {
  if (input.missingFields.length > 0) return 'blocked';
  if (input.placeholders > 0 || input.lowConfidenceWeeks > 0) return 'warning';
  return 'healthy';
};

export async function generateCampaignAuditReport(
  companyId?: string,
  campaignId?: string
): Promise<any> {
  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId && campaignId) {
    const { data } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', campaignId)
      .single();
    resolvedCompanyId = data?.company_id;
  }

  if (!resolvedCompanyId) {
    return { status: 'blocked', reason: 'campaign not found' };
  }

  const profile = await getProfile(resolvedCompanyId, { autoRefine: false });
  const gate = validateCompanyProfile(profile);
  if (gate.status === 'blocked') {
    return { status: 'blocked', missing_fields: gate.missing_fields };
  }

  if (!profile) {
    return { status: 'blocked', reason: 'company profile not found' };
  }

  const campaignVersion = await getLatestCampaignVersion(resolvedCompanyId, campaignId);
  if (!campaignVersion) {
    return { status: 'blocked', reason: 'campaign not found' };
  }

  const campaignSnapshot = deriveCampaignSnapshot(campaignVersion);
  const omnivyraSnapshot = campaignSnapshot?.omnivyra ?? campaignSnapshot?.campaign?.omnivyra ?? null;
  const weeklyPlan = extractWeeklyPlan(campaignVersion);
  const dailyPlan = extractDailyPlan(campaignVersion);
  const scheduleHints = extractScheduleHints(campaignVersion);
  const optimizationHistory = await getOptimizationHistory(resolvedCompanyId, campaignId);
  const trendSnapshots = await getTrendSnapshots(resolvedCompanyId, campaignId);
  const weekVersions = await getWeekVersions(resolvedCompanyId, campaignId);
  const platformExecution = await getLatestPlatformExecutionPlan({
    companyId: resolvedCompanyId,
    campaignId,
    weekNumber: weeklyPlan?.[0]?.week_number ?? 1,
  });
  const contentAssets = campaignId
    ? await listAssetsWithLatestContent({ campaignId })
    : [];
  const analyticsReport = await getLatestAnalyticsReport(resolvedCompanyId, campaignId);
  const learningInsights = await getLatestLearningInsights(resolvedCompanyId, campaignId);
  const forecast = campaignId ? await getLatestForecast(campaignId) : null;
  const roi = campaignId ? await getLatestRoi(campaignId) : null;
  const businessReport = campaignId ? await getLatestBusinessReport(campaignId) : null;
  const memory = await getCampaignMemory({ companyId: resolvedCompanyId, campaignId });
  const overlap = await detectContentOverlap({
    companyId: resolvedCompanyId,
    newProposedContent: [
      ...weeklyPlan.map((week: any) => week.theme).filter(Boolean),
      ...dailyPlan.map((day: any) => day.topic).filter(Boolean),
    ],
    campaignMemory: memory,
  });

  const promotionMetadata: any[] = [];
  const platformVariants: any[] = [];
  const complianceReports: any[] = [];
  for (const asset of contentAssets) {
    const platform = asset.platform;
    if (!platform) continue;
    const metadata = await getPromotionMetadata(asset.asset_id, platform);
    const variant = await getPlatformVariant(asset.asset_id, platform);
    const compliance = await getComplianceReport(asset.asset_id, platform);
    if (metadata) promotionMetadata.push(metadata);
    if (variant) platformVariants.push(variant);
    if (compliance) complianceReports.push(compliance);
  }

  console.log('COMPANY PROFILE USED', summarizeCompanyProfile(profile));

  const trendAssessments = await buildTrendAssessments({
    profile,
    weekly_plan: weeklyPlan,
  });
  const trendAlerts = getTrendAlerts(trendAssessments);

  const usedTrends = trendAssessments
    .filter((assessment) => assessment.status !== 'ignore')
    .map((assessment) => ({
      topic: assessment.trend.topic,
      platform: assessment.trend.platform,
      reason:
        assessment.status === 'emerging_opportunity'
          ? 'Novel aligned opportunity'
          : 'Aligned with existing themes',
      relevance_score: assessment.relevance_score,
    }));

  const ignoredTrends = trendAssessments
    .filter((assessment) => assessment.status === 'ignore')
    .map((assessment) => ({
      topic: assessment.trend.topic,
      reason: 'Low relevance to company profile themes',
    }));

  console.log('TRENDS USED', usedTrends);
  console.log('TRENDS IGNORED', ignoredTrends);
  console.log('WEEKLY PLAN BUILT', weeklyPlan);
  console.log('DAILY PLAN BUILT', dailyPlan);

  const placeholders = buildPlaceholderSummary(dailyPlan);
  console.log('PLACEHOLDERS CREATED', placeholders);
  console.log('CONTENT GENERATED', { assets: contentAssets.length });
  if (promotionMetadata.length > 0) {
    console.log('PROMOTION METADATA GENERATED', { count: promotionMetadata.length });
  }
  if (platformVariants.length > 0) {
    console.log('PLATFORM VARIANTS CREATED', { count: platformVariants.length });
  }
  if (complianceReports.length > 0) {
    console.log('COMPLIANCE REPORT', { count: complianceReports.length });
  }
  console.log('ANALYTICS COMPUTED', { report: analyticsReport?.report_json ? 'available' : 'missing' });
  console.log('LEARNING INSIGHTS GENERATED', {
    insights: learningInsights?.insights_json ? 'available' : 'missing',
  });
  if (forecast?.forecast_json) {
    console.log('FORECAST GENERATED', { campaignId });
  }
  if (roi?.roi_json) {
    console.log('ROI CALCULATED', { campaignId });
  }
  if (businessReport?.report_json) {
    console.log('BUSINESS REPORT CREATED', { campaignId });
  }
  console.log('CAMPAIGN MEMORY CONSULTED', { companyId: resolvedCompanyId });
  if (overlap.overlapDetected) {
    console.log('CONTENT OVERLAP DETECTED', overlap);
  }
  if (omnivyraSnapshot) {
    console.log('OMNIVYRA SNAPSHOT', omnivyraSnapshot);
  }

  const lowConfidenceWeeks = weeklyPlan
    .filter((week: any) => !week.ai_optimized && (week.trend_influence || []).length === 0)
    .map((week: any) => week.week_number);

  const gaps = {
    missing_profile_fields: gate.missing_fields,
    unsupported_content_types: placeholders.map((entry) => ({
      platform: entry.platform,
      content_type: entry.content_type,
    })),
    low_confidence_weeks: lowConfidenceWeeks,
  };

  const confidence_score = computeConfidenceScore({
    missingFields: gate.missing_fields,
    placeholders: placeholders.length,
    lowConfidenceWeeks: lowConfidenceWeeks.length,
  });
  const confidence_label =
    confidence_score >= 75 ? 'High' : confidence_score >= 40 ? 'Medium' : 'Low';
  const novelty_flag = overlap.similarityScore > 0.6;
  const omnivyra_explanation_used = Boolean(omnivyraSnapshot?.explanation);
  const ui_explainability_snapshot = {
    explanation: omnivyraSnapshot?.explanation ?? null,
    confidence: omnivyraSnapshot?.confidence ?? null,
    placeholders: omnivyraSnapshot?.placeholders ?? [],
    trends_used: usedTrends.slice(0, 10),
    trends_ignored: ignoredTrends.slice(0, 10),
  };
  const enabledApis = await getEnabledApis();
  const externalApiSnapshot = await getExternalApiRuntimeSnapshot(
    enabledApis.map((api) => api.id)
  );
  const learningStatus = getLearningStatus(campaignId ?? null);
  const omnivyraHealth = getOmniVyraHealthReport();
  const omnivyraMeta = getLastMeta();
  const status = computeStatus({
    missingFields: gate.missing_fields,
    placeholders: placeholders.length,
    lowConfidenceWeeks: lowConfidenceWeeks.length,
  });

  const healthReport = validateCampaignHealth({
    companyProfile: profile,
    trends: trendAssessments,
    campaign: campaignSnapshot?.campaign ?? campaignSnapshot,
    weeklyPlans: weeklyPlan,
    dailyPlans: dailyPlan,
    platformExecutionPlan: platformExecution?.plan_json ?? null,
    contentAssets,
    analyticsReport: analyticsReport?.report_json ?? null,
    learningInsights: learningInsights?.insights_json ?? null,
    memoryOverlap: overlap,
    forecast: forecast?.forecast_json ?? null,
    roi: roi?.roi_json ?? null,
    businessReport: businessReport?.report_json ?? null,
    complianceReports,
    promotionMetadataCount: promotionMetadata.length,
    omnivyraCoverageScore: 0,
  });

  return {
    company_profile_used: summarizeCompanyProfile(profile),
    trends: {
      used: usedTrends,
      ignored: ignoredTrends,
      emerging_opportunities: trendAlerts.emerging_trends.map((trend) => ({
        topic: trend.topic,
        suggested_action: 'Consider weaving into weekly theme',
      })),
    },
    campaign_strategy: {
      objective: campaignSnapshot?.campaign?.objective ?? campaignSnapshot?.objective,
      duration: campaignSnapshot?.campaign?.duration ?? campaignSnapshot?.duration,
      selected_platforms:
        campaignSnapshot?.campaign?.recommended_platforms ?? campaignSnapshot?.recommended_platforms,
      platform_frequency:
        campaignSnapshot?.campaign?.platform_frequency ?? campaignSnapshot?.platform_frequency,
      campaign_types:
        campaignSnapshot?.campaign?.campaign_types ?? campaignSnapshot?.campaign_types,
    },
    weekly_plan_summary: weeklyPlan.map((week: any) => ({
      week_number: week.week_number,
      theme: week.theme,
      trend_influence: week.trend_influence,
      platforms: week.platforms,
      content_types: week.content_types,
      frequency: week.frequency_per_platform,
      ai_optimized: week.ai_optimized,
      version: week.version,
    })),
    daily_plan_summary: dailyPlan.map((day: any) => ({
      date: day.date,
      platform: day.platform,
      content_type: day.content_type,
      topic: day.topic,
      scheduled_time: day.scheduled_time,
      source: day.source,
      trend_alignment: day.trend_alignment,
    })),
    placeholders,
    gaps,
    scheduling_hints: scheduleHints.map((hint: any) => ({
      platform: hint.platform,
      best_day: hint.best_day,
      best_time: hint.best_time,
      confidence: hint.confidence,
    })),
    confidence_score,
    status,
    health_report: healthReport,
    recommendation_snapshot: campaignSnapshot?.recommendation_snapshot ?? null,
    omnivyra_snapshot: omnivyraSnapshot,
    trend_sources: usedTrends.map((trend) => trend.platform || trend.topic),
    novelty_score: overlap.similarityScore,
    confidence: confidence_score,
    confidence_label,
    novelty_flag,
    omnivyra_explanation_used,
    ui_explainability_snapshot,
    external_api_health_snapshot: externalApiSnapshot.health_snapshot,
    cache_hits: externalApiSnapshot.cache_stats,
    rate_limited_sources: externalApiSnapshot.rate_limited_sources,
    signal_confidence_summary: externalApiSnapshot.signal_confidence_summary,
    omnivyra_learning_sent: learningStatus?.status === 'sent',
    omnivyra_learning_payload_preview: learningStatus?.payload_preview ?? null,
    omnivyra_health_snapshot: omnivyraHealth,
    omnivyra_contract_valid: omnivyraMeta?.contract_valid ?? null,
    omnivyra_fallback_reason: getLastFallbackReason(),
    omnivyra_latency_ms: omnivyraMeta?.latency_ms ?? null,
    omnivyra_endpoint_used: omnivyraMeta?.endpoint ?? null,
    platform_execution_plan: platformExecution?.plan_json ?? null,
    content_assets: {
      total: contentAssets.length,
      approved: contentAssets.filter((asset) => asset.status === 'approved').length,
      reviewed: contentAssets.filter((asset) => asset.status === 'reviewed').length,
      draft: contentAssets.filter((asset) => asset.status === 'draft').length,
      regenerated: contentAssets.filter((asset) => (asset.current_version ?? 1) > 1).length,
    },
    platform_promotion: {
      promotion_metadata: promotionMetadata.length,
      platform_variants: platformVariants.length,
      compliance_reports: complianceReports.length,
    },
    campaign_memory: memory,
    overlap_report: overlap,
    forecast_snapshot: forecast?.forecast_json ?? null,
    roi_snapshot: roi?.roi_json ?? null,
    business_report: businessReport?.report_json ?? null,
    audit_sources: {
      trend_snapshots: trendSnapshots,
      week_versions: weekVersions,
      optimization_history: optimizationHistory,
      analytics_report: analyticsReport?.report_json ?? null,
      learning_insights: learningInsights?.insights_json ?? null,
    },
  };
}
