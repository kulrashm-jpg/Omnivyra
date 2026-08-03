/**
 * INT-001 Phase 4 — public surface.
 *
 * `createLeadIntelligenceOrchestrator` is THE public entry point for
 * generating/regenerating/persisting lead intelligence; the Phase 2 engines
 * stay internal behind it. Read integration is additive and persisted-only.
 * Nothing in the existing runtime imports this module yet — wiring a caller
 * (API route, job, cron) is a deliberate later activation step.
 */

export * from './types';
export {
  ENGINE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  isSupportedSchemaVersion,
  ORCHESTRATED_ENGINES,
} from './engineVersion';
export { computeInputFingerprint, stableStringify } from './fingerprint';
export { resolveIntelligenceFreshness } from './freshness';
export {
  durableIntelligencePersistence,
  createInMemoryIntelligenceStore,
  rowToIntelligenceRecord,
  LEAD_INTELLIGENCE_PROFILES_TABLE,
} from './persistence';
export { durableSnapshotSource } from './snapshotSource';
export {
  createLeadIntelligenceOrchestrator,
  type LeadIntelligenceOrchestrator,
  type LeadIntelligenceOrchestratorOptions,
} from './orchestrator';
export {
  getPersistedLeadIntelligence,
  getEnrichedLeadProfileWithIntelligence,
  type EnrichedLeadProfileWithIntelligence,
  type IntelligenceMeta,
} from './readIntegration';
