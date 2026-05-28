/**
 * semanticGroundingEngine.ts
 *
 * Phase 5.2 — In-process semantic grounding.
 *
 * The grounded-claim validator from Phase 4 uses token-overlap matching.
 * That misses paraphrased evidence, semantic equivalence, indirect
 * support, and concept-level matches.
 *
 * Per spec — NO external vector DB, NO distributed retrieval, NO
 * sentence-transformer model dependency. Instead this module implements
 * a deterministic pseudo-embedding using:
 *
 *   1. Character-trigram + word-bigram feature hashing  → dense feature
 *      vector. Captures spelling variation and short-phrase similarity
 *      that token Jaccard misses.
 *   2. Length-normalized term frequency               → relative weight
 *      across short and long fragments.
 *   3. Cosine similarity on the hashed vectors        → grounding strength.
 *   4. Lightweight contradiction detection            → token-pair antonyms
 *      + numeric divergence (e.g., "increased" vs "decreased", "47%"
 *      vs "12%").
 *
 * The interface is deliberately compatible with future drop-in
 * replacement by a real embedding service: the unit of work is
 * `encodeFragment()` and the matcher operates on `EncodedFragment[]`,
 * which a future implementation can swap to vector embeddings without
 * changing call sites.
 *
 * Local embedding cache: feature vectors are cached in-process by
 * fragment text hash. A future LRU layer can replace the simple Map.
 */

import type {
  KnowledgeSource,
  KnowledgeSourceFragment,
  RetrievalGroundingProfile,
} from './longFormRecommendationTypes';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EncodedFragment {
  fragmentId: string;
  sourceId?: string;
  text: string;
  /**
   * Sparse feature vector — Map<featureHash, weight>. Compatible with
   * future dense embeddings (just replace builder + cosine).
   */
  vector: Map<number, number>;
  /** L2 norm precomputed for cosine. */
  norm: number;
  /** Numeric tokens (for contradiction detection). */
  numericTokens: number[];
  /** Polarity tokens (for contradiction detection). */
  polarityTokens: string[];
}

export interface FragmentMatch {
  fragment: EncodedFragment;
  similarity: number;       // 0..1 cosine
  matchKind: 'strong' | 'moderate' | 'weak';
  numericDivergence: boolean;
  polarityConflict: boolean;
}

export interface SemanticGroundingResult {
  groundingStrength: number;          // 0..100 — composite for this claim
  matchedFragments: FragmentMatch[];   // ranked desc by similarity
  contradictoryFragments: FragmentMatch[];
  unsupportedClaims: string[];         // empty for single-claim API; populated by aggregateClaims
  semanticCoverage: number;            // 0..100 — % of claim tokens covered by best match
}

export interface SemanticClaimMatchInput {
  claimText: string;
  fragments: readonly EncodedFragment[];
  /** Optional cap on returned matches. Default 5. */
  topK?: number;
  /** Strong/moderate/weak thresholds (0..1). Defaults: 0.45 / 0.25 / 0.12. */
  thresholds?: { strong?: number; moderate?: number; weak?: number };
}

// ── Constants ────────────────────────────────────────────────────────────────

const FEATURE_HASH_MOD = 32_768;
const DEFAULT_THRESHOLDS = { strong: 0.45, moderate: 0.25, weak: 0.12 };

const STOPWORDS = new Set<string>([
  'the','a','an','and','or','but','if','then','of','to','in','on','for','with','by','at','from','as',
  'is','are','was','were','be','been','being','it','its','this','that','these','those','i','you','he','she',
  'we','they','them','his','her','our','their','my','your','what','which','who','how','why','when','where',
  'can','will','would','could','should','may','might','must','do','does','did','have','has','had','not',
  'no','yes','so','than','also','such','very','more','most','some','any','all','one','two','three',
]);

// Polarity tokens that flag potential contradictions when one fragment uses
// them and the matched claim uses an antonym.
const POLARITY_PAIRS: Array<[string, string]> = [
  ['increase', 'decrease'],
  ['increases', 'decreases'],
  ['increasing', 'decreasing'],
  ['grew', 'shrank'],
  ['rose', 'fell'],
  ['gained', 'lost'],
  ['faster', 'slower'],
  ['cheaper', 'expensive'],
  ['more', 'less'],
  ['higher', 'lower'],
  ['accelerated', 'slowed'],
  ['expanded', 'contracted'],
  ['improved', 'worsened'],
  ['adopted', 'rejected'],
  ['ascending', 'descending'],
  ['always', 'never'],
];
const POLARITY_FORWARD = new Map(POLARITY_PAIRS);
const POLARITY_REVERSE = new Map(POLARITY_PAIRS.map(([a, b]) => [b, a] as [string, string]));

// ── Hash helpers ─────────────────────────────────────────────────────────────

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h % FEATURE_HASH_MOD);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function charTrigrams(token: string): string[] {
  if (token.length < 3) return [`#${token}#`];
  const out: string[] = [];
  const padded = `#${token}#`;
  for (let i = 0; i <= padded.length - 3; i += 1) out.push(padded.slice(i, i + 3));
  return out;
}

function wordBigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) out.push(`${tokens[i]}|${tokens[i + 1]}`);
  return out;
}

function extractNumerics(text: string): number[] {
  const out: number[] = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function extractPolarityTokens(tokens: string[]): string[] {
  return tokens.filter((t) => POLARITY_FORWARD.has(t) || POLARITY_REVERSE.has(t));
}

// ── Encoder ──────────────────────────────────────────────────────────────────

/**
 * Build a sparse feature vector from text using char-trigram + word-bigram
 * + word-unigram features. Length-normalized.
 *
 * The result is deterministic across runs — same input always produces
 * the same vector. This makes the engine cache-friendly and test-friendly.
 */
function buildFeatureVector(text: string): { vector: Map<number, number>; norm: number; tokens: string[] } {
  const tokens = tokenize(text);
  const features: Array<[number, number]> = [];

  // Char-trigram features per token (weight: 1.0).
  for (const t of tokens) {
    for (const tri of charTrigrams(t)) features.push([djb2(`tri:${tri}`), 1.0]);
  }
  // Word-unigram features (weight: 1.5 — higher than trigram noise).
  for (const t of tokens) features.push([djb2(`uni:${t}`), 1.5]);
  // Word-bigram features (weight: 2.0 — strongest signal for phrase match).
  for (const bg of wordBigrams(tokens)) features.push([djb2(`big:${bg}`), 2.0]);

  // Accumulate into sparse vector.
  const vector = new Map<number, number>();
  for (const [h, w] of features) {
    vector.set(h, (vector.get(h) ?? 0) + w);
  }
  // L2 normalize.
  let sumSq = 0;
  for (const [, v] of vector) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  for (const [k, v] of vector) vector.set(k, v / norm);

  return { vector, norm: 1, tokens }; // pre-normalized so norm is 1
}

// ── Cache ───────────────────────────────────────────────────────────────────

const encodeCache = new Map<string, EncodedFragment>();

function cacheKey(text: string, fragmentId?: string): string {
  // Stable key — text content drives caching; fragmentId only for identity
  // preservation on retrieval.
  return `${fragmentId ?? ''}::${djb2(text)}::${text.length}`;
}

/** Encode a fragment (or claim) into an EncodedFragment. Cached. */
export function encodeFragment(input: {
  text: string;
  fragmentId?: string;
  sourceId?: string;
}): EncodedFragment {
  const key = cacheKey(input.text, input.fragmentId);
  const hit = encodeCache.get(key);
  if (hit) return hit;
  const { vector } = buildFeatureVector(input.text);
  const numericTokens = extractNumerics(input.text);
  const polarityTokens = extractPolarityTokens(tokenize(input.text));
  const out: EncodedFragment = {
    fragmentId: input.fragmentId ?? `enc_${djb2(input.text)}`,
    sourceId: input.sourceId,
    text: input.text,
    vector,
    norm: 1,
    numericTokens,
    polarityTokens,
  };
  encodeCache.set(key, out);
  return out;
}

/**
 * Bulk-encode a RetrievalGroundingProfile into EncodedFragment[]. Reuses
 * the cache.
 */
export function encodeGroundingProfile(profile: RetrievalGroundingProfile): EncodedFragment[] {
  const out: EncodedFragment[] = [];
  for (const source of profile.approvedSources) {
    for (const frag of source.contentFragments) {
      out.push(encodeFragment({
        text: frag.text,
        fragmentId: frag.fragmentId,
        sourceId: source.sourceId,
      }));
    }
  }
  return out;
}

// ── Similarity ───────────────────────────────────────────────────────────────

function cosine(a: EncodedFragment, b: EncodedFragment): number {
  // Both vectors are L2-normalized, so cosine = dot product.
  let dot = 0;
  const small = a.vector.size <= b.vector.size ? a.vector : b.vector;
  const other = small === a.vector ? b.vector : a.vector;
  for (const [k, v] of small) {
    const o = other.get(k);
    if (o !== undefined) dot += v * o;
  }
  // Cosine in [0, 1] for our non-negative feature space.
  if (dot < 0) return 0;
  if (dot > 1) return 1;
  return dot;
}

function detectNumericDivergence(claim: EncodedFragment, frag: EncodedFragment): boolean {
  if (claim.numericTokens.length === 0 || frag.numericTokens.length === 0) return false;
  // Pair the largest claim numeric with the largest fragment numeric. If
  // they differ by >= 20% of the larger, treat as divergent.
  const c = Math.max(...claim.numericTokens);
  const f = Math.max(...frag.numericTokens);
  if (c === f) return false;
  const max = Math.max(Math.abs(c), Math.abs(f));
  if (max < 1) return false;
  return Math.abs(c - f) / max >= 0.20;
}

function detectPolarityConflict(claim: EncodedFragment, frag: EncodedFragment): boolean {
  for (const ct of claim.polarityTokens) {
    const antonym = POLARITY_FORWARD.get(ct) ?? POLARITY_REVERSE.get(ct);
    if (antonym && frag.polarityTokens.includes(antonym)) return true;
  }
  return false;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function matchClaimToGroundingFragments(input: SemanticClaimMatchInput): FragmentMatch[] {
  const t = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const claimEnc = encodeFragment({ text: input.claimText });
  const matches: FragmentMatch[] = [];
  for (const frag of input.fragments) {
    const sim = cosine(claimEnc, frag);
    if (sim < t.weak) continue;
    matches.push({
      fragment: frag,
      similarity: Number(sim.toFixed(4)),
      matchKind: sim >= t.strong ? 'strong' : sim >= t.moderate ? 'moderate' : 'weak',
      numericDivergence: detectNumericDivergence(claimEnc, frag),
      polarityConflict: detectPolarityConflict(claimEnc, frag),
    });
  }
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, input.topK ?? 5);
}

export function rankSupportingEvidence(input: SemanticClaimMatchInput): FragmentMatch[] {
  // Filter out contradictory matches before ranking.
  return matchClaimToGroundingFragments(input).filter(
    (m) => !m.numericDivergence && !m.polarityConflict,
  );
}

export function detectSemanticSupport(input: SemanticClaimMatchInput): boolean {
  return rankSupportingEvidence(input).some((m) => m.matchKind === 'strong' || m.matchKind === 'moderate');
}

export function detectContradictoryEvidence(input: SemanticClaimMatchInput): FragmentMatch[] {
  return matchClaimToGroundingFragments(input).filter(
    (m) => m.numericDivergence || m.polarityConflict,
  );
}

/** 0..100 composite grounding strength for a single claim. */
export function computeGroundingStrength(input: SemanticClaimMatchInput): number {
  const matches = rankSupportingEvidence(input);
  if (matches.length === 0) return 0;
  const top = matches[0];
  const second = matches[1];
  // Base: strongest match scaled to 100.
  let score = top.similarity * 100;
  // Reinforcement: if 2+ moderate matches, bump by up to +15.
  if (second && second.matchKind !== 'weak') score = Math.min(100, score + 15 * second.similarity);
  // Strong match bonus.
  if (top.matchKind === 'strong') score = Math.min(100, score + 5);
  return Math.round(score);
}

// ── Article-level aggregator ─────────────────────────────────────────────────

export interface AggregateSemanticGroundingInput {
  /** One entry per claim. */
  claims: Array<{ claimId: string; claimText: string; isHighRisk?: boolean }>;
  fragments: readonly EncodedFragment[];
  thresholds?: SemanticClaimMatchInput['thresholds'];
}

export interface AggregateSemanticGroundingResult {
  perClaim: Array<{
    claimId: string;
    claimText: string;
    groundingStrength: number;
    matchedFragments: FragmentMatch[];
    contradictoryFragments: FragmentMatch[];
    isHighRisk: boolean;
  }>;
  groundingStrength: number;       // 0..100 average over high-risk claims
  semanticCoverage: number;        // 0..100 — % of high-risk claims with ≥moderate support
  unsupportedClaims: string[];
  contradictoryFragments: FragmentMatch[];
}

export function aggregateSemanticGrounding(input: AggregateSemanticGroundingInput): AggregateSemanticGroundingResult {
  const perClaim: AggregateSemanticGroundingResult['perClaim'] = [];
  let strongOrModerate = 0;
  let highRiskCount = 0;
  let strengthSum = 0;
  const unsupported: string[] = [];
  const contradictions: FragmentMatch[] = [];

  for (const claim of input.claims) {
    const matches = matchClaimToGroundingFragments({
      claimText: claim.claimText,
      fragments: input.fragments,
      thresholds: input.thresholds,
    });
    const supporting = matches.filter((m) => !m.numericDivergence && !m.polarityConflict);
    const opposing = matches.filter((m) => m.numericDivergence || m.polarityConflict);
    const strength = computeGroundingStrength({
      claimText: claim.claimText,
      fragments: input.fragments,
      thresholds: input.thresholds,
    });
    const isHighRisk = claim.isHighRisk ?? false;

    perClaim.push({
      claimId: claim.claimId,
      claimText: claim.claimText,
      groundingStrength: strength,
      matchedFragments: supporting,
      contradictoryFragments: opposing,
      isHighRisk,
    });

    contradictions.push(...opposing);

    if (isHighRisk) {
      highRiskCount += 1;
      strengthSum += strength;
      const top = supporting[0];
      if (top && (top.matchKind === 'strong' || top.matchKind === 'moderate')) {
        strongOrModerate += 1;
      } else {
        unsupported.push(claim.claimText);
      }
    }
  }

  return {
    perClaim,
    groundingStrength: highRiskCount === 0 ? 0 : Math.round(strengthSum / highRiskCount),
    semanticCoverage: highRiskCount === 0 ? 0 : Math.round((strongOrModerate / highRiskCount) * 100),
    unsupportedClaims: unsupported,
    contradictoryFragments: contradictions,
  };
}

// Test-only helper.
export function __resetSemanticEncodeCacheForTests(): void {
  encodeCache.clear();
}
