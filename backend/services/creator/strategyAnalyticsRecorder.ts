/**
 * Strategy Analytics Recorder.
 *
 * Records strategy-attributed engagement events into a bounded
 * in-memory ring buffer. Mirrors the pattern from
 * `creatorPerformanceTelemetry.ts` (single-process bounded ring,
 * 30-day rolling window) so the analytics surface does NOT require
 * new storage tables (PHASE 2 + PHASE 12 constraint).
 *
 * Phases addressed:
 *   - PHASE 2 — asset attribution helper (`enrichAssetMetadataWithStrategyAnalytics`)
 *   - PHASE 3 — additive event enrichment (`enrichEngagementEvent`)
 *   - PHASE 12 — legacy events with no strategy id pass through
 *                unchanged; recorder no-ops gracefully.
 *
 * STRICT non-goals (enforced here):
 *   - No external network calls.
 *   - No new storage tables.
 *   - No mutation of existing event contracts.
 *   - No auto-modification of campaigns / generation behavior.
 *
 * All caches are BOUNDED:
 *   - 2000 strategy events per org max (rolling)
 *   - 200 orgs in the cache max (LRU eviction)
 *   - 30-day rolling observation window
 */

import {
  type AnalyticsContentType,
  type AnalyticsStrategyFamily,
  type StrategyAnalyticsDimensions,
  isKnownStrategyId,
  resolveStrategyAnalyticsDimensions,
  resolveStrategyAnalyticsDimensionsFromMetadata,
} from './strategyAnalyticsRegistry';

/* ── Event taxonomy (additive — does NOT replace any existing event) ── */

export type StrategyEngagementType =
  | 'impression'
  | 'click'
  | 'save'
  | 'share'
  | 'reaction'
  | 'comment'
  | 'engagement';

export type StrategyAnalyticsEvent = {
  type: StrategyEngagementType;
  occurredAt: string;
  companyId: string;
  campaignId?: string | null;
  creatorId?: string | null;
  platform?: string | null;
  /** Resolved strategy dimensions. When null, the event is dropped
   *  (recorder is for STRATEGY-ATTRIBUTED events only — legacy events
   *  flow through their existing pipelines untouched). */
  dimensions: StrategyAnalyticsDimensions;
  /** Optional weight — defaults to 1. Used when an event represents an
   *  aggregated batch (e.g. nightly impression rollup). */
  weight: number;
  /** Optional variant id — when set, the event is attributable at the
   *  variant level (PHASE 6). When null, the event is strategy-level
   *  only and the variant aggregator treats it as `baseline`. */
  variantId?: string | null;
  /** Optional variant family — 'v1' | 'v2' | 'v3' | null. */
  variantFamily?: string | null;
};

/* ── Bounded ring buffer ────────────────────────────────────────── */

const MAX_EVENTS_PER_ORG = 2000;
const MAX_ORGS = 200;
const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type OrgBuffer = {
  events: StrategyAnalyticsEvent[];
  lastTouchedAt: number;
};

const orgBuffers = new Map<string, OrgBuffer>();

function pruneOrgsIfFull(): void {
  if (orgBuffers.size <= MAX_ORGS) return;
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

/* ── PHASE 2: asset attribution ──────────────────────────────────── */

/**
 * Returns the `strategy_analytics` envelope that should be written
 * onto `assetPayload.media_bundle.metadata.strategy_analytics`. The
 * renderer calls this helper from the bundle-metadata block in
 * `creatorAssetRenderer.ts`. When the asset has no resolvable
 * strategy id, returns null and the caller MUST leave the metadata
 * envelope absent (PHASE 12 regression safety).
 *
 * When the metadata also carries an `applied_variant` envelope (set
 * by the variant renderer wiring), the returned attribution
 * additionally exposes `variant_id` + `variant_family` so the
 * downstream recorder + aggregator can group by variant
 * (PHASE 6 — variant analytics attribution).
 */
export function buildStrategyAnalyticsAttribution(
  metadata: Record<string, unknown> | null | undefined,
): {
  strategy_id: string;
  strategy_family: AnalyticsStrategyFamily;
  content_type: AnalyticsContentType;
  layout_type: StrategyAnalyticsDimensions['layout_type'];
  render_strategy_id: string;
  purpose_family: AnalyticsStrategyFamily;
  variant_id: string | null;
  variant_family: string | null;
} | null {
  const dims = resolveStrategyAnalyticsDimensionsFromMetadata(metadata ?? null);
  if (!dims) return null;
  // Variant fields (optional). Pull from `applied_variant` envelope
  // if present, otherwise from a flat `variant_id` / `variant_family`
  // — both shapes are supported.
  let variantId: string | null = null;
  let variantFamily: string | null = null;
  if (metadata && typeof metadata === 'object') {
    const meta = metadata as Record<string, unknown>;
    const applied = meta.applied_variant;
    if (applied && typeof applied === 'object') {
      const av = applied as Record<string, unknown>;
      if (typeof av.variant_id === 'string') variantId = av.variant_id;
      if (typeof av.variant_family === 'string') variantFamily = av.variant_family;
    }
    if (!variantId && typeof meta.variant_id === 'string') variantId = meta.variant_id;
    if (!variantFamily && typeof meta.variant_family === 'string') variantFamily = meta.variant_family;
  }
  return {
    strategy_id: dims.strategy_id,
    strategy_family: dims.strategy_family,
    content_type: dims.content_type,
    layout_type: dims.layout_type,
    render_strategy_id: dims.render_strategy_id,
    purpose_family: dims.purpose_family,
    variant_id: variantId,
    variant_family: variantFamily,
  };
}

/**
 * Pure helper — given any existing event payload, returns a NEW
 * object with strategy dimensions merged. The original event object
 * is NOT mutated. When no strategy dimensions resolve, the original
 * event is returned unchanged (additive-only contract).
 */
export function enrichEngagementEvent<T extends Record<string, unknown>>(
  event: T,
  attribution: {
    strategy_id?: string | null;
    media_bundle_metadata?: Record<string, unknown> | null;
  },
): T & Partial<StrategyAnalyticsDimensions> {
  const dims =
    (attribution.strategy_id ? resolveStrategyAnalyticsDimensions(attribution.strategy_id) : null) ??
    resolveStrategyAnalyticsDimensionsFromMetadata(attribution.media_bundle_metadata ?? null);
  if (!dims) return event as T & Partial<StrategyAnalyticsDimensions>;
  return {
    ...event,
    strategy_id: dims.strategy_id,
    strategy_family: dims.strategy_family,
    render_strategy_id: dims.render_strategy_id,
    content_type: dims.content_type,
    layout_type: dims.layout_type,
    purpose_family: dims.purpose_family,
  };
}

/* ── PHASE 3 + 12: recording API ─────────────────────────────────── */

export type RecordStrategyEventInput = {
  type: StrategyEngagementType;
  companyId: string;
  campaignId?: string | null;
  creatorId?: string | null;
  platform?: string | null;
  /** Resolved strategy id — required. */
  strategyId?: string | null;
  /** Optional metadata payload (e.g. asset's media_bundle.metadata).
   *  Used as a fallback when `strategyId` is not supplied directly. */
  metadata?: Record<string, unknown> | null;
  /** Defaults to 1 — for batched/aggregated impressions etc. */
  weight?: number | null;
  /** Optional client-supplied timestamp — defaults to now(). */
  occurredAt?: string | null;
  /** Optional variant attribution (PHASE 6). When omitted, the event
   *  is strategy-level only. */
  variantId?: string | null;
  /** Optional variant family token ('v1' | 'v2' | 'v3'). */
  variantFamily?: string | null;
};

/**
 * Record a strategy-attributed engagement event. No-ops gracefully
 * when:
 *   - companyId missing
 *   - no strategy id resolvable from input
 *   - strategy id unknown (foreign / future strategies)
 *
 * This guarantees PHASE 12: legacy callers + new callers without
 * strategy metadata continue functioning, the recorder simply does
 * not produce a strategy event.
 *
 * Returns true if the event was recorded, false otherwise. Callers
 * can use the boolean to decide whether to also emit to their
 * legacy/non-strategy pipeline (they ALWAYS should — strategy
 * analytics is ADDITIVE).
 */
export function recordStrategyEvent(input: RecordStrategyEventInput): boolean {
  if (!input || !input.companyId || typeof input.companyId !== 'string') return false;
  const strategyIdFromInput = input.strategyId ? String(input.strategyId).trim() : null;
  let dims: StrategyAnalyticsDimensions | null = strategyIdFromInput
    ? resolveStrategyAnalyticsDimensions(strategyIdFromInput)
    : null;
  if (!dims) {
    dims = resolveStrategyAnalyticsDimensionsFromMetadata(input.metadata ?? null);
  }
  if (!dims) return false;
  if (!isKnownStrategyId(dims.strategy_id)) return false;
  const weight =
    typeof input.weight === 'number' && Number.isFinite(input.weight) && input.weight > 0
      ? input.weight
      : 1;
  const occurredAt =
    typeof input.occurredAt === 'string' && input.occurredAt
      ? input.occurredAt
      : new Date().toISOString();
  // Variant resolution (PHASE 6). When the caller supplies a variantId
  // OR variantFamily, resolve through the variant registry. Unknown or
  // mismatched variant ids (wrong strategy) are silently dropped to
  // null — the event still records at strategy level.
  let resolvedVariantId: string | null = null;
  let resolvedVariantFamily: string | null = null;
  if (input.variantId || input.variantFamily) {
    try {
      const { resolveVariant, resolveVariantByFamily } =
        require('./variantRegistry') as typeof import('./variantRegistry');
      const variant =
        (input.variantId ? resolveVariant(input.variantId) : null)
        ?? (input.variantFamily ? resolveVariantByFamily(dims.strategy_id, input.variantFamily) : null);
      if (variant && variant.strategy_id === dims.strategy_id) {
        resolvedVariantId = variant.variant_id;
        resolvedVariantFamily = variant.variant_family;
      }
    } catch {
      // Best-effort — variant resolution failure must not block the
      // strategy-level recording.
    }
  } else if (input.metadata) {
    // Fall back to metadata-supplied variant fields when neither id
    // nor family was explicitly passed.
    const meta = input.metadata as Record<string, unknown>;
    const applied = meta.applied_variant && typeof meta.applied_variant === 'object'
      ? (meta.applied_variant as Record<string, unknown>)
      : null;
    const metaVariantId = typeof applied?.variant_id === 'string'
      ? applied.variant_id
      : typeof meta.variant_id === 'string'
        ? meta.variant_id
        : null;
    if (metaVariantId) {
      try {
        const { resolveVariant } = require('./variantRegistry') as typeof import('./variantRegistry');
        const variant = resolveVariant(metaVariantId);
        if (variant && variant.strategy_id === dims.strategy_id) {
          resolvedVariantId = variant.variant_id;
          resolvedVariantFamily = variant.variant_family;
        }
      } catch {
        // Best-effort.
      }
    }
  }
  const buf = getOrCreateBuffer(input.companyId);
  const event: StrategyAnalyticsEvent = {
    type: input.type,
    occurredAt,
    companyId: input.companyId,
    campaignId: input.campaignId ?? null,
    creatorId: input.creatorId ?? null,
    platform: input.platform ?? null,
    dimensions: dims,
    weight,
    variantId: resolvedVariantId,
    variantFamily: resolvedVariantFamily,
  };
  buf.events.push(event);
  if (buf.events.length > MAX_EVENTS_PER_ORG) {
    buf.events.splice(0, buf.events.length - MAX_EVENTS_PER_ORG);
  }
  // Final Corrective Pass — P2-5. Mirror to Redis for cross-replica
  // diagnostic consistency. Best-effort; never blocks the recorder.
  try {
    const { mirrorStrategyEvent } =
      require('./variantDiagnosticsRedisPersistence') as typeof import('./variantDiagnosticsRedisPersistence');
    void mirrorStrategyEvent(input.companyId, event);
  } catch {
    // No-op.
  }
  return true;
}

/* ── Read API (consumed by aggregator + insights engine) ──────────── */

export type EventQueryScope = {
  companyId: string;
  campaignId?: string | null;
  platform?: string | null;
  creatorId?: string | null;
  /** Rolling window in milliseconds. Defaults to the full 30-day
   *  observation window. Useful values: 7d, 30d, 90d. */
  windowMs?: number;
  /** Optional content-type filter — restricts to a single lane. */
  contentType?: AnalyticsContentType;
};

/**
 * Snapshot of all recorded strategy events for `companyId` that
 * match the scope. Returns a defensive copy — callers can sort /
 * filter without affecting the underlying ring buffer.
 */
export function getStrategyEventsForScope(scope: EventQueryScope): StrategyAnalyticsEvent[] {
  if (!scope || !scope.companyId) return [];
  const buf = orgBuffers.get(scope.companyId.trim().toLowerCase());
  if (!buf) return [];
  const window = typeof scope.windowMs === 'number' && scope.windowMs > 0 ? scope.windowMs : ROLLING_WINDOW_MS;
  const cutoff = Date.now() - window;
  return buf.events.filter((e) => {
    const ts = Date.parse(e.occurredAt);
    if (!Number.isFinite(ts) || ts < cutoff) return false;
    if (scope.campaignId && e.campaignId !== scope.campaignId) return false;
    if (scope.platform && e.platform !== scope.platform) return false;
    if (scope.creatorId && e.creatorId !== scope.creatorId) return false;
    if (scope.contentType && e.dimensions.content_type !== scope.contentType) return false;
    return true;
  });
}

/** Diagnostics surface — reports buffer usage for the observability
 *  dashboard. */
export function strategyAnalyticsRecorderStats(): {
  orgCount: number;
  maxOrgs: number;
  maxEventsPerOrg: number;
  rollingWindowMs: number;
  totalEvents: number;
} {
  let total = 0;
  for (const buf of orgBuffers.values()) total += buf.events.length;
  return {
    orgCount: orgBuffers.size,
    maxOrgs: MAX_ORGS,
    maxEventsPerOrg: MAX_EVENTS_PER_ORG,
    rollingWindowMs: ROLLING_WINDOW_MS,
    totalEvents: total,
  };
}

/** Test-surface — clears the buffer between tests. NOT exported as
 *  part of any production code path. */
export function clearAllStrategyAnalytics(): void {
  orgBuffers.clear();
}

export const STRATEGY_ANALYTICS_ROLLING_WINDOW_MS = ROLLING_WINDOW_MS;
