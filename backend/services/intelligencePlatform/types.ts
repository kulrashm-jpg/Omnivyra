/**
 * PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase D — Platform Consumption contracts.
 *
 * The STABLE downstream-facing surface (G-D402/G-D403). Every future intelligence domain (Visitor /
 * Journey / Intent / Opportunity / Decision / Customer / Revenue / Automation) consumes THESE contracts
 * — the graph, cross-entity context, canonical evidence, reasoning, and explainability — WITHOUT
 * touching graph internals and WITHOUT introducing a parallel relationship or reasoning model. This
 * layer adds NO new graph/relationship/reasoning primitive; it re-exposes Phases B + C. Ownership stays
 * in Programs 1–3; the graph stays infrastructure-only.
 */

import type {
  CanonicalEntityUnderstanding, ContextProjection, CrossEntityInsight, RelationshipQuality,
  CrossEntityExplanation, EvidenceRef, ISOTimestamp,
} from '../crossEntityIntelligence';

export type {
  CanonicalEntityUnderstanding, ContextProjection, CrossEntityInsight, RelationshipQuality,
  CrossEntityExplanation, EvidenceRef, ISOTimestamp,
};

/** A participating entity reference — identity only, no internals exposed. */
export interface EntityRef { key: string; type: string; id: string; }

/** A cross-entity insight flattened for downstream consumption (no raw internals; trace on request). */
export interface ContextInsight {
  kind: string; claim: string; conclusion: string | number | boolean | null;
  entities: string[]; confidence: number; abstained: boolean;
}

/**
 * G-D402 — the ONE canonical context contract downstream programs consume. It bundles the cross-entity
 * context projections + insights + relationships + evidence summary for a focus entity. It DUPLICATES
 * no entity projection (Programs 1–3 keep their own single projection); it references cross-entity
 * outputs only.
 */
export interface CanonicalContext {
  focus: EntityRef;
  entities: EntityRef[];               // participating entities (identity only)
  contexts: ContextProjection[];       // buying / account / offering / relationship
  insights: ContextInsight[];          // flattened cross-entity insights
  relationshipCount: number;
  evidenceCount: number;
  builtAt: ISOTimestamp;
}

/** Options a consumer passes when opening a platform session. */
export interface ConsumptionOptions { focusKey?: string; depth?: number; halfLifeDays?: number; }

/**
 * G-D403 — the stable Platform Consumption API. Downstream programs open a session over a set of
 * canonical Understandings and read views — context / traversal / evidence / reasoning / explainability
 * — never reaching into the graph. Read-only; owns nothing; mutates nothing.
 */
export interface PlatformSession {
  context(): CanonicalContext;                         // canonical downstream context
  traverse(fromKey: string, toKey: string): string[] | null;  // graph path (internals hidden)
  evidence(): EvidenceRef[];                           // fused canonical evidence
  reasoning(): CrossEntityInsight[];                   // full cross-entity insights (with traces)
  relationships(): RelationshipQuality[];              // derived relationship intelligence
  explain(): CrossEntityExplanation[];                 // explainability continuity (entities/path/evidence/trace/uncertainty)
}
