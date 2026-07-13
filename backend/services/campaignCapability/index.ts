/**
 * campaignCapability — Campaign Planner as a platform consumer (PMF-005).
 *
 * A Capability Graph (configuration + execution graph) + a Campaign Planner AIA
 * agent (orchestration) + a platform runtime that executes planning through AIA-001
 * (orchestration), AIC-001 (execution), and CKC-001 (knowledge), with the existing
 * planner engine as the inference backend (zero prompt/quality change) behind a
 * reversible flag.
 */

export {
  CAMPAIGN_CAPABILITY_GRAPH, CAMPAIGN_CAPABILITY_IDS, resolveCampaignCapability,
  campaignExecutionOrder, planProducingCapability,
} from './campaignCapabilityGraph';
export type { CampaignCapabilityId, CampaignCapabilityProfile } from './campaignCapabilityGraph';

export { getCampaignRuntimeMode, shouldRunPlatform, legacyIsSafetyNet } from './campaignMigrationFlag';
export type { CampaignRuntimeMode } from './campaignMigrationFlag';

export { runCampaignPlanViaPlatform, recordCampaignRuntime } from './campaignPlatformRuntime';
export type { CampaignPlatformInput, CampaignPlatformDeps } from './campaignPlatformRuntime';
