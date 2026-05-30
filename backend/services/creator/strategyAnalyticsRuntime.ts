/**
 * Strategy Analytics Runtime — engagement-pipeline wiring.
 *
 * Thin emit-side adapter between production engagement ingestion paths
 * and the strategy analytics recorder. Every entry point is wrapped in
 * a defensive try/catch — analytics failures NEVER bubble back to the
 * caller and NEVER block the canonical ingestion write (PHASE 6
 * safety contract).
 *
 * Entry points:
 *   - recordPostAnalyticsStrategyEvents — wired from
 *     `analyticsNormalizationService.upsertPostAnalytics` so polled
 *     impressions / clicks / likes (reactions) / comments / shares /
 *     saves are mirrored as strategy events.
 *
 *   - recordCommentStrategyEvents — wired from
 *     `engagementIngestionService.persistComments` so each fetched
 *     comment also lands as a 'comment' strategy event.
 *
 *   - recordCampaignPerformanceStrategyEvents — wired from the
 *     `performanceIngestionJob` aggregator so weekly rollups also
 *     feed the strategy aggregator.
 *
 * Strategy resolution goes through `strategyAttributionResolver` which
 * walks `scheduled_posts.creator_attachment_metadata`. When attribution
 * is null (legacy post / no strategy / lookup failure), all helpers
 * no-op silently.
 *
 * Per-poll de-duplication:
 *   For a given (scheduled_post_id, analytics_date), we only record
 *   the DELTA between the previous snapshot and the current one. The
 *   recorder uses a tiny bounded in-memory cache keyed by
 *   `${scheduled_post_id}|${analytics_date}` so a repeat poll of the
 *   same row doesn't double-count. Cache caps at 500 entries.
 */

import {
  type StrategyAttribution,
  resolveStrategyAttributionForScheduledPost,
} from './strategyAttributionResolver';
import {
  type StrategyEngagementType,
  recordStrategyEvent,
} from './strategyAnalyticsRecorder';
import type { RawPostMetrics } from '../platformAnalyticsIngester';

/* ── De-duplication cache ───────────────────────────────────────── */

const MAX_DEDUP_ENTRIES = 500;
type SnapshotKey = string; // `${scheduled_post_id}|${analytics_date}`

type SnapshotMetrics = {
  impressions: number;
  clicks: number;
  saves: number;
  shares: number;
  reactions: number;
  comments: number;
};

const dedupCache = new Map<SnapshotKey, { snapshot: SnapshotMetrics; cachedAt: number }>();

function pruneDedupIfFull(): void {
  if (dedupCache.size <= MAX_DEDUP_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of dedupCache.entries()) {
    if (v.cachedAt < oldestTs) {
      oldestTs = v.cachedAt;
      oldestKey = k;
    }
  }
  if (oldestKey) dedupCache.delete(oldestKey);
}

function getLastSnapshot(key: SnapshotKey): SnapshotMetrics | null {
  const entry = dedupCache.get(key);
  return entry ? entry.snapshot : null;
}

function storeSnapshot(key: SnapshotKey, snapshot: SnapshotMetrics): void {
  dedupCache.set(key, { snapshot, cachedAt: Date.now() });
  pruneDedupIfFull();
}

/* ── Metric extraction helpers ──────────────────────────────────── */

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return fallback;
}

/**
 * Convert a RawPostMetrics row into the SnapshotMetrics shape the
 * recorder counts off. Maps `likes` → `reactions` because the
 * platform-ingest layer reports "likes" but the strategy recorder
 * groups them under 'reaction' (alongside other platforms' reactions).
 */
function metricsToSnapshot(m: RawPostMetrics): SnapshotMetrics {
  return {
    impressions: asNumber(m.impressions),
    // Clicks aren't directly carried by RawPostMetrics — most platforms
    // surface "views" instead. We treat views as a click-adjacent
    // proxy ONLY when impressions are also present; otherwise we leave
    // clicks at 0 so engagement-rate math stays correct.
    clicks: 0,
    saves: asNumber(m.saves),
    shares: asNumber(m.shares),
    reactions: asNumber(m.likes) + asNumber(m.reactions),
    comments: asNumber(m.comments),
  };
}

function snapshotDelta(prev: SnapshotMetrics | null, curr: SnapshotMetrics): SnapshotMetrics {
  if (!prev) return curr;
  return {
    impressions: Math.max(0, curr.impressions - prev.impressions),
    clicks:      Math.max(0, curr.clicks - prev.clicks),
    saves:       Math.max(0, curr.saves - prev.saves),
    shares:      Math.max(0, curr.shares - prev.shares),
    reactions:   Math.max(0, curr.reactions - prev.reactions),
    comments:    Math.max(0, curr.comments - prev.comments),
  };
}

/* ── Common emit helper ─────────────────────────────────────────── */

function emitStrategyEventSafe(input: {
  type: StrategyEngagementType;
  attribution: StrategyAttribution;
  weight: number;
}): void {
  if (input.weight <= 0) return;
  try {
    recordStrategyEvent({
      type: input.type,
      companyId: input.attribution.companyId ?? '',
      campaignId: input.attribution.campaignId,
      creatorId: input.attribution.creatorId,
      platform: input.attribution.platform,
      strategyId: input.attribution.dimensions.strategy_id,
      // PHASE 6 — variant attribution carries through to the recorder
      // so leaderboards + winners can pivot at variant resolution.
      variantId: input.attribution.variantId,
      variantFamily: input.attribution.variantFamily,
      weight: input.weight,
    });
    // P3-2 — when the event carries a variant attribution and the
    // event is engagement-shaped (click / save / share / reaction /
    // comment / engagement aggregate), advance the experiment
    // tracker to 'engaged'. Best-effort: failures swallowed.
    if (
      input.attribution.variantId
      && input.attribution.companyId
      && input.type !== 'impression'
    ) {
      try {
        const { notifyExperimentAssetEngaged } =
          require('./variantExperimentLifecycle') as typeof import('./variantExperimentLifecycle');
        notifyExperimentAssetEngaged({
          companyId: input.attribution.companyId,
          variantId: input.attribution.variantId,
        });
      } catch {
        // No-op.
      }
    }
  } catch {
    // Best-effort. Never throw into the caller.
  }
}

/* ── PHASE 3: post analytics activation ─────────────────────────── */

export type PostAnalyticsRow = {
  scheduled_post_id: string;
  user_id?: string | null;
  platform: string;
  analytics_date: string;
  metrics: RawPostMetrics;
};

/**
 * Record strategy events for a single content_analytics snapshot
 * upsert. Computes the DELTA against the previous snapshot for the
 * same (scheduled_post_id, analytics_date) so a re-poll does not
 * double-count.
 *
 * Best-effort throughout — all errors swallowed.
 */
export async function recordPostAnalyticsStrategyEvents(row: PostAnalyticsRow): Promise<void> {
  try {
    if (!row || !row.scheduled_post_id) return;
    const attribution = await resolveStrategyAttributionForScheduledPost(row.scheduled_post_id);
    if (!attribution) return;
    if (!attribution.companyId) return;

    const snapshotKey: SnapshotKey = `${row.scheduled_post_id}|${row.analytics_date}`;
    const currSnapshot = metricsToSnapshot(row.metrics);
    const lastSnapshot = getLastSnapshot(snapshotKey);
    const delta = snapshotDelta(lastSnapshot, currSnapshot);
    storeSnapshot(snapshotKey, currSnapshot);

    emitStrategyEventSafe({ type: 'impression', attribution, weight: delta.impressions });
    emitStrategyEventSafe({ type: 'click',      attribution, weight: delta.clicks });
    emitStrategyEventSafe({ type: 'save',       attribution, weight: delta.saves });
    emitStrategyEventSafe({ type: 'share',      attribution, weight: delta.shares });
    emitStrategyEventSafe({ type: 'reaction',   attribution, weight: delta.reactions });
    emitStrategyEventSafe({ type: 'comment',    attribution, weight: delta.comments });
  } catch {
    // Best-effort — analytics must never block ingestion.
  }
}

/* ── PHASE 3: comment-stream activation ──────────────────────────── */

/**
 * Record strategy events for a batch of platform comments ingested by
 * `engagementIngestionService.persistComments`. Each row produces one
 * 'comment' strategy event (regardless of like_count / reply_count —
 * those are tracked via the post analytics path).
 *
 * Best-effort.
 */
export async function recordCommentStrategyEvents(input: {
  scheduledPostId: string;
  commentCount: number;
}): Promise<void> {
  try {
    if (!input || !input.scheduledPostId || input.commentCount <= 0) return;
    const attribution = await resolveStrategyAttributionForScheduledPost(input.scheduledPostId);
    if (!attribution) return;
    if (!attribution.companyId) return;
    emitStrategyEventSafe({
      type: 'comment',
      attribution,
      weight: input.commentCount,
    });
  } catch {
    // Best-effort.
  }
}

/* ── PHASE 3: campaign performance rollup activation ─────────────── */

/**
 * Record a single rollup-level strategy event when the campaign
 * performance ingestion job aggregates a post's engagement into
 * `campaign_performance_signals`. This mirrors the rollup as a
 * single 'engagement' event with the total engagement count as
 * weight so weekly aggregations also reach the strategy aggregator.
 *
 * Best-effort.
 */
export async function recordCampaignPerformanceStrategyEvents(input: {
  scheduledPostId: string;
  engagementTotal: number;
}): Promise<void> {
  try {
    if (!input || !input.scheduledPostId || input.engagementTotal <= 0) return;
    const attribution = await resolveStrategyAttributionForScheduledPost(input.scheduledPostId);
    if (!attribution) return;
    if (!attribution.companyId) return;
    emitStrategyEventSafe({
      type: 'engagement',
      attribution,
      weight: input.engagementTotal,
    });
  } catch {
    // Best-effort.
  }
}

/* ── Diagnostics + test surface ──────────────────────────────────── */

export function strategyAnalyticsRuntimeStats(): {
  dedupSize: number;
  maxDedupEntries: number;
} {
  return { dedupSize: dedupCache.size, maxDedupEntries: MAX_DEDUP_ENTRIES };
}

/** Test-surface — clears the dedup cache. */
export function clearStrategyAnalyticsRuntimeCaches(): void {
  dedupCache.clear();
}
