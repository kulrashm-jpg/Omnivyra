import { saveLearningInsights } from '../db/performanceStore';

export async function generateLearningInsights(input: {
  analytics: {
    engagementRate: number;
    bestPlatforms: string[];
    bestContentTypes: string[];
    bestTimes: string[];
    trendSuccess: Array<{ trend: string; score: number }>;
  };
  companyProfile: any;
  campaign: any;
  companyId: string;
  campaignId?: string;
}): Promise<{
  insights: string[];
  recommendations: Array<{ type: 'platform' | 'timing' | 'content' | 'trend'; message: string; confidence: number }>;
  rulesToApply: {
    preferredPlatforms: string[];
    preferredTimes: string[];
    avoidTrends: string[];
    boostContentTypes: string[];
  };
}> {
  const insights: string[] = [];
  const recommendations: Array<{ type: 'platform' | 'timing' | 'content' | 'trend'; message: string; confidence: number }> = [];
  const preferredPlatforms = input.analytics.bestPlatforms || [];
  const preferredTimes = input.analytics.bestTimes || [];
  const boostContentTypes = input.analytics.bestContentTypes || [];
  const avoidTrends = input.analytics.trendSuccess.filter((trend) => trend.score < 0.2).map((trend) => trend.trend);

  if (preferredPlatforms.length > 0) {
    insights.push(`Top platforms: ${preferredPlatforms.join(', ')}`);
    recommendations.push({
      type: 'platform',
      message: `Prioritize ${preferredPlatforms[0]} based on engagement performance.`,
      confidence: 80,
    });
  }
  if (preferredTimes.length > 0) {
    insights.push(`Best times: ${preferredTimes.join(', ')}`);
    recommendations.push({
      type: 'timing',
      message: `Schedule more posts around ${preferredTimes[0]}.`,
      confidence: 75,
    });
  }
  if (boostContentTypes.length > 0) {
    insights.push(`Best content types: ${boostContentTypes.join(', ')}`);
    recommendations.push({
      type: 'content',
      message: `Increase ${boostContentTypes[0]} content based on performance.`,
      confidence: 78,
    });
  }
  if (avoidTrends.length > 0) {
    recommendations.push({
      type: 'trend',
      message: `Avoid trends with poor engagement: ${avoidTrends.slice(0, 2).join(', ')}`,
      confidence: 72,
    });
  }

  const filteredRecommendations = recommendations.filter((rec) => rec.confidence >= 70);
  const payload = {
    insights,
    recommendations: filteredRecommendations,
    rulesToApply: {
      preferredPlatforms,
      preferredTimes,
      avoidTrends,
      boostContentTypes,
    },
  };

  await saveLearningInsights({
    companyId: input.companyId,
    campaignId: input.campaignId,
    insights: payload,
  });
  console.log('LEARNING INSIGHTS GENERATED', { companyId: input.companyId, campaignId: input.campaignId });
  return payload;
}
