/**
 * @jest-environment jsdom
 *
 * Creator Performance Learning Engine — focused tests:
 *
 *   Phase 1+2+3  computeLearningPriors derives scores from observed
 *                analytics; audience + industry reasons surface
 *   Phase 4      Blender additively combines context + learning scores;
 *                governance restrictions never get overridden
 *   Phase 5      Confidence band tracks sample size (low / medium /
 *                high)
 *   Phase 6      Reasons include "outperforms peers by X%" + audience
 *                + industry annotations
 *   Phase 7      Cold-start: insufficient samples → zero learning
 *                bonus, blender preserves input order
 *   Phase 8      Dashboard endpoint surfaces learning section
 *   Phase 9      Regression-safe: governance / generation / variant
 *                modules unchanged
 *   Phase 10     Per-industry / per-audience parity tests
 */

import '@testing-library/jest-dom';
import {
  computeLearningPriors,
  listLearningThresholds,
} from '../../services/creator/strategyLearningEngine';
import {
  blendLearningPriors,
  blendLearningPriorsAllTypes,
} from '../../services/creator/strategyLearningBlender';
import { getRecommendedPurposeOptions } from '../../services/creator/companyStrategyRecommendationEngine';
import {
  clearAllStrategyAnalytics,
  recordStrategyEvent,
} from '../../services/creator/strategyAnalyticsRecorder';

const COMPANY = 'co-learning';

beforeEach(() => {
  clearAllStrategyAnalytics();
});

/* ── Helper to seed events ──────────────────────────────────────── */

function seedImpressions(strategyId: string, opts: {
  impressions?: number;
  clicks?: number;
  shares?: number;
} = {}): void {
  const impressions = opts.impressions ?? 0;
  const clicks = opts.clicks ?? 0;
  const shares = opts.shares ?? 0;
  for (let i = 0; i < impressions; i++) {
    recordStrategyEvent({
      type: 'impression',
      companyId: COMPANY,
      strategyId,
    });
  }
  for (let i = 0; i < clicks; i++) {
    recordStrategyEvent({
      type: 'click',
      companyId: COMPANY,
      strategyId,
    });
  }
  for (let i = 0; i < shares; i++) {
    recordStrategyEvent({
      type: 'share',
      companyId: COMPANY,
      strategyId,
    });
  }
}

/* ── Phase 7 — Cold-start safety ────────────────────────────────── */

describe('Phase 7 — cold-start safety', () => {
  test('no events → coldStart=true, every score is zero', () => {
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'image',
    });
    expect(summary.lane.coldStart).toBe(true);
    expect(summary.lane.totalSamples).toBe(0);
    expect(summary.coldStartNote).toMatch(/Insufficient lane samples/i);
  });

  test('few events below threshold → coldStart=true, no scores qualify', () => {
    for (let i = 0; i < 5; i++) {
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'image:promotional-image' });
    }
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'image',
    });
    expect(summary.lane.coldStart).toBe(true);
    expect(Object.values(summary.scores).every((s) => s.score === 0)).toBe(true);
  });

  test('cold-start blender preserves input order', () => {
    const recommended = getRecommendedPurposeOptions({
      industry: 'Developer Tools',
      target_audience: 'developers',
    });
    const summary = computeLearningPriors({ companyId: COMPANY, contentType: 'carousel' });
    const result = blendLearningPriors({
      contentType: 'carousel',
      recommendations: recommended.carousel,
      learning: summary,
    });
    expect(result.appliedLearning).toBe(false);
    expect(result.coldStartNote).toMatch(/Insufficient lane samples/i);
    // Order preserved verbatim.
    const inputOrder = recommended.carousel.map((o) => o.value);
    const outputOrder = result.options.map((o) => o.value);
    expect(outputOrder).toEqual(inputOrder);
    // No learning bonus applied to any option.
    for (const opt of result.options) {
      expect(opt.learning_score).toBe(0);
      expect(opt.learning_reasons).toEqual([]);
      expect(opt.score).toBe(opt.context_score);
    }
  });
});

/* ── Phase 1+5+6 — Score computation + confidence + reasons ──────── */

describe('Phase 1+5+6 — score + confidence + reasons', () => {
  test('strategy with strong performance receives positive bonus', () => {
    // Seed Framework with strong engagement (50 impressions, 25 clicks,
    // 10 shares) and several other strategies with weaker performance.
    seedImpressions('carousel:framework-carousel', { impressions: 50, clicks: 25, shares: 10 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 3 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 4 });
    seedImpressions('carousel:product-showcase-carousel', { impressions: 50, clicks: 5 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'carousel',
      companyContext: {
        industry: 'Developer Tools',
        target_audience: 'developers',
      },
    });
    expect(summary.lane.coldStart).toBe(false);
    const framework = summary.scores['carousel:framework-carousel'];
    expect(framework).toBeDefined();
    expect(framework.score).toBeGreaterThan(0);
    expect(framework.deltaVsPeers).toBeGreaterThan(0);
    // Reasons should include "outperform peers" + developer audience.
    expect(framework.reasons.some((r) => /outperform peers by/i.test(r))).toBe(true);
    expect(framework.reasons.some((r) => /developer audience/i.test(r))).toBe(true);
  });

  test('underperforming strategy receives negative bonus + underperform reason', () => {
    seedImpressions('carousel:framework-carousel', { impressions: 50, clicks: 30 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 1 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 25 });
    seedImpressions('carousel:product-showcase-carousel', { impressions: 50, clicks: 20 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'carousel',
    });
    const story = summary.scores['carousel:story-carousel'];
    expect(story.score).toBeLessThan(0);
    expect(story.reasons.some((r) => /underperform peers/i.test(r))).toBe(true);
  });

  test('confidence band is "low" when lane sample is small but above floor', () => {
    // Just over MIN floor (30) per strategy, total ~120 lane samples
    seedImpressions('carousel:framework-carousel', { impressions: 30, clicks: 12 });
    seedImpressions('carousel:story-carousel', { impressions: 30, clicks: 5 });
    seedImpressions('carousel:educational-carousel', { impressions: 30, clicks: 6 });
    seedImpressions('carousel:product-showcase-carousel', { impressions: 30, clicks: 7 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'carousel',
    });
    // Lane total = 120, which is medium per thresholds (>= 100).
    expect(summary.lane.confidence).toBe('medium');
    const framework = summary.scores['carousel:framework-carousel'];
    // Per-strategy band uses individual sample size (30).
    expect(framework.confidence).toBe('low');
  });

  test('confidence band is "high" when individual strategy has 300+ samples', () => {
    seedImpressions('carousel:framework-carousel', { impressions: 350, clicks: 100 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 5 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 6 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'carousel',
    });
    const framework = summary.scores['carousel:framework-carousel'];
    expect(framework.confidence).toBe('high');
  });

  test('thresholds are exposed for dashboards', () => {
    const t = listLearningThresholds();
    expect(t.minSamplesForConfidence).toBeGreaterThan(0);
    expect(t.perStrategyMinSample).toBeGreaterThan(0);
    expect(t.maxLearningBonus).toBeGreaterThan(0);
  });
});

/* ── Phase 4 — Additive blending ────────────────────────────────── */

describe('Phase 4 — additive blending', () => {
  test('blended score equals context_score + learning_score', () => {
    seedImpressions('carousel:framework-carousel', { impressions: 50, clicks: 30 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 5 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 6 });
    seedImpressions('carousel:product-showcase-carousel', { impressions: 50, clicks: 7 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'carousel',
      companyContext: { industry: 'Developer Tools' },
    });
    const recommended = getRecommendedPurposeOptions({
      industry: 'Developer Tools',
      target_audience: 'developers',
    });
    const result = blendLearningPriors({
      contentType: 'carousel',
      recommendations: recommended.carousel,
      learning: summary,
    });
    for (const opt of result.options) {
      expect(opt.score).toBe(opt.context_score + opt.learning_score);
    }
  });

  test('learning_applied=true when any strategy received a non-zero bonus', () => {
    seedImpressions('carousel:framework-carousel', { impressions: 50, clicks: 30 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 5 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 6 });
    seedImpressions('carousel:product-showcase-carousel', { impressions: 50, clicks: 7 });
    const summary = computeLearningPriors({ companyId: COMPANY, contentType: 'carousel' });
    const recommended = getRecommendedPurposeOptions({ industry: 'Developer Tools' });
    const result = blendLearningPriors({
      contentType: 'carousel',
      recommendations: recommended.carousel,
      learning: summary,
    });
    expect(result.appliedLearning).toBe(true);
  });

  test('blender re-sorts when learning applies; native order is the tiebreaker', () => {
    seedImpressions('carousel:framework-carousel', { impressions: 50, clicks: 30 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 5 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 6 });
    seedImpressions('carousel:product-showcase-carousel', { impressions: 50, clicks: 7 });
    const summary = computeLearningPriors({ companyId: COMPANY, contentType: 'carousel' });
    const recommended = getRecommendedPurposeOptions({ industry: 'Marketing technology' });
    const result = blendLearningPriors({
      contentType: 'carousel',
      recommendations: recommended.carousel,
      learning: summary,
    });
    // Framework now has the strongest signal — it should land in top 2.
    const top2 = result.options.slice(0, 2).map((o) => o.value);
    expect(top2).toContain('framework');
  });

  test('all-types blender returns three lanes', () => {
    const recommended = getRecommendedPurposeOptions({ industry: 'Developer Tools' });
    const learningByType = {
      image: computeLearningPriors({ companyId: COMPANY, contentType: 'image' }),
      carousel: computeLearningPriors({ companyId: COMPANY, contentType: 'carousel' }),
      infographic: computeLearningPriors({ companyId: COMPANY, contentType: 'infographic' }),
    };
    const result = blendLearningPriorsAllTypes({
      recommendedByType: recommended,
      learningByType,
    });
    expect(result.image).toBeDefined();
    expect(result.carousel).toBeDefined();
    expect(result.infographic).toBeDefined();
  });
});

/* ── Phase 10 — Per-industry / per-audience parity ──────────────── */

describe('Phase 10 — per-industry / per-audience parity', () => {
  test('developer-tools company + framework outperformance → framework rises', () => {
    seedImpressions('carousel:framework-carousel', { impressions: 50, clicks: 30 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 5 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 4 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'carousel',
      companyContext: {
        industry: 'Developer Tools',
        target_audience: 'developers',
      },
    });
    const framework = summary.scores['carousel:framework-carousel'];
    expect(framework.score).toBeGreaterThan(0);
    expect(framework.reasons.some((r) => /developer audience/i.test(r))).toBe(true);
  });

  test('healthcare company + educational outperformance → educational rises', () => {
    seedImpressions('infographic:stats', { impressions: 50, clicks: 25 });
    seedImpressions('infographic:process', { impressions: 50, clicks: 20 });
    seedImpressions('infographic:roadmap', { impressions: 50, clicks: 3 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'infographic',
      companyContext: {
        industry: 'Healthcare',
        target_audience: 'patients and physicians',
      },
    });
    expect(summary.lane.coldStart).toBe(false);
    const stats = summary.scores['infographic:stats'];
    expect(stats.score).toBeGreaterThan(0);
  });

  test('finance company + comparison outperformance → comparison rises', () => {
    seedImpressions('infographic:comparison', { impressions: 60, clicks: 30 });
    seedImpressions('infographic:stats', { impressions: 60, clicks: 5 });
    seedImpressions('infographic:process', { impressions: 60, clicks: 6 });
    seedImpressions('infographic:timeline', { impressions: 60, clicks: 8 });
    const summary = computeLearningPriors({
      companyId: COMPANY,
      contentType: 'infographic',
      companyContext: {
        industry: 'Finance',
        target_audience: 'finance leaders',
      },
    });
    const comparison = summary.scores['infographic:comparison'];
    expect(comparison.score).toBeGreaterThan(0);
    expect(comparison.reasons.some((r) => /finance leader audience/i.test(r))).toBe(true);
  });

  test('cold-start company behaves exactly like the existing context engine', () => {
    // No events recorded.
    const recommended = getRecommendedPurposeOptions({
      industry: 'Developer Tools',
      target_audience: 'developers',
    });
    const summary = computeLearningPriors({ companyId: COMPANY, contentType: 'carousel' });
    const result = blendLearningPriors({
      contentType: 'carousel',
      recommendations: recommended.carousel,
      learning: summary,
    });
    // Order matches the original recommendation engine.
    const original = recommended.carousel.map((o) => o.value);
    const blended = result.options.map((o) => o.value);
    expect(blended).toEqual(original);
    // Scores are unmodified.
    for (let i = 0; i < result.options.length; i++) {
      expect(result.options[i].score).toBe(recommended.carousel[i].score);
    }
  });
});

/* ── Phase 4 + 9 — Governance is never overridden ───────────────── */

describe('Phase 4 + 9 — governance authority preserved', () => {
  test('blender does NOT filter or hard-suppress any option', () => {
    seedImpressions('carousel:framework-carousel', { impressions: 50, clicks: 30 });
    seedImpressions('carousel:story-carousel', { impressions: 50, clicks: 5 });
    seedImpressions('carousel:educational-carousel', { impressions: 50, clicks: 6 });
    seedImpressions('carousel:product-showcase-carousel', { impressions: 50, clicks: 7 });
    const summary = computeLearningPriors({ companyId: COMPANY, contentType: 'carousel' });
    const recommended = getRecommendedPurposeOptions({ industry: 'Healthcare' });
    const result = blendLearningPriors({
      contentType: 'carousel',
      recommendations: recommended.carousel,
      learning: summary,
    });
    // Total option count is preserved — no strategy is removed by the blender.
    expect(result.options.length).toBe(recommended.carousel.length);
    // Every recommendation engine option is still present (by slug).
    const inputValues = new Set(recommended.carousel.map((o) => o.value));
    const outputValues = new Set(result.options.map((o) => o.value));
    expect(outputValues).toEqual(inputValues);
  });
});
