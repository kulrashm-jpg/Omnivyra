import { CompanyProfile } from './companyProfileService';

export type CampaignHealthReport = {
  status: 'healthy' | 'warning' | 'blocked';
  confidence: number;
  issues: Array<{ level: 'error' | 'warning'; field: string; message: string }>;
  scores: {
    profileCompleteness: number;
    trendCoverage: number;
    platformBalance: number;
    contentDiversity: number;
    scheduleQuality: number;
    automationReadiness: number;
    contentReadiness: number;
    approvalCoverage: number;
    assetCompleteness: number;
    performanceCoverage: number;
    learningConfidence: number;
    optimizationEffectiveness: number;
    noveltyScore: number;
    forecastConfidence: number;
    roiHealth: number;
    businessScore: number;
    platformComplianceScore: number;
    promotionCompletenessScore: number;
    omnivyraCoverageScore: number;
  };
  recommendations: string[];
};

const hasList = (value?: string[] | null) =>
  Array.isArray(value) && value.some((item) => item && item.trim().length > 0);

const hasValue = (value?: string | null) => Boolean(value && value.trim().length > 0);

const computeProfileCompleteness = (profile: CompanyProfile): number => {
  const required = [
    hasList(profile.industry_list) || hasValue(profile.industry),
    hasList(profile.target_audience_list) || hasValue(profile.target_audience),
    hasList(profile.content_themes_list) || hasValue(profile.content_themes),
    hasList(profile.goals_list) || hasValue(profile.goals),
    Array.isArray(profile.social_profiles) && profile.social_profiles.length > 0,
  ];
  const score = (required.filter(Boolean).length / required.length) * 100;
  return Math.round(score);
};

const computeTrendCoverage = (dailyPlans: any[]): number => {
  if (!dailyPlans || dailyPlans.length === 0) return 0;
  const aligned = dailyPlans.filter((plan) => plan?.trend_alignment).length;
  return Math.round((aligned / dailyPlans.length) * 100);
};

const computePlatformBalance = (dailyPlans: any[]): number => {
  if (!dailyPlans || dailyPlans.length === 0) return 0;
  const platforms = new Set(dailyPlans.map((plan) => plan?.platform).filter(Boolean));
  if (platforms.size <= 1) return 40;
  if (platforms.size === 2) return 70;
  return 100;
};

const computeContentDiversity = (dailyPlans: any[]): number => {
  if (!dailyPlans || dailyPlans.length === 0) return 0;
  const types = new Set(dailyPlans.map((plan) => plan?.content_type).filter(Boolean));
  if (types.size <= 1) return 40;
  if (types.size === 2) return 70;
  return 100;
};

const computeScheduleQuality = (dailyPlans: any[], platformExecutionPlan?: any): number => {
  if (platformExecutionPlan?.days?.length) {
    const plannedDays = platformExecutionPlan.days.length;
    return Math.round((plannedDays / 7) * 100);
  }
  if (!dailyPlans || dailyPlans.length === 0) return 0;
  const withHints = dailyPlans.filter((plan) => plan?.schedule_hint).length;
  return Math.round((withHints / dailyPlans.length) * 100);
};

const computeAutomationReadiness = (platformExecutionPlan?: any): number => {
  if (!platformExecutionPlan?.days?.length) return 0;
  const placeholders = platformExecutionPlan.days.filter((day: any) => day.placeholder).length;
  const ratio = placeholders / platformExecutionPlan.days.length;
  return Math.round((1 - ratio) * 100);
};

const computeContentReadiness = (assets?: any[]): number => {
  if (!assets || assets.length === 0) return 0;
  const approved = assets.filter((asset) => asset.status === 'approved').length;
  return Math.round((approved / assets.length) * 100);
};

const computeApprovalCoverage = (assets?: any[]): number => {
  if (!assets || assets.length === 0) return 0;
  const reviewed = assets.filter((asset) => ['reviewed', 'approved'].includes(asset.status)).length;
  return Math.round((reviewed / assets.length) * 100);
};

const computeAssetCompleteness = (assets?: any[]): number => {
  if (!assets || assets.length === 0) return 0;
  const withContent = assets.filter((asset) => asset.current_version && asset.current_version > 0).length;
  return Math.round((withContent / assets.length) * 100);
};

const computePerformanceCoverage = (analyticsReport?: any): number => {
  if (!analyticsReport) return 0;
  return analyticsReport.engagementRate ? Math.round(analyticsReport.engagementRate * 100) : 0;
};

const computeLearningConfidence = (learningInsights?: any): number => {
  if (!learningInsights?.recommendations?.length) return 0;
  const avg = learningInsights.recommendations.reduce(
    (sum: number, rec: any) => sum + (rec.confidence ?? 0),
    0
  );
  return Math.round(avg / learningInsights.recommendations.length);
};

const computeOptimizationEffectiveness = (analyticsReport?: any): number => {
  if (!analyticsReport) return 0;
  return analyticsReport.engagementRate ? Math.round(analyticsReport.engagementRate * 100) : 0;
};

export function validateCampaignHealth(input: {
  companyProfile: CompanyProfile;
  trends: any[];
  campaign: any;
  weeklyPlans: any[];
  dailyPlans: any[];
  platformExecutionPlan?: any;
  contentAssets?: any[];
  analyticsReport?: any;
  learningInsights?: any;
  memoryOverlap?: { similarityScore: number };
  forecast?: { confidence?: number };
  roi?: { roiPercent?: number };
  businessReport?: { healthScore?: number };
  complianceReports?: Array<{ status: string }>;
  promotionMetadataCount?: number;
  omnivyraCoverageScore?: number;
}): CampaignHealthReport {
  console.log('CAMPAIGN HEALTH CHECK', {
    companyId: input.companyProfile?.company_id,
  });

  const issues: CampaignHealthReport['issues'] = [];
  const recommendations: string[] = [];

  const profileCompleteness = computeProfileCompleteness(input.companyProfile);
  const trendCoverage = computeTrendCoverage(input.dailyPlans);
  const platformBalance = computePlatformBalance(input.dailyPlans);
  const contentDiversity = computeContentDiversity(input.dailyPlans);
  const scheduleQuality = computeScheduleQuality(input.dailyPlans, input.platformExecutionPlan);
  const automationReadiness = computeAutomationReadiness(input.platformExecutionPlan);
  const contentReadiness = computeContentReadiness(input.contentAssets);
  const approvalCoverage = computeApprovalCoverage(input.contentAssets);
  const assetCompleteness = computeAssetCompleteness(input.contentAssets);
  const performanceCoverage = computePerformanceCoverage(input.analyticsReport);
  const learningConfidence = computeLearningConfidence(input.learningInsights);
  const optimizationEffectiveness = computeOptimizationEffectiveness(input.analyticsReport);
  const noveltyScore = input.memoryOverlap
    ? Math.round((1 - input.memoryOverlap.similarityScore) * 100)
    : 100;
  const forecastConfidence = input.forecast?.confidence ?? 0;
  const roiHealth = input.roi?.roiPercent ?? 0;
  const businessScore = input.businessReport?.healthScore ?? 0;
  const platformComplianceScore = input.complianceReports && input.complianceReports.length > 0
    ? Math.round(
        (input.complianceReports.filter((report) => report.status === 'ok').length /
          input.complianceReports.length) *
          100
      )
    : 0;
  const promotionCompletenessScore = input.promotionMetadataCount && input.contentAssets?.length
    ? Math.round((input.promotionMetadataCount / input.contentAssets.length) * 100)
    : 0;
  const omnivyraCoverageScore = input.omnivyraCoverageScore ?? 0;

  console.log('PROFILE COMPLETENESS SCORE', profileCompleteness);
  console.log('TREND COVERAGE SCORE', trendCoverage);
  console.log('PLATFORM BALANCE SCORE', platformBalance);

  const weeklyPlansMissing = !input.weeklyPlans || input.weeklyPlans.length === 0;
  const dailyPlansMissing = !input.dailyPlans || input.dailyPlans.length === 0;
  const missingIndustry = !(hasList(input.companyProfile.industry_list) || hasValue(input.companyProfile.industry));

  if (missingIndustry) {
    issues.push({ level: 'error', field: 'industry', message: 'Company industry is missing' });
  }
  if (weeklyPlansMissing) {
    issues.push({ level: 'error', field: 'weeklyPlans', message: 'Weekly plan is missing' });
  }
  if (dailyPlansMissing) {
    issues.push({ level: 'error', field: 'dailyPlans', message: 'Daily plan is missing' });
  }

  const placeholders = input.dailyPlans.filter((plan) => plan?.source === 'placeholder').length;
  const placeholderRatio = input.dailyPlans.length
    ? placeholders / input.dailyPlans.length
    : 0;

  if (input.platformExecutionPlan?.days?.length) {
    const planPlaceholders = input.platformExecutionPlan.days.filter((day: any) => day.placeholder).length;
    const planRatio = planPlaceholders / input.platformExecutionPlan.days.length;
    if (planRatio > 0.3) {
      issues.push({
        level: 'warning',
        field: 'automationReadiness',
        message: 'More than 30% of execution plan is placeholders',
      });
      recommendations.push('Reduce placeholder content before scheduling.');
    }
    if (input.platformExecutionPlan.days.length < 7) {
      issues.push({
        level: 'error',
        field: 'schedule',
        message: 'Execution plan does not cover all 7 days',
      });
    }
  }

  if (input.contentAssets && input.contentAssets.length === 0) {
    issues.push({
      level: 'warning',
      field: 'content_assets',
      message: 'No content assets generated',
    });
    recommendations.push('Generate content assets for execution plan.');
  }
  if (input.contentAssets && input.contentAssets.length > 0) {
    const unapproved = input.contentAssets.filter((asset) => asset.status !== 'approved').length;
    if (unapproved > 0) {
      issues.push({
        level: 'error',
        field: 'content_approval',
        message: 'Unapproved content assets block scheduling',
      });
    }
    const regenHeavy = input.contentAssets.filter((asset) => (asset.current_version ?? 0) > 3).length;
    if (regenHeavy > 0) {
      issues.push({
        level: 'warning',
        field: 'regeneration',
        message: 'Some assets have more than 3 regenerations',
      });
    }
  }

  if (!input.analyticsReport) {
    issues.push({
      level: 'warning',
      field: 'performance',
      message: 'No performance metrics available',
    });
  }
  if (learningConfidence > 0 && learningConfidence < 50) {
    issues.push({
      level: 'warning',
      field: 'learning',
      message: 'Learning confidence is below 50%',
    });
  }

  if (input.memoryOverlap && input.memoryOverlap.similarityScore > 0.8) {
    issues.push({
      level: 'warning',
      field: 'novelty',
      message: 'High overlap with past campaign content',
    });
  }
  if (platformComplianceScore > 0 && platformComplianceScore < 60) {
    issues.push({
      level: 'warning',
      field: 'platformCompliance',
      message: 'Platform compliance score is low',
    });
  }
  if (promotionCompletenessScore > 0 && promotionCompletenessScore < 60) {
    issues.push({
      level: 'warning',
      field: 'promotionMetadata',
      message: 'Promotion metadata completeness is low',
    });
  }
  if (forecastConfidence > 0 && forecastConfidence < 50) {
    issues.push({
      level: 'warning',
      field: 'forecast',
      message: 'Forecast confidence is low',
    });
  }
  if (roiHealth < 0) {
    issues.push({
      level: 'warning',
      field: 'roi',
      message: 'ROI forecast is negative',
    });
  }

  if (performanceCoverage < 1) {
    issues.push({
      level: 'warning',
      field: 'performanceCoverage',
      message: 'Performance coverage is low',
    });
  }

  if (placeholderRatio > 0.2) {
    issues.push({
      level: 'warning',
      field: 'placeholders',
      message: 'More than 20% of daily plans are placeholders',
    });
    recommendations.push('Increase content capability coverage to reduce placeholders.');
  }

  const platforms = new Set(input.dailyPlans.map((plan) => plan?.platform).filter(Boolean));
  if (platforms.size <= 1) {
    issues.push({
      level: 'warning',
      field: 'platforms',
      message: 'Only one platform is used in daily plans',
    });
    recommendations.push('Expand platform mix to improve reach.');
  }

  if (!hasList(input.companyProfile.content_themes_list) && !hasValue(input.companyProfile.content_themes)) {
    issues.push({
      level: 'warning',
      field: 'content_themes',
      message: 'Content themes are missing',
    });
    recommendations.push('Add content themes to improve alignment.');
  }

  if (!hasList(input.companyProfile.geography_list) && !hasValue(input.companyProfile.geography)) {
    issues.push({
      level: 'warning',
      field: 'geography',
      message: 'Geography is missing',
    });
    recommendations.push('Add geography to improve targeting.');
  }

  if (!hasList(input.companyProfile.competitors_list) && !hasValue(input.companyProfile.competitors)) {
    issues.push({
      level: 'warning',
      field: 'competitors',
      message: 'Competitors are missing',
    });
    recommendations.push('Add competitor landscape for stronger differentiation.');
  }

  if (trendCoverage < 50) {
    issues.push({
      level: 'warning',
      field: 'trend_alignment',
      message: 'Trend alignment is below 50%',
    });
    recommendations.push('Blend in aligned trends to improve relevance.');
  }

  if (input.weeklyPlans.length > 0 && input.weeklyPlans.length < 12) {
    issues.push({
      level: 'warning',
      field: 'weeklyPlans',
      message: 'Weekly plan has fewer than 12 weeks',
    });
    recommendations.push('Extend weekly plan to 12 weeks for full coverage.');
  }

  const confidence = Math.round(
    (profileCompleteness +
      trendCoverage +
      platformBalance +
      contentDiversity +
      scheduleQuality +
      automationReadiness +
      contentReadiness +
      approvalCoverage +
      assetCompleteness +
      performanceCoverage +
      learningConfidence +
      optimizationEffectiveness +
      noveltyScore +
      forecastConfidence +
      Math.max(0, roiHealth) +
      businessScore +
      platformComplianceScore +
      promotionCompletenessScore +
      omnivyraCoverageScore) /
      19
  );

  if (confidence < 50) {
    issues.push({
      level: 'error',
      field: 'confidence',
      message: 'Campaign confidence is below 50',
    });
  }

  let status: CampaignHealthReport['status'] = 'healthy';
  if (issues.some((issue) => issue.level === 'error')) {
    status = 'blocked';
  } else if (issues.some((issue) => issue.level === 'warning')) {
    status = 'warning';
  }

  if (status === 'healthy' && confidence < 80) {
    status = 'warning';
  }

  return {
    status,
    confidence,
    issues,
    scores: {
      profileCompleteness,
      trendCoverage,
      platformBalance,
      contentDiversity,
      scheduleQuality,
      automationReadiness,
      contentReadiness,
      approvalCoverage,
      assetCompleteness,
      performanceCoverage,
      learningConfidence,
      optimizationEffectiveness,
      noveltyScore,
      forecastConfidence,
      roiHealth,
      businessScore,
      platformComplianceScore,
      promotionCompletenessScore,
      omnivyraCoverageScore,
    },
    recommendations,
  };
}
