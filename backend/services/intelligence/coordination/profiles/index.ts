/**
 * Communication Query Profiles — public facade (WS-2D, Zone A2).
 *
 * The canonical read-side API that future Analytics, Campaign Intelligence,
 * dashboards, governance tooling, and reporting consume — INSTEAD of composing
 * graph queries themselves. Every method runs its profile through the one shared
 * execution layer (`executeProfile`).
 */
import type { CoordinationResult } from '../coordinationContracts';
import { communicationIntelligence } from '../intelligence/communicationIntelligenceService';
import { executeProfile, type ProfileDeps } from './queryProfileFramework';
import type { ProfileResponse } from './profileModels';
import { timelineProfile, type TimelineProfileRequest, type TimelineProfileData } from './timelineProfile';
import { continuityProfile, type ContinuityProfileData } from './continuityProfile';
import { campaignProfile, type CampaignProfileRequest, type CampaignProfileData } from './campaignProfile';
import { semanticProfile, type SemanticProfileRequest, type SemanticProfileData } from './semanticProfile';
import { analyticsProfile, type AnalyticsProfileRequest, type AnalyticsProfileData } from './analyticsProfile';
import { auditProfile, type AuditProfileData } from './auditProfile';

export interface CommunicationQueryProfiles {
  timeline(companyId: string, req?: TimelineProfileRequest): Promise<CoordinationResult<ProfileResponse<TimelineProfileData>>>;
  continuity(companyId: string): Promise<CoordinationResult<ProfileResponse<ContinuityProfileData>>>;
  campaign(companyId: string, req?: CampaignProfileRequest): Promise<CoordinationResult<ProfileResponse<CampaignProfileData>>>;
  semantic(companyId: string, req: SemanticProfileRequest): Promise<CoordinationResult<ProfileResponse<SemanticProfileData>>>;
  analytics(companyId: string, req?: AnalyticsProfileRequest): Promise<CoordinationResult<ProfileResponse<AnalyticsProfileData>>>;
  audit(companyId: string): Promise<CoordinationResult<ProfileResponse<AuditProfileData>>>;
}

export function createCommunicationQueryProfiles(deps: Partial<ProfileDeps> = {}): CommunicationQueryProfiles {
  const d: ProfileDeps = { intel: deps.intel ?? communicationIntelligence };
  return {
    timeline: (companyId, req = {}) => executeProfile(timelineProfile, d, companyId, req),
    continuity: (companyId) => executeProfile(continuityProfile, d, companyId, {}),
    campaign: (companyId, req = {}) => executeProfile(campaignProfile, d, companyId, req),
    semantic: (companyId, req) => executeProfile(semanticProfile, d, companyId, req),
    analytics: (companyId, req = {}) => executeProfile(analyticsProfile, d, companyId, req),
    audit: (companyId) => executeProfile(auditProfile, d, companyId, {}),
  };
}

/** The default process-wide query-profile facade over the canonical intelligence service. */
export const communicationQueryProfiles: CommunicationQueryProfiles = createCommunicationQueryProfiles();

// ── Re-exports (framework + models + per-profile contracts) ──────────────────
export {
  executeProfile,
  must,
  type QueryProfile,
  type ProfileDeps,
} from './queryProfileFramework';
export * from './profileModels';
export {
  isCoordinationQueryProfilesEnabled,
  COORDINATION_QUERY_PROFILES_ENABLED_ENV_VAR,
} from './profileFlags';
export { timelineProfile, type TimelineProfileRequest, type TimelineItem, type TimelineProfileData } from './timelineProfile';
export { continuityProfile, type ContinuityProfileRequest, type ContinuityProfileData, type LineageSummaryEntry } from './continuityProfile';
export { campaignProfile, type CampaignProfileRequest, type CampaignSummary, type CampaignProfileData } from './campaignProfile';
export { semanticProfile, type SemanticProfileRequest, type SemanticProfileData } from './semanticProfile';
export { analyticsProfile, type AnalyticsProfileRequest, type AnalyticsProfileData } from './analyticsProfile';
export { auditProfile, type AuditProfileRequest, type AuditProfileData } from './auditProfile';
