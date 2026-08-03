/**
 * INT-001 Phase 4 / INT-002 Wave 2 — version identity for generated intelligence.
 *
 * ENGINE_VERSION identifies the scoring/orchestration logic that produced a
 * record. Bump it when engine behaviour changes so persisted records become
 * 'stale' (regenerable) without breaking history — old records keep the
 * version that produced them.
 *
 * INTELLIGENCE_SCHEMA_VERSION identifies the persisted envelope shape.
 *
 * Version history:
 *  - lie-1.0.0 / schema 1 — Phase 2 intelligence summary only.
 *  - lie-2.0.0 / schema 2 — INT-002 Wave 2: envelope also carries Phase 3
 *    qualification planning and Phase 5 automation planning. Schema-1 rows
 *    remain loadable (planning layers surface as null) and are stale by
 *    engine-version mismatch, so the next generate upgrades them in place.
 */

export const ENGINE_VERSION = 'lie-2.0.0';

export const INTELLIGENCE_SCHEMA_VERSION = 2;

/** Envelope schema versions this build can load. Anything else reads as stale. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];

export const isSupportedSchemaVersion = (v: number): boolean => SUPPORTED_SCHEMA_VERSIONS.includes(v);

/** Engines the orchestrator executes, in order (summary builder runs the first block). */
export const ORCHESTRATED_ENGINES = [
  'behaviorAnalysis',
  'intentEngine',
  'personaEngine',
  'qualificationEngine',
  'segmentationEngine',
  'recommendationEngine',
  'timelineEngine',
  'summaryBuilder',
  'qualificationPlanning',
  'automationExecution',
] as const;
