/**
 * Shared canonical Multi-Source FUSION — re-exports Program 1's certified, entity-agnostic
 * `fuseEvidence` (dedup + source-weighting + conflict resolution over `EvidenceRef`) so Company +
 * Offering reuse ONE fusion implementation (no fork).
 */
export { fuseEvidence, DEFAULT_SOURCE_WEIGHTS, type FusionResult } from '../../leadUnderstanding/engines/fusion';
