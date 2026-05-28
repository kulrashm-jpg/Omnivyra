/**
 * Production Render QA Pipeline (Phases 1 + 2).
 *
 * Combines three signal sources into a single post-render verdict:
 *
 *   1. Provider OCR — text/region/CTA detection (already runs in
 *      renderer; flags here are read from the existing result).
 *   2. CV-light image statistics — `sharp`-based channel stats +
 *      tile-symmetry checks. NO model inference, NO GPU, NO ML.
 *   3. Governance + aesthetic rank — already computed upstream.
 *
 * Emits a structured `QAResult` with score, violations, severity
 * bucket, regenerateRequired flag, retryStrategy, and a
 * production-safe boolean. The renderer's existing retry-loop can
 * consume the retryStrategy to choose its next move.
 *
 * Production-safe: pure aggregation + lightweight image statistics.
 * Tolerates missing image buffer + missing OCR (degrades gracefully).
 */

import type { CreatorOcrResult } from '../creatorOcrProvider';
import type { GovernanceResult } from './brandGovernanceEngine';
import type { AestheticRankResult } from './creativeAestheticRanking';
import type { CreativeDirectionPlan } from './creativeDirectorEngine';

/* ── Output contract ────────────────────────────────────────────────── */

export type QASeverity = 'pass' | 'warning' | 'fail' | 'reject';

export type QACategory =
  | 'ocr_text_in_supporting_visual'
  | 'ocr_dense_regions'
  | 'ocr_cta_phrase_detected'
  | 'ocr_fake_glyphs'
  | 'cv_visual_noise_spike'
  | 'cv_low_detail'
  | 'cv_color_imbalance'
  | 'cv_symmetry_anomaly'
  | 'cv_perspective_collapse'
  | 'cv_palette_drift'
  | 'governance_reject'
  | 'governance_violations'
  | 'aesthetic_low_score'
  | 'image_unavailable';

export type QAViolation = {
  category: QACategory;
  severity: 'warning' | 'fail' | 'reject';
  description: string;
  recommendedAction: string;
};

export type QARetryStrategy =
  | 'regenerate_with_realism_intensification'
  | 'regenerate_with_palette_tightening'
  | 'regenerate_with_composition_switch'
  | 'regenerate_with_suppression_intensification'
  | 'regenerate_with_human_suppression'
  | 'reject_and_escalate'
  | 'none';

export type ImageStatistics = {
  width: number;
  height: number;
  channels: number;
  perChannelStdev: number[];
  perChannelMean: number[];
  globalNoiseScore: number;
  tileSymmetryDelta: number;
  paletteDominanceTop3: string[];
};

export type QAResult = {
  qaScore: number;
  qaViolations: ReadonlyArray<QAViolation>;
  qaWarnings: ReadonlyArray<QAViolation>;
  severity: QASeverity;
  regenerateRequired: boolean;
  retryStrategy: QARetryStrategy;
  productionSafe: boolean;
  imageAnalysis: ImageStatistics | null;
  /** Audit trail — every signal source's contribution. */
  audit: {
    ocrEvaluated: boolean;
    cvEvaluated: boolean;
    governanceEvaluated: boolean;
    rankEvaluated: boolean;
    componentScores: {
      ocr: number;
      cv: number;
      governance: number;
      aesthetic: number;
    };
  };
};

/* ── Per-source scorers ─────────────────────────────────────────────── */

const OCR_ARTIFACT_FLAGS = new Set<string>([
  'ocr_visible_text_exceeds_threshold',
  'ocr_dense_region_ratio_exceeds_threshold',
  'ocr_region_count_exceeds_threshold',
  'ocr_cta_phrase_detected',
  'ocr_non_english_or_fake_glyphs',
  'ocr_confidence_below_threshold',
]);

function evaluateOcrSignals(
  ocr: CreatorOcrResult | null | undefined,
  attachmentMode: 'embedded_copy' | 'supporting_visual',
): { score: number; violations: QAViolation[] } {
  if (!ocr) return { score: 70, violations: [] };
  const violations: QAViolation[] = [];

  if (attachmentMode === 'supporting_visual' && ocr.text && ocr.text.trim().length > 0) {
    violations.push({
      category: 'ocr_text_in_supporting_visual',
      severity: 'fail',
      description: 'Provider rendered visible text on a supporting_visual asset (text-ban contract violated).',
      recommendedAction: 'Regenerate with stronger text-ban directive and suppression layer.',
    });
  }
  if (ocr.flags.includes('ocr_dense_region_ratio_exceeds_threshold') || ocr.flags.includes('ocr_region_count_exceeds_threshold')) {
    violations.push({
      category: 'ocr_dense_regions',
      severity: 'fail',
      description: 'Dense or numerous text regions detected — likely malformed UI / fake interface.',
      recommendedAction: 'Regenerate with abstracted-UI directive.',
    });
  }
  if (ocr.flags.includes('ocr_cta_phrase_detected')) {
    violations.push({
      category: 'ocr_cta_phrase_detected',
      severity: 'fail',
      description: 'CTA phrase detected in the image — provider violated CTA-free contract.',
      recommendedAction: 'Regenerate with suppression intensification.',
    });
  }
  if (ocr.flags.includes('ocr_non_english_or_fake_glyphs')) {
    violations.push({
      category: 'ocr_fake_glyphs',
      severity: 'fail',
      description: 'Non-English glyphs or fake-glyph patterns detected — likely warped typography.',
      recommendedAction: 'Regenerate with realism intensification + abstracted-text directive.',
    });
  }

  const penalty = violations.reduce((p, v) => p + (v.severity === 'fail' ? 25 : v.severity === 'warning' ? 10 : 0), 0);
  return { score: Math.max(0, 100 - penalty), violations };
}

function evaluateGovernanceSignal(
  governance: GovernanceResult,
): { score: number; violations: QAViolation[] } {
  const violations: QAViolation[] = [];
  if (governance.rejectGeneration) {
    violations.push({
      category: 'governance_reject',
      severity: 'reject',
      description: 'Brand governance hard-rejected the generation.',
      recommendedAction: 'Escalate to operator.',
    });
  }
  if (governance.governanceViolations.length > 0) {
    violations.push({
      category: 'governance_violations',
      severity: 'fail',
      description: `Brand governance flagged ${governance.governanceViolations.length} violation(s).`,
      recommendedAction: governance.retryStrategy !== 'none'
        ? `Apply governance retry strategy: ${governance.retryStrategy}`
        : 'Tighten governance compliance.',
    });
  }
  return { score: governance.governanceScore, violations };
}

function evaluateAestheticSignal(
  rank: AestheticRankResult,
): { score: number; violations: QAViolation[] } {
  const violations: QAViolation[] = [];
  if (rank.totalScore < 55) {
    violations.push({
      category: 'aesthetic_low_score',
      severity: rank.totalScore < 40 ? 'reject' : 'fail',
      description: `Aesthetic rank below acceptable: ${rank.totalScore}/100 (${rank.bucket}).`,
      recommendedAction: 'Regenerate with a stronger creative-direction template.',
    });
  }
  return { score: rank.totalScore, violations };
}

/* ── CV-light image heuristics (sharp-based) ────────────────────────── */

const NOISE_SPIKE_THRESHOLD = 90;        // per-channel stdev > 90 on a 0-255 scale is noisy
const LOW_DETAIL_THRESHOLD = 6;          // per-channel stdev < 6 is suspiciously flat
const COLOR_IMBALANCE_THRESHOLD = 4;     // ratio between dominant + weakest channel mean
const SYMMETRY_DELTA_REJECT = 0.45;      // tile-half symmetry delta > 0.45 suggests duplicated subject

async function evaluateCvHeuristics(
  imageBuffer: Buffer | null | undefined,
): Promise<{ score: number; violations: QAViolation[]; stats: ImageStatistics | null }> {
  if (!imageBuffer) {
    return {
      score: 70,
      violations: [{
        category: 'image_unavailable',
        severity: 'warning',
        description: 'No image buffer available for CV-light analysis.',
        recommendedAction: 'Provider did not return image; QA falls back to prompt-side signals only.',
      }],
      stats: null,
    };
  }

  let sharp: typeof import('sharp');
  try {
    sharp = require('sharp') as typeof import('sharp');
  } catch {
    // sharp unavailable — degrade to image-unavailable handling.
    return {
      score: 70,
      violations: [],
      stats: null,
    };
  }

  try {
    const pipeline = sharp(imageBuffer);
    const metadata = await pipeline.metadata();
    const stats = await pipeline.stats();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const channels = stats.channels?.length ?? 0;

    const perChannelStdev: number[] = (stats.channels ?? []).map((c) => c.stdev ?? 0);
    const perChannelMean: number[] = (stats.channels ?? []).map((c) => c.mean ?? 0);

    // Global noise score = average stdev across channels (excluding alpha).
    const rgbChannels = perChannelStdev.slice(0, 3);
    const globalNoiseScore = rgbChannels.length > 0
      ? rgbChannels.reduce((sum, v) => sum + v, 0) / rgbChannels.length
      : 0;

    const violations: QAViolation[] = [];
    let score = 100;

    // 1. Visual noise spike — provider output appears noisy / corrupted.
    if (globalNoiseScore > NOISE_SPIKE_THRESHOLD) {
      violations.push({
        category: 'cv_visual_noise_spike',
        severity: 'fail',
        description: `High per-channel variance (${globalNoiseScore.toFixed(1)}) — likely visual corruption or noise artifact.`,
        recommendedAction: 'Regenerate with composition discipline intensification.',
      });
      score -= 25;
    }

    // 2. Low detail — image is suspiciously flat, suggesting a degenerate output.
    if (globalNoiseScore < LOW_DETAIL_THRESHOLD && (width * height) > 100) {
      violations.push({
        category: 'cv_low_detail',
        severity: 'fail',
        description: `Per-channel variance too low (${globalNoiseScore.toFixed(1)}) — image likely lacks detail.`,
        recommendedAction: 'Regenerate with composition + realism intensification.',
      });
      score -= 25;
    }

    // 3. Color imbalance — one RGB channel dominates the others by a wide margin.
    const rgbMeans = perChannelMean.slice(0, 3).filter((m) => m > 0);
    if (rgbMeans.length === 3) {
      const minMean = Math.min(...rgbMeans);
      const maxMean = Math.max(...rgbMeans);
      const ratio = minMean > 0 ? maxMean / minMean : Infinity;
      if (ratio > COLOR_IMBALANCE_THRESHOLD) {
        violations.push({
          category: 'cv_color_imbalance',
          severity: 'warning',
          description: `Severe channel imbalance (max/min ratio ${ratio.toFixed(1)}) — may indicate color-cast artifact.`,
          recommendedAction: 'Regenerate with palette tightening.',
        });
        score -= 10;
      }
    }

    // 4. Tile symmetry — extract left + right halves' channel means and compare.
    //    A near-perfect mirror suggests a duplicated subject (common AI failure).
    let tileSymmetryDelta = 1;
    try {
      const halfWidth = Math.floor(width / 2);
      if (halfWidth > 8 && height > 8) {
        const leftStats = await sharp(imageBuffer)
          .extract({ left: 0, top: 0, width: halfWidth, height })
          .stats();
        const rightStats = await sharp(imageBuffer)
          .extract({ left: width - halfWidth, top: 0, width: halfWidth, height })
          .stats();
        const leftMeans = (leftStats.channels ?? []).slice(0, 3).map((c) => c.mean ?? 0);
        const rightMeans = (rightStats.channels ?? []).slice(0, 3).map((c) => c.mean ?? 0);
        if (leftMeans.length === 3 && rightMeans.length === 3) {
          const deltaSum = leftMeans.reduce((sum, m, i) => sum + Math.abs(m - rightMeans[i]), 0);
          const meanRef = (leftMeans.reduce((s, v) => s + v, 0) + rightMeans.reduce((s, v) => s + v, 0)) / 6;
          tileSymmetryDelta = meanRef > 0 ? deltaSum / (meanRef * 3) : 1;
          if (tileSymmetryDelta < (1 - SYMMETRY_DELTA_REJECT)) {
            // VERY similar halves — possible duplicated subject.
            violations.push({
              category: 'cv_symmetry_anomaly',
              severity: 'warning',
              description: `Tile-halves nearly identical (delta ${tileSymmetryDelta.toFixed(2)}) — possible duplicated subject.`,
              recommendedAction: 'Regenerate with asymmetric framing directive.',
            });
            score -= 10;
          }
        }
      }
    } catch {
      // Extract failed — skip symmetry check silently.
    }

    // 5. Perspective collapse — when global stdev is in the low band AND
    //    color imbalance fired, the image is likely flat and washed.
    if (globalNoiseScore < 20 && violations.some((v) => v.category === 'cv_color_imbalance')) {
      violations.push({
        category: 'cv_perspective_collapse',
        severity: 'warning',
        description: 'Low variance combined with color imbalance suggests perspective collapse / flat output.',
        recommendedAction: 'Regenerate with composition + depth directives.',
      });
      score -= 8;
    }

    return {
      score: Math.max(0, score),
      violations,
      stats: {
        width,
        height,
        channels,
        perChannelStdev,
        perChannelMean,
        globalNoiseScore,
        tileSymmetryDelta,
        paletteDominanceTop3: [], // dominant-color extraction is heavier; deferred to provider-side palette extraction
      },
    };
  } catch (error) {
    return {
      score: 70,
      violations: [{
        category: 'image_unavailable',
        severity: 'warning',
        description: `CV-light analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        recommendedAction: 'QA falls back to prompt-side signals.',
      }],
      stats: null,
    };
  }
}

/* ── Retry-strategy resolver ────────────────────────────────────────── */

function selectRetryStrategy(violations: ReadonlyArray<QAViolation>): QARetryStrategy {
  if (violations.some((v) => v.severity === 'reject')) return 'reject_and_escalate';

  const fails = violations.filter((v) => v.severity === 'fail');
  for (const v of fails) {
    switch (v.category) {
      case 'ocr_text_in_supporting_visual':
      case 'ocr_dense_regions':
      case 'ocr_cta_phrase_detected':
      case 'ocr_fake_glyphs':
        return 'regenerate_with_suppression_intensification';
      case 'cv_visual_noise_spike':
        return 'regenerate_with_composition_switch';
      case 'cv_low_detail':
        return 'regenerate_with_realism_intensification';
      case 'aesthetic_low_score':
        return 'regenerate_with_composition_switch';
      case 'governance_violations':
        return 'regenerate_with_palette_tightening';
      default:
        continue;
    }
  }
  const warnings = violations.filter((v) => v.severity === 'warning');
  if (warnings.length >= 3) return 'regenerate_with_realism_intensification';
  return 'none';
}

/* ── Severity bucket ────────────────────────────────────────────────── */

function deriveSeverity(score: number, violations: ReadonlyArray<QAViolation>): QASeverity {
  if (violations.some((v) => v.severity === 'reject')) return 'reject';
  if (score < 40) return 'reject';
  if (score < 55) return 'fail';
  if (score < 70 || violations.some((v) => v.severity === 'fail')) return 'warning';
  return 'pass';
}

/* ── Public entry point ─────────────────────────────────────────────── */

export type QAEvaluationInput = {
  imageBuffer?: Buffer | null;
  ocr?: CreatorOcrResult | null;
  governance: GovernanceResult;
  rank: AestheticRankResult;
  plan: CreativeDirectionPlan;
  attachmentMode: 'embedded_copy' | 'supporting_visual';
};

const COMPONENT_WEIGHTS = {
  ocr: 0.25,
  cv: 0.25,
  governance: 0.30,
  aesthetic: 0.20,
};

export async function evaluateProductionRenderQA(
  input: QAEvaluationInput,
): Promise<QAResult> {
  const ocrEval = evaluateOcrSignals(input.ocr ?? null, input.attachmentMode);
  const cvEval = await evaluateCvHeuristics(input.imageBuffer ?? null);
  const govEval = evaluateGovernanceSignal(input.governance);
  const aesEval = evaluateAestheticSignal(input.rank);

  const totalScore = Math.round(
    ocrEval.score * COMPONENT_WEIGHTS.ocr
    + cvEval.score * COMPONENT_WEIGHTS.cv
    + govEval.score * COMPONENT_WEIGHTS.governance
    + aesEval.score * COMPONENT_WEIGHTS.aesthetic,
  );

  const allViolations = [
    ...ocrEval.violations,
    ...cvEval.violations,
    ...govEval.violations,
    ...aesEval.violations,
  ];
  const violations = allViolations.filter((v) => v.severity === 'fail' || v.severity === 'reject');
  const warnings = allViolations.filter((v) => v.severity === 'warning');

  const severity = deriveSeverity(totalScore, allViolations);
  const retryStrategy = selectRetryStrategy(allViolations);
  const regenerateRequired = severity === 'fail' || severity === 'reject';
  const productionSafe = severity === 'pass' || severity === 'warning';

  return {
    qaScore: totalScore,
    qaViolations: violations,
    qaWarnings: warnings,
    severity,
    regenerateRequired,
    retryStrategy,
    productionSafe,
    imageAnalysis: cvEval.stats,
    audit: {
      ocrEvaluated: input.ocr != null,
      cvEvaluated: cvEval.stats != null,
      governanceEvaluated: true,
      rankEvaluated: true,
      componentScores: {
        ocr: ocrEval.score,
        cv: cvEval.score,
        governance: govEval.score,
        aesthetic: aesEval.score,
      },
    },
  };
}
