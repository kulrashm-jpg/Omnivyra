/**
 * Strategy Attribution Resolver — runtime activation bridge.
 *
 * Connects production engagement emitters (impression / click / save /
 * share / reaction / comment ingestion paths) to the strategy
 * attribution envelope written by the renderer onto an asset's
 * `media_bundle.metadata.strategy_analytics`.
 *
 * The link from an engagement event back to its strategy goes through
 * the scheduled_posts row:
 *
 *     scheduled_post_id
 *        ↓
 *     scheduled_posts.creator_attachment_metadata[]  (JSONB array)
 *        ↓
 *     attachment.strategy_analytics                  (envelope persisted at schedule time)
 *     OR
 *     attachment.renderManifest.media_bundle.metadata.strategy_analytics
 *     OR
 *     attachment.renderManifest.media_bundle.metadata.purpose_strategy.id
 *        ↓
 *     resolveStrategyAnalyticsDimensions(...)
 *
 * Legacy posts with no creator attachment OR no strategy envelope
 * resolve to `null` — the recorder no-ops and the legacy event flows
 * through its existing pipeline untouched (PHASE 6 safety contract).
 *
 * Bounded LRU cache (200 unique scheduled_post_ids, 10-minute TTL) so
 * repeated polls of the same post in a batch run don't issue extra DB
 * round-trips.
 */

import { supabase } from '../../db/supabaseClient';
import {
  type StrategyAnalyticsDimensions,
  resolveStrategyAnalyticsDimensions,
  resolveStrategyAnalyticsDimensionsFromMetadata,
} from './strategyAnalyticsRegistry';

/* ── Cache ───────────────────────────────────────────────────────── */

const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

type AttributionEntry = {
  /** The cached attribution payload. `null` means we looked up + confirmed there is none. */
  attribution: StrategyAttribution | null;
  cachedAt: number;
};

const cache = new Map<string, AttributionEntry>();

function pruneIfFull(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop the OLDEST entry.
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of cache.entries()) {
    if (v.cachedAt < oldestTs) {
      oldestTs = v.cachedAt;
      oldestKey = k;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/* ── Attribution shape returned to emitters ─────────────────────── */

export type StrategyAttribution = {
  /** Resolved analytics dimensions for the strategy. */
  dimensions: StrategyAnalyticsDimensions;
  /** Best-effort companyId. May be null when the scheduled post has
   *  no resolvable org context — recorder no-ops in that case. */
  companyId: string | null;
  /** Best-effort campaignId. May be null. */
  campaignId: string | null;
  /** Best-effort creatorId — falls back to the post's user_id. */
  creatorId: string | null;
  /** Platform string from the scheduled_posts row. */
  platform: string | null;
  /** The raw media_bundle.metadata envelope — kept so emitters can
   *  pass it to `enrichEngagementEvent` for field-level fallback when
   *  they only have metadata, not an id. */
  mediaBundleMetadata: Record<string, unknown> | null;
  /** Resolved variant id (PHASE 6 — variant attribution). Null when
   *  the asset has no variant declared (legacy / baseline). */
  variantId: string | null;
  /** Resolved variant family token ('v1' | 'v2' | 'v3' | null). */
  variantFamily: string | null;
};

/* ── Extraction helpers ──────────────────────────────────────────── */

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Walk the `creator_attachment_metadata` JSONB array on a scheduled
 * post row and return the FIRST resolvable strategy attribution.
 *
 * Looks up (in priority order):
 *   1. attachment.strategy_analytics            (canonical envelope)
 *   2. attachment.renderManifest.media_bundle.metadata.strategy_analytics
 *   3. attachment.renderManifest.media_bundle.metadata.purpose_strategy.id
 *   4. attachment.render_manifest.* (snake_case variant)
 *
 * Returns null when no attachment has any strategy info.
 */
function extractAttributionFromAttachments(
  attachments: unknown,
): {
  dimensions: StrategyAnalyticsDimensions;
  mediaBundleMetadata: Record<string, unknown> | null;
  variantId: string | null;
  variantFamily: string | null;
} | null {
  if (!Array.isArray(attachments)) return null;
  for (const raw of attachments) {
    const attachment = asObject(raw);
    if (!attachment) continue;

    // Pull variant info — searched alongside strategy lookup so we
    // attribute strategy + variant together. Variant is OPTIONAL —
    // attribution still resolves at strategy level when variant is
    // absent.
    const rootAppliedVariant = asObject(attachment.applied_variant);
    const rootVariantId = asString(attachment.variant_id) ?? asString(rootAppliedVariant?.variant_id);
    const rootVariantFamily = asString(attachment.variant_family) ?? asString(rootAppliedVariant?.variant_family);

    // 1. Canonical strategy_analytics envelope at attachment root.
    const rootEnvelope = asObject(attachment.strategy_analytics);
    if (rootEnvelope) {
      const id = asString(rootEnvelope.strategy_id);
      if (id) {
        const dims = resolveStrategyAnalyticsDimensions(id);
        if (dims) {
          return {
            dimensions: dims,
            mediaBundleMetadata: null,
            variantId: asString(rootEnvelope.variant_id) ?? rootVariantId,
            variantFamily: asString(rootEnvelope.variant_family) ?? rootVariantFamily,
          };
        }
      }
    }

    // 2 + 3 + 4. Drill through renderManifest / render_manifest.
    for (const manifestKey of ['renderManifest', 'render_manifest']) {
      const manifest = asObject(attachment[manifestKey]);
      if (!manifest) continue;
      const mediaBundle = asObject(manifest.media_bundle);
      if (!mediaBundle) continue;
      const metadata = asObject(mediaBundle.metadata);
      if (!metadata) continue;

      const appliedVariant = asObject(metadata.applied_variant);
      const variantId =
        asString(appliedVariant?.variant_id)
        ?? asString(metadata.variant_id)
        ?? rootVariantId;
      const variantFamily =
        asString(appliedVariant?.variant_family)
        ?? asString(metadata.variant_family)
        ?? rootVariantFamily;

      // 2a. strategy_analytics envelope.
      const envelope = asObject(metadata.strategy_analytics);
      if (envelope) {
        const id = asString(envelope.strategy_id);
        if (id) {
          const dims = resolveStrategyAnalyticsDimensions(id);
          if (dims) {
            return {
              dimensions: dims,
              mediaBundleMetadata: metadata,
              variantId: asString(envelope.variant_id) ?? variantId,
              variantFamily: asString(envelope.variant_family) ?? variantFamily,
            };
          }
        }
      }

      // 2b. purpose_strategy.id fallback (works for assets predating
      //     strategy_analytics envelope but post-dating purpose strategy).
      const dimsFromMeta = resolveStrategyAnalyticsDimensionsFromMetadata(metadata);
      if (dimsFromMeta) {
        return {
          dimensions: dimsFromMeta,
          mediaBundleMetadata: metadata,
          variantId,
          variantFamily,
        };
      }
    }
  }
  return null;
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Resolve strategy attribution for a scheduled post id. Best-effort:
 *
 *   - returns null when the post has no creator attachment, no
 *     strategy envelope, or the lookup throws
 *   - caches the result (positive AND null) for 10 minutes to avoid
 *     repeated DB hits across batched polling runs
 *
 * Callers MUST treat null as "legacy / non-strategy post" — the
 * recorder no-ops on null attribution.
 */
export async function resolveStrategyAttributionForScheduledPost(
  scheduledPostId: string | null | undefined,
): Promise<StrategyAttribution | null> {
  if (!scheduledPostId || typeof scheduledPostId !== 'string') return null;
  const key = scheduledPostId.trim();
  if (!key) return null;

  // Cache hit (positive or null).
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.attribution;
  }

  let attribution: StrategyAttribution | null = null;
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('id, user_id, campaign_id, platform, creator_attachment_metadata, social_account_id')
      .eq('id', key)
      .maybeSingle();

    if (!error && data) {
      const row = data as Record<string, unknown>;
      const extracted = extractAttributionFromAttachments(row.creator_attachment_metadata);
      if (extracted) {
        const companyId = await resolveCompanyIdForPost(row);
        attribution = {
          dimensions: extracted.dimensions,
          companyId,
          campaignId: asString(row.campaign_id),
          creatorId: asString(row.user_id),
          platform: asString(row.platform),
          mediaBundleMetadata: extracted.mediaBundleMetadata,
          variantId: extracted.variantId,
          variantFamily: extracted.variantFamily,
        };
      }
    }
  } catch {
    // Best-effort: any failure → null attribution. The engagement
    // emitter MUST continue without throwing.
    attribution = null;
  }

  cache.set(key, { attribution, cachedAt: Date.now() });
  pruneIfFull();
  return attribution;
}

/**
 * Resolve the company id for a scheduled post. Tries (in order):
 *
 *   1. campaigns.company_id (when campaign_id present)
 *   2. social_accounts.user_id → users.default_company / etc.
 *      (skipped — too brittle; falls back to null)
 *
 * Returns null when nothing resolves — the recorder no-ops on null
 * companyId.
 */
async function resolveCompanyIdForPost(row: Record<string, unknown>): Promise<string | null> {
  const campaignId = asString(row.campaign_id);
  if (campaignId) {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('company_id')
        .eq('id', campaignId)
        .maybeSingle();
      if (!error && data) {
        return asString((data as Record<string, unknown>).company_id);
      }
    } catch {
      return null;
    }
  }
  return null;
}

/* ── Diagnostics + test surface ──────────────────────────────────── */

export function strategyAttributionCacheStats(): {
  size: number;
  maxEntries: number;
  ttlMs: number;
} {
  return { size: cache.size, maxEntries: MAX_CACHE_ENTRIES, ttlMs: CACHE_TTL_MS };
}

/** Test-surface — clears the cache. NOT exported for production callers. */
export function clearStrategyAttributionCache(): void {
  cache.clear();
}

/**
 * Synchronous variant — extracts attribution from a creator attachment
 * payload that the caller already has in memory (e.g. inside the
 * scheduler at schedule time, before any DB roundtrip is required).
 * Useful for inline emission paths that already hold the attachment.
 */
export function extractStrategyAttributionFromAttachments(
  attachments: unknown,
): StrategyAttribution | null {
  const extracted = extractAttributionFromAttachments(attachments);
  if (!extracted) return null;
  return {
    dimensions: extracted.dimensions,
    companyId: null,
    campaignId: null,
    creatorId: null,
    platform: null,
    mediaBundleMetadata: extracted.mediaBundleMetadata,
    variantId: extracted.variantId,
    variantFamily: extracted.variantFamily,
  };
}
