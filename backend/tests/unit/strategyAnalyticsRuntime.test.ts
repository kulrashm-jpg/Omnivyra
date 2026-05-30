/**
 * Strategy Analytics Runtime Activation — end-to-end suite.
 *
 * Covers PHASE 1-7 of the runtime activation prompt:
 *
 *   PHASE 2 — extraction from creator_attachment_metadata
 *             (canonical envelope + renderManifest fallback + null cases)
 *
 *   PHASE 3 — runtime emit-side helpers (recordPostAnalyticsStrategyEvents,
 *             recordCommentStrategyEvents,
 *             recordCampaignPerformanceStrategyEvents)
 *
 *   PHASE 4 — end-to-end attribution chain:
 *             attachment → resolver → recorder → aggregator → leaderboard
 *
 *   PHASE 5 — dashboard reflection (leaderboards / signals / trends move
 *             when events are recorded)
 *
 *   PHASE 6 — safety: analytics failures NEVER throw; legacy posts pass
 *             through unaffected
 *
 *   PHASE 7 — per-metric attribution (impression, click, save, share,
 *             reaction, comment) + delta math + dedup
 */

import {
  type StrategyAttribution,
  clearStrategyAttributionCache,
  extractStrategyAttributionFromAttachments,
} from '../../services/creator/strategyAttributionResolver';
import {
  clearStrategyAnalyticsRuntimeCaches,
  recordCampaignPerformanceStrategyEvents,
  recordCommentStrategyEvents,
  recordPostAnalyticsStrategyEvents,
  strategyAnalyticsRuntimeStats,
} from '../../services/creator/strategyAnalyticsRuntime';
import {
  clearAllStrategyAnalytics,
  strategyAnalyticsRecorderStats,
} from '../../services/creator/strategyAnalyticsRecorder';
import {
  aggregateStrategyPerformance,
  buildStrategyLeaderboard,
} from '../../services/creator/strategyPerformanceAggregator';
import { computeRecommendationSignals } from '../../services/creator/strategyInsightsEngine';

/* ── Test fixtures ───────────────────────────────────────────────── */

const COMPANY = 'co-runtime-activation';
const CAMPAIGN = 'camp-runtime';
const CREATOR = 'user-creator';

function buildAttribution(strategyId: string): StrategyAttribution {
  return {
    dimensions: {
      strategy_id: strategyId,
      strategy_family: 'quote',
      content_type: 'image',
      layout_type: 'image-overlay',
      render_strategy_id: strategyId,
      purpose_family: 'quote',
    },
    companyId: COMPANY,
    campaignId: CAMPAIGN,
    creatorId: CREATOR,
    platform: 'linkedin',
    mediaBundleMetadata: null,
  };
}

beforeEach(() => {
  clearAllStrategyAnalytics();
  clearStrategyAttributionCache();
  clearStrategyAnalyticsRuntimeCaches();
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 2 — synchronous attribution extraction                        */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 2 — Extracting attribution from creator_attachment_metadata', () => {
  test('reads canonical strategy_analytics envelope at attachment root', () => {
    const result = extractStrategyAttributionFromAttachments([
      {
        id: 'a-1',
        creatorType: 'image',
        strategy_analytics: { strategy_id: 'image:quote-image' },
      },
    ]);
    expect(result).not.toBeNull();
    expect(result!.dimensions.strategy_id).toBe('image:quote-image');
    expect(result!.dimensions.strategy_family).toBe('quote');
  });

  test('falls back to renderManifest.media_bundle.metadata.strategy_analytics', () => {
    const result = extractStrategyAttributionFromAttachments([
      {
        id: 'a-1',
        renderManifest: {
          media_bundle: {
            metadata: {
              strategy_analytics: { strategy_id: 'carousel:framework-carousel' },
            },
          },
        },
      },
    ]);
    expect(result).not.toBeNull();
    expect(result!.dimensions.strategy_id).toBe('carousel:framework-carousel');
    expect(result!.dimensions.strategy_family).toBe('framework');
  });

  test('falls back to purpose_strategy.id when no strategy_analytics envelope', () => {
    const result = extractStrategyAttributionFromAttachments([
      {
        renderManifest: {
          media_bundle: {
            metadata: {
              purpose_strategy: { id: 'infographic:comparison' },
            },
          },
        },
      },
    ]);
    expect(result).not.toBeNull();
    expect(result!.dimensions.strategy_id).toBe('infographic:comparison');
    expect(result!.dimensions.content_type).toBe('infographic');
  });

  test('walks multi-attachment arrays and picks the first resolvable strategy', () => {
    const result = extractStrategyAttributionFromAttachments([
      { id: 'no-strategy' },
      { renderManifest: { media_bundle: { metadata: {} } } },
      { strategy_analytics: { strategy_id: 'image:promotional-image' } },
    ]);
    expect(result).not.toBeNull();
    expect(result!.dimensions.strategy_id).toBe('image:promotional-image');
  });

  test('returns null when no attachment carries strategy info (PHASE 12 legacy)', () => {
    expect(extractStrategyAttributionFromAttachments(null)).toBeNull();
    expect(extractStrategyAttributionFromAttachments([])).toBeNull();
    expect(extractStrategyAttributionFromAttachments([{ id: 'a-1' }])).toBeNull();
    expect(extractStrategyAttributionFromAttachments([{
      renderManifest: { media_bundle: { metadata: {} } },
    }])).toBeNull();
  });

  test('snake_case render_manifest variant is supported', () => {
    const result = extractStrategyAttributionFromAttachments([
      {
        render_manifest: {
          media_bundle: {
            metadata: {
              strategy_analytics: { strategy_id: 'carousel:story-carousel' },
            },
          },
        },
      },
    ]);
    expect(result).not.toBeNull();
    expect(result!.dimensions.strategy_id).toBe('carousel:story-carousel');
  });

  test('rejects strategy_analytics with unknown id', () => {
    const result = extractStrategyAttributionFromAttachments([
      { strategy_analytics: { strategy_id: 'image:fictional-strategy' } },
    ]);
    expect(result).toBeNull();
  });

  test('rejects non-object attachment entries', () => {
    expect(extractStrategyAttributionFromAttachments([
      'string-attachment',
      42,
      null,
      undefined,
    ])).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 3 — runtime emit helpers (direct invocation, no DB)            */
/* ─────────────────────────────────────────────────────────────────── */

/**
 * For these tests we monkey-patch the resolver so that we can drive
 * runtime behavior without DB. The runtime module dynamically imports
 * the resolver via the same module specifier, so a jest.mock applied
 * to the resolver module is picked up by both the test and the runtime.
 */
jest.mock('../../services/creator/strategyAttributionResolver', () => {
  const actual = jest.requireActual('../../services/creator/strategyAttributionResolver');
  return {
    ...actual,
    resolveStrategyAttributionForScheduledPost: jest.fn(),
  };
});

const { resolveStrategyAttributionForScheduledPost } =
  require('../../services/creator/strategyAttributionResolver');

describe('PHASE 3 — recordPostAnalyticsStrategyEvents', () => {
  test('emits one event per non-zero metric type on first poll', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-1',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: {
        likes: 10,
        comments: 5,
        shares: 2,
        saves: 3,
        impressions: 100,
        reach: 100,
        views: 50,
        raw: {},
      } as any,
    });
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf).toHaveLength(1);
    expect(perf[0].metrics.impressions).toBe(100);
    expect(perf[0].metrics.saves).toBe(3);
    expect(perf[0].metrics.shares).toBe(2);
    expect(perf[0].metrics.reactions).toBe(10); // likes mapped to reactions
    expect(perf[0].metrics.comments).toBe(5);
  });

  test('emits only the DELTA on a re-poll (no double-count)', async () => {
    const attribution = buildAttribution('image:quote-image');
    (resolveStrategyAttributionForScheduledPost as jest.Mock)
      .mockResolvedValueOnce(attribution)
      .mockResolvedValueOnce(attribution);

    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-1',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: {
        likes: 10, comments: 5, shares: 2, saves: 3,
        impressions: 100, reach: 100, views: 50, raw: {},
      } as any,
    });
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-1',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: {
        likes: 12, comments: 7, shares: 2, saves: 4,
        impressions: 150, reach: 150, views: 75, raw: {},
      } as any,
    });
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf[0].metrics.impressions).toBe(150);  // 100 + 50 delta
    expect(perf[0].metrics.reactions).toBe(12);     // 10 + 2 delta
    expect(perf[0].metrics.comments).toBe(7);       // 5 + 2 delta
    expect(perf[0].metrics.shares).toBe(2);         // 2 + 0 delta
    expect(perf[0].metrics.saves).toBe(4);          // 3 + 1 delta
  });

  test('no-ops on null attribution (legacy post / no creator attachment)', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(null);
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'legacy-post',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: {
        likes: 50, comments: 10, shares: 5, saves: 8,
        impressions: 1000, reach: 800, views: 600, raw: {},
      } as any,
    });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('no-ops on attribution missing companyId', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce({
      ...buildAttribution('image:quote-image'),
      companyId: null,
    });
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-1',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 5, comments: 0, shares: 0, saves: 0, impressions: 50, reach: 50, views: 0, raw: {} } as any,
    });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('safety — never throws when resolver throws', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockRejectedValueOnce(new Error('db boom'));
    await expect(recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-1',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 1, comments: 0, shares: 0, saves: 0, impressions: 10, reach: 10, views: 0, raw: {} } as any,
    })).resolves.not.toThrow();
  });

  test('safety — never throws on malformed input', async () => {
    await expect(recordPostAnalyticsStrategyEvents(null as any)).resolves.not.toThrow();
    await expect(recordPostAnalyticsStrategyEvents({} as any)).resolves.not.toThrow();
    await expect(recordPostAnalyticsStrategyEvents({ scheduled_post_id: '' } as any)).resolves.not.toThrow();
  });

  test('zero-metric snapshot emits nothing', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-zero',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 0, comments: 0, shares: 0, saves: 0, impressions: 0, reach: 0, views: 0, raw: {} } as any,
    });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });
});

describe('PHASE 3 — recordCommentStrategyEvents', () => {
  test('emits one comment event per comment in the batch', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordCommentStrategyEvents({ scheduledPostId: 'post-1', commentCount: 5 });
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf[0].metrics.comments).toBe(5);
  });

  test('no-ops on commentCount <= 0', async () => {
    await recordCommentStrategyEvents({ scheduledPostId: 'post-1', commentCount: 0 });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('no-ops on null attribution', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(null);
    await recordCommentStrategyEvents({ scheduledPostId: 'legacy-post', commentCount: 10 });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('safety — never throws on malformed input', async () => {
    await expect(recordCommentStrategyEvents(null as any)).resolves.not.toThrow();
    await expect(recordCommentStrategyEvents({} as any)).resolves.not.toThrow();
    await expect(recordCommentStrategyEvents({ scheduledPostId: '', commentCount: 5 } as any)).resolves.not.toThrow();
  });
});

describe('PHASE 3 — recordCampaignPerformanceStrategyEvents', () => {
  test('emits one engagement event with the rollup total as weight', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('carousel:framework-carousel'),
    );
    await recordCampaignPerformanceStrategyEvents({ scheduledPostId: 'post-7', engagementTotal: 42 });
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf[0].metrics.engagements).toBe(42);
  });

  test('no-ops on null attribution', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(null);
    await recordCampaignPerformanceStrategyEvents({ scheduledPostId: 'legacy', engagementTotal: 100 });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('no-ops on engagementTotal <= 0', async () => {
    await recordCampaignPerformanceStrategyEvents({ scheduledPostId: 'post', engagementTotal: 0 });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('safety — never throws on malformed input', async () => {
    await expect(recordCampaignPerformanceStrategyEvents(null as any)).resolves.not.toThrow();
    await expect(recordCampaignPerformanceStrategyEvents({} as any)).resolves.not.toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 4 + 5 — end-to-end attribution + dashboard reflection         */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 4 — end-to-end attribution chain (attachment → leaderboard)', () => {
  test('attachment metadata flows to leaderboard ranking', async () => {
    // Two posts, two different strategies — each gets emitted via the
    // runtime helper and should show up on the appropriate lane
    // leaderboard with correct ranking.
    (resolveStrategyAttributionForScheduledPost as jest.Mock)
      .mockResolvedValueOnce(buildAttribution('image:quote-image'))
      .mockResolvedValueOnce(buildAttribution('image:promotional-image'));

    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-quote',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: {
        likes: 30, comments: 10, shares: 5, saves: 8,
        impressions: 100, reach: 100, views: 0, raw: {},
      } as any,
    });
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-promo',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: {
        likes: 5, comments: 1, shares: 1, saves: 0,
        impressions: 100, reach: 100, views: 0, raw: {},
      } as any,
    });

    const lb = buildStrategyLeaderboard({
      companyId: COMPANY,
      contentType: 'image',
      window: '30d',
      minSampleSize: 10,
    });
    expect(lb).toHaveLength(2);
    expect(lb[0].rank).toBe(1);
    expect(lb[0].strategy_id).toBe('image:quote-image');
    expect(lb[1].strategy_id).toBe('image:promotional-image');
  });
});

describe('PHASE 5 — dashboard signals reflect live telemetry', () => {
  test('recording strong-performer events flips a strategy to recommended', async () => {
    // Before: no events → no signals.
    expect(computeRecommendationSignals({ companyId: COMPANY, window: '30d' })).toEqual([]);

    // Seed lots of high-engagement events for a single strategy.
    for (let i = 0; i < 30; i++) {
      (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
        buildAttribution('image:quote-image'),
      );
      await recordPostAnalyticsStrategyEvents({
        scheduled_post_id: `post-${i}`,
        platform: 'linkedin',
        analytics_date: '2026-05-29',
        metrics: {
          likes: 5, comments: 2, shares: 1, saves: 2,
          impressions: 20, reach: 20, views: 0, raw: {},
        } as any,
      });
    }

    const signals = computeRecommendationSignals({ companyId: COMPANY, window: '30d' });
    expect(signals.length).toBeGreaterThan(0);
    const recommended = signals.find((s) => s.kind === 'recommended');
    expect(recommended).toBeDefined();
    expect(recommended!.strategy_id).toBe('image:quote-image');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 6 — safety regression suite                                   */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 6 — safety contracts (no analytics failure may block ingestion)', () => {
  test('legacy post (null attribution) leaves the recorder buffer empty', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(null);
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'legacy',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: {
        likes: 100, comments: 50, shares: 20, saves: 30,
        impressions: 5000, reach: 4000, views: 3000, raw: {},
      } as any,
    });
    expect(strategyAnalyticsRecorderStats().totalEvents).toBe(0);
  });

  test('post-analytics helper never throws when input is malformed', async () => {
    await expect(recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'p',
      platform: 'x',
      analytics_date: 'invalid',
      metrics: null as any,
    })).resolves.not.toThrow();
  });

  test('dedup cache stat surface bounded + non-empty after activity', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'post-stat-1',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 1, comments: 0, shares: 0, saves: 0, impressions: 10, reach: 10, views: 0, raw: {} } as any,
    });
    const stats = strategyAnalyticsRuntimeStats();
    expect(stats.dedupSize).toBeGreaterThan(0);
    expect(stats.maxDedupEntries).toBeGreaterThan(0);
    expect(stats.dedupSize).toBeLessThanOrEqual(stats.maxDedupEntries);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 7 — per-metric attribution                                    */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 7 — per-metric attribution', () => {
  test('impression attribution', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'p-i',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 0, comments: 0, shares: 0, saves: 0, impressions: 100, reach: 100, views: 0, raw: {} } as any,
    });
    expect(aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' })[0].metrics.impressions).toBe(100);
  });

  test('save attribution', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'p-s',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 0, comments: 0, shares: 0, saves: 15, impressions: 0, reach: 0, views: 0, raw: {} } as any,
    });
    expect(aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' })[0].metrics.saves).toBe(15);
  });

  test('share attribution', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'p-sh',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 0, comments: 0, shares: 7, saves: 0, impressions: 0, reach: 0, views: 0, raw: {} } as any,
    });
    expect(aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' })[0].metrics.shares).toBe(7);
  });

  test('reaction attribution (likes mapped to reactions)', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'p-r',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 25, comments: 0, shares: 0, saves: 0, impressions: 0, reach: 0, views: 0, raw: {} } as any,
    });
    expect(aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' })[0].metrics.reactions).toBe(25);
  });

  test('comment attribution via comment helper', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('image:quote-image'),
    );
    await recordCommentStrategyEvents({ scheduledPostId: 'p-c', commentCount: 9 });
    expect(aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' })[0].metrics.comments).toBe(9);
  });

  test('aggregated engagement via campaign performance helper', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock).mockResolvedValueOnce(
      buildAttribution('infographic:comparison'),
    );
    await recordCampaignPerformanceStrategyEvents({ scheduledPostId: 'p-e', engagementTotal: 123 });
    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf[0].metrics.engagements).toBe(123);
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* PHASE 7 — legacy assets remain unaffected                            */
/* ─────────────────────────────────────────────────────────────────── */

describe('PHASE 7 — legacy assets remain unaffected', () => {
  test('a legacy poll alongside a strategy-attributed poll leaves only the latter on the leaderboard', async () => {
    (resolveStrategyAttributionForScheduledPost as jest.Mock)
      .mockResolvedValueOnce(null) // legacy
      .mockResolvedValueOnce(buildAttribution('image:quote-image'));

    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'legacy',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 1000, comments: 500, shares: 100, saves: 50, impressions: 50000, reach: 40000, views: 0, raw: {} } as any,
    });
    await recordPostAnalyticsStrategyEvents({
      scheduled_post_id: 'with-strategy',
      platform: 'linkedin',
      analytics_date: '2026-05-29',
      metrics: { likes: 10, comments: 5, shares: 1, saves: 1, impressions: 50, reach: 50, views: 0, raw: {} } as any,
    });

    const perf = aggregateStrategyPerformance({ companyId: COMPANY, window: '30d' });
    expect(perf).toHaveLength(1);
    expect(perf[0].strategy_id).toBe('image:quote-image');
    expect(perf[0].metrics.impressions).toBe(50);
  });
});
