/**
 * Strategy Analytics Registry.
 *
 * Canonical analytics dimensions for the 16 Purpose Strategies that
 * ship as part of Creator content generation. Provides:
 *
 *   - content_type        ('image' | 'carousel' | 'infographic')
 *   - strategy_id         ('image:quote-image', etc.)
 *   - strategy_family     ('quote', 'educational', 'promotional', ...)
 *   - layout_type         (renderer-level layout token)
 *   - render_strategy_id  (mirror of strategy id — kept distinct so
 *                          future divergence is supported without a
 *                          breaking schema change)
 *   - purpose_family      (operator-readable rollup — same as family
 *                          for the current 16-entry registry, surfaced
 *                          separately so cross-content comparisons can
 *                          group `image:promotional` with
 *                          `carousel:product_showcase` when needed)
 *
 * Pure data + a thin resolver. No side effects. No storage. No
 * network. All caches are bounded (only one map of 16 entries).
 *
 * Distinct from `purposeStrategyRegistry.ts`:
 *   - purposeStrategyRegistry feeds the PROMPT composer.
 *   - renderStrategyRegistry  feeds the RENDERER overlay.
 *   - strategyAnalyticsRegistry feeds the ANALYTICS dimensions
 *     attached to engagement events + asset metadata so we can
 *     measure which strategies perform best.
 */

import { resolvePurposeStrategy, listPurposeStrategies, type PurposeContentType, type PurposeStrategy } from './purposeStrategyRegistry';
import { resolveRenderStrategy } from './renderStrategyRegistry';

/* ── Dimension types ─────────────────────────────────────────────── */

export type AnalyticsContentType = PurposeContentType;

export type AnalyticsStrategyFamily =
  | 'promotional'
  | 'educational'
  | 'quote'
  | 'product_showcase'
  | 'brand_focus'
  | 'framework'
  | 'story'
  | 'presentation'
  | 'statistics'
  | 'process'
  | 'timeline'
  | 'comparison'
  | 'roadmap';

export type AnalyticsLayoutType =
  | 'image-overlay'
  | 'carousel-deck'
  | 'infographic-section';

export type StrategyAnalyticsDimensions = {
  /** Canonical content type — image / carousel / infographic. */
  content_type: AnalyticsContentType;
  /** Canonical strategy id (matches purpose + render registries). */
  strategy_id: string;
  /** Operator-readable family token — supports cross-content grouping. */
  strategy_family: AnalyticsStrategyFamily;
  /** Renderer-level layout token — drives layout-scoped aggregations. */
  layout_type: AnalyticsLayoutType;
  /** Mirror of `strategy_id` — preserved as a separate dimension so
   *  future divergence (different render variants per purpose) does not
   *  require a schema change. */
  render_strategy_id: string;
  /** Operator-readable purpose family — same vocabulary as
   *  strategy_family. Surfaced separately so downstream consumers can
   *  rollup by family without normalizing on the underscore key. */
  purpose_family: AnalyticsStrategyFamily;
  /** Variant id — `<strategy_id>:v1|v2|v3`. NULL for legacy /
   *  baseline assets where no variant was explicitly selected
   *  (PHASE 5 backward compatibility). */
  variant_id?: string | null;
  /** Variant family token — 'v1' | 'v2' | 'v3' | null. */
  variant_family?: string | null;
};

/* ── Family map ──────────────────────────────────────────────────── */

const STRATEGY_ID_TO_FAMILY: Record<string, AnalyticsStrategyFamily> = {
  // Image strategies (5)
  'image:promotional-image':       'promotional',
  'image:educational-image':       'educational',
  'image:quote-image':             'quote',
  'image:product-showcase-image':  'product_showcase',
  'image:brand-focus-image':       'brand_focus',
  // Carousel strategies (5)
  'carousel:educational-carousel':     'educational',
  'carousel:framework-carousel':       'framework',
  'carousel:story-carousel':           'story',
  'carousel:product-showcase-carousel': 'product_showcase',
  'carousel:presentation-carousel':    'presentation',
  // Infographic strategies (6)
  'infographic:stats':       'statistics',
  'infographic:process':     'process',
  'infographic:timeline':    'timeline',
  'infographic:comparison':  'comparison',
  'infographic:framework':   'framework',
  'infographic:roadmap':     'roadmap',
};

const CONTENT_TYPE_TO_LAYOUT: Record<AnalyticsContentType, AnalyticsLayoutType> = {
  image: 'image-overlay',
  carousel: 'carousel-deck',
  infographic: 'infographic-section',
};

/* ── Resolver ────────────────────────────────────────────────────── */

/**
 * Resolve analytics dimensions from a strategy id (e.g. from
 * `media_bundle.metadata.purpose_strategy.id` or
 * `media_bundle.metadata.applied_render_strategy.id`). Returns null
 * when the id is unknown or unset — callers MUST treat null as
 * "legacy / pre-strategy asset" and fall back to non-strategy
 * analytics (PHASE 12 regression safety).
 */
export function resolveStrategyAnalyticsDimensions(
  strategyId: string | null | undefined,
): StrategyAnalyticsDimensions | null {
  if (!strategyId) return null;
  const id = String(strategyId).trim();
  if (!id) return null;
  const family = STRATEGY_ID_TO_FAMILY[id];
  if (!family) return null;
  // `strategy_id` shape is `<contentType>:<purposeKey>`.
  const colonIndex = id.indexOf(':');
  if (colonIndex <= 0) return null;
  const contentTypeRaw = id.slice(0, colonIndex);
  if (contentTypeRaw !== 'image' && contentTypeRaw !== 'carousel' && contentTypeRaw !== 'infographic') {
    return null;
  }
  const contentType: AnalyticsContentType = contentTypeRaw;
  return {
    content_type: contentType,
    strategy_id: id,
    strategy_family: family,
    layout_type: CONTENT_TYPE_TO_LAYOUT[contentType],
    render_strategy_id: id,
    purpose_family: family,
  };
}

/**
 * Resolve analytics dimensions from a (contentType, purposeKey) pair —
 * useful when the caller has the writer payload but not the resolved
 * strategy id yet. Internally goes through `resolvePurposeStrategy`
 * so UI aliases (banner→image, slider→carousel) are honored.
 */
export function resolveStrategyAnalyticsDimensionsFromPurposeKey(
  contentType: string,
  purposeKey: string | null | undefined,
): StrategyAnalyticsDimensions | null {
  const strategy = resolvePurposeStrategy(contentType, purposeKey);
  if (!strategy) return null;
  return resolveStrategyAnalyticsDimensions(strategy.id);
}

/**
 * Resolve analytics dimensions from an asset's media_bundle.metadata
 * envelope. Reads `purpose_strategy.id` (set by the prompt composer)
 * with a fallback to `applied_render_strategy.id` (set by the renderer)
 * before giving up. Both envelopes were added in the prior phases.
 */
export function resolveStrategyAnalyticsDimensionsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): StrategyAnalyticsDimensions | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const purposeEnvelope = metadata['purpose_strategy'];
  const purposeId =
    purposeEnvelope && typeof purposeEnvelope === 'object'
      ? (purposeEnvelope as Record<string, unknown>)['id']
      : null;
  const dims = resolveStrategyAnalyticsDimensions(typeof purposeId === 'string' ? purposeId : null);
  if (dims) return dims;
  const renderEnvelope = metadata['applied_render_strategy'];
  const renderId =
    renderEnvelope && typeof renderEnvelope === 'object'
      ? (renderEnvelope as Record<string, unknown>)['id']
      : null;
  return resolveStrategyAnalyticsDimensions(typeof renderId === 'string' ? renderId : null);
}

/* ── Diagnostics + enumeration ──────────────────────────────────── */

/** All known analytics dimensions — driven by the purpose strategy
 *  registry so the analytics surface always covers exactly the same
 *  strategies that the generator + renderer support. Used by leaderboard
 *  initialization + tests. */
export function listAllStrategyAnalyticsDimensions(): ReadonlyArray<StrategyAnalyticsDimensions> {
  const out: StrategyAnalyticsDimensions[] = [];
  for (const purpose of listPurposeStrategies()) {
    const dims = resolveStrategyAnalyticsDimensions(purpose.id);
    if (dims) out.push(dims);
  }
  return out;
}

/** List analytics dimensions for a specific content type. Drives the
 *  per-lane leaderboards in the dashboard. */
export function listStrategyAnalyticsDimensionsForContentType(
  contentType: AnalyticsContentType,
): ReadonlyArray<StrategyAnalyticsDimensions> {
  return listAllStrategyAnalyticsDimensions().filter((d) => d.content_type === contentType);
}

/** Verify a render-strategy id is known + analytics-supported. Used by
 *  the recorder to reject malformed event payloads early. */
export function isKnownStrategyId(strategyId: string): boolean {
  return Object.prototype.hasOwnProperty.call(STRATEGY_ID_TO_FAMILY, strategyId);
}

/** Returns the family for a strategy id, or null when unknown. */
export function strategyFamilyOf(strategyId: string | null | undefined): AnalyticsStrategyFamily | null {
  if (!strategyId) return null;
  return STRATEGY_ID_TO_FAMILY[strategyId] ?? null;
}

/** Re-export resolveRenderStrategy presence-check so callers can verify
 *  the analytics + render registries agree on an id. Used by tests +
 *  the recorder to enforce 1:1 coverage. */
export function isRenderStrategyKnown(strategyId: string): boolean {
  return resolveRenderStrategy(strategyId) !== null;
}

/** Operator-readable display label for a strategy id — combines the
 *  purpose strategy registry's `displayLabel` with the family token. */
export function describeStrategyAnalytics(strategyId: string): {
  displayLabel: string;
  family: AnalyticsStrategyFamily;
  contentType: AnalyticsContentType;
} | null {
  const dims = resolveStrategyAnalyticsDimensions(strategyId);
  if (!dims) return null;
  const purpose: PurposeStrategy | null = (() => {
    for (const p of listPurposeStrategies()) {
      if (p.id === strategyId) return p;
    }
    return null;
  })();
  return {
    displayLabel: purpose?.displayLabel ?? strategyId,
    family: dims.strategy_family,
    contentType: dims.content_type,
  };
}
