/**
 * Semantic Continuity Contracts (OMNIVYRA OMNI-COORD-002, Zone A2).
 *
 * Extends the Coordination Foundation into a Semantic Continuity Engine —
 * CONTRACTS + METADATA ONLY. No content generation, no AI evaluation, no module
 * integration. This file defines the canonical vocabulary the whole platform
 * will derive from:
 *
 *   Phase 1  SemanticRoot          — the origin of communication (not content)
 *   Phase 4  Semantic continuity   — "does this artifact still represent the root?"
 *   Phase 6  Communication graph    — nodes + edges (metadata; no graph DB)
 *   Phase 7  Semantic drift         — origin → published-asset drift (interface only)
 *
 * Lineage primitives (ArtifactType / GenerationStage / SemanticLineage) live in
 * `coordinationContracts.ts`; this module builds the higher-level model on them.
 * Every evaluator here is an INTERFACE; the shipped implementations are inert
 * (always NOT_EVALUABLE) — exactly like the PIP Null adapters. No AI is wired.
 */
import type {
  ArtifactType,
  CommunicationIntent,
  CommunicationRecord,
  CoordinationRef,
  CoordinationResult,
} from './coordinationContracts';

// ── Phase 1 — Semantic Root (the origin of communication) ────────────────────

/**
 * The origin every marketing artifact derives from. It is NOT content, NOT a
 * prompt, NOT a post — it is the intent-defining spec. Everything downstream
 * (brief → post → visual → image → adaptation → published → engagement →
 * analytics) traces back to exactly one SemanticRoot.
 */
export interface SemanticRoot {
  id: string;                          // stable; = deriveSemanticRootId(...) unless supplied
  companyId: string;                   // tenant boundary
  businessObjective: string;           // the durable business goal this serves
  campaignObjective?: string | null;   // optional campaign framing
  topic: string;                       // the subject seed
  communicationIntent: CommunicationIntent;
  targetAudience: string;              // who it addresses
  positioning: string;                 // the stance / angle / value framing
  createdAt: string;                   // ISO-8601
  metadata?: Record<string, unknown>;
}

/** What a producer supplies to register a Semantic Root (id derived if omitted). */
export interface RegisterSemanticRootInput {
  companyId: string;
  businessObjective: string;
  topic: string;
  communicationIntent: CommunicationIntent;
  targetAudience: string;
  positioning: string;
  campaignObjective?: string | null;
  id?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Semantic Root registry — canonical origin store. Reusable across all modules;
 * couples to none. Register once, derive everything else from `root.id`.
 */
export interface SemanticRootRegistry {
  register(input: RegisterSemanticRootInput): Promise<CoordinationResult<SemanticRoot>>;
  get(companyId: string, id: string): Promise<CoordinationResult<SemanticRoot | null>>;
  list(companyId: string): Promise<CoordinationResult<SemanticRoot[]>>;
}

/** Storage port for Semantic Roots (swap in-memory / supabase / future PIP). */
export interface SemanticRootStore {
  upsert(root: SemanticRoot): Promise<SemanticRoot>;
  get(companyId: string, id: string): Promise<SemanticRoot | null>;
  list(companyId: string): Promise<SemanticRoot[]>;
}

// ── Phase 6 — Communication Graph (nodes + edges; metadata only) ─────────────

/** Coarse node classification for the evolving communication graph. */
export type GraphNodeKind =
  | 'semantic_root' | 'content' | 'visual' | 'campaign' | 'engagement' | 'analytics';

/** The relationship an edge encodes. */
export type GraphEdgeKind =
  | 'derives_from'   // child → predecessor (or → root)
  | 'belongs_to'     // artifact → its semantic root / campaign
  | 'adapts'         // platform adaptation → source artifact
  | 'responds_to'    // engagement → the asset it answers
  | 'measures';      // analytics → the artifact it measures

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  artifactType?: ArtifactType;
  semanticRootId: string;
  label?: string;
  ref?: CoordinationRef | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
}

/** A projection (not a persisted graph, not a graph DB) over registry metadata. */
export interface CommunicationGraph {
  companyId: string;
  semanticRootId?: string;   // present when the graph is scoped to one root
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Phase 4 — Semantic Continuity Validation (contract only) ─────────────────

/** Does an artifact still represent its Semantic Root? */
export type SemanticContinuityDecision =
  | 'ALIGNED'        // faithfully represents the root
  | 'DRIFTED'        // has moved away, not contradictory
  | 'CONFLICTING'    // contradicts the root
  | 'NOT_EVALUABLE'; // cannot be assessed (no evaluator / insufficient signal)

/** How a continuity verdict was reached — provenance so callers can trust or degrade. */
export type ContinuityBasis = 'none' | 'deterministic' | 'semantic';

export interface SemanticContinuityVerdict {
  decision: SemanticContinuityDecision;
  semanticRootId: string;
  artifactId: string;
  score?: number | null;     // 0..1 alignment; null when not evaluated
  basis: ContinuityBasis;
  rationale?: string;
}

/**
 * The evaluator CONTRACT. No AI implementation exists yet by design — the
 * shipped `inertContinuityEvaluator` always returns NOT_EVALUABLE. A future wave
 * injects a real evaluator behind this same interface.
 */
export interface SemanticContinuityEvaluator {
  evaluate(input: { root: SemanticRoot; artifact: CommunicationRecord }): Promise<SemanticContinuityVerdict>;
}

// ── Phase 7 — Semantic Drift (origin → published asset; contract only) ───────

export type SemanticDriftSeverity =
  | 'none' | 'minor' | 'major' | 'breaking' | 'not_evaluable';

export interface SemanticDriftDimension { dimension: string; drift: number }

export interface SemanticDriftAssessment {
  severity: SemanticDriftSeverity;
  semanticRootId: string;
  fromArtifactId: string;    // typically the semantic root
  toArtifactId: string;      // typically the final published asset
  drift?: number | null;     // 0..1 aggregate; null when not evaluated
  dimensions?: SemanticDriftDimension[];
  basis: ContinuityBasis;
  note?: string;
}

/**
 * The drift-evaluator CONTRACT. No implementation yet — `inertDriftEvaluator`
 * returns `not_evaluable`. Designed to assess drift between the Semantic Root and
 * the final published asset, optionally using the intervening lineage.
 */
export interface SemanticDriftEvaluator {
  assess(input: {
    root: SemanticRoot;
    published: CommunicationRecord;
    lineage?: CommunicationRecord[];
  }): Promise<SemanticDriftAssessment>;
}

// ── Inert evaluators (no AI) — the safe defaults, contract-proving stubs ──────

/** Always NOT_EVALUABLE — proves the contract compiles; wires no AI. */
export const inertContinuityEvaluator: SemanticContinuityEvaluator = {
  async evaluate({ root, artifact }) {
    return {
      decision: 'NOT_EVALUABLE',
      semanticRootId: root.id,
      artifactId: artifact.id,
      score: null,
      basis: 'none',
      rationale: 'no continuity evaluator wired (contract-only, OMNI-COORD-002)',
    };
  },
};

/** Always not_evaluable — the drift-contract stub; wires no AI. */
export const inertDriftEvaluator: SemanticDriftEvaluator = {
  async assess({ root, published }) {
    return {
      severity: 'not_evaluable',
      semanticRootId: root.id,
      fromArtifactId: root.id,
      toArtifactId: published.id,
      drift: null,
      basis: 'none',
      note: 'no drift evaluator wired (contract-only, OMNI-COORD-002)',
    };
  },
};
