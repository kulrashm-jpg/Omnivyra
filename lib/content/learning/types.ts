/**
 * Wave 5 — Learning Engine & Performance Intelligence: shared types.
 *
 * DETERMINISTIC + EXPLAINABLE + COMPANY-SCOPED. These types describe the
 * durable learning layer introduced by
 * supabase/migrations/20260718000003_content_learning_performance.sql:
 *
 *  - PerformanceSignals    : the per-published-item metric bag (camelCase view
 *                            of content_performance).
 *  - LearningIntelligence  : one derived, persisted PATTERN (learning_intelligence
 *                            row) with an explainable effectiveness score.
 *  - LearningMemory        : the company rollup (learning_memory row) consumed
 *                            TOGETHER WITH Wave-2 brand memory at read time.
 *  - LearningDimension     : the closed set of dimensions the engine reasons over.
 *
 * NO ML / no opaque scoring. Every `score` is a normalization of the company's
 * OWN history (a percentile rank) that a human can reproduce by hand. Learning
 * is append-only relative to historical content — it NEVER mutates `content`.
 */

/** The closed set of learnable dimensions. Mirrors the migration comment. */
export type LearningDimension =
  | 'hook'
  | 'cta'
  | 'structure'
  | 'length'
  | 'hashtag'
  | 'emoji'
  | 'platform'
  | 'campaign';

/**
 * Per-published-item performance signals (camelCase view of a
 * `content_performance` row). Every field is optional — a freshly published
 * item may have no metrics yet (a "learning event" with a zero/placeholder row).
 */
export interface PerformanceSignals {
  impressions?: number;
  reach?: number;
  clicks?: number;
  engagement?: number;
  reactions?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  ctr?: number;
  watchTimeMs?: number;
  /** Extensible bag for future / platform-specific metrics. */
  metrics?: Record<string, unknown>;
}

/**
 * A single derived, persisted intelligence pattern (camelCase view of a
 * `learning_intelligence` row). `pattern` carries the structured, human-readable
 * EVIDENCE behind the score (method, sample, mean rate, examples) so every row
 * is auditable. `score` is a 0..1 company-history percentile — NOT a black box.
 */
export interface LearningIntelligence {
  dimension: LearningDimension;
  /** Canonical key within the dimension (e.g. the hook text, a length bucket). */
  patternKey: string;
  /** null = cross-platform aggregate; set only for the `platform` dimension. */
  platform?: string | null;
  /** The structured pattern + explainable evidence. */
  pattern: Record<string, unknown>;
  /** Effectiveness score in [0,1] — mean company-history percentile of members. */
  score: number;
  /** Number of published items that evidence this pattern. */
  sampleSize: number;
}

/**
 * The company-level learning rollup (camelCase view of the single
 * `learning_memory` row per company). Consumed alongside Wave-2 brand memory;
 * this layer NEVER alters brand_memory.
 */
export interface LearningMemory {
  /** Messaging (hooks / key messages) from top-percentile published content. */
  successfulMessaging: string[];
  /** Messaging from bottom-percentile published content (what to avoid). */
  unsuccessfulMessaging: string[];
  /** Winning narrative styles (ordered non-CTA structure) from top content. */
  narrativeStyles: string[];
  /** Winning structural shapes (block-type sequences) from top content. */
  winningStructures: string[];
  /** Per-platform mean percentile in [0,1] — effective platform adaptations. */
  platformAdaptations: Record<string, number>;
  /** Recurring audience-interest terms surfaced from top content. */
  audienceInterests: string[];
  /** Monotonic freshness / reproducibility counter (bumped per learning event). */
  modelVersion: number;
}
