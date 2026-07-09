/** BARREL — route split into backend parts; explicit re-exports (Next bans export * in pages). */
export { buildAudienceMetricRankings, buildTopicClusters, classifyCampaignPath, deriveFallbackAction, deriveFallbackConfidence, deriveFallbackStability, derivePriority, deriveReportMaturityStage, deriveTimingThresholds, integrationMatches, mapContentTypeToStage, parseDays } from '../../../backend/services/intelligence/snapshotRouteBuild';
export type { CampaignRow, CampaignVersionRow, CompanyIntegrationRow, SnapshotResponse } from '../../../backend/services/intelligence/snapshotRouteBuild';
export { default } from '../../../backend/services/intelligence/snapshotRouteHandler';
