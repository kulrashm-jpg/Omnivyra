/**
 * Evidence Context Resolvers  (BETA-ENGINE-007, Phase 5)
 *
 * Bridge from the persisted canonical Evidence store to the decision engines' BETA-ENGINE-006 evidence
 * contexts. Decision engines NEVER call providers directly and NEVER fetch — they receive the Evidence the
 * orchestrator already persisted (one fetch, many consumers). When no persisted Evidence exists (this
 * environment, no credentials), the contexts are empty and the engines fall back to their prior behaviour.
 */
import { readPersistedEvidence, type EvidenceStore, getEvidenceStore } from './evidenceStore';
import type { Evidence } from '../evidenceModel';

/** Shape consumed by authorityIntelligenceService (BETA-ENGINE-006). */
export interface ResolvedAuthorityContext {
  entityEvidence: Evidence[] | null;
}

/** Shape consumed by trustIntelligenceService (BETA-ENGINE-006). */
export interface ResolvedTrustContext {
  reputationEvidence: Evidence[] | null;
  aiVisibilityEvidence: Evidence[] | null;
}

const orNull = (rows: Evidence[]): Evidence[] | null => (rows.length > 0 ? rows : null);

/** Persisted entity Evidence → authority engine context. */
export function resolveAuthorityEvidenceContext(subjectId: string, store: EvidenceStore = getEvidenceStore()): ResolvedAuthorityContext {
  return { entityEvidence: orNull(readPersistedEvidence('entity_graph', subjectId, store)) };
}

/** Persisted reputation + AI-visibility Evidence → trust engine context. */
export function resolveTrustEvidenceContext(subjectId: string, store: EvidenceStore = getEvidenceStore()): ResolvedTrustContext {
  return {
    reputationEvidence: orNull(readPersistedEvidence('reviews', subjectId, store)),
    aiVisibilityEvidence: orNull(readPersistedEvidence('llm_visibility', subjectId, store)),
  };
}
