/**
 * G-C303 — Cross-Entity Evidence Fusion (pure, deterministic).
 *
 * Fuses evidence originating from MULTIPLE canonical entities into one derived set — REUSING the shared
 * `fuseEvidence` (dedup + source-weighting + conflict resolution), NOT a new evidence primitive. It
 * also emits `derived` evidence (kind 'inferred') summarizing each participating entity's contribution
 * to the cross-entity picture; derived evidence is grounded in canonical evidence and never fabricates.
 */

import type { CrossEntityContext, FusedCrossEntityEvidence, EvidenceRef } from './types';
import { fuseEvidence, mkEvidence } from '../intelligence/canonical';
import { evidenceOf } from './contextAssembler';

export function fuseCrossEntityEvidence(context: CrossEntityContext): FusedCrossEntityEvidence {
  const fusion = fuseEvidence(context.evidence);

  // Derived (inferred) evidence: one item per participating entity that actually carries evidence,
  // referencing its own freshest observation — a corroboration signal, not a new fact.
  const derived: EvidenceRef[] = context.entities
    .map((e) => {
      const ev = evidenceOf(e.understanding);
      if (ev.length === 0) return null;
      const freshestAt = ev.reduce((m, x) => (x.observedAt > m ? x.observedAt : m), ev[0].observedAt);
      return mkEvidence('cross_entity_intelligence', {
        label: `contributes:${e.type}`, value: ev.length, source: 'cross_entity_intelligence',
        observedAt: freshestAt, kind: 'inferred', weight: 0.5,
      });
    })
    .filter((e): e is EvidenceRef => e != null)
    .sort((a, b) => a.id.localeCompare(b.id));

  return { fused: fusion.fused, provenance: fusion.provenance, contradictions: fusion.contradictions, confidence: fusion.confidence, derived };
}
