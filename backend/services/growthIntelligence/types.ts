/**
 * Growth Intelligence Types — Phase-1 Read-Only
 * No schema changes, no writes.
 */

export interface GrowthSummary {
  companyId: string;
  campaignId?: string;

  contentVelocity: {
    plannedPosts: number;
    scheduledPosts: number;
    publishedPosts: number;
  };

  publishing: {
    published: number;
    failed: number;
    successRate: number;
  };

  engagement: {
    totalViews: number;
    totalLikes: number;
    totalShares: number;
    totalComments: number;
    engagementRate: number;
  };

  community: {
    executedActions: number;
    replies: number;
    likes: number;
    shares: number;
  };

  opportunities: {
    campaignsFromOpportunities: number;
    availableOpportunities: number;
  };

  growthScore: number;

  /** Optional breakdown of score by component for explainability. Sum ≈ growthScore. */
  scoreBreakdown?: {
    contentVelocity: number;
    publishing: number;
    engagement: number;
    community: number;
    opportunity: number;
  };
}
