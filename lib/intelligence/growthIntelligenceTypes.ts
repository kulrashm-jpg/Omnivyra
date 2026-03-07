/**
 * Growth Intelligence — Frontend Data Contract
 * TypeScript interfaces and helper utilities for consuming API responses.
 * No backend dependencies. Pure types + helpers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Score Breakdown
// ─────────────────────────────────────────────────────────────────────────────

export interface GrowthScoreBreakdown {
  contentVelocity: number;
  publishing: number;
  engagement: number;
  community: number;
  opportunity: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Growth Summary (campaign or company scope)
// ─────────────────────────────────────────────────────────────────────────────

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
    replies?: number;
    likes?: number;
    shares?: number;
  };

  opportunities: {
    campaignsFromOpportunities: number;
    availableOpportunities?: number;
  };

  growthScore: number;
  scoreBreakdown?: GrowthScoreBreakdown;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Response Wrapper
// ─────────────────────────────────────────────────────────────────────────────

export interface GrowthApiResponse {
  success: boolean;
  data: GrowthSummary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Company Summary (aggregated across campaigns)
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyGrowthSummary {
  companyId: string;
  campaignCount: number;

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
  };

  opportunities: {
    campaignsFromOpportunities: number;
  };

  growthScore: number;
  scoreBreakdown?: GrowthScoreBreakdown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getGrowthScoreLabel(score: number): string {
  if (score >= 80) return 'High Growth';
  if (score >= 60) return 'Healthy';
  if (score >= 40) return 'Developing';
  return 'Needs Attention';
}

export function getGrowthScoreColor(score: number): 'green' | 'blue' | 'orange' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'blue';
  if (score >= 40) return 'orange';
  return 'red';
}

export interface BreakdownItem {
  label: string;
  value: number;
}

export function normalizeBreakdown(breakdown?: GrowthScoreBreakdown): BreakdownItem[] {
  if (!breakdown) return [];

  return [
    { label: 'Content Velocity', value: breakdown.contentVelocity },
    { label: 'Publishing Reliability', value: breakdown.publishing },
    { label: 'Engagement Quality', value: breakdown.engagement },
    { label: 'Community Activity', value: breakdown.community },
    { label: 'Opportunity Activation', value: breakdown.opportunity },
  ];
}
