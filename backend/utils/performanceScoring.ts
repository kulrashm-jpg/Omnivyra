/**
 * Performance Scoring Utilities
 * Campaign Learning Layer: engagement and conversion score calculation.
 * Rule-based, deterministic, no LLM.
 */

/** Engagement metrics for scoring */
export type EngagementMetrics = {
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  retweets?: number;
  quotes?: number;
  reactions?: number;
  views?: number;
};

/** Conversion-related metrics */
export type ConversionMetrics = {
  clicks?: number;
  conversions?: number;
  leads?: number;
  signups?: number;
};

/** Weight for each engagement type (relative importance) */
const ENGAGEMENT_WEIGHTS: Record<string, number> = {
  comments: 4,
  shares: 3,
  saves: 2.5,
  reactions: 2,
  retweets: 2,
  quotes: 2,
  likes: 1,
  views: 0.1,
  impressions: 0.05,
};

/**
 * Calculate weighted engagement score from raw metrics.
 * Higher-value actions (comments, shares) weighted more than likes/views.
 * @returns Normalized score (0–100 scale, unbounded above for virality)
 */
export function calculateEngagementScore(metrics: EngagementMetrics): number {
  let weighted = 0;
  for (const [key, weight] of Object.entries(ENGAGEMENT_WEIGHTS)) {
    const value = Number((metrics as Record<string, number>)[key] ?? 0) || 0;
    weighted += value * weight;
  }
  // Log-scale normalization: score = min(100, 10 * log10(1 + weighted))
  const raw = Math.log10(1 + Math.max(0, weighted));
  return Math.round(Math.min(100, raw * 10) * 100) / 100;
}

/**
 * Calculate conversion score from conversion-related metrics.
 * Optimized for click-through and downstream conversions.
 * @returns Normalized score (0–100 scale)
 */
export function calculateConversionScore(metrics: ConversionMetrics): number {
  const clicks = Number(metrics.clicks ?? 0) || 0;
  const conversions = Number(metrics.conversions ?? 0) || 0;
  const leads = Number(metrics.leads ?? 0) || 0;
  const signups = Number(metrics.signups ?? 0) || 0;

  const conversionValue = conversions * 5 + leads * 3 + signups * 2 + clicks * 0.5;
  const raw = Math.log10(1 + Math.max(0, conversionValue));
  return Math.round(Math.min(100, raw * 15) * 100) / 100;
}
