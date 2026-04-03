/**
 * Growth Intelligence — Phase-1 Read-Only Module
 * Exports: getGrowthIntelligenceSummary, metric functions
 * No writes, no worker imports, no schema changes.
 */

export { getGrowthIntelligenceSummary } from './growthIntelligenceService';
export { generateGrowthIntelligenceDecisions } from './growthIntelligenceService';
export { resolveCampaignIdsForCompany } from './growthIntelligenceService';
export { getContentVelocityMetrics } from './metrics/contentVelocity';
export { getPublishingSuccessMetrics } from './metrics/publishingSuccess';
export { getEngagementScore } from './metrics/engagementScore';
export { getCommunityEngagementMetrics } from './metrics/communityEngagement';
export { getOpportunityActivationMetrics } from './metrics/opportunityActivation';
export type { GrowthSummary } from './types';
