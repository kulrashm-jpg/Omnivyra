/**
 * provenanceMapper — Phase-2 Step-16. Pure builders, no I/O.
 *
 *  - buildAuthoritativeProvenance: stamped by authoritative generators.
 *  - deriveProvenanceFromContent: reads the persisted record; absence of a
 *    canonical provenance record == deterministic LEGACY (NOT heuristic).
 *    HYBRID when an authoritative record co-exists with a legacy/blueprint
 *    reconciliation (real signal from the Step-1 merge), or partial.
 */

import {
  ORCHESTRATION_VERSION,
  PROVENANCE_KEY,
  type ExecutionProvenance,
  type ProvenanceGenerationMode,
  type ProvenanceGenerationStage,
} from './provenanceTypes';

export function normalizeMode(m: unknown): ProvenanceGenerationMode {
  const s = String(m ?? '').toUpperCase();
  if (s === 'STRATEGY_FIRST' || s === 'SKELETON_FIRST') return s;
  return 'CONVERGED';
}

export function buildAuthoritativeProvenance(input: {
  execution_id: string;
  stage: ProvenanceGenerationStage;
  generation_mode: unknown;
  authoritative_confidence: number;
  fallback_active?: boolean;
  rollback_triggered?: boolean;
  lineage?: ExecutionProvenance['lineage'];
  metadata?: Record<string, unknown>;
}): ExecutionProvenance {
  return {
    execution_id: input.execution_id,
    generation_source: 'AUTHORITATIVE',
    generation_stage: input.stage,
    generation_mode: normalizeMode(input.generation_mode),
    routing_source: 'CENTRALIZED_ROUTING',
    readiness_source: 'CANONICAL_READINESS',
    orchestration_version: ORCHESTRATION_VERSION,
    fallback_active: input.fallback_active === true,
    rollback_triggered: input.rollback_triggered === true,
    authoritative_confidence: Math.max(0, Math.min(100, Math.round(input.authoritative_confidence || 0))),
    generation_timestamp: new Date().toISOString(),
    lineage: input.lineage ?? {},
    metadata: input.metadata ?? {},
  };
}

function coercePersisted(executionId: string, raw: Record<string, unknown>): ExecutionProvenance {
  return {
    execution_id: String(raw.execution_id ?? executionId),
    generation_source:
      raw.generation_source === 'AUTHORITATIVE' || raw.generation_source === 'HYBRID'
        ? raw.generation_source
        : 'LEGACY',
    generation_stage: (raw.generation_stage as ProvenanceGenerationStage) ?? 'WEEKLY',
    generation_mode: normalizeMode(raw.generation_mode),
    routing_source: raw.routing_source === 'CENTRALIZED_ROUTING' ? 'CENTRALIZED_ROUTING' : 'LEGACY',
    readiness_source: raw.readiness_source === 'CANONICAL_READINESS' ? 'CANONICAL_READINESS' : 'LEGACY',
    orchestration_version: String(raw.orchestration_version ?? ORCHESTRATION_VERSION),
    fallback_active: raw.fallback_active === true,
    rollback_triggered: raw.rollback_triggered === true,
    authoritative_confidence: Number(raw.authoritative_confidence) || 0,
    generation_timestamp: String(raw.generation_timestamp ?? new Date().toISOString()),
    lineage: (raw.lineage && typeof raw.lineage === 'object' ? raw.lineage : {}) as ExecutionProvenance['lineage'],
    metadata: (raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}) as Record<string, unknown>,
  };
}

function legacyProvenance(executionId: string, stage: ProvenanceGenerationStage): ExecutionProvenance {
  return {
    execution_id: executionId,
    generation_source: 'LEGACY',
    generation_stage: stage,
    generation_mode: 'CONVERGED',
    routing_source: 'LEGACY',
    readiness_source: 'LEGACY',
    orchestration_version: ORCHESTRATION_VERSION,
    fallback_active: true,
    rollback_triggered: false,
    authoritative_confidence: 0,
    generation_timestamp: new Date().toISOString(),
    lineage: {},
    metadata: { derived: 'no_canonical_provenance_record' },
  };
}

export function deriveProvenanceFromContent(
  executionId: string,
  contentBlob: Record<string, unknown> | null | undefined,
  opts: { stage?: ProvenanceGenerationStage; reconciledWithBlueprint?: boolean } = {},
): { provenance: ExecutionProvenance; hybrid: boolean } {
  const stage = opts.stage ?? 'WEEKLY';
  const rawProv = contentBlob && (contentBlob as Record<string, unknown>)[PROVENANCE_KEY];
  if (rawProv && typeof rawProv === 'object' && !Array.isArray(rawProv)) {
    const p = coercePersisted(executionId, rawProv as Record<string, unknown>);
    // Real HYBRID signal: an authoritative record that was reconciled with a
    // legacy/blueprint source (Step-1 merge) → partially legacy-influenced.
    if (p.generation_source === 'AUTHORITATIVE' && opts.reconciledWithBlueprint) {
      return { provenance: { ...p, generation_source: 'HYBRID' }, hybrid: true };
    }
    return { provenance: p, hybrid: p.generation_source === 'HYBRID' };
  }
  return { provenance: legacyProvenance(executionId, stage), hybrid: false };
}
