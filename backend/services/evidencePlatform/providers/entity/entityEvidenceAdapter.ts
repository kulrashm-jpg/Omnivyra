/**
 * Entity / Knowledge Graph Evidence Adapter  (BETA-PROVIDER-006, Phase 3-4) — REFERENCE IMPLEMENTATION #6
 *
 * Converts authenticated entity / knowledge-graph data (Wikidata · Google KG · schema.org) into canonical
 * Evidence via the BETA-ENGINE-004 `ProviderEvidenceAdapter` contract. It is the ONLY bridge from an
 * entity payload to the canonical Evidence model — no engine consumes the payload directly. Deterministic;
 * emits ONLY the entity facts genuinely supplied (missing facts are omitted, failures emitted as
 * UNAVAILABLE — never fabricated).
 *
 * NON-NEGOTIABLE: entities and identifiers are never invented. A knowledge-graph LOOKUP that succeeded but
 * found no entity is a genuine MEASURED absence (`knowledge_graph_presence = 0`), not a fabrication. A
 * missing identifier stays absent — never inferred.
 *
 * Provider-agnostic + multi-provider: it consumes a normalised `EntityEvidenceInput` that the entity bridge
 * builds by DETERMINISTICALLY CONSOLIDATING one or more entity providers. The bridge owns consolidation;
 * this adapter owns the canonical Evidence conversion.
 */
import { createEvidence, type Evidence } from '../../evidenceModel';
import { buildProvenance } from '../../provenance';
import { fromEngineConfidence } from '../../confidenceContract';
import type { ProviderEvidenceAdapter, AdapterContext } from '../providerAdapter';
import { baseAdapterFailure } from '../providerAdapter';
import type { ProviderFailure } from '../providerFailure';

const PROVIDER_ENGINE_ID = 'provider:entity_graph';

/**
 * Normalised, provider-agnostic CONSOLIDATED entity metrics (output of multi-provider consolidation).
 * Every field nullable — only genuinely-resolved facts pass through; nulls are omitted by the adapter
 * (never fabricated). `knowledgeGraphPresence` is 0/1 (measured absence is 0, not null, only when ≥1
 * provider actually performed a lookup). `contributingSources` lists the resolving sources.
 */
export interface EntityEvidenceInput {
  subjectId: string;
  knowledgeGraphPresence: number | null; // 1 if ≥1 provider resolved an entity; 0 = measured absence
  entityIdentifierPresent: number | null; // 1 if a wikidata QID or google KG mid is present
  entitySourceCount: number | null; // number of providers that resolved the entity (coverage)
  sameAsCount: number | null; // union of distinct sameAs targets across providers
  schemaCompleteness: number | null; // 0..1, best (max) completeness across providers
  hasCanonicalDescription: number | null; // 1 if any provider supplied a canonical description
  identifierConflict: number | null; // 1 if providers disagree on the entity identifier
  entityGraphStrength: number | null; // 0..100 CALCULATED composite (schema completeness + sameAs density)
  freshnessHours: number | null; // hours since the most recent observation (CALCULATED)
  observedAt: string | null;
  providerReliability: number | null;
  contributingSources: string[];
}

/** The canonical evidence keys this adapter can emit (align with the Evidence Registry + descriptor). */
export const ENTITY_EVIDENCE_KEYS = [
  'knowledge_graph_presence',
  'entity_identifier_present',
  'entity_source_count',
  'sameas_count',
  'schema_completeness',
  'has_canonical_description',
  'identifier_conflict',
  'entity_graph_strength',
  'entity_freshness_hours',
] as const;

const round = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export class EntityEvidenceAdapter implements ProviderEvidenceAdapter<EntityEvidenceInput> {
  readonly providerId = 'entity_graph';
  readonly supportedEvidence = [...ENTITY_EVIDENCE_KEYS];

  toEvidence(raw: EntityEvidenceInput, _context: AdapterContext): Evidence[] {
    const ts = raw.observedAt ?? null;
    const out: Evidence[] = [];
    const conf = fromEngineConfidence(raw.providerReliability, { reliability: raw.providerReliability ?? null });
    const sources = raw.contributingSources ?? [];
    const prov = (extraOp: string | null = null) =>
      buildProvenance({
        origin: 'provider:entity_graph',
        collector: 'entity_graph_api',
        engine: PROVIDER_ENGINE_ID,
        version: '1.0.0',
        timestamp: ts,
        calculationSteps: [
          { op: 'consolidate', detail: `sources=${sources.join('+') || 'none'}` },
          ...(extraOp ? [{ op: extraOp }] : []),
        ],
      });

    // MEASURED — an entity fact ≥1 provider genuinely resolved. Missing → skipped (no fabrication).
    const measured = (key: string, value: number, unit: string, measurementType: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'MEASURED',
        sourceSystem: 'entity_graph_api', sourceType: 'external_api', measurementType, observationType: 'snapshot',
        unit, observedAt: ts, collectedAt: ts, confidence: conf, provenance: prov(), validationStatus: 'validated',
      }));
    const calculated = (key: string, value: number, unit: string, measurementType: string, detail: string) =>
      out.push(createEvidence({
        engineId: PROVIDER_ENGINE_ID, key, value, maturity: 'CALCULATED',
        sourceSystem: 'entity_graph_api', sourceType: 'external_api', measurementType, observationType: 'snapshot',
        unit, observedAt: ts, collectedAt: ts, confidence: conf,
        provenance: prov(detail), validationStatus: 'validated',
      }));

    // knowledge_graph_presence / identifier_present are 0/1 measurements — 0 is a genuine measured absence.
    if (raw.knowledgeGraphPresence != null) measured('knowledge_graph_presence', raw.knowledgeGraphPresence, 'boolean', 'presence');
    if (raw.entityIdentifierPresent != null) measured('entity_identifier_present', raw.entityIdentifierPresent, 'boolean', 'presence');
    if (raw.entitySourceCount != null) measured('entity_source_count', raw.entitySourceCount, 'count', 'count');
    if (raw.sameAsCount != null) measured('sameas_count', raw.sameAsCount, 'count', 'count');
    if (raw.schemaCompleteness != null) measured('schema_completeness', round4(raw.schemaCompleteness), 'ratio', 'ratio');
    if (raw.hasCanonicalDescription != null) measured('has_canonical_description', raw.hasCanonicalDescription, 'boolean', 'presence');
    if (raw.identifierConflict != null) measured('identifier_conflict', raw.identifierConflict, 'boolean', 'presence');

    if (raw.entityGraphStrength != null) calculated('entity_graph_strength', round(raw.entityGraphStrength), 'score_0_100', 'score', 'schema_completeness*60 + min(sameas,8)*5');
    if (raw.freshnessHours != null) calculated('entity_freshness_hours', round(raw.freshnessHours), 'hours', 'age', 'now - most_recent_observation');
    return out;
  }

  onFailure(failure: ProviderFailure): Evidence[] {
    return baseAdapterFailure(failure);
  }
}

export const entityEvidenceAdapter = new EntityEvidenceAdapter();
