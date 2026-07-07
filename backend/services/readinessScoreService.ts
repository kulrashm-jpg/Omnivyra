/**
 * Readiness Score Calculation Service
 * Computes 0-100 readiness score based on feature completion weights
 */

import { FeatureKey, FeatureCompletionRecord } from '../types/featureCompletion';
import { FEATURE_WEIGHTS } from '../../config/readinessFeatures';

/**
 * Weighted model for readiness scoring
 * Total = 100 points
 */
const WEIGHTS = FEATURE_WEIGHTS as Record<FeatureKey, number>;

/**
 * Sum of all weights (validation)
 */
export const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Breakdown item in score response
 */
export interface ScoreBreakdownItem {
  key: FeatureKey;
  status: 'not_started' | 'in_progress' | 'completed';
  weight: number;
  pointsEarned: number; // weight if completed, 0 otherwise
}

/**
 * Readiness score response
 */
export interface ReadinessScoreResponse {
  score: number; // 0-100
  maxScore: number; // Always 100
  breakdown: ScoreBreakdownItem[];
  completedFeatures: number;
  totalFeatures: number;
  completionPercentage: number;
}

/**
 * Compute readiness score from feature completion records
 * 
 * @param features Array of feature completion records
 * @returns Readiness score with detailed breakdown
 */
export function computeReadinessScore(
  features: FeatureCompletionRecord[]
): ReadinessScoreResponse {
  let totalScore = 0;
  const breakdown: ScoreBreakdownItem[] = [];
  let completedCount = 0;

  // Process each feature
  for (const feature of features) {
    const featureKey = feature.feature_key as FeatureKey;
    const weight = WEIGHTS[featureKey] ?? 0;

    // Use partial score from metadata if available, else binary fallback
    const partialScore: number = typeof feature.metadata?.score === 'number'
      ? feature.metadata.score
      : feature.status === 'completed' ? 1 : 0;
    const pointsEarned = Math.round(partialScore * weight);
    totalScore += pointsEarned;

    if (feature.status === 'completed') {
      completedCount++;
    }

    breakdown.push({
      key: featureKey,
      status: feature.status as any,
      weight,
      pointsEarned,
    });
  }

  // Sort breakdown by weight (descending) for readability
  breakdown.sort((a, b) => b.weight - a.weight);

  return {
    score: Math.min(totalScore, 100), // Cap at 100
    maxScore: 100,
    breakdown,
    completedFeatures: completedCount,
    totalFeatures: features.length,
    completionPercentage: Math.round((completedCount / features.length) * 100),
  };
}

/**
 * Get readiness level label based on score
 * 
 * @param score 0-100 readiness score
 * @returns Human-readable level
 */
export function getReadinessLevel(score: number): string {
  if (score >= 90) return '🟢 Fully Ready';
  if (score >= 70) return '🟡 Mostly Ready';
  if (score >= 50) return '🟠 Partially Ready';
  if (score >= 25) return '🔴 Minimally Ready';
  return '⚫ Not Ready';
}

/**
 * Get readiness recommendations based on score
 * 
 * @param breakdown Feature breakdown
 * @returns Array of actionable recommendations
 */
export function getReadinessRecommendations(
  breakdown: ScoreBreakdownItem[]
): Array<{ feature: FeatureKey; weight: number; action: string }> {
  return breakdown
    .filter(item => item.status !== 'completed')
    .sort((a, b) => b.weight - a.weight) // Highest impact first
    .map(item => {
      const actions: Record<FeatureKey, string> = {
        [FeatureKey.COMPANY_PROFILE_COMPLETED]: 'Complete your company profile with name, industry, and company size',
        [FeatureKey.WEBSITE_CONNECTED]: 'Add your website URL to enable content analysis',
        [FeatureKey.BLOG_CREATED]: 'Create your first blog post to unlock blogging features',
        [FeatureKey.REPORT_GENERATED]: 'Generate a content readiness report to see your analysis',
        [FeatureKey.SOCIAL_ACCOUNTS_CONNECTED]: 'Connect your social media accounts to enable campaigns',
        [FeatureKey.CAMPAIGN_CREATED]: 'Create and stage your first campaign',
        [FeatureKey.CAMPAIGN_PUBLISHED]: 'Publish or send your first campaign to your audience',
        [FeatureKey.RECURRING_ENGAGEMENT]: 'Enable auto-reply / auto-DM engagement to respond automatically',
        [FeatureKey.CHROME_EXTENSION_INSTALLED]: 'Install the Chrome extension for real-time engagement notifications',
        [FeatureKey.API_CONFIGURED]: 'Configure API keys for campaign automation',
        [FeatureKey.CONTENT_WRITER]: 'Write your first long-form piece to unlock writer features',
        [FeatureKey.CONTENT_SHORT_FORMAT]: 'Create a post, tweet, or poll to unlock short-format content',
        [FeatureKey.CONTENT_CREATOR]: 'Produce a reel, video, short, or story to unlock creator content',
        [FeatureKey.CONTENT_WRITER_ASSET]: 'Attach a visual asset to your content to unlock rich-format publishing',
        [FeatureKey.MARKET_PULSE_USED]: 'Run Market Pulse to unlock competitive intelligence',
        [FeatureKey.ACTIVE_LEADS_USED]: 'Use Active Leads to unlock lead intelligence',
        [FeatureKey.FREE_CREDITS_USED]: 'Use your free credits to explore premium features',
      };

      return {
        feature: item.key,
        weight: item.weight,
        action: actions[item.key] || 'Complete this feature',
      };
    });
}

/**
 * Example: Create a detailed readiness report
 * 
 * @param score Readiness score response
 * @returns Formatted report
 */
export function generateReadinessReport(score: ReadinessScoreResponse): {
  level: string;
  score: number;
  breakdown: ScoreBreakdownItem[];
  recommendations: Array<{ feature: FeatureKey; weight: number; action: string }>;
} {
  const recommendations = getReadinessRecommendations(score.breakdown);
  
  return {
    level: getReadinessLevel(score.score),
    score: score.score,
    breakdown: score.breakdown,
    recommendations,
  };
}
