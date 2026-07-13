/**
 * companyKnowledgeEntity.ts — the immutable Company Knowledge Entity + version
 * lifecycle (CKRE-003 §2/§3).
 *
 * Each knowledge version is ONE immutable logical object referencing the company,
 * version, provenance, source fingerprints, confidence, dependencies, and its
 * lifecycle state. The entity does not replace any storage — it is the canonical
 * shape persisted (additively) alongside the composed domain snapshot.
 *
 * Lifecycle (deterministic, illegal transitions impossible):
 *   CREATED → VALIDATED → ACTIVE → SUPERSEDED → ROLLED_BACK → ARCHIVED
 * with the restore edge SUPERSEDED → ACTIVE (rollback target) and self-transitions.
 */

import type { RefreshAction } from '../crawl/refreshPolicyEngine';
import type { FingerprintTypeId } from '../crawl/fingerprintRegistry';
import type { KnowledgeDomainId } from './companyKnowledgeModel';

export type KnowledgeLifecycleState =
  | 'CREATED'
  | 'VALIDATED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'ROLLED_BACK'
  | 'ARCHIVED';

export const KNOWLEDGE_LIFECYCLE_ORDER: ReadonlyArray<KnowledgeLifecycleState> = [
  'CREATED', 'VALIDATED', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED',
];

const TRANSITIONS: Readonly<Record<KnowledgeLifecycleState, ReadonlyArray<KnowledgeLifecycleState>>> = {
  CREATED:     ['VALIDATED', 'ARCHIVED'],
  VALIDATED:   ['ACTIVE', 'ARCHIVED'],
  ACTIVE:      ['SUPERSEDED', 'ROLLED_BACK', 'ARCHIVED'],
  SUPERSEDED:  ['ACTIVE', 'ARCHIVED'],   // restore via rollback
  ROLLED_BACK: ['ARCHIVED'],
  ARCHIVED:    [],                        // terminal
};

export function canKnowledgeTransition(from: KnowledgeLifecycleState, to: KnowledgeLifecycleState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertKnowledgeTransition(from: KnowledgeLifecycleState, to: KnowledgeLifecycleState): void {
  if (!canKnowledgeTransition(from, to)) {
    throw new Error(`ILLEGAL_KNOWLEDGE_LIFECYCLE_TRANSITION:${from}->${to}`);
  }
}

/** Compact fingerprint reference stored on the entity (no duplicate fingerprint store). */
export interface KnowledgeFingerprintRef {
  fingerprintVersion: string | null;
  computedAt: string | null;
  /** Per-registry-type hashes summary (from extractRegistryHashes), for diff attribution. */
  hashes: Partial<Record<FingerprintTypeId, string | null>>;
}

export interface KnowledgeProvenanceRef {
  producer: string | null;
  generatedAt: string | null;
  workflow: string | null;
  generationReason: string | null;
}

export interface KnowledgeConfidence {
  overall: number;
  byDomain: Partial<Record<KnowledgeDomainId, number>>;
}

export interface KnowledgeEntity {
  companyId: string;
  version: number;
  createdAt: string;
  createdBy: string | null;
  refreshReason: string;
  /** The policy action that produced this version (CKRE-002). */
  refreshPolicy: RefreshAction | string;
  sourceFingerprints: KnowledgeFingerprintRef | null;
  provenance: KnowledgeProvenanceRef | null;
  confidence: KnowledgeConfidence;
  /** Affected fingerprint types (the CKRE-001R dependency-graph closure). */
  dependencies: FingerprintTypeId[];
  lifecycle: KnowledgeLifecycleState;
}

export interface BuildKnowledgeEntityInput {
  companyId: string;
  version: number;
  createdAt: string;
  createdBy?: string | null;
  refreshReason: string;
  refreshPolicy: RefreshAction | string;
  sourceFingerprints?: KnowledgeFingerprintRef | null;
  provenance?: KnowledgeProvenanceRef | null;
  confidence: KnowledgeConfidence;
  dependencies?: FingerprintTypeId[];
  lifecycle?: KnowledgeLifecycleState;
}

/** Build an immutable knowledge entity. Pure. */
export function buildKnowledgeEntity(input: BuildKnowledgeEntityInput): KnowledgeEntity {
  return Object.freeze({
    companyId: input.companyId,
    version: input.version,
    createdAt: input.createdAt,
    createdBy: input.createdBy ?? null,
    refreshReason: input.refreshReason,
    refreshPolicy: input.refreshPolicy,
    sourceFingerprints: input.sourceFingerprints ?? null,
    provenance: input.provenance ?? null,
    confidence: input.confidence,
    dependencies: input.dependencies ? [...input.dependencies] : [],
    lifecycle: input.lifecycle ?? 'CREATED',
  });
}

/**
 * Derive the effective lifecycle state of a stored version, given the current
 * active version number + explicit markers. Deterministic:
 *   explicit ARCHIVED/ROLLED_BACK win → else current version = ACTIVE → else SUPERSEDED.
 */
export function deriveKnowledgeLifecycle(
  storedState: KnowledgeLifecycleState,
  version: number,
  currentActiveVersion: number,
): KnowledgeLifecycleState {
  if (storedState === 'ARCHIVED') return 'ARCHIVED';
  if (storedState === 'ROLLED_BACK') return 'ROLLED_BACK';
  return version === currentActiveVersion ? 'ACTIVE' : 'SUPERSEDED';
}
