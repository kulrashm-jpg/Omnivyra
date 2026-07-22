/**
 * Wave 4 — Deterministic Quality Engine: shared contracts.
 *
 * PURE, DB-free, AI-free data shapes for the deterministic content quality
 * scorecard, the section-block model, and the recommendation record. No runtime
 * logic lives here — only the types that flow between `sectionBlocks.ts`, the
 * `qualityEngine`, and (later waves) the recommendation / rewrite layers.
 *
 * Every consumer of these types is deterministic: given the same input, the same
 * scorecard is produced. Timestamps (`evaluatedAt`) are the ONLY non-pure field
 * and are always supplied by the caller — never generated inside scoring.
 */

/**
 * The twelve axes the deterministic quality engine scores. Every scorecard
 * carries a `DimensionScore` for ALL twelve — none are optional at runtime.
 */
export type QualityDimension =
  | 'objectiveAlignment'
  | 'brandVoice'
  | 'originality'
  | 'platformFit'
  | 'readability'
  | 'hook'
  | 'cta'
  | 'seo'
  | 'trust'
  | 'clarity'
  | 'grammar'
  | 'structure';

/** The ordered, canonical list of every quality dimension (single source of truth). */
export const QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  'objectiveAlignment',
  'brandVoice',
  'originality',
  'platformFit',
  'readability',
  'hook',
  'cta',
  'seo',
  'trust',
  'clarity',
  'grammar',
  'structure',
] as const;

/** Coarse quality band derived deterministically from a 0..100 score. */
export type QualityLabel = 'poor' | 'fair' | 'good' | 'excellent';

/**
 * A single dimension's verdict.
 * `score` is clamped 0..100; `label` is the band; `signals` are the concrete,
 * human-readable observations that produced the score (empty is allowed).
 */
export interface DimensionScore {
  /** 0..100, higher is better. */
  score: number;
  /** Coarse band derived from `score`. */
  label: QualityLabel;
  /** Deterministic, human-readable observations behind the score. */
  signals: string[];
}

/**
 * The full deterministic scorecard for one piece of content.
 * `dimensions` always contains an entry for every `QualityDimension`.
 */
export interface QualityScorecard {
  /** Weighted mean of the dimension scores, 0..100. */
  overall: number;
  /** Per-dimension verdicts, one for every `QualityDimension`. */
  dimensions: Record<QualityDimension, DimensionScore>;
  /**
   * ISO timestamp of when the caller ran the evaluation. Supplied by the
   * caller — NEVER generated inside the engine (determinism). Optional.
   */
  evaluatedAt?: string;
}

/** The structural role of a content block within a piece. */
export type ContentBlockType = 'hook' | 'opening' | 'body' | 'cta' | 'hashtags' | 'other';

/**
 * A single addressable block of content. `position` is a 0-based ordering index;
 * `locked` marks a block the user has pinned against automated rewrites.
 */
export interface ContentBlock {
  /** Stable identifier when persisted; optional for freshly-split blocks. */
  id?: string;
  /** Structural role of this block. */
  blockType: ContentBlockType;
  /** 0-based ordering index within the piece. */
  position: number;
  /** The block's own text (no surrounding block separators). */
  text: string;
  /** True when the block is pinned against automated rewrites. */
  locked: boolean;
}

/**
 * A single deterministic improvement suggestion. `before`/`after` are the exact
 * text spans so the change is auditable and reversible; `confidence` is 0..1.
 */
export interface Recommendation {
  /** Stable identifier when persisted; optional for freshly-derived recs. */
  id?: string;
  /** Coarse grouping (e.g. a `QualityDimension` name or a rule family). */
  category: string;
  /** Why this change is suggested. */
  reason: string;
  /** The improvement expected if accepted. */
  expectedImpact: string;
  /** 0..1 confidence in the suggestion. */
  confidence: number;
  /** Which structural section the change applies to. */
  affectedSection: ContentBlockType;
  /** The specific block targeted, when known. */
  blockId?: string | null;
  /** Exact text before the change. */
  before: string;
  /** Exact text after the change. */
  after: string;
  /** Lifecycle state of the recommendation. */
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
}
