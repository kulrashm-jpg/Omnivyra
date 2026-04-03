import { generateCampaignForecast } from './campaignForecastService';
import { calculateROI } from './roiService';
import { detectTrendDrift } from './trendDriftService';
import { getDecisionReportView } from './decisionReportService';
import {
  archiveDecisionScope,
  replaceDecisionObjectsForSource,
  type PersistedDecisionObject,
} from './decisionObjectService';
import { assertBackgroundJobContext } from './intelligenceExecutionContext';
import { assertDecisionArray, assertDecisionReportView } from './decisionRuntimeGuardService';

interface BusinessIntelligenceInput {
  companyId: string;
  campaignId: string;
  companyProfile: any;
  campaignPlan: any;
  platformExecutionPlan?: any;
  contentAssets?: any[];
  trendsUsed?: string[];
  campaignMemory?: any;
  analyticsHistory?: any;
  performanceMetrics?: any;
  costInputs?: {
    adSpend?: number;
    productionCost?: number;
    manpowerCost?: number;
  };
  learningInsights?: any;
}

export async function generateBusinessDecisionObjects(
  input: BusinessIntelligenceInput
): Promise<PersistedDecisionObject[]> {
  assertBackgroundJobContext('businessIntelligenceService');
  const forecast = await generateCampaignForecast({
    companyId: input.companyId,
    campaignId: input.campaignId,
    campaignPlan: input.campaignPlan,
    platformExecutionPlan: input.platformExecutionPlan,
    contentAssets: input.contentAssets,
    trendsUsed: input.trendsUsed,
    campaignMemory: input.campaignMemory,
    analyticsHistory: input.analyticsHistory,
  });

  const roi = calculateROI({
    campaignId: input.campaignId,
    costInputs: input.costInputs ?? {},
    performanceMetrics: input.performanceMetrics,
  });

  const trendDrift = detectTrendDrift({
    companyProfile: input.companyProfile,
    previousTrends: input.campaignMemory?.pastTrendsUsed || [],
    newTrends: input.trendsUsed || [],
    analytics: input.analyticsHistory,
  });

  const decisions = [];

  if (roi.roiPercent < 0) {
    decisions.push({
      company_id: input.companyId,
      report_tier: 'deep' as const,
      source_service: 'businessIntelligenceService',
      entity_type: 'campaign' as const,
      entity_id: input.campaignId,
      issue_type: 'negative_roi_risk',
      title: 'Forecasted ROI is negative',
      description: `Current economics project ROI at ${roi.roiPercent}%, which means spend is unlikely to return value.`,
      evidence: {
        roi_percent: roi.roiPercent,
        estimated_revenue: roi.totalValue ?? null,
        total_cost: roi.totalCost ?? null,
        recommendations: roi.recommendations ?? [],
      },
      impact_traffic: 30,
      impact_conversion: 55,
      impact_revenue: Math.min(100, 70 + Math.round(Math.abs(roi.roiPercent) / 2)),
      priority_score: Math.min(100, 80 + Math.round(Math.abs(roi.roiPercent) / 3)),
      effort_score: 35,
      confidence_score: 0.93,
      recommendation: 'Reallocate budget or reduce production cost before scaling this campaign.',
      action_type: 'reallocate_budget',
      action_payload: {
        campaign_id: input.campaignId,
        roi_percent: roi.roiPercent,
        total_cost: roi.totalCost ?? null,
      },
      status: 'open' as const,
    });
  }

  if (trendDrift.driftDetected) {
    decisions.push({
      company_id: input.companyId,
      report_tier: 'deep' as const,
      source_service: 'businessIntelligenceService',
      entity_type: 'campaign' as const,
      entity_id: input.campaignId,
      issue_type: 'market_shift',
      title: 'Campaign is drifting away from current market trends',
      description: 'The current campaign direction no longer matches the trend mix the business should be using.',
      evidence: {
        previous_trends: input.campaignMemory?.pastTrendsUsed || [],
        new_trends: input.trendsUsed || [],
        trend_drift: trendDrift,
      },
      impact_traffic: 48,
      impact_conversion: 52,
      impact_revenue: 61,
      priority_score: 66,
      effort_score: 40,
      confidence_score: 0.84,
      recommendation: 'Refresh the strategy roadmap and align the next execution cycle to the current trend mix.',
      action_type: 'adjust_strategy',
      action_payload: {
        campaign_id: input.campaignId,
        previous_trends: input.campaignMemory?.pastTrendsUsed || [],
        new_trends: input.trendsUsed || [],
      },
      status: 'open' as const,
    });
  }

  if ((forecast.confidence ?? 0) < 60) {
    decisions.push({
      company_id: input.companyId,
      report_tier: 'deep' as const,
      source_service: 'businessIntelligenceService',
      entity_type: 'campaign' as const,
      entity_id: input.campaignId,
      issue_type: 'forecast_confidence_gap',
      title: 'Forecast confidence is too low for reliable budget decisions',
      description: `Forecast confidence is ${forecast.confidence}, so the campaign lacks enough signal quality for safe scaling decisions.`,
      evidence: {
        forecast_confidence: forecast.confidence,
        risk_factors: forecast.riskFactors ?? [],
        expected_reach: forecast.expectedReach ?? null,
      },
      impact_traffic: 22,
      impact_conversion: 40,
      impact_revenue: 58,
      priority_score: 60,
      effort_score: 30,
      confidence_score: 0.9,
      recommendation: 'Delay major budget decisions until tracking quality and input coverage improve.',
      action_type: 'improve_tracking',
      action_payload: {
        campaign_id: input.campaignId,
        forecast_confidence: forecast.confidence,
      },
      status: 'open' as const,
    });
  }

  if (Array.isArray(input.learningInsights?.recommendations) && input.learningInsights.recommendations.length > 0) {
    decisions.push({
      company_id: input.companyId,
      report_tier: 'deep' as const,
      source_service: 'businessIntelligenceService',
      entity_type: 'campaign' as const,
      entity_id: input.campaignId,
      issue_type: 'learning_loop_not_applied',
      title: 'Optimization learnings have not been activated',
      description: 'The campaign has recorded learning signals, but they are not yet mapped into the next execution cycle.',
      evidence: {
        learning_recommendations: input.learningInsights.recommendations,
      },
      impact_traffic: 20,
      impact_conversion: 46,
      impact_revenue: 54,
      priority_score: 56,
      effort_score: 25,
      confidence_score: 0.81,
      recommendation: 'Convert current learning insights into the next campaign optimization cycle.',
      action_type: 'apply_learning',
      action_payload: {
        campaign_id: input.campaignId,
        learning_recommendation_count: input.learningInsights.recommendations.length,
      },
      status: 'open' as const,
    });
  }

  if (decisions.length === 0) {
    await archiveDecisionScope({
      company_id: input.companyId,
      report_tier: 'deep',
      source_service: 'businessIntelligenceService',
      entity_type: 'campaign',
      entity_id: input.campaignId,
      changed_by: 'system',
    });
    return [];
  }

  const persisted = await replaceDecisionObjectsForSource(decisions);
  return assertDecisionArray('businessIntelligenceService.generateBusinessDecisionObjects', persisted);
}

export async function buildExecutiveReport(input: BusinessIntelligenceInput): Promise<{
  summary: string;
  report_view: Awaited<ReturnType<typeof getDecisionReportView>>;
  risks: string[];
  nextActions: string[];
}> {
  const reportView = await getDecisionReportView({
    companyId: input.companyId,
    reportTier: 'deep',
    entityType: 'campaign',
    entityId: input.campaignId,
    sourceService: 'businessIntelligenceService',
  });
  const safeReportView = assertDecisionReportView('businessIntelligenceService.buildExecutiveReport', reportView);

  return {
    summary: safeReportView.decisions[0]?.description ?? 'Decision intelligence report view loaded.',
    report_view: safeReportView,
    risks: safeReportView.decisions.map((item) => item.title),
    nextActions: safeReportView.decisions.map((item) => item.recommendation),
  };
}
