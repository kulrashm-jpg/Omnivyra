/**
 * Analytics Profile (WS-2D Phase 6) — analytics-friendly summaries (DTOs only, no
 * visualization). Composes `getHistory` + `getSemanticClusters` + `getRepeatedIntents`
 * and aggregates. No new traversal.
 */
import type { QueryProfile, ProfileDeps } from './queryProfileFramework';
import { must } from './queryProfileFramework';
import { distribution, type DistributionBucket } from './profileModels';

export interface AnalyticsProfileRequest {
  sinceDays?: number;
}

export interface AnalyticsProfileData {
  totalCommunications: number;
  communicationFrequency: DistributionBucket[];   // by day (YYYY-MM-DD), newest bucket first by count
  platformDistribution: DistributionBucket[];
  intentDistribution: DistributionBucket[];
  lifecycleDistribution: DistributionBucket[];
  continuityCoverage: number;                      // published roots / total roots
  duplicateRate: number;                           // repeated communications / total
  communicationVelocityPerWeek: number;            // total / span-in-weeks
  semanticReuseRate: number;                       // roots used in >1 campaign / total roots
}

const WEEK_MS = 7 * 86_400_000;

export const analyticsProfile: QueryProfile<AnalyticsProfileRequest, AnalyticsProfileData> = {
  type: 'analytics',
  async run(deps: ProfileDeps, companyId, req) {
    const history = must(await deps.intel.getHistory(companyId, { sinceDays: req.sinceDays }));
    const clusters = must(await deps.intel.getSemanticClusters(companyId));
    const repeats = must(await deps.intel.getRepeatedIntents(companyId));

    const rootCount = clusters.length;
    const publishedRoots = clusters.filter((c) => c.lifecycleStates.includes('published')).length;
    const reuseRoots = clusters.filter((c) => c.campaignIds.length > 1).length;
    const repeatedCommunications = repeats.reduce((sum, r) => sum + (r.count - 1), 0);

    // Velocity from the observed span within the returned set (deterministic; no clock).
    const times = history.map((r) => Date.parse(r.observedAt)).filter((n) => !Number.isNaN(n));
    const spanWeeks = times.length > 1 ? Math.max((Math.max(...times) - Math.min(...times)) / WEEK_MS, 1) : 1;

    return {
      totalCommunications: history.length,
      communicationFrequency: distribution(history.map((r) => r.observedAt.slice(0, 10))),
      platformDistribution: distribution(history.map((r) => r.platform)),
      intentDistribution: distribution(history.map((r) => r.communicationIntent)),
      lifecycleDistribution: distribution(history.map((r) => r.publicationStatus)),
      continuityCoverage: rootCount ? publishedRoots / rootCount : 0,
      duplicateRate: history.length ? repeatedCommunications / history.length : 0,
      communicationVelocityPerWeek: history.length / spanWeeks,
      semanticReuseRate: rootCount ? reuseRoots / rootCount : 0,
    };
  },
  resultCount: (d) => d.totalCommunications,
};
