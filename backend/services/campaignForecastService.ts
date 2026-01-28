export async function generateCampaignForecast(input: {
  companyId: string;
  campaignId: string;
  campaignPlan: any;
  platformExecutionPlan?: any;
  contentAssets?: any[];
  trendsUsed?: string[];
  campaignMemory?: any;
  analyticsHistory?: any;
}): Promise<{
  expectedReach: number;
  expectedEngagement: number;
  expectedConversions: number;
  confidence: number;
  highImpactWeeks: number[];
  lowImpactWeeks: number[];
  riskFactors: string[];
  opportunities: string[];
  forecastByPlatform: Array<{
    platform: string;
    expectedReach: number;
    expectedCTR: number;
    confidence: number;
  }>;
}> {
  const weeklyPlan = input.campaignPlan?.weekly_plan ?? [];
  const totalDays = input.platformExecutionPlan?.days?.length ?? 0;
  const baseReachPerDay = 1000;
  const engagementRate = input.analyticsHistory?.engagementRate ?? 0.05;
  const expectedReach = totalDays * baseReachPerDay;
  const expectedEngagement = Math.round(expectedReach * engagementRate);
  const expectedConversions = Math.round(expectedEngagement * 0.05);

  const trendsCount = input.trendsUsed?.length ?? 0;
  const confidence = Math.min(100, Math.round(50 + engagementRate * 100 + trendsCount * 2));

  const highImpactWeeks = weeklyPlan
    .filter((week: any) => (week.trend_influence || []).length > 0)
    .map((week: any) => week.week_number);
  const lowImpactWeeks = weeklyPlan
    .filter((week: any) => (week.trend_influence || []).length === 0)
    .map((week: any) => week.week_number);

  const riskFactors: string[] = [];
  if (!input.platformExecutionPlan) riskFactors.push('No execution plan available');
  if (input.contentAssets && input.contentAssets.length === 0) {
    riskFactors.push('No content assets generated');
  }
  const opportunities: string[] = [];
  if (trendsCount > 0) opportunities.push('Trend-aligned weeks available');
  if (engagementRate > 0.1) opportunities.push('Strong engagement baseline');

  const platformCounts: Record<string, number> = {};
  (input.platformExecutionPlan?.days || []).forEach((day: any) => {
    const platform = day.platform;
    platformCounts[platform] = (platformCounts[platform] ?? 0) + 1;
  });

  const forecastByPlatform = Object.entries(platformCounts).map(([platform, count]) => ({
    platform,
    expectedReach: count * baseReachPerDay,
    expectedCTR: Number((engagementRate * 0.2).toFixed(3)),
    confidence: Math.min(100, Math.round(50 + engagementRate * 100)),
  }));

  return {
    expectedReach,
    expectedEngagement,
    expectedConversions,
    confidence,
    highImpactWeeks,
    lowImpactWeeks,
    riskFactors,
    opportunities,
    forecastByPlatform,
  };
}
