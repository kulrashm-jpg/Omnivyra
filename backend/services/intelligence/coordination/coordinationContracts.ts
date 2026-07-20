/**
 * Coordination Intelligence Layer — canonical contracts (types + interfaces ONLY).
 *
 * OMNIVYRA-PMO-001 Zone A2 (Intelligence & Egress). This layer does NOT generate
 * content. Its sole responsibility is to let the specialized intelligences
 * (Writer, Campaigns, Creator, Engagement, Analytics, MarketPulse) COORDINATE —
 * to know what a company is already communicating, to whom, on which platform,
 * under which campaign, and whether a new communication repeats an existing
 * *intent* (semantically) rather than repeating *wording*.
 *
 * Boundary discipline:
 *  - This is the shared coordination seam. It is deliberately module-agnostic:
 *    it imports NOTHING from Writer / Generation Runtime / Brand / Prompt Assembly
 *    and defines its own DTOs so no consumer couples to another consumer.
 *  - It is DISTINCT from A1's Originality Engine (`content/originalityGate.ts` +
 *    `content_memory`), which dedups content *wording* at generation time. This
 *    layer dedups communication *intent* across modules — a higher altitude.
 *  - It CONSUMES frozen platform seams (the embedding seam, observability); it
 *    never re-implements them. See `semanticIntentComparator.ts`.
 *
 * TYPES + INTERFACES ONLY — no logic lives here.
 */
import type { AiError } from '../../ai/safety';
// ICR-1 (TD-13): the communication-intent vocabulary is now the ONE canonical
// platform type — consumed here (was defined locally), re-exported so existing
// importers of this barrel keep resolving. Value set is identical ⇒ no behavior
// change. Consume-only: do not re-define it locally.
import type { CommunicationIntent } from '../../../platform/intelligence';
export type { CommunicationIntent };

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Lifecycle of a communication as it moves through the egress path. */
export type PublicationStatus =
  | 'planned'    // intent registered, nothing produced yet
  | 'generated'  // content produced, not scheduled
  | 'scheduled'  // queued for a future publish slot
  | 'published'  // live
  | 'suppressed' // intentionally withheld (e.g. duplicate intent / moderation)
  | 'retired';   // superseded / archived

/** Which specialized intelligence owns/produced the communication. */
export type CoordinationSourceModule =
  | 'writer' | 'campaigns' | 'creator'
  | 'engagement' | 'analytics' | 'marketpulse' | 'unknown';

// ── Semantic lineage (OMNI-COORD-002) — artifact-node metadata (metadata only) ─

/**
 * The kind of marketing artifact a node represents along the derivation chain:
 * semantic_root → content_brief → post → visual_brief → image → image_text →
 * platform_adaptation → published_asset → engagement → analytics.
 */
export type ArtifactType =
  | 'semantic_root' | 'content_brief' | 'post' | 'visual_brief'
  | 'image' | 'image_text' | 'platform_adaptation' | 'published_asset'
  | 'engagement' | 'analytics';

/** Where an artifact sits in the origin → publication → measurement progression. */
export type GenerationStage =
  | 'origin' | 'brief' | 'draft' | 'visual' | 'render'
  | 'adaptation' | 'publication' | 'engagement' | 'measurement';

/**
 * Lineage metadata every artifact exposes (Phase 3). PURELY DESCRIPTIVE — it
 * records provenance (where an artifact came from) without prescribing behaviour.
 */
export interface SemanticLineage {
  semanticRootId: string;            // the origin every node ultimately derives from
  parentArtifactId?: string | null;  // direct predecessor in the chain
  artifactType: ArtifactType;
  derivedFrom?: string[];            // ids this artifact derives from (multi-source allowed)
  generationStage: GenerationStage;
}

// ── Value objects ────────────────────────────────────────────────────────────

/**
 * A *reference* to a semantic embedding — the layer stores a reference, not a
 * bespoke vector store. `vector` may be inlined (jsonb) or omitted in favour of
 * an external `ref` (e.g. a future pgvector row id). Never fabricated: a null
 * vector with no ref means "not embedded", which yields `not_evaluable`, not a
 * false claim of uniqueness.
 */
export interface SemanticEmbeddingRef {
  provider: string;          // e.g. 'text-embedding-3-small'
  dim: number;               // vector dimensionality
  vector: number[] | null;   // inline embedding (jsonb) — null when not computed
  ref?: string | null;       // optional handle into an external vector store
}

/** A soft (non-FK) reference to a produced artifact or a performance record. */
export interface CoordinationRef {
  kind: string;              // e.g. 'content' | 'signal' | 'metric'
  id: string;
}

/**
 * A registered communication — one row in the semantic coordination registry.
 * This is the shared coordination record every intelligence can read/write.
 */
export interface CommunicationRecord {
  id: string;
  companyId: string;                       // tenant boundary (RLS)
  semanticRootId: string;                  // stable grouping id for one intent seed
  communicationIntent: CommunicationIntent;
  topic: string;                           // the semantic seed (subject) — NOT the produced wording
  campaignId?: string | null;
  platform?: string | null;
  audience?: string | null;
  publicationStatus: PublicationStatus;
  embedding?: SemanticEmbeddingRef | null; // semantic embedding reference
  contentRef?: CoordinationRef | null;     // soft ref to produced content
  performanceRef?: CoordinationRef | null; // performance reference
  sourceModule: CoordinationSourceModule;
  observedAt: string;                      // ISO-8601
  metadata?: Record<string, unknown>;

  // ── Semantic lineage (OMNI-COORD-002, optional/additive) ──
  // When present, this record IS an artifact node in the communication graph.
  // Absent ⇒ a plain communication event (backward compatible).
  artifactType?: ArtifactType;
  parentArtifactId?: string | null;
  derivedFrom?: string[];
  generationStage?: GenerationStage;
}

/** What a producer supplies to register / check an intent (layer fills the rest). */
export interface RegisterCommunicationInput {
  companyId: string;
  communicationIntent: CommunicationIntent;
  topic: string;
  semanticRootId?: string;                 // supplied by producer, else derived deterministically
  campaignId?: string | null;
  platform?: string | null;
  audience?: string | null;
  publicationStatus?: PublicationStatus;   // defaults to 'planned'
  contentRef?: CoordinationRef | null;
  performanceRef?: CoordinationRef | null;
  sourceModule?: CoordinationSourceModule; // defaults to 'unknown'
  embedding?: SemanticEmbeddingRef | null; // caller may pre-compute; else the layer may (flag/seam)
  metadata?: Record<string, unknown>;
  correlationId?: string;

  // ── Semantic lineage (OMNI-COORD-002, optional/additive) ──
  artifactType?: ArtifactType;
  parentArtifactId?: string | null;
  derivedFrom?: string[];
  generationStage?: GenerationStage;
}

/** Narrowing filters for reads / candidate selection. */
export interface CoordinationQuery {
  campaignId?: string | null;
  platform?: string | null;
  audience?: string | null;
  communicationIntent?: CommunicationIntent;
  semanticRootId?: string;
  since?: string;                          // ISO-8601 lower bound on observedAt
  limit?: number;
}

// ── Duplicate-intent verdict (semantic, NOT wording) ─────────────────────────

export type DuplicateIntentDecision =
  | 'unique'          // no prior communication shares this intent
  | 'duplicate_intent'// a prior communication expresses the same intent
  | 'related'         // adjacent intent (below duplicate, above the related floor)
  | 'not_evaluable';  // cannot be assessed semantically (no embedding) — never fabricate uniqueness

/** How the verdict was reached — provenance, so callers can trust or degrade. */
export type DuplicateIntentBasis =
  | 'root_id'    // deterministic: shares a semanticRootId
  | 'embedding'  // semantic: embedding cosine over topic seeds
  | 'none';      // trivially unique (no priors) or not evaluable

export interface DuplicateIntentVerdict {
  decision: DuplicateIntentDecision;
  basis: DuplicateIntentBasis;
  maxSimilarity: number | null;            // 0..1 cosine; null when not evaluable
  matchedRecordId?: string | null;
  matchedRootId?: string | null;
  matchedIntent?: CommunicationIntent | null;
  candidatesConsidered: number;
  note?: string;
}

// ── Result substrate (repo convention: typed union, never throw across boundary) ─

export type CoordinationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AiError };

// ── Reusable service interfaces (consumers depend ONLY on these) ─────────────

/**
 * The canonical coordination surface. Every intelligence module depends only on
 * this interface — never on a concrete implementation, a store, or another
 * module. Additive and fail-safe: a failure returns a typed error, never throws
 * into a consumer's critical path.
 */
export interface CommunicationRegistry {
  /** Record a communication intent. Derives the semantic root + embedding as needed. */
  register(input: RegisterCommunicationInput): Promise<CoordinationResult<CommunicationRecord>>;
  /** Read prior communications for a company (optionally narrowed). */
  lookup(companyId: string, query?: CoordinationQuery): Promise<CoordinationResult<CommunicationRecord[]>>;
  /** Assess whether an intent duplicates a prior one — semantic, non-persisting. */
  checkDuplicateIntent(input: RegisterCommunicationInput): Promise<CoordinationResult<DuplicateIntentVerdict>>;
  /** Advance the lifecycle of a registered communication. */
  markStatus(companyId: string, id: string, status: PublicationStatus): Promise<CoordinationResult<void>>;
}

/**
 * Storage PORT — the registry is decoupled from persistence. Swap the in-memory
 * default for a Supabase-backed store (or a future PIP SignalService adapter)
 * without touching the registry. This is why "no duplicate storage" holds: the
 * registry owns no table directly; it owns a port.
 */
export interface CoordinationStore {
  insert(record: CommunicationRecord): Promise<CommunicationRecord>;
  findByRoot(companyId: string, semanticRootId: string): Promise<CommunicationRecord[]>;
  query(companyId: string, query: CoordinationQuery): Promise<CommunicationRecord[]>;
  markStatus(companyId: string, id: string, status: PublicationStatus): Promise<void>;
}

/**
 * Semantic comparator PORT — the registry never calls an embedding provider
 * directly; it depends on this port so the embedding backend (the frozen seam,
 * or a stub in tests) is injectable.
 */
export interface SemanticIntentComparator {
  /** Return a topic embedding, or null when embedding is disabled/unavailable (fail-open). */
  embed(text: string, companyId: string): Promise<number[] | null>;
  /** Cosine similarity in [-1, 1]. */
  similarity(a: number[], b: number[]): number;
}
