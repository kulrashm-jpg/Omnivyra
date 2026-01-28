import { generateCampaignForecast } from './campaignForecastService';
import { calculateROI } from './roiService';
import { detectTrendDrift } from './trendDriftService';

export async function buildExecutiveReport(input: {
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
}): Promise<{
  summary: string;
  chartsData: any;
  risks: string[];
  wins: string[];
  nextActions: string[];
  forecast: any;
  roi: any;
  trendDrift: any;
  noveltyScore: number;
  healthScore: number;
  platformEffectiveness: any;
  contentEffectiveness: any;
}> {
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

  const noveltyScore = input.campaignMemory?.pastThemes?.length
    ? Math.max(10, 100 - input.campaignMemory.pastThemes.length * 5)
    : 100;
  const healthScore = Math.round((forecast.confidence + Math.max(0, roi.roiPercent)) / 2);

  const risks = [...forecast.riskFactors];
  if (roi.roiPercent < 0) risks.push('Negative ROI forecast');
  const wins = [...forecast.opportunities];
  if (roi.roiPercent > 0) wins.push('Positive ROI forecast');

  const nextActions: string[] = [];
  if (trendDrift.driftDetected) nextActions.push('Review trend drift and adjust weekly plan');
  if (roi.recommendations.length > 0) nextActions.push(...roi.recommendations);
  if (input.learningInsights?.recommendations?.length) {
    nextActions.push('Apply learning insights to next optimization cycle');
  }

  const summary = `Forecast reach ${forecast.expectedReach} with ROI ${roi.roiPercent}%.`;

  return {
    summary,
    chartsData: {
      forecastByPlatform: forecast.forecastByPlatform,
      roi: roi.roiPercent,
      engagement: input.analyticsHistory?.engagementRate ?? 0,
    },
    risks,
    wins,
    nextActions,
    forecast,
    roi,
    trendDrift,
    noveltyScore,
    healthScore,
    platformEffectiveness: input.analyticsHistory?.bestPlatforms ?? [],
    contentEffectiveness: input.analyticsHistory?.bestContentTypes ?? [],
  };
}
