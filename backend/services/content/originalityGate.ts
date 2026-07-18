/**
 * Originality Gate — Wave 2. THE single seam that decides whether a freshly
 * generated piece of content is original relative to the company's remembered
 * content, or a (near-)duplicate that should be regenerated.
 *
 * Pipeline (least → most expensive), EARLY-TERMINATING on the first stage that
 * confidently matches a remembered unit:
 *
 *   1. exact hash        — byte-identical to a prior unit.
 *   2. normalized hash   — identical after case/whitespace/punct folding.
 *   3. simhash near-dup  — Hamming-close 64-bit signatures.
 *   4. semantic Jaccard  — minhash / token / shingle overlap.
 *   5. structural        — same structural shape AND non-trivial semantic overlap.
 *   6. embedding cosine  — ONLY when options.embeddingEnabled && options.embed
 *                          are supplied (flag OFF by default; no external calls).
 *   7. platform variant  — when a platform is set, compare against sibling
 *                          variants on the same platform.
 *
 * Scoring: score = 1 - maxSimilarity, isOriginal = score >= threshold (0.82).
 * decision = 'duplicate' when a stage crosses its confidence cutoff, else
 * 'accepted'. The aggregate deliberately IGNORES the ~0.5 chance baseline of
 * SimHash on unrelated text (and sub-cutoff embedding), so genuinely distinct
 * content scores near 1.
 *
 * FAIL-OPEN: the entire pipeline is wrapped in try/catch. On ANY error it
 * returns a 'bypassed' result (isOriginal: true) so originality checking can
 * NEVER throw into, or block, content generation.
 */

import { computeFingerprint } from '../../../lib/content/originality/fingerprint';
import {
  exactEqual,
  normalizedEqual,
  simhashSimilarity,
  minhashJaccard,
  tokenSimilarity,
  shingleSimilarity,
  structuralSimilarity,
  cosine,
} from '../../../lib/content/originality/similarity';
import type {
  ContentFingerprint,
  NearestMatch,
  OriginalityResult,
  SimilarityDimension,
} from '../../../lib/content/originality/types';
import { retrieveRelevant, type ContentMemoryRecord } from './contentMemoryService';

// ── tuning constants ─────────────────────────────────────────────────────────

/** Aggregate originality threshold: score >= this ⇒ isOriginal. */
export const DEFAULT_ORIGINALITY_THRESHOLD = 0.82;
/** Default number of candidate memories retrieved for comparison. */
export const DEFAULT_MAX_CANDIDATES = 50;

/** Per-stage confident-duplicate cutoffs. */
const SIMHASH_CUTOFF = 0.9;
const SEMANTIC_CUTOFF = 0.82;
const EMBEDDING_CUTOFF = 0.92;
const VARIANT_CUTOFF = 0.85;
/** Structural shape only counts as a duplicate when semantic overlap backs it. */
const STRUCTURAL_SEMANTIC_FLOOR = 0.6;

// ── inputs ───────────────────────────────────────────────────────────────────

export interface OriginalityOptions {
  /** Aggregate originality threshold (default 0.82). */
  threshold?: number;
  /** Max candidate memories to compare against (default 50). */
  maxCandidates?: number;
  /** Enable the embedding-cosine stage. OFF by default. */
  embeddingEnabled?: boolean;
  /** Injected embedder; required for the embedding stage. No stage runs without it. */
  embed?: (text: string) => Promise<number[] | null>;
}

export interface AssertOriginalityInput {
  companyId: string;
  contentType: string;
  platform?: string | null;
  campaignId?: string | null;
  candidateText: string;
  options?: OriginalityOptions;
}

// ── stage math ───────────────────────────────────────────────────────────────

/** The semantic axis: the strongest of minhash / token / shingle Jaccard. */
function semanticScore(fp: ContentFingerprint, rec: ContentMemoryRecord): number {
  return Math.max(
    minhashJaccard(fp.minhash, rec.minhash),
    tokenSimilarity(fp.tokenSummary.tokens, rec.tokenSummary.tokens),
    shingleSimilarity(fp.tokenSummary.shingles, rec.tokenSummary.shingles),
  );
}

function excerptOf(rec: ContentMemoryRecord): string {
  return rec.textExcerpt ?? '';
}

/** An empty fingerprint for the (near-impossible) case computeFingerprint throws. */
function emptyFingerprint(): ContentFingerprint {
  return {
    exactHash: '',
    normalizedHash: '',
    simhash: '0'.repeat(16),
    minhash: [],
    structuralShape: '',
    tokenSummary: { tokens: [], shingles: [] },
  };
}

interface StageDef {
  dim: SimilarityDimension;
  /** Similarity of the candidate vs one remembered record, 0..1. */
  score: (fp: ContentFingerprint, rec: ContentMemoryRecord) => number;
  /** The record set this stage compares against (defaults to all candidates). */
  eligible?: (rec: ContentMemoryRecord) => boolean;
  /** Confident-duplicate check for the stage's best score. `sem` = best semantic so far. */
  confident: (best: number, sem: number) => boolean;
  /** Effective contribution to the aggregate (drops chance-baseline noise). */
  effective: (best: number, sem: number) => number;
}

// ── the gate ─────────────────────────────────────────────────────────────────

/**
 * Decide whether `candidateText` is original for a company. Never throws; on
 * any internal failure returns a fail-open 'bypassed' result.
 */
export async function assertOriginality(
  input: AssertOriginalityInput,
): Promise<OriginalityResult> {
  const candidateText = input.candidateText ?? '';

  let fingerprint: ContentFingerprint;
  try {
    fingerprint = computeFingerprint(candidateText);
  } catch {
    fingerprint = emptyFingerprint();
  }

  try {
    const threshold = input.options?.threshold ?? DEFAULT_ORIGINALITY_THRESHOLD;
    const maxCandidates = input.options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
    const embeddingActive = Boolean(input.options?.embeddingEnabled && input.options?.embed);
    const platform = input.platform ?? null;

    const candidates = await retrieveRelevant(input.companyId, {
      contentType: input.contentType,
      campaignId: input.campaignId ?? undefined,
      limit: maxCandidates,
    });

    // No memory yet → nothing to duplicate.
    if (candidates.length === 0) {
      return {
        isOriginal: true,
        score: 1,
        decision: 'accepted',
        nearestMatches: [],
        dimensions: {},
        fingerprint,
      };
    }

    // Candidate embedding is computed lazily, at most once.
    let candidateEmbedding: number[] | null | undefined;
    const getCandidateEmbedding = async (): Promise<number[] | null> => {
      if (candidateEmbedding === undefined) {
        candidateEmbedding = input.options?.embed
          ? await input.options.embed(candidateText)
          : null;
      }
      return candidateEmbedding;
    };

    // Track the best semantic score seen — the structural stage depends on it.
    let bestSemantic = 0;

    const stages: StageDef[] = [
      {
        dim: 'exact',
        score: (fp, rec) => (exactEqual(fp.exactHash, rec.exactHash) ? 1 : 0),
        confident: (best) => best >= 1,
        effective: (best) => best,
      },
      {
        dim: 'normalized',
        score: (fp, rec) => (normalizedEqual(fp.normalizedHash, rec.normalizedHash) ? 1 : 0),
        confident: (best) => best >= 1,
        effective: (best) => best,
      },
      {
        // SimHash near-dup. Labeled 'semantic' (no dedicated dimension exists);
        // its ~0.5 chance baseline is dropped from the aggregate unless it clears
        // the near-dup cutoff.
        dim: 'semantic',
        score: (fp, rec) => simhashSimilarity(fp.simhash, rec.simhash),
        confident: (best) => best >= SIMHASH_CUTOFF,
        effective: (best) => (best >= SIMHASH_CUTOFF ? best : 0),
      },
      {
        dim: 'semantic',
        score: (fp, rec) => {
          const s = semanticScore(fp, rec);
          if (s > bestSemantic) bestSemantic = s;
          return s;
        },
        confident: (best) => best >= SEMANTIC_CUTOFF,
        effective: (best) => best,
      },
      {
        dim: 'structural',
        score: (fp, rec) => structuralSimilarity(fp.structuralShape, rec.structuralShape),
        // Shape alone is weak; require semantic backing to avoid false positives.
        confident: (best, sem) => best >= 1 && sem >= STRUCTURAL_SEMANTIC_FLOOR,
        effective: (best, sem) => (best >= 1 && sem >= STRUCTURAL_SEMANTIC_FLOOR ? best : 0),
      },
    ];

    if (embeddingActive) {
      stages.push({
        dim: 'embedding',
        // Synchronous stub replaced by the async pass below; see runEmbeddingStage.
        score: () => 0,
        eligible: (rec) => Array.isArray(rec.embedding) && rec.embedding.length > 0,
        confident: (best) => best >= EMBEDDING_CUTOFF,
        effective: (best) => (best >= EMBEDDING_CUTOFF ? best : 0),
      });
    }

    if (platform) {
      stages.push({
        dim: 'variant',
        // Sibling-variant comparison: strongest of simhash / semantic overlap.
        score: (fp, rec) =>
          Math.max(simhashSimilarity(fp.simhash, rec.simhash), semanticScore(fp, rec)),
        eligible: (rec) => rec.platform === platform,
        confident: (best) => best >= VARIANT_CUTOFF,
        effective: (best) => best,
      });
    }

    // Run the cascade. Early-terminate on the first confident stage.
    //
    // `dimensions` is the human-facing display map (max score per axis; simhash
    // and semantic-Jaccard both surface as 'semantic'). The aggregate score is
    // NOT derived from it — it is derived from each stage's OWN best via that
    // stage's `effective()`, so SimHash's ~0.5 chance baseline on unrelated text
    // (shared into the 'semantic' key) can never leak into the aggregate.
    const dimensions: Partial<Record<SimilarityDimension, number>> = {};
    const outcomes: Array<{ stage: StageDef; best: number; rec: ContentMemoryRecord }> = [];

    for (const stage of stages) {
      const pool = stage.eligible ? candidates.filter(stage.eligible) : candidates;
      if (pool.length === 0) continue;

      let best = -1;
      let bestRec: ContentMemoryRecord | null = null;

      if (stage.dim === 'embedding') {
        // Async embedding pass — computed here rather than via stage.score.
        const emb = await getCandidateEmbedding();
        if (emb && emb.length > 0) {
          for (const rec of pool) {
            const s = rec.embedding ? cosine(emb, rec.embedding) : 0;
            if (s > best) { best = s; bestRec = rec; }
          }
        }
      } else {
        for (const rec of pool) {
          const s = stage.score(fingerprint, rec);
          if (s > best) { best = s; bestRec = rec; }
        }
      }

      if (best <= 0 || !bestRec) continue; // only meaningful (>0) axes are recorded

      outcomes.push({ stage, best, rec: bestRec });
      const prior = dimensions[stage.dim];
      if (prior === undefined || best > prior) dimensions[stage.dim] = best;

      if (stage.confident(best, bestSemantic)) {
        // Confident duplicate → early terminate; skip remaining, costlier stages.
        const nearest: NearestMatch = {
          memoryId: bestRec.id,
          score: best,
          dimension: stage.dim,
          excerpt: excerptOf(bestRec),
        };
        return {
          isOriginal: false,
          score: 1 - best,
          decision: 'duplicate',
          nearestMatches: [nearest],
          dimensions,
          fingerprint,
        };
      }
    }

    // No confident duplicate → aggregate each stage's OWN effective similarity.
    let maxSimilarity = 0;
    const nearestMatches: NearestMatch[] = [];
    for (const { stage, best, rec } of outcomes) {
      const eff = stage.effective(best, bestSemantic);
      if (eff <= 0) continue;
      if (eff > maxSimilarity) maxSimilarity = eff;
      nearestMatches.push({
        memoryId: rec.id,
        score: best,
        dimension: stage.dim,
        excerpt: excerptOf(rec),
      });
    }
    nearestMatches.sort((a, b) => b.score - a.score);

    const score = 1 - maxSimilarity;
    const isOriginal = score >= threshold;

    return {
      isOriginal,
      score,
      decision: 'accepted',
      nearestMatches: nearestMatches.slice(0, 5),
      dimensions,
      fingerprint,
    };
  } catch (error) {
    // FAIL-OPEN — never block generation on an originality-check failure.
    // eslint-disable-next-line no-console
    console.warn(
      `[originalityGate] assertOriginality bypassed (fail-open): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      isOriginal: true,
      score: 1,
      decision: 'bypassed',
      nearestMatches: [],
      dimensions: {},
      fingerprint,
    };
  }
}
