/**
 * longFormCapability — the Long-form Engine as a platform capability (PMF-003).
 *
 * Capability Profiles (configuration) + a platform runtime (orchestration) that
 * executes long-form generation through AIC-001 (pipeline), CKC-001 (knowledge),
 * and the PMF-002 extracted intelligence — with the existing engine as the
 * inference backend (zero prompt/quality change) behind a reversible flag.
 */

export {
  LONG_FORM_PROFILES, LONG_FORM_CAPABILITY_IDS, resolveLongFormProfile, profileForEngineContentType,
} from './longFormCapabilityProfile';
export type { LongFormCapabilityId, LongFormCapabilityProfile } from './longFormCapabilityProfile';

export { getLongFormRuntimeMode, shouldRunPlatform, legacyIsSafetyNet } from './longFormMigrationFlag';
export type { LongFormRuntimeMode } from './longFormMigrationFlag';

export {
  runLongFormCapability, recordLongFormRuntime, defaultLongFormEngineRunner,
} from './longFormPlatformRuntime';
export type { LongFormPlatformInput, LongFormPlatformDeps, LongFormEngineRunner } from './longFormPlatformRuntime';
