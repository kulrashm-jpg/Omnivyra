/**
 * Strategy Learning Engine (Creator Performance Learning Engine).
 *
 * Pure read-only learning layer that converts observed strategy
 * analytics into a per-strategy `LearningScore`. The score is
 * **additive only** — it raises or lowers strategy ranking on top of
 * the existing company-context recommendation engine. It NEVER:
 *   - mutates analytics, generation, variants, governance, publishing
 *   - overrides governance suppression / restriction decisions
 *   - hard-suppresses strategies
 *
 * Inputs:
 *   - companyId — scopes the event window (per-tenant read)
 *   - companyContext — used for explainability reasons and to bias
 *     audience signal interpretation (does NOT change analytics)
 *   - contentType — lane scope (image / carousel / infographic)
 *
 * Outputs:
 *   - `LearningScore` per strategy: numeric bonus + confidence band +
 *     human-readable reasons
 *   - aggregate confidence summary
 *
 * Cold-start: when sample size < `MIN_SAMPLES_FOR_CONFIDENCE`, ALL
 * scores are zero and the caller's prior recommendation order is
 * preserved unchanged.
 *
 * STRICT scope: pure module. No DB. No network. No mutations.
 */

import {
  aggregateStrategyPerformance,
  type StrategyPerformance,
} from './strategyPerformanceAggregator';
import { resolvePurposeStrategy } from './purposeStrategyRegistry';
import type { AnalyticsContentType } from './strategyAnalyticsRegistry';

/* ── Confidence model ─────────────────────────────────────────── */

export type LearningConfidence = 'low' | 'medium' | 'high';

/**
 * Minimum cumulative sample size in the lane before we trust any
 * differential signal. Below this we return zero scores.
 */
const MIN_SAMPLES_FOR_CONFIDENCE = 30;

/**
 * Sample-size thresholds for the confidence bands.
 *   - low: 30..99 events in lane
 *   - medium: 100..299 events
 *   - high: 300+ events
 */
const MEDIUM_CONFIDENCE_THRESHOLD = 100;
const HIGH_CONFIDENCE_THRESHOLD = 300;

/**
 * Maximum absolute learning bonus. Bound so a single hot strategy
 * cannot drown out governance + context signals.
 */
const MAX_LEARNING_BONUS = 6;

/**
 * Per-strategy minimum sample size required to receive a non-zero
 * learning score. Strategies below this still get listed but with
 * score=0 and reasons explaining the cold-start state.
 */
const PER_STRATEGY_MIN_SAMPLE = 10;

/* ── Public types ─────────────────────────────────────────────── */

export type LearningScore = {
  /** Canonical strategy id (`<contentType>:<key>`). */
  strategy_id: string;
  /** Slug used by the picker / recommendation engine (e.g. 'framework'). */
  strategy_key: string;
  /** Additive bonus applied to the recommendation engine's score. */
  score: number;
  /** Confidence band — operators can dim a low-confidence reason. */
  confidence: LearningConfidence;
  /** Sample size that drove this score (post-window). */
  sampleSize: number;
  /** Engagement rate observed in window. 0 when no events. */
  engagementRate: number;
  /** Engagement-rate delta vs. lane peers (decimal; 0.18 = +18%). */
  deltaVsPeers: number;
  /** Operator-readable explanation lines. */
  reasons: string[];
};

export type LearningSummary = {
  /** Map of strategy_id → score. */
  scores: Record<string, LearningScore>;
  /** Lane-level rollup metadata. */
  lane: {
    contentType: AnalyticsContentType;
    totalSamples: number;
    qualifyingStrategies: number;
    confidence: LearningConfidence;
    coldStart: boolean;
  };
  /** Operator-readable cold-start / under-sampled note. Empty when
   *  the engine produced confident scores. */
  coldStartNote: string | null;
};

export type ComputeLearningPriorsInput = {
  companyId: string;
  contentType: AnalyticsContentType;
  /** Window over which to read events. Defaults to '30d'. */
  window?: '7d' | '30d' | '90d' | 'all_time';
  /** Company-context signals — used ONLY for explainability text
   *  (e.g. "Framework strategies match your developer audience's
   *  engagement pattern"). Does NOT affect score values. */
  companyContext?: {
    industry?: string | null;
    industry_list?: ReadonlyArray<string> | null;
    target_audience?: string | null;
    target_audience_list?: ReadonlyArray<string> | null;
    products_services?: string | null;
  } | null;
  /** Optional per-strategy minimum sample override (for tests). */
  perStrategyMinSample?: number;
  /** Optional lane minimum sample override (for tests). */
  laneMinSample?: number;
};

/* ── Audience / industry inference for reasons ────────────────── */

function inferAudienceLabel(input: ComputeLearningPriorsInput): string | null {
  const tokens = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (!s) return;
    for (const t of String(s).toLowerCase().split(/[^a-z0-9+]+/g)) {
      if (t.length > 1) tokens.add(t);
    }
  };
  add(input.companyContext?.target_audience ?? null);
  if (Array.isArray(input.companyContext?.target_audience_list)) {
    for (const e of input.companyContext!.target_audience_list!) add(e);
  }
  const has = (...keys: string[]) => keys.some((k) => tokens.has(k));
  if (has('developer', 'developers', 'engineer', 'engineers', 'engineering', 'cto', 'devs')) return 'developer';
  if (has('marketer', 'marketers', 'marketing', 'cmo', 'growth')) return 'marketer';
  if (has('founder', 'founders', 'ceo', 'ceos')) return 'founder';
  if (has('hr', 'people', 'recruiter', 'recruiters', 'hiring')) return 'hr leader';
  if (has('finance', 'cfo', 'cfos', 'financial', 'finances')) return 'finance leader';
  if (has('operations', 'coo', 'coos', 'ops')) return 'operations leader';
  return null;
}

function inferIndustryLabel(input: ComputeLearningPriorsInput): string | null {
  const tokens = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (!s) return;
    for (const t of String(s).toLowerCase().split(/[^a-z0-9+]+/g)) {
      if (t.length > 1) tokens.add(t);
    }
  };
  add(input.companyContext?.industry ?? null);
  if (Array.isArray(input.companyContext?.industry_list)) {
    for (const e of input.companyContext!.industry_list!) add(e);
  }
  if (tokens.has('healthcare') || tokens.has('medical') || tokens.has('clinical')) return 'healthcare';
  if (tokens.has('finance') || tokens.has('fintech') || tokens.has('banking')) return 'finance';
  if (tokens.has('developer') || tokens.has('devtools') || tokens.has('developers')) return 'developer-tools';
  if (tokens.has('marketing') || tokens.has('martech')) return 'marketing';
  if (tokens.has('consulting') || tokens.has('advisory')) return 'consulting';
  return null;
}

/* ── Score computation ────────────────────────────────────────── */

function bandFromSamples(samples: number): LearningConfidence {
  if (samples >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (samples >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
  return 'low';
}

/**
 * Convert an engagement-rate z-score into a bounded additive bonus.
 * Z-score of 0 → 0 bonus; z=1 → MAX_LEARNING_BONUS/2; z=2+ →
 * MAX_LEARNING_BONUS clamp.
 */
function bonusFromZScore(z: number): number {
  if (!Number.isFinite(z)) return 0;
  // Convert z into a 0..1 scale (sigmoid-ish but bounded).
  const halfMax = MAX_LEARNING_BONUS / 2;
  const raw = z * halfMax;
  if (raw > MAX_LEARNING_BONUS) return MAX_LEARNING_BONUS;
  if (raw < -MAX_LEARNING_BONUS) return -MAX_LEARNING_BONUS;
  return Number(raw.toFixed(4));
}

function strategyKeyFromId(strategyId: string, contentType: AnalyticsContentType): string {
  // strategy_id is `<contentType>:<purposeKey>` where purposeKey may
  // be the long form (e.g. 'promotional-image') for image/carousel
  // and short form for infographic. Normalize to the picker slug.
  const colon = strategyId.indexOf(':');
  const purposeKey = colon >= 0 ? strategyId.slice(colon + 1) : strategyId;
  const slug = String(purposeKey).toLowerCase();
  const suffix = `-${contentType}`;
  if (slug.endsWith(suffix)) return slug.slice(0, -suffix.length);
  return slug;
}

/* ── Public API ───────────────────────────────────────────────── */

/**
 * Compute the learning priors for a company × content type.
 *
 * Cold-start guarantee: when lane samples < laneMinSample, every
 * returned score is zero AND `summary.lane.coldStart = true`. Callers
 * MUST honor cold-start and fall back to the existing context
 * recommendation engine without any learning blend.
 */
export function computeLearningPriors(
  input: ComputeLearningPriorsInput,
): LearningSummary {
  const perStrategyMin = input.perStrategyMinSample ?? PER_STRATEGY_MIN_SAMPLE;
  const laneMin = input.laneMinSample ?? MIN_SAMPLES_FOR_CONFIDENCE;
  const performance = aggregateStrategyPerformance({
    companyId: input.companyId,
    contentType: input.contentType,
    window: input.window ?? '30d',
  });
  const inLane: StrategyPerformance[] = performance.filter(
    (p) => p.content_type === input.contentType,
  );
  const totalSamples = inLane.reduce((acc, p) => acc + p.metrics.sampleSize, 0);
  const laneConfidence = bandFromSamples(totalSamples);

  // Cold start — return zero scores for every observed strategy plus a
  // note so callers can render the fallback rationale.
  if (totalSamples < laneMin) {
    const scores: Record<string, LearningScore> = {};
    for (const p of inLane) {
      scores[p.strategy_id] = {
        strategy_id: p.strategy_id,
        strategy_key: strategyKeyFromId(p.strategy_id, input.contentType),
        score: 0,
        confidence: 'low',
        sampleSize: p.metrics.sampleSize,
        engagementRate: p.metrics.engagementRate,
        deltaVsPeers: 0,
        reasons: [],
      };
    }
    return {
      scores,
      lane: {
        contentType: input.contentType,
        totalSamples,
        qualifyingStrategies: 0,
        confidence: laneConfidence,
        coldStart: true,
      },
      coldStartNote: `Insufficient lane samples (${totalSamples}/${laneMin}). Falling back to context recommendation engine.`,
    };
  }

  // Compute mean + stdev of engagementRate over strategies with
  // enough per-strategy samples — the "qualifying" set.
  const qualifying = inLane.filter((p) => p.metrics.sampleSize >= perStrategyMin);
  if (qualifying.length === 0) {
    const scores: Record<string, LearningScore> = {};
    for (const p of inLane) {
      scores[p.strategy_id] = {
        strategy_id: p.strategy_id,
        strategy_key: strategyKeyFromId(p.strategy_id, input.contentType),
        score: 0,
        confidence: 'low',
        sampleSize: p.metrics.sampleSize,
        engagementRate: p.metrics.engagementRate,
        deltaVsPeers: 0,
        reasons: [],
      };
    }
    return {
      scores,
      lane: {
        contentType: input.contentType,
        totalSamples,
        qualifyingStrategies: 0,
        confidence: laneConfidence,
        coldStart: true,
      },
      coldStartNote: `No strategies have ≥ ${perStrategyMin} samples in window. Falling back to context recommendation engine.`,
    };
  }

  const rates = qualifying.map((p) => p.metrics.engagementRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance =
    rates.reduce((acc, r) => acc + (r - mean) ** 2, 0) / rates.length;
  const stdev = Math.sqrt(variance);

  const audience = inferAudienceLabel(input);
  const industry = inferIndustryLabel(input);

  const scores: Record<string, LearningScore> = {};
  for (const p of inLane) {
    const sample = p.metrics.sampleSize;
    const strategyKey = strategyKeyFromId(p.strategy_id, input.contentType);
    if (sample < perStrategyMin) {
      // Strategy listed but under-sampled — no bonus.
      scores[p.strategy_id] = {
        strategy_id: p.strategy_id,
        strategy_key: strategyKey,
        score: 0,
        confidence: 'low',
        sampleSize: sample,
        engagementRate: p.metrics.engagementRate,
        deltaVsPeers: 0,
        reasons: [],
      };
      continue;
    }
    const z = stdev > 0 ? (p.metrics.engagementRate - mean) / stdev : 0;
    const bonus = bonusFromZScore(z);
    const delta = mean > 0 ? (p.metrics.engagementRate - mean) / mean : 0;
    const confidence = bandFromSamples(sample);
    const strategyMeta = resolvePurposeStrategy(input.contentType, strategyKey);
    const familyLabel = strategyMeta?.displayLabel ?? strategyKey;

    const reasons: string[] = [];
    if (delta > 0.05) {
      const deltaPct = Math.round(delta * 100);
      reasons.push(
        `${familyLabel} strategies outperform peers by ${deltaPct}% in this lane (n=${Math.round(sample)}).`,
      );
    } else if (delta < -0.05) {
      const deltaPct = Math.round(Math.abs(delta) * 100);
      reasons.push(
        `${familyLabel} strategies underperform peers by ${deltaPct}% in this lane (n=${Math.round(sample)}).`,
      );
    }
    if (audience && bonus > 0) {
      reasons.push(`Engagement pattern matches your ${audience} audience.`);
    }
    if (industry && bonus > 0) {
      reasons.push(`Consistent with observed ${industry} performance.`);
    }

    scores[p.strategy_id] = {
      strategy_id: p.strategy_id,
      strategy_key: strategyKey,
      score: bonus,
      confidence,
      sampleSize: sample,
      engagementRate: p.metrics.engagementRate,
      deltaVsPeers: Number(delta.toFixed(4)),
      reasons,
    };
  }

  return {
    scores,
    lane: {
      contentType: input.contentType,
      totalSamples,
      qualifyingStrategies: qualifying.length,
      confidence: laneConfidence,
      coldStart: false,
    },
    coldStartNote: null,
  };
}

/**
 * Diagnostics surface: rule-set summary. Used by the dashboard +
 * admin diagnostics endpoints.
 */
export function listLearningThresholds(): {
  minSamplesForConfidence: number;
  perStrategyMinSample: number;
  mediumConfidenceThreshold: number;
  highConfidenceThreshold: number;
  maxLearningBonus: number;
} {
  return {
    minSamplesForConfidence: MIN_SAMPLES_FOR_CONFIDENCE,
    perStrategyMinSample: PER_STRATEGY_MIN_SAMPLE,
    mediumConfidenceThreshold: MEDIUM_CONFIDENCE_THRESHOLD,
    highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
    maxLearningBonus: MAX_LEARNING_BONUS,
  };
}
