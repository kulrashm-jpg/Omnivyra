/**
 * Phase 2 — Transformation intelligence engine.
 *
 * Pure / deterministic. Scores the suitability of a given format-pair
 * transformation across 4 dimensions:
 *   transformationSuitabilityScore   composite
 *   narrativeRetentionScore          how much of the source narrative survives
 *   authorityRetentionScore          how much of the source authority survives
 *   audienceFitScore                 how well the target format fits the source's ICP cadence
 *
 * Mechanics:
 *   - format pairs have a base compatibility table (heuristic, deterministic)
 *   - narrative retention is gated by word-count ratio (compression loss is
 *     monotonic in compression factor)
 *   - authority retention is gated by claim coverage + evidence density
 *   - audience fit is determined by the cadence/depth profile of the target
 */

import type {
  CrossModalAsset,
  CrossModalFormat,
  CrossModalTransformationType,
  TransformationSuitabilityResult,
} from './longFormRecommendationTypes';

// ── Format profile (for compression + audience fit) ─────────────────────────
interface FormatProfile {
  typicalWordCount: number;
  cadence: 'high' | 'medium' | 'low'; // posts = high, whitepapers = low
  depth: 'shallow' | 'medium' | 'deep';
}

const FORMAT_PROFILE: Record<CrossModalFormat, FormatProfile> = {
  post:        { typicalWordCount: 200,   cadence: 'high',   depth: 'shallow' },
  thread:      { typicalWordCount: 1200,  cadence: 'high',   depth: 'medium'  },
  newsletter:  { typicalWordCount: 1200,  cadence: 'medium', depth: 'medium'  },
  story:       { typicalWordCount: 800,   cadence: 'medium', depth: 'medium'  },
  guide:       { typicalWordCount: 2200,  cadence: 'medium', depth: 'deep'    },
  long_form:   { typicalWordCount: 4000,  cadence: 'low',    depth: 'deep'    },
  case_study:  { typicalWordCount: 2500,  cadence: 'medium', depth: 'deep'    },
  whitepaper:  { typicalWordCount: 6000,  cadence: 'low',    depth: 'deep'    },
};

// ── Base compatibility table (source → target → baseScore 0..100) ───────────
// Entries omitted default to a neutral 50.
const BASE_COMPATIBILITY: Partial<Record<CrossModalFormat, Partial<Record<CrossModalFormat, number>>>> = {
  long_form:  { thread: 85, post: 75, newsletter: 80, guide: 70, story: 60, whitepaper: 55, case_study: 60 },
  whitepaper: { long_form: 78, guide: 80, newsletter: 70, thread: 65, post: 55, story: 45, case_study: 60 },
  guide:      { thread: 75, post: 70, newsletter: 78, story: 65, long_form: 70, whitepaper: 55, case_study: 55 },
  case_study: { post: 65, thread: 70, newsletter: 75, long_form: 75, story: 70, whitepaper: 60, guide: 55 },
  thread:     { long_form: 70, post: 80, newsletter: 65, guide: 55, story: 50, whitepaper: 45, case_study: 40 },
  post:       { thread: 80, long_form: 55, newsletter: 55, story: 45, guide: 45, whitepaper: 35, case_study: 40 },
  newsletter: { post: 65, thread: 60, long_form: 55, guide: 60, story: 55, case_study: 45, whitepaper: 40 },
  story:      { post: 60, thread: 65, newsletter: 60, long_form: 60, guide: 50, whitepaper: 45, case_study: 65 },
};

function baseCompatibility(source: CrossModalFormat, target: CrossModalFormat): number {
  return BASE_COMPATIBILITY[source]?.[target] ?? 50;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Compression ratio = target / source words. Both extremes hurt narrative
// retention; the ideal is roughly 0.3..1.5.
function narrativeRetentionFromCompression(srcWords: number, tgtWords: number): number {
  if (srcWords <= 0) return 50;
  const ratio = tgtWords / srcWords;
  if (ratio >= 0.3 && ratio <= 1.5) return 90;
  if (ratio >= 0.15 && ratio < 0.3) return 70;
  if (ratio > 1.5 && ratio <= 3) return 75;
  if (ratio >= 0.05 && ratio < 0.15) return 45;  // heavy compression
  if (ratio > 3) return 60;                       // big expansion needs new material
  return 30;                                       // extreme compression (<5%)
}

// Authority retention: weighted blend of claim coverage (60%) + evidence
// density (40%). Heavily-compressed targets lose more.
function authorityRetentionFromAsset(target: CrossModalAsset, compressionFactor: number): number {
  const claimWeight = target.authorityClaimCoverage * 0.6;
  const evidenceWeight = target.evidenceDensity * 0.4;
  const blended = claimWeight + evidenceWeight;
  // If the target is much smaller, authority retention is naturally capped.
  const compressionCap = compressionFactor < 0.15 ? 60 : compressionFactor < 0.3 ? 80 : 100;
  return Math.min(blended, compressionCap);
}

// Audience fit: derived from cadence + depth match between target and source.
function audienceFit(source: CrossModalAsset, sourceProfile: FormatProfile, targetProfile: FormatProfile): number {
  let score = 75;
  // High-cadence formats lose evidence density → penalize if source has
  // dense evidence (would feel "wasted").
  if (targetProfile.cadence === 'high' && source.evidenceDensity >= 70) score -= 10;
  // Deep targets feel under-equipped if source has thin authority.
  if (targetProfile.depth === 'deep' && source.authorityClaimCoverage < 40) score -= 15;
  // Cadence step jumps further than 1 level hurt fit.
  const cadenceRank = { high: 0, medium: 1, low: 2 } as const;
  const cadenceJump = Math.abs(cadenceRank[targetProfile.cadence] - cadenceRank[sourceProfile.cadence]);
  if (cadenceJump >= 2) score -= 8;
  // Shallow target for a deep source loses too much.
  if (sourceProfile.depth === 'deep' && targetProfile.depth === 'shallow') score -= 5;
  return clamp100(score);
}

export interface AssessTransformationInput {
  source: CrossModalAsset;
  targetFormat: CrossModalFormat;
  transformationType: CrossModalTransformationType;
  /** Optional concrete target asset if we are scoring an existing transformation. */
  derived?: CrossModalAsset;
}

export function assessTransformation(input: AssessTransformationInput): TransformationSuitabilityResult {
  const srcProfile = FORMAT_PROFILE[input.source.format];
  const tgtProfile = FORMAT_PROFILE[input.targetFormat];
  const blockingConcerns: string[] = [];

  // 1. base compatibility
  const baseScore = baseCompatibility(input.source.format, input.targetFormat);

  // 2. narrative retention
  const targetWords = input.derived?.approximateWordCount ?? tgtProfile.typicalWordCount;
  const narrativeRetentionScore = narrativeRetentionFromCompression(input.source.approximateWordCount, targetWords);
  if (narrativeRetentionScore < 50) {
    blockingConcerns.push(`Heavy compression (${input.source.approximateWordCount} → ${targetWords} words) — narrative retention low.`);
  }

  // 3. authority retention
  const compressionFactor = input.source.approximateWordCount > 0 ? targetWords / input.source.approximateWordCount : 1;
  const authorityRetentionScore = input.derived
    ? clamp100(authorityRetentionFromAsset(input.derived, compressionFactor))
    : clamp100(authorityRetentionFromAsset(input.source, compressionFactor));
  if (authorityRetentionScore < 50) {
    blockingConcerns.push(`Authority retention low (${authorityRetentionScore}/100) — claim coverage or evidence density insufficient for ${input.targetFormat}.`);
  }

  // 4. audience fit
  const audienceFitScore = audienceFit(input.source, srcProfile, tgtProfile);
  if (audienceFitScore < 50) {
    blockingConcerns.push(`Audience fit weak (${audienceFitScore}/100) — cadence/depth mismatch between ${input.source.format} and ${input.targetFormat}.`);
  }

  // 5. transformation-type vs format-pair sanity gate.
  const sanityOK = isTypeSane(input.source.format, input.targetFormat, input.transformationType);
  if (!sanityOK) {
    blockingConcerns.push(`Transformation type "${input.transformationType}" is unusual for ${input.source.format} → ${input.targetFormat}.`);
  }

  const transformationSuitabilityScore = clamp100(
    baseScore * 0.35
    + narrativeRetentionScore * 0.25
    + authorityRetentionScore * 0.25
    + audienceFitScore * 0.15
    - (sanityOK ? 0 : 10),
  );

  const rationale = [
    `${input.source.format} → ${input.targetFormat} via ${input.transformationType}: base=${baseScore}, narrative=${narrativeRetentionScore}, authority=${authorityRetentionScore}, audience=${audienceFitScore}.`,
    blockingConcerns.length === 0 ? 'No blocking concerns.' : `${blockingConcerns.length} blocking concern(s) raised.`,
  ].join(' ');

  return {
    transformationType: input.transformationType,
    sourceFormat: input.source.format,
    targetFormat: input.targetFormat,
    transformationSuitabilityScore,
    narrativeRetentionScore,
    authorityRetentionScore,
    audienceFitScore,
    rationale,
    blockingConcerns,
  };
}

function isTypeSane(source: CrossModalFormat, target: CrossModalFormat, type: CrossModalTransformationType): boolean {
  const srcWords = FORMAT_PROFILE[source].typicalWordCount;
  const tgtWords = FORMAT_PROFILE[target].typicalWordCount;
  switch (type) {
    case 'decomposition': return srcWords > tgtWords;
    case 'extraction':    return srcWords > tgtWords;
    case 'expansion':     return srcWords < tgtWords;
    case 'adaptation':    return true; // size-agnostic
    case 'repurposing':   return true;
    case 'derivation':    return srcWords >= tgtWords;
    default:              return true;
  }
}

export { FORMAT_PROFILE, BASE_COMPATIBILITY };
