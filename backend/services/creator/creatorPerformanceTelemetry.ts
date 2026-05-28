/**
 * Creator performance telemetry + cross-campaign strategic learning +
 * human feedback reinforcement + long-term strategic memory
 * (Phases 4, 5, 7, 9).
 *
 * Single-process in-memory event store + aggregated strategic memory.
 * NOT a database, NOT ML training. Lightweight bounded ring buffers
 * + per-org rolling aggregations consumed by the autonomous optimizer.
 *
 * Phase 11 — every cache + ring buffer is BOUNDED:
 *   - 1000 events per org max
 *   - 200 orgs in the cache max (LRU)
 *   - 30-day rolling window for aggregations
 */

import type { CreativeStrategyId } from './creativeDirectorEngine';
import type { CreativeDirectionTemplate } from './creatorPromptComposer';

/* ── Event taxonomy ─────────────────────────────────────────────────── */

export type TelemetryEventType =
  | 'variant_selected'
  | 'variant_rejected'
  | 'asset_downloaded'
  | 'asset_regenerated'
  | 'asset_attached_to_writer'
  | 'asset_published'
  | 'qa_failed'
  | 'qa_passed'
  | 'governance_intervention'
  | 'governance_retry_applied'
  | 'experiment_assignment'
  | 'engagement_signal'
  | 'human_thumbs_up'
  | 'human_thumbs_down'
  | 'campaign_conversion';

export type TelemetryEvent = {
  type: TelemetryEventType;
  occurredAt: string;
  companyId: string;
  campaignId?: string | null;
  strategy?: CreativeStrategyId | null;
  template?: CreativeDirectionTemplate | null;
  platform?: string | null;
  emotionalDirection?: string | null;
  realismProfile?: string | null;
  qaScore?: number | null;
  governanceScore?: number | null;
  aestheticScore?: number | null;
  engagementMetric?: number | null;
  /** Free-form audit payload — kept small. */
  payload?: Record<string, unknown>;
};

/* ── Bounded ring buffer ────────────────────────────────────────────── */

const MAX_EVENTS_PER_ORG = 1000;
const MAX_ORGS = 200;
const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type OrgBuffer = {
  events: TelemetryEvent[];
  lastTouchedAt: number;
};

const orgBuffers = new Map<string, OrgBuffer>();

function pruneOrgsIfFull(): void {
  if (orgBuffers.size <= MAX_ORGS) return;
  // Drop the LEAST-RECENTLY-TOUCHED org.
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of orgBuffers.entries()) {
    if (v.lastTouchedAt < oldestTs) {
      oldestTs = v.lastTouchedAt;
      oldestKey = k;
    }
  }
  if (oldestKey) orgBuffers.delete(oldestKey);
}

function getOrCreateBuffer(companyId: string): OrgBuffer {
  const key = companyId.trim().toLowerCase();
  let buf = orgBuffers.get(key);
  if (!buf) {
    buf = { events: [], lastTouchedAt: Date.now() };
    orgBuffers.set(key, buf);
    pruneOrgsIfFull();
  }
  buf.lastTouchedAt = Date.now();
  return buf;
}

export function recordTelemetryEvent(event: Omit<TelemetryEvent, 'occurredAt'>): void {
  if (!event.companyId) return;
  const buf = getOrCreateBuffer(event.companyId);
  buf.events.push({ ...event, occurredAt: new Date().toISOString() });
  if (buf.events.length > MAX_EVENTS_PER_ORG) {
    buf.events.splice(0, buf.events.length - MAX_EVENTS_PER_ORG);
  }
}

/* ── Strategic aggregation ──────────────────────────────────────────── */

export type StrategyEffectiveness = {
  strategy: CreativeStrategyId;
  samples: number;
  successRate: number;             // 0-1 ratio of (selected | published) over total
  averageQaScore: number;
  averageAestheticScore: number;
  averageGovernanceScore: number;
  regenerationRate: number;        // 0-1 ratio of (regenerated) over total
  humanThumbsUp: number;
  humanThumbsDown: number;
};

export type OrgStrategicMemory = {
  companyId: string;
  observationWindowMs: number;
  totalEvents: number;
  topStrategies: ReadonlyArray<StrategyEffectiveness>;
  /** Best-performing emotional direction for this org. */
  bestEmotionalDirection: string | null;
  /** Best-performing realism profile for this org. */
  bestRealismProfile: string | null;
  /** Best-performing platform for this org. */
  bestPlatform: string | null;
  /** Strategies that failed governance / QA repeatedly — biases the
   *  optimizer to DOWN-weight them on future selection. */
  underperformingStrategies: ReadonlyArray<CreativeStrategyId>;
  computedAt: string;
};

function isRecent(event: TelemetryEvent, windowMs: number): boolean {
  return Date.now() - new Date(event.occurredAt).getTime() < windowMs;
}

export function computeOrgStrategicMemory(companyId: string): OrgStrategicMemory | null {
  const buf = orgBuffers.get(companyId.trim().toLowerCase());
  if (!buf) return null;
  const recent = buf.events.filter((e) => isRecent(e, ROLLING_WINDOW_MS));
  if (recent.length === 0) return null;

  // Per-strategy aggregation.
  const byStrategy = new Map<CreativeStrategyId, {
    total: number;
    successCount: number;
    regenerated: number;
    qaSum: number;
    qaSamples: number;
    aesSum: number;
    aesSamples: number;
    govSum: number;
    govSamples: number;
    thumbsUp: number;
    thumbsDown: number;
  }>();

  const accumByDirection = new Map<string, { samples: number; positiveSignals: number }>();
  const accumByRealism = new Map<string, { samples: number; positiveSignals: number }>();
  const accumByPlatform = new Map<string, { samples: number; positiveSignals: number }>();

  const POSITIVE_TYPES: TelemetryEventType[] = ['variant_selected', 'asset_downloaded', 'asset_attached_to_writer', 'asset_published', 'human_thumbs_up', 'campaign_conversion'];
  const NEGATIVE_TYPES: TelemetryEventType[] = ['variant_rejected', 'asset_regenerated', 'qa_failed', 'human_thumbs_down'];

  for (const event of recent) {
    if (event.strategy) {
      let bucket = byStrategy.get(event.strategy);
      if (!bucket) {
        bucket = { total: 0, successCount: 0, regenerated: 0, qaSum: 0, qaSamples: 0, aesSum: 0, aesSamples: 0, govSum: 0, govSamples: 0, thumbsUp: 0, thumbsDown: 0 };
        byStrategy.set(event.strategy, bucket);
      }
      bucket.total++;
      if (POSITIVE_TYPES.includes(event.type)) bucket.successCount++;
      if (event.type === 'asset_regenerated') bucket.regenerated++;
      if (typeof event.qaScore === 'number') { bucket.qaSum += event.qaScore; bucket.qaSamples++; }
      if (typeof event.aestheticScore === 'number') { bucket.aesSum += event.aestheticScore; bucket.aesSamples++; }
      if (typeof event.governanceScore === 'number') { bucket.govSum += event.governanceScore; bucket.govSamples++; }
      if (event.type === 'human_thumbs_up') bucket.thumbsUp++;
      if (event.type === 'human_thumbs_down') bucket.thumbsDown++;
    }
    const positiveBump = POSITIVE_TYPES.includes(event.type) ? 1 : NEGATIVE_TYPES.includes(event.type) ? -1 : 0;
    if (event.emotionalDirection) {
      const d = accumByDirection.get(event.emotionalDirection) ?? { samples: 0, positiveSignals: 0 };
      d.samples++;
      d.positiveSignals += positiveBump;
      accumByDirection.set(event.emotionalDirection, d);
    }
    if (event.realismProfile) {
      const r = accumByRealism.get(event.realismProfile) ?? { samples: 0, positiveSignals: 0 };
      r.samples++;
      r.positiveSignals += positiveBump;
      accumByRealism.set(event.realismProfile, r);
    }
    if (event.platform) {
      const p = accumByPlatform.get(event.platform) ?? { samples: 0, positiveSignals: 0 };
      p.samples++;
      p.positiveSignals += positiveBump;
      accumByPlatform.set(event.platform, p);
    }
  }

  const topStrategies: StrategyEffectiveness[] = [];
  const underperforming: CreativeStrategyId[] = [];
  for (const [strategy, bucket] of byStrategy.entries()) {
    const successRate = bucket.total > 0 ? bucket.successCount / bucket.total : 0;
    const regenerationRate = bucket.total > 0 ? bucket.regenerated / bucket.total : 0;
    const avgQa = bucket.qaSamples > 0 ? bucket.qaSum / bucket.qaSamples : 0;
    const avgAes = bucket.aesSamples > 0 ? bucket.aesSum / bucket.aesSamples : 0;
    const avgGov = bucket.govSamples > 0 ? bucket.govSum / bucket.govSamples : 0;
    const eff: StrategyEffectiveness = {
      strategy,
      samples: bucket.total,
      successRate,
      averageQaScore: avgQa,
      averageAestheticScore: avgAes,
      averageGovernanceScore: avgGov,
      regenerationRate,
      humanThumbsUp: bucket.thumbsUp,
      humanThumbsDown: bucket.thumbsDown,
    };
    topStrategies.push(eff);
    // A strategy is under-performing when it has ≥3 samples AND a high
    // regeneration rate AND a low average QA. Threshold deliberately
    // conservative — we never auto-disable strategies, only down-weight.
    if (bucket.total >= 3 && regenerationRate > 0.5 && avgQa < 60) {
      underperforming.push(strategy);
    }
  }
  // Sort by composite score: success rate weighted by sample size.
  topStrategies.sort((a, b) => (b.successRate * Math.log1p(b.samples)) - (a.successRate * Math.log1p(a.samples)));

  function pickBest(map: Map<string, { samples: number; positiveSignals: number }>): string | null {
    let bestKey: string | null = null;
    let bestSignal = -Infinity;
    for (const [k, v] of map.entries()) {
      if (v.samples < 2) continue;
      const signal = v.positiveSignals;
      if (signal > bestSignal) {
        bestSignal = signal;
        bestKey = k;
      }
    }
    return bestSignal > 0 ? bestKey : null;
  }

  return {
    companyId,
    observationWindowMs: ROLLING_WINDOW_MS,
    totalEvents: recent.length,
    topStrategies: topStrategies.slice(0, 8),
    bestEmotionalDirection: pickBest(accumByDirection),
    bestRealismProfile: pickBest(accumByRealism),
    bestPlatform: pickBest(accumByPlatform),
    underperformingStrategies: underperforming,
    computedAt: new Date().toISOString(),
  };
}

/* ── Human-preference snapshot ──────────────────────────────────────── */

export type HumanPreferenceSnapshot = {
  companyId: string;
  preferredStrategies: ReadonlyArray<CreativeStrategyId>;
  unfavoredStrategies: ReadonlyArray<CreativeStrategyId>;
  preferredEmotionalDirection: string | null;
  preferredRealismProfile: string | null;
  preferredPlatformAdaptation: string | null;
  thumbsUpCount: number;
  thumbsDownCount: number;
};

export function computeHumanPreferenceSnapshot(companyId: string): HumanPreferenceSnapshot | null {
  const memory = computeOrgStrategicMemory(companyId);
  if (!memory) return null;
  const preferred = memory.topStrategies
    .filter((s) => s.humanThumbsUp > s.humanThumbsDown && s.samples >= 2)
    .map((s) => s.strategy);
  const unfavored = memory.topStrategies
    .filter((s) => s.humanThumbsDown > s.humanThumbsUp && s.humanThumbsDown >= 2)
    .map((s) => s.strategy);
  const thumbsUp = memory.topStrategies.reduce((sum, s) => sum + s.humanThumbsUp, 0);
  const thumbsDown = memory.topStrategies.reduce((sum, s) => sum + s.humanThumbsDown, 0);
  return {
    companyId,
    preferredStrategies: preferred,
    unfavoredStrategies: unfavored,
    preferredEmotionalDirection: memory.bestEmotionalDirection,
    preferredRealismProfile: memory.bestRealismProfile,
    preferredPlatformAdaptation: memory.bestPlatform,
    thumbsUpCount: thumbsUp,
    thumbsDownCount: thumbsDown,
  };
}

/* ── Diagnostics ────────────────────────────────────────────────────── */

export function telemetryStats(): { orgCount: number; maxOrgs: number; maxEventsPerOrg: number; rollingWindowMs: number } {
  return {
    orgCount: orgBuffers.size,
    maxOrgs: MAX_ORGS,
    maxEventsPerOrg: MAX_EVENTS_PER_ORG,
    rollingWindowMs: ROLLING_WINDOW_MS,
  };
}

export function clearAllTelemetry(): void {
  orgBuffers.clear();
}
