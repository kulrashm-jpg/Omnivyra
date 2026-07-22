/**
 * Wave 2 — Content Intelligence: Originality primitives (shared types).
 *
 * Pure, deterministic, DB-free contracts shared by the fingerprint and
 * similarity primitives. No runtime logic lives here — only the data shapes
 * that flow between `fingerprint.ts`, `similarity.ts`, and (later waves) the
 * originality memory / decision layers.
 */

/**
 * A fully-deterministic multi-signal fingerprint of a single piece of content.
 * Every field is derived purely from the input text (no clocks, no randomness),
 * so the same input always produces byte-identical output.
 */
export interface ContentFingerprint {
  /** sha256 hex of the raw, untouched input. Exact-duplicate detector. */
  exactHash: string;
  /** sha256 hex of the normalized input. Near-exact (whitespace/case/punct) detector. */
  normalizedHash: string;
  /** 64-bit SimHash of the token shingles, rendered as a 16-char hex string. */
  simhash: string;
  /** k-permutation MinHash signature (k=64) over word shingles. */
  minhash: number[];
  /** Compact structural signature (sentence/line/length buckets). */
  structuralShape: string;
  /** Token-level summary used by the token/shingle Jaccard comparators. */
  tokenSummary: {
    /** Unique normalized words, in first-seen order. */
    tokens: string[];
    /** 3-word shingles of the normalized token stream, in order. */
    shingles: string[];
  };
}

/**
 * The comparison axes an originality check can run along. Not every dimension
 * is populated by every check — `semantic`/`embedding`/`variant` are reserved
 * for later waves that add model-backed signals.
 */
export type SimilarityDimension =
  | 'exact'
  | 'normalized'
  | 'structural'
  | 'semantic'
  | 'embedding'
  | 'variant';

/**
 * The terminal disposition of an originality check.
 */
export type OriginalityDecision =
  | 'accepted'
  | 'duplicate'
  | 'regenerated'
  | 'bypassed'
  | 'error';

/**
 * A single close match surfaced by an originality check.
 */
export interface NearestMatch {
  /** Identifier of the remembered content this candidate matched against. */
  memoryId: string;
  /** Match strength on `dimension`, 0..1 (1 = identical). */
  score: number;
  /** Which axis produced this score. */
  dimension: SimilarityDimension;
  /** A short human-readable excerpt of the matched memory. */
  excerpt: string;
}

/**
 * The full result of an originality check for one candidate.
 */
export interface OriginalityResult {
  /** Convenience verdict derived from `score`/`decision`. */
  isOriginal: boolean;
  /** Aggregate originality score, 0..1 (1 = fully original). */
  score: number;
  /** Terminal disposition. */
  decision: OriginalityDecision;
  /** The closest remembered matches, strongest first. */
  nearestMatches: NearestMatch[];
  /** Per-dimension similarity scores that fed the aggregate. */
  dimensions: Partial<Record<SimilarityDimension, number>>;
  /** The fingerprint computed for the candidate. */
  fingerprint: ContentFingerprint;
}
