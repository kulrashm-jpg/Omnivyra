/**
 * creatorCapability — Content Creator as a platform consumer (PMF-004).
 *
 * Creator Capability Profiles (configuration) + a platform runtime (orchestration)
 * that executes asset generation through AIC-001 (pipeline) and CKC-001 (knowledge),
 * with the existing asset pipeline as the generation backend (zero prompt/quality
 * change) behind a reversible flag.
 */

export {
  CREATOR_PROFILES, CREATOR_CAPABILITY_IDS, resolveCreatorProfile, profileForAssetType,
} from './creatorCapabilityProfile';
export type { CreatorCapabilityId, CreatorCapabilityProfile } from './creatorCapabilityProfile';

export { getCreatorRuntimeMode, shouldRunPlatform, legacyIsSafetyNet } from './creatorMigrationFlag';
export type { CreatorRuntimeMode } from './creatorMigrationFlag';

export { runCreatorCapability, recordCreatorRuntime } from './creatorPlatformRuntime';
export type { CreatorPlatformInput, CreatorPlatformDeps } from './creatorPlatformRuntime';
