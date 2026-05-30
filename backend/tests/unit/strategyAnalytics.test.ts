/**
 * Purpose Strategy Analytics — correctness + regression-safety suite.
 *
 * Covers:
 *
 *   PHASE 1 — Registry: 16-entry coverage + dimension shape +
 *             family + layout_type assignment.
 *
 *   PHASE 2 — Attribution: `buildStrategyAnalyticsAttribution`
 *             reads from purpose_strategy / applied_render_strategy
 *             envelopes and returns null when neither is present
 *             (regression-safe for legacy assets).
 *
 *   PHASE 3 — Enrichment: `enrichEngagementEvent` adds strategy
 *             dimensions ADDITIVELY; original event keys are
 *             preserved verbatim; events without resolvable strategy
 *             pass through unchanged.
 *
 *   PHASE 4 — Aggregation: counts impressions / clicks / saves /
 *             shares / engagements correctly; computes CTR +
 *             engagementRate + saveRate + shareRate; honors scopes
 *             (campaign, platform, creator, contentType).
 *
 *   PHASE 5 — Leaderboards: ranks by engagementRate, honors
 *             minSampleSize, returns top-N.
 *
 *   PHASE 6 — Comparison engine: reports delta + confidence +
 *             sample size; returns insufficientData when below
 *             threshold; handles missing strategies gracefully.
 *
 *   PHASE 7 — Insights: returns evidence-based summaries only
 *             when sample threshold is met; never fabricates.
 *
 *   PHASE 8 — Recommendation signals: classifies strong / emerging /
 *             underperformer / recommended with thresholds.
 *
 *   PHASE 10 — Trend analysis: rising / declining / stable /
 *              insufficient_data based on current vs previous period.
 *
 *   PHASE 11 — Explainability join: every dimension surfaced with
 *              optional performance + trend + signal annotations.
 *
 *   PHASE 12 — Regression safety: legacy assets (no strategy
 *              metadata) flow through untouched; the recorder
 *              no-ops; aggregations return empty buckets, not
 *              errors.
 */

import {
  type AnalyticsStrategyFamily,
  describeStrategyAnalytics,
  isKnownStrategyId,
  isRenderStrategyKnown,
  listAllStrategyAnalyticsDimensions,
  listStrategyAnalyticsDimensionsForContentType,
  resolveStrategyAnalyticsDimensions,
  resolveStrategyAnalyticsDimensionsFromMetadata,
  resolveStrategyAnalyticsDimensionsFromPurposeKey,
  strategyFamilyOf,
} from '../../services/creator/strategyAnalyticsRegistry';
import {
  buildStrategyAnalyticsAttribution,
  clearAllStrategyAnalytics,
  enrichEngagementEvent,
  recordStrategyEvent,
  strategyAnalyticsRecorderStats,
  type StrategyEngagementType,
} from '../../services/creator/strategyAnalyticsRecorder';
import {
  aggregateAllStrategiesWithCoverage,
  aggregateByStrategyFamily,
  aggregateStrategyPerformance,
  buildStrategyLeaderboard,
  compareStrategies,
  resolveWindowMs,
  type StrategyTimeWindow,
} from '../../services/creator/strategyPerformanceAggregator';
import {
  analyzeStrategyTrends,
  buildStrategyExplainabilityPayloads,
  computeRecommendationSignals,
  generateStrategyInsights,
} from '../../services/creator/strategyInsightsEngine';

/* ── Shared fixtures ─────────────────────────────────────────────── */

const COMPANY = 'co-analytics-test';
const CAMPAIGN_A = 'camp-A';
const CAMPAIGN_B = 'camp-B';

const ALL_STRATEGY_IDS = [
  // image (5)
  'image:promotional-image',
  'image:educational-image',
  'image:quote-image',
  'image:product-showcase-image',
  'image:brand-focus-image',
  // carousel (5)
  'carousel:educational-carousel',
  'carousel:framework-carousel',
  'carousel:story-carousel',
  'carousel:product-showcase-carousel',
  'carousel:presentation-carousel',
  // infographic (6)
  'infographic:stats',
  'infographic:process',
  'infographic:timeline',
  'infographic:comparison',
  'infographic:framework',
  'infographic:roadmap',
];

function seedEvents(seq: Array<{
  type: StrategyEngagementType;
  strategyId: string;
  count?: number;
  weight?: number;
  occurredAt?: string;
  campaignId?: string;
  platform?: string;
}>): void {
  for (const e of seq) {
    const count = e.count ?? 1;
    for (let i = 0; i < count; i++) {
      recordStrategyEvent({
        type: e.type,
        companyId: COMPANY,
        campaignId: e.campaignId ?? CAMPAIGN_A,
        platform: e.platform ?? 'linkedin',
        strategyId: e.strategyId,
        weight: e.weight ?? 1,
        occurredAt: e.occurredAt,
      });
    }
  }
}

beforeEach(() => {
  clearAllStrategyAnalytics();
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 1 — registry coverage                                         */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 1 — Strategy Analytics Registry', () => {
  test('all 16 strategy ids resolve to dimensions', () => {
    for (const id of ALL_STRATEGY_IDS) {
      const dims = resolveStrategyAnalyticsDimensions(id);
      expect(dims).not.toBeNull();
      expect(dims!.strategy_id).toBe(id);
      expect(dims!.render_strategy_id).toBe(id);
    }
  });

  test('listAllStrategyAnalyticsDimensions returns exactly 16 entries', () => {
    expect(listAllStrategyAnalyticsDimensions()).toHaveLength(16);
  });

  test('lane coverage — 5 image, 5 carousel, 6 infographic', () => {
    expect(listStrategyAnalyticsDimensionsForContentType('image')).toHaveLength(5);
    expect(listStrategyAnalyticsDimensionsForContentType('carousel')).toHaveLength(5);
    expect(listStrategyAnalyticsDimensionsForContentType('infographic')).toHaveLength(6);
  });

  test('layout_type matches content_type lane', () => {
    for (const dims of listAllStrategyAnalyticsDimensions()) {
      if (dims.content_type === 'image') expect(dims.layout_type).toBe('image-overlay');
      if (dims.content_type === 'carousel') expect(dims.layout_type).toBe('carousel-deck');
      if (dims.content_type === 'infographic') expect(dims.layout_type).toBe('infographic-section');
    }
  });

  test('family assignments are canonical (purpose_family === strategy_family)', () => {
    for (const dims of listAllStrategyAnalyticsDimensions()) {
      expect(dims.purpose_family).toBe(dims.strategy_family);
    }
  });

  test('family-of canonical ids — spot-check 5', () => {
    expect(strategyFamilyOf('image:quote-image')).toBe('quote');
    expect(strategyFamilyOf('carousel:story-carousel')).toBe('story');
    expect(strategyFamilyOf('infographic:comparison')).toBe('comparison');
    expect(strategyFamilyOf('infographic:stats')).toBe('statistics');
    expect(strategyFamilyOf('image:brand-focus-image')).toBe('brand_focus');
  });

  test('analytics registry agrees with renderStrategyRegistry — every id resolves on both', () => {
    for (const id of ALL_STRATEGY_IDS) {
      expect(isKnownStrategyId(id)).toBe(true);
      expect(isRenderStrategyKnown(id)).toBe(true);
    }
  });

  test('unknown / malformed / null ids return null (PHASE 12 regression safety)', () => {
    expect(resolveStrategyAnalyticsDimensions(null)).toBeNull();
    expect(resolveStrategyAnalyticsDimensions(undefined)).toBeNull();
    expect(resolveStrategyAnalyticsDimensions('')).toBeNull();
    expect(resolveStrategyAnalyticsDimensions('   ')).toBeNull();
    expect(resolveStrategyAnalyticsDimensions('foo')).toBeNull();
    expect(resolveStrategyAnalyticsDimensions('image:nonexistent')).toBeNull();
    expect(resolveStrategyAnalyticsDimensions('video:something')).toBeNull(); // wrong lane
    expect(isKnownStrategyId('image:nonexistent')).toBe(false);
  });

  test('resolve from purpose key — composite + UI aliases', () => {
    expect(resolveStrategyAnalyticsDimensionsFromPurposeKey('image', 'promotional-image')!.strategy_id)
      .toBe('image:promotional-image');
    expect(resolveStrategyAnalyticsDimensionsFromPurposeKey('infographic', 'stats')!.strategy_id)
      .toBe('infographic:stats');
    expect(resolveStrategyAnalyticsDimensionsFromPurposeKey('image', 'doesnotexist')).toBeNull();
  });

  test('describe returns the registry-level displayLabel', () => {
    const d = describeStrategyAnalytics('image:quote-image');
    expect(d).not.toBeNull();
    expect(d!.family).toBe('quote');
    expect(d!.contentType).toBe('image');
    expect(typeof d!.displayLabel).toBe('string');
    expect(d!.displayLabel.length).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 2 — asset attribution                                         */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 2 — Asset Attribution', () => {
  test('reads from media_bundle.metadata.purpose_strategy.id', () => {
    const attribution = buildStrategyAnalyticsAttribution({
      purpose_strategy: { id: 'image:quote-image' },
    });
    expect(attribution).not.toBeNull();
    expect(attribution!.strategy_id).toBe('image:quote-image');
    expect(attribution!.strategy_family).toBe('quote');
    expect(attribution!.content_type).toBe('image');
    expect(attribution!.render_strategy_id).toBe('image:quote-image');
  });

  test('falls back to applied_render_strategy.id when purpose_strategy absent', () => {
    const attribution = buildStrategyAnalyticsAttribution({
      applied_render_strategy: { id: 'carousel:story-carousel' },
    });
    expect(attribution).not.toBeNull();
    expect(attribution!.strategy_id).toBe('carousel:story-carousel');
    expect(attribution!.strategy_family).toBe('story');
  });

  test('returns null for legacy assets with no strategy metadata (PHASE 12)', () => {
    expect(buildStrategyAnalyticsAttribution(null)).toBeNull();
    expect(buildStrategyAnalyticsAttribution(undefined)).toBeNull();
    expect(buildStrategyAnalyticsAttribution({})).toBeNull();
    expect(buildStrategyAnalyticsAttribution({ purpose_strategy: null, applied_render_strategy: null })).toBeNull();
  });

  test('does not mutate the input metadata object', () => {
    const meta = { purpose_strategy: { id: 'image:promotional-image' }, foo: 'bar' };
    const frozen = JSON.stringify(meta);
    buildStrategyAnalyticsAttribution(meta);
    expect(JSON.stringify(meta)).toBe(frozen);
  });

  test('resolveStrategyAnalyticsDimensionsFromMetadata returns null when both envelopes are absent', () => {
    expect(resolveStrategyAnalyticsDimensionsFromMetadata({ purpose_strategy: null, applied_render_strategy: null }))
      .toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 3 — event enrichment                                          */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 3 — Event Enrichment (additive only)', () => {
  test('enriches an event with strategy dimensions when strategy id resolves', () => {
    const event = { event_id: 'evt-1', post_id: 'p-1', kind: 'impression' };
    const enriched = enrichEngagementEvent(event, { strategy_id: 'image:promotional-image' });
    expect(enriched.event_id).toBe('evt-1');
    expect(enriched.post_id).toBe('p-1');
    expect(enriched.kind).toBe('impression');
    expect(enriched.strategy_id).toBe('image:promotional-image');
    expect(enriched.strategy_family).toBe('promotional');
    expect(enriched.content_type).toBe('image');
    expect(enriched.layout_type).toBe('image-overlay');
    expect(enriched.render_strategy_id).toBe('image:promotional-image');
    expect(enriched.purpose_family).toBe('promotional');
  });

  test('returns the original event UNCHANGED when no strategy id resolves (PHASE 12)', () => {
    const event = { event_id: 'evt-1', kind: 'click' };
    const enriched = enrichEngagementEvent(event, { strategy_id: null });
    expect(enriched).toEqual(event); // no extra keys added
  });

  test('does not mutate the original event object', () => {
    const event = { event_id: 'evt-1', kind: 'save' };
    const frozen = JSON.stringify(event);
    enrichEngagementEvent(event, { strategy_id: 'image:quote-image' });
    expect(JSON.stringify(event)).toBe(frozen);
  });

  test('reads strategy id from metadata fallback when not supplied directly', () => {
    const event = { event_id: 'evt-1' };
    const enriched = enrichEngagementEvent(event, {
      media_bundle_metadata: { purpose_strategy: { id: 'carousel:framework-carousel' } },
    });
    expect(enriched.strategy_id).toBe('carousel:framework-carousel');
    expect(enriched.strategy_family).toBe('framework');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Recording API (PHASE 3 + PHASE 12)                                  */
/* ─────────────────────────────────────────────────────────────────── */

describe('Recorder — record / drop semantics', () => {
  test('records valid strategy events', () => {
    const recorded = recordStrategyEvent({
      type: 'impression',
      companyId: COMPANY,
      strategyId: 'image:quote-image',
    });
    expect(recorded).toBe(true);
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(1);
  });

  test('drops events missing companyId (no throw — regression safe)', () => {
    expect(recordStrategyEvent({ type: 'impression', companyId: '', strategyId: 'image:quote-image' })).toBe(false);
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('drops events with unknown strategy id (forward-compatible)', () => {
    expect(recordStrategyEvent({
      type: 'impression',
      companyId: COMPANY,
      strategyId: 'image:future-unknown-strategy',
    })).toBe(false);
  });

  test('drops events with no resolvable strategy at all (PHASE 12 legacy event)', () => {
    expect(recordStrategyEvent({
      type: 'impression',
      companyId: COMPANY,
    })).toBe(false);
  });

  test('respects weight on aggregated batch events', () => {
    seedEvents([{ type: 'impression', strategyId: 'image:quote-image', weight: 50 }]);
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    const q = perf.find((p) => p.strategy_id === 'image:quote-image');
    expect(q!.metrics.impressions).toBe(50);
    expect(q!.metrics.sampleSize).toBe(50);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 4 — aggregation                                               */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 4 — Performance Aggregation', () => {
  test('aggregates impressions/clicks/saves/shares per strategy', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:promotional-image', count: 100 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 10 },
      { type: 'save',       strategyId: 'image:promotional-image', count: 5 },
      { type: 'share',      strategyId: 'image:promotional-image', count: 2 },
    ]);
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf).toHaveLength(1);
    const p = perf[0];
    expect(p.metrics.impressions).toBe(100);
    expect(p.metrics.clicks).toBe(10);
    expect(p.metrics.saves).toBe(5);
    expect(p.metrics.shares).toBe(2);
    expect(p.metrics.ctr).toBeCloseTo(10 / 100, 5);
    // engagementRate counts clicks + saves + shares + reactions + comments + engagements
    expect(p.metrics.engagementRate).toBeCloseTo(17 / 100, 5);
    expect(p.metrics.saveRate).toBeCloseTo(5 / 100, 5);
    expect(p.metrics.shareRate).toBeCloseTo(2 / 100, 5);
  });

  test('scopes correctly by campaignId', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 10, campaignId: CAMPAIGN_A },
      { type: 'impression', strategyId: 'image:quote-image', count: 50, campaignId: CAMPAIGN_B },
    ]);
    const aOnly = aggregateStrategyPerformance({ companyId: COMPANY, campaignId: CAMPAIGN_A, window: '30d' });
    const bOnly = aggregateStrategyPerformance({ companyId: COMPANY, campaignId: CAMPAIGN_B, window: '30d' });
    expect(aOnly[0].metrics.impressions).toBe(10);
    expect(bOnly[0].metrics.impressions).toBe(50);
  });

  test('scopes correctly by platform', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 7, platform: 'linkedin' },
      { type: 'impression', strategyId: 'image:quote-image', count: 3, platform: 'instagram' },
    ]);
    const li = aggregateStrategyPerformance({ companyId: COMPANY, platform: 'linkedin', window: '30d' });
    const ig = aggregateStrategyPerformance({ companyId: COMPANY, platform: 'instagram', window: '30d' });
    expect(li[0].metrics.impressions).toBe(7);
    expect(ig[0].metrics.impressions).toBe(3);
  });

  test('scopes correctly by content type', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 5 },
      { type: 'impression', strategyId: 'carousel:story-carousel', count: 7 },
    ]);
    const onlyImage = aggregateStrategyPerformance({ companyId: COMPANY, contentType: 'image', window: '30d' });
    expect(onlyImage).toHaveLength(1);
    expect(onlyImage[0].content_type).toBe('image');
  });

  test('window restricts to a rolling time band', () => {
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 10, occurredAt: longAgo },
      { type: 'impression', strategyId: 'image:quote-image', count: 3 }, // now
    ]);
    const sevenDay = aggregateStrategyPerformance({ companyId: COMPANY, window: '7d' });
    expect(sevenDay[0].metrics.impressions).toBe(3);
  });

  test('CTR=0 when no impressions exist', () => {
    seedEvents([{ type: 'click', strategyId: 'image:quote-image', count: 5 }]);
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf[0].metrics.ctr).toBe(0);
    expect(perf[0].metrics.engagementRate).toBe(0);
  });

  test('coverage helper returns all 16 rows even with zero events (image lane: 5)', () => {
    const all = aggregateAllStrategiesWithCoverage({ companyId: COMPANY, contentType: 'image', window: '30d' });
    expect(all).toHaveLength(5);
    expect(all.every((e) => e.metrics.sampleSize === 0)).toBe(true);
  });

  test('family rollup aggregates within scope', () => {
    seedEvents([
      { type: 'impression', strategyId: 'carousel:framework-carousel', count: 50 },
      { type: 'click',      strategyId: 'carousel:framework-carousel', count: 5 },
      { type: 'impression', strategyId: 'infographic:framework', count: 50 },
      { type: 'click',      strategyId: 'infographic:framework', count: 7 },
    ]);
    const fams = aggregateByStrategyFamily({ companyId: COMPANY, window: '30d' });
    const framework = fams.find((f) => f.strategy_family === 'framework');
    expect(framework).toBeDefined();
    expect(framework!.metrics.impressions).toBe(100);
    expect(framework!.metrics.clicks).toBe(12);
  });

  test('resolveWindowMs returns documented millisecond ranges', () => {
    expect(resolveWindowMs('7d')).toBe(7 * 86400000);
    expect(resolveWindowMs('30d')).toBe(30 * 86400000);
    expect(resolveWindowMs('90d')).toBe(90 * 86400000);
    // all_time is bounded by the recorder's rolling window
    expect(resolveWindowMs('all_time')).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 5 — leaderboards                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 5 — Strategy Leaderboards', () => {
  test('ranks by engagementRate by default with sample-size tiebreak', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
      { type: 'click',      strategyId: 'image:quote-image', count: 25 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 100 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 15 },
      { type: 'impression', strategyId: 'image:brand-focus-image', count: 100 },
      { type: 'click',      strategyId: 'image:brand-focus-image', count: 8 },
    ]);
    const lb = buildStrategyLeaderboard({
      companyId: COMPANY,
      contentType: 'image',
      window: '30d',
      minSampleSize: 10,
    });
    expect(lb).toHaveLength(3);
    expect(lb[0].rank).toBe(1);
    expect(lb[0].strategy_id).toBe('image:quote-image'); // highest engagement
    expect(lb[1].strategy_id).toBe('image:promotional-image');
    expect(lb[2].strategy_id).toBe('image:brand-focus-image');
  });

  test('omits strategies below minSampleSize', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
      { type: 'click',      strategyId: 'image:quote-image', count: 10 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 2 }, // below floor
    ]);
    const lb = buildStrategyLeaderboard({
      companyId: COMPANY,
      contentType: 'image',
      window: '30d',
      minSampleSize: 10,
    });
    expect(lb).toHaveLength(1);
    expect(lb[0].strategy_id).toBe('image:quote-image');
  });

  test('respects limit', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
      { type: 'click',      strategyId: 'image:quote-image', count: 25 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 100 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 15 },
      { type: 'impression', strategyId: 'image:brand-focus-image', count: 100 },
      { type: 'click',      strategyId: 'image:brand-focus-image', count: 8 },
    ]);
    const lb = buildStrategyLeaderboard({
      companyId: COMPANY,
      contentType: 'image',
      window: '30d',
      minSampleSize: 10,
      limit: 2,
    });
    expect(lb).toHaveLength(2);
  });

  test('ranks by alternative metric when requested (saveRate)', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
      { type: 'save',       strategyId: 'image:quote-image', count: 30 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 100 },
      { type: 'save',       strategyId: 'image:promotional-image', count: 5 },
    ]);
    const lb = buildStrategyLeaderboard({
      companyId: COMPANY,
      contentType: 'image',
      window: '30d',
      minSampleSize: 10,
      rankBy: 'saveRate',
    });
    expect(lb[0].strategy_id).toBe('image:quote-image');
    expect(lb[0].rankedBy).toBe('saveRate');
  });

  test('supports 7d / 30d / 90d / all_time windows without crashing', () => {
    seedEvents([{ type: 'impression', strategyId: 'image:quote-image', count: 100 }]);
    for (const window of ['7d', '30d', '90d', 'all_time'] as StrategyTimeWindow[]) {
      const lb = buildStrategyLeaderboard({
        companyId: COMPANY,
        contentType: 'image',
        window,
        minSampleSize: 10,
      });
      expect(Array.isArray(lb)).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 6 — comparison engine                                         */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 6 — Strategy Comparison Engine', () => {
  test('reports delta + confidence + sample size when sample threshold met', () => {
    seedEvents([
      { type: 'impression', strategyId: 'carousel:story-carousel', count: 200 },
      { type: 'click',      strategyId: 'carousel:story-carousel', count: 30 },
      { type: 'impression', strategyId: 'carousel:framework-carousel', count: 200 },
      { type: 'click',      strategyId: 'carousel:framework-carousel', count: 20 },
    ]);
    const cmp = compareStrategies({
      companyId: COMPANY,
      window: '30d',
      strategyAId: 'carousel:story-carousel',
      strategyBId: 'carousel:framework-carousel',
    });
    expect(cmp.insufficientData).toBe(false);
    expect(cmp.delta).not.toBeNull();
    expect(cmp.delta!).toBeGreaterThan(0); // story wins
    expect(cmp.confidence).toBe('high');
    expect(cmp.sampleSize).toBe(450); // 230 (story: 200 imp + 30 clicks) + 220 (framework: 200 imp + 20 clicks)
    expect(cmp.summary).toMatch(/outperforms/);
  });

  test('returns insufficientData when below the minimum threshold', () => {
    seedEvents([
      { type: 'impression', strategyId: 'carousel:story-carousel', count: 3 },
    ]);
    const cmp = compareStrategies({
      companyId: COMPANY,
      window: '30d',
      strategyAId: 'carousel:story-carousel',
      strategyBId: 'carousel:framework-carousel',
    });
    expect(cmp.insufficientData).toBe(true);
    expect(cmp.summary).toBeNull();
  });

  test('handles invalid strategy ids without throwing (regression-safe)', () => {
    const cmp = compareStrategies({
      companyId: COMPANY,
      window: '30d',
      strategyAId: 'image:fictional-strategy',
      strategyBId: 'image:quote-image',
    });
    expect(cmp.insufficientData).toBe(true);
    expect(cmp.delta).toBeNull();
  });

  test('handles divide-by-zero (B has no impressions) gracefully', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
      { type: 'click',      strategyId: 'image:quote-image', count: 10 },
    ]);
    const cmp = compareStrategies({
      companyId: COMPANY,
      window: '30d',
      strategyAId: 'image:quote-image',
      strategyBId: 'image:brand-focus-image',
    });
    // B has no impressions -> engagementRate = 0 -> delta null
    expect(cmp.delta).toBeNull();
  });

  test('confidence band tracks combined sample size', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 20 },
      { type: 'click',      strategyId: 'image:quote-image', count: 3 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 20 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 2 },
    ]);
    const cmp = compareStrategies({
      companyId: COMPANY,
      window: '30d',
      strategyAId: 'image:quote-image',
      strategyBId: 'image:promotional-image',
    });
    // combined ~46 — medium band
    expect(cmp.confidence).toBe('medium');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 7 — insights engine                                           */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 7 — Strategy Insights Engine', () => {
  test('returns empty array when no data exists', () => {
    expect(generateStrategyInsights({ companyId: COMPANY, window: '30d' })).toEqual([]);
  });

  test('returns engagement-rate insight when 2 strategies clear the threshold', () => {
    seedEvents([
      { type: 'impression', strategyId: 'carousel:story-carousel', count: 100 },
      { type: 'click',      strategyId: 'carousel:story-carousel', count: 25 },
      { type: 'impression', strategyId: 'carousel:framework-carousel', count: 100 },
      { type: 'click',      strategyId: 'carousel:framework-carousel', count: 10 },
    ]);
    const insights = generateStrategyInsights({ companyId: COMPANY, window: '30d' });
    const engagement = insights.find((i) => i.metric === 'engagementRate');
    expect(engagement).toBeDefined();
    expect(engagement!.referenceStrategyIds).toEqual(
      expect.arrayContaining(['carousel:story-carousel', 'carousel:framework-carousel']),
    );
    expect(engagement!.delta).toBeGreaterThan(0);
    expect(engagement!.confidence).toBeDefined();
    expect(engagement!.text).toMatch(/outperforms/);
  });

  test('reports a save-rate insight when save winner differs from engagement winner', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:promotional-image', count: 100 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 30 },
      { type: 'save',       strategyId: 'image:promotional-image', count: 5 },
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
      { type: 'click',      strategyId: 'image:quote-image', count: 5 },
      { type: 'save',       strategyId: 'image:quote-image', count: 25 },
    ]);
    const insights = generateStrategyInsights({ companyId: COMPANY, window: '30d' });
    const save = insights.find((i) => i.metric === 'saveRate');
    expect(save).toBeDefined();
    expect(save!.text).toMatch(/saves/);
    expect(save!.referenceStrategyIds[0]).toBe('image:quote-image'); // wins on saves
  });

  test('refuses to generate insights below the sample-size threshold (no fabrication)', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 5 },
      { type: 'click',      strategyId: 'image:quote-image', count: 2 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 5 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 1 },
    ]);
    expect(generateStrategyInsights({ companyId: COMPANY, window: '30d' })).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 8 — recommendation signals                                    */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 8 — Recommendation Signals', () => {
  test('returns empty when no data exists', () => {
    expect(computeRecommendationSignals({ companyId: COMPANY, window: '30d' })).toEqual([]);
  });

  test('flags the top strategy as recommended when it has enough samples', () => {
    seedEvents([
      { type: 'impression', strategyId: 'carousel:story-carousel', count: 500 },
      { type: 'click',      strategyId: 'carousel:story-carousel', count: 60 },
      { type: 'impression', strategyId: 'carousel:framework-carousel', count: 500 },
      { type: 'click',      strategyId: 'carousel:framework-carousel', count: 20 },
    ]);
    const signals = computeRecommendationSignals({ companyId: COMPANY, window: '30d' });
    const rec = signals.find((s) => s.kind === 'recommended');
    expect(rec).toBeDefined();
    expect(rec!.strategy_id).toBe('carousel:story-carousel');
    const strong = signals.find((s) => s.kind === 'strong_performer' && s.strategy_id === 'carousel:story-carousel');
    expect(strong).toBeDefined();
  });

  test('flags an emerging performer when sample sits in [EMERGING_MIN, EMERGING_MAX]', () => {
    seedEvents([
      // Two strong performers establish a clear leader
      { type: 'impression', strategyId: 'image:quote-image', count: 200 },
      { type: 'click',      strategyId: 'image:quote-image', count: 30 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 200 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 10 },
      // Mid-sample strategy that performs decently
      { type: 'impression', strategyId: 'image:brand-focus-image', count: 50 },
      { type: 'click',      strategyId: 'image:brand-focus-image', count: 12 },
    ]);
    const signals = computeRecommendationSignals({ companyId: COMPANY, window: '30d' });
    const emerging = signals.find((s) => s.kind === 'emerging_performer');
    expect(emerging).toBeDefined();
  });

  test('does not flag an emerging performer when sample is below EMERGING_MIN', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:brand-focus-image', count: 5 },
      { type: 'click',      strategyId: 'image:brand-focus-image', count: 2 },
    ]);
    const signals = computeRecommendationSignals({ companyId: COMPANY, window: '30d' });
    expect(signals.find((s) => s.kind === 'emerging_performer')).toBeUndefined();
  });

  test('flags an underperformer when bottom-quartile AND sample is large enough', () => {
    // Three strategies, the worst one with a large but underperforming sample
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 200 },
      { type: 'click',      strategyId: 'image:quote-image', count: 40 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 200 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 25 },
      { type: 'impression', strategyId: 'image:brand-focus-image', count: 200 },
      { type: 'click',      strategyId: 'image:brand-focus-image', count: 3 },
    ]);
    const signals = computeRecommendationSignals({ companyId: COMPANY, window: '30d' });
    const under = signals.find((s) => s.kind === 'underperformer');
    expect(under).toBeDefined();
    expect(under!.strategy_id).toBe('image:brand-focus-image');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 10 — trend analysis                                           */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 10 — Trend Analysis', () => {
  test('returns insufficient_data when either period is undersampled', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 5 },
      { type: 'click',      strategyId: 'image:quote-image', count: 1 },
    ]);
    const trends = analyzeStrategyTrends({ companyId: COMPANY, window: '7d' });
    const q = trends.find((t) => t.strategy_id === 'image:quote-image');
    expect(q!.direction).toBe('insufficient_data');
  });

  test('detects rising trend when current period beats previous by threshold', () => {
    const now = Date.now();
    const sevenDayMs = 7 * 24 * 60 * 60 * 1000;
    // Previous period: ~8 days ago — low engagement
    const previousTs = new Date(now - sevenDayMs - 60 * 1000).toISOString();
    // Current period: now — high engagement
    seedEvents([
      // Previous period
      { type: 'impression', strategyId: 'image:quote-image', count: 50, occurredAt: previousTs },
      { type: 'click',      strategyId: 'image:quote-image', count: 5,  occurredAt: previousTs },
      // Current period
      { type: 'impression', strategyId: 'image:quote-image', count: 50 },
      { type: 'click',      strategyId: 'image:quote-image', count: 25 },
    ]);
    const trends = analyzeStrategyTrends({ companyId: COMPANY, window: '7d' });
    const q = trends.find((t) => t.strategy_id === 'image:quote-image');
    expect(q!.direction).toBe('rising');
    expect(q!.delta!).toBeGreaterThan(0);
  });

  test('detects declining trend when current period drops by threshold', () => {
    const now = Date.now();
    const sevenDayMs = 7 * 24 * 60 * 60 * 1000;
    const previousTs = new Date(now - sevenDayMs - 60 * 1000).toISOString();
    seedEvents([
      // Previous: hot
      { type: 'impression', strategyId: 'image:quote-image', count: 50, occurredAt: previousTs },
      { type: 'click',      strategyId: 'image:quote-image', count: 25, occurredAt: previousTs },
      // Current: cool
      { type: 'impression', strategyId: 'image:quote-image', count: 50 },
      { type: 'click',      strategyId: 'image:quote-image', count: 5 },
    ]);
    const trends = analyzeStrategyTrends({ companyId: COMPANY, window: '7d' });
    const q = trends.find((t) => t.strategy_id === 'image:quote-image');
    expect(q!.direction).toBe('declining');
    expect(q!.delta!).toBeLessThan(0);
  });

  test('detects stable trend when delta is within ±10%', () => {
    const now = Date.now();
    const sevenDayMs = 7 * 24 * 60 * 60 * 1000;
    const previousTs = new Date(now - sevenDayMs - 60 * 1000).toISOString();
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 100, occurredAt: previousTs },
      { type: 'click',      strategyId: 'image:quote-image', count: 20,  occurredAt: previousTs },
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
      { type: 'click',      strategyId: 'image:quote-image', count: 21 }, // ~5% change
    ]);
    const trends = analyzeStrategyTrends({ companyId: COMPANY, window: '7d' });
    const q = trends.find((t) => t.strategy_id === 'image:quote-image');
    expect(q!.direction).toBe('stable');
  });

  test('rising trends are sorted before declining and stable', () => {
    const now = Date.now();
    const sevenDayMs = 7 * 24 * 60 * 60 * 1000;
    const previousTs = new Date(now - sevenDayMs - 60 * 1000).toISOString();
    // Rising
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 50, occurredAt: previousTs },
      { type: 'click',      strategyId: 'image:quote-image', count: 5,  occurredAt: previousTs },
      { type: 'impression', strategyId: 'image:quote-image', count: 50 },
      { type: 'click',      strategyId: 'image:quote-image', count: 30 },
    ]);
    // Declining
    seedEvents([
      { type: 'impression', strategyId: 'image:promotional-image', count: 50, occurredAt: previousTs },
      { type: 'click',      strategyId: 'image:promotional-image', count: 30, occurredAt: previousTs },
      { type: 'impression', strategyId: 'image:promotional-image', count: 50 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 5 },
    ]);
    const trends = analyzeStrategyTrends({ companyId: COMPANY, window: '7d' });
    const directions = trends.map((t) => t.direction);
    const risingIdx = directions.indexOf('rising');
    const decliningIdx = directions.indexOf('declining');
    expect(risingIdx).toBeGreaterThanOrEqual(0);
    expect(decliningIdx).toBeGreaterThan(risingIdx);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 11 — explainability join                                      */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 11 — Preview Explainability Integration', () => {
  test('builds payload for all 16 strategies even when no events recorded', () => {
    const payload = buildStrategyExplainabilityPayloads({ companyId: COMPANY, window: '30d' });
    expect(payload).toHaveLength(16);
    for (const entry of payload) {
      expect(entry.strategy_id).toBeTruthy();
      expect(entry.displayLabel).toBeTruthy();
      expect(entry.strategy_family).toBeTruthy();
      expect(entry.content_type).toBeTruthy();
      expect(entry.trend).toBe('insufficient_data'); // no events
      expect(Array.isArray(entry.signals)).toBe(true);
    }
  });

  test('joins performance + signals into the payload when events exist', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 500 },
      { type: 'click',      strategyId: 'image:quote-image', count: 100 },
      { type: 'impression', strategyId: 'image:promotional-image', count: 500 },
      { type: 'click',      strategyId: 'image:promotional-image', count: 30 },
    ]);
    const payload = buildStrategyExplainabilityPayloads({ companyId: COMPANY, window: '30d' });
    const quote = payload.find((p) => p.strategy_id === 'image:quote-image');
    expect(quote!.performance).not.toBeNull();
    expect(quote!.performance!.impressions).toBe(500);
    expect(quote!.signals).toEqual(expect.arrayContaining(['recommended']));
  });

  test('strategies with no events keep performance = null', () => {
    seedEvents([
      { type: 'impression', strategyId: 'image:quote-image', count: 100 },
    ]);
    const payload = buildStrategyExplainabilityPayloads({ companyId: COMPANY, window: '30d' });
    const story = payload.find((p) => p.strategy_id === 'carousel:story-carousel');
    expect(story!.performance).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 12 — regression safety (end-to-end)                            */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 12 — Regression Safety', () => {
  test('aggregator returns [] for unknown company (no crash)', () => {
    expect(aggregateStrategyPerformance({ companyId: 'co-does-not-exist', window: '30d' })).toEqual([]);
  });

  test('leaderboard returns [] when no events exist', () => {
    expect(buildStrategyLeaderboard({ companyId: COMPANY, contentType: 'image', window: '30d' })).toEqual([]);
  });

  test('insight engine returns [] when no events exist (no fabrication)', () => {
    expect(generateStrategyInsights({ companyId: COMPANY, window: '30d' })).toEqual([]);
  });

  test('signal engine returns [] when no events exist', () => {
    expect(computeRecommendationSignals({ companyId: COMPANY, window: '30d' })).toEqual([]);
  });

  test('explainability payload still surfaces all 16 dimensions with null performance', () => {
    const payload = buildStrategyExplainabilityPayloads({ companyId: COMPANY, window: '30d' });
    expect(payload).toHaveLength(16);
    expect(payload.every((p) => p.performance === null)).toBe(true);
  });

  test('recorder no-ops on legacy event without strategy id', () => {
    const before = strategyAnalyticsRecorderStats().totalEvents;
    expect(recordStrategyEvent({ type: 'impression', companyId: COMPANY })).toBe(false);
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(before);
  });

  test('event enrichment returns input UNCHANGED when no strategy resolves', () => {
    const event = { post_id: 'p-1', timestamp: 't-1' };
    const enriched = enrichEngagementEvent(event, {});
    expect(enriched).toBe(event); // same object reference - additive contract
  });

  test('window outside rolling buffer (very old occurredAt) is filtered out', () => {
    const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    seedEvents([{ type: 'impression', strategyId: 'image:quote-image', count: 100, occurredAt: veryOld }]);
    expect(aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' })).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Cross-cutting — recorder stats / bounded buffer                     */
/* ─────────────────────────────────────────────────────────────────── */

describe('Bounded buffer + stats', () => {
  test('stats expose buffer caps', () => {
    const s = strategyAnalyticsRecorderStats();
    expect(s.maxOrgs).toBeGreaterThan(0);
    expect(s.maxEventsPerOrg).toBeGreaterThan(0);
    expect(s.rollingWindowMs).toBeGreaterThan(0);
  });

  test('writing many events stays within the per-org cap', () => {
    for (let i = 0; i < 2200; i++) {
      recordStrategyEvent({ type: 'impression', companyId: COMPANY, strategyId: 'image:quote-image' });
    }
    const s = strategyAnalyticsRecorderStats();
    expect(s.totalEvents).toBeLessThanOrEqual(s.maxEventsPerOrg * s.orgCount);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Family enum coverage — ensures no orphan id maps to undefined        */
/* ─────────────────────────────────────────────────────────────────── */

describe('Family enum coverage', () => {
  test('every strategy id maps to a non-null family in the enum', () => {
    for (const id of ALL_STRATEGY_IDS) {
      const fam: AnalyticsStrategyFamily | null = strategyFamilyOf(id);
      expect(fam).not.toBeNull();
    }
  });
});
