/**
 * Creator Variant Bridge — read-only consumer.
 *
 * Surfaces the creator lane's ALREADY-DURABLE variant selection to the
 * link-minting lane (generate-day → tracking link → lead attribution).
 *
 * This is a BRIDGE, not a producer. It SELECTS nothing — the creator lane
 * (`planVariantExecution`) remains the sole authoritative selector. It only
 * reads what the creator lane already persisted:
 *
 *   1. scheduled_posts.creator_attachment_metadata[]   (campaign_id + platform keyed)
 *   2. creator_assets.metadata.applied_variant         (metadata.campaign_id + platform_context)
 *
 * No new tables. No new persistence. No second variant system.
 *
 * Experiment safety: if a campaign+platform has MORE THAN ONE distinct
 * variant in flight (experiment / top_3 fan-out), the bridge returns
 * `ambiguous` and the caller MUST skip variant attribution rather than
 * guess. Attribution is never fabricated.
 */

import { supabase } from '../../db/supabaseClient';

export type CampaignVariantStatus = 'resolved' | 'none' | 'ambiguous';

export type CampaignVariantResolution = {
  status: CampaignVariantStatus;
  variant_id: string | null;
  strategy_id: string | null;
  variant_family: string | null;
  /** Which durable store the value came from (null for none/ambiguous). */
  source: 'scheduled_posts' | 'creator_assets' | null;
  /** Populated on `ambiguous` so callers/diagnostics can see the conflict. */
  distinct_variant_ids?: string[];
};

const NONE: CampaignVariantResolution = {
  status: 'none',
  variant_id: null,
  strategy_id: null,
  variant_family: null,
  source: null,
};

/* ── small helpers ───────────────────────────────────────────────── */

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizePlatform(platform: string | null | undefined): string {
  const lower = String(platform || '').trim().toLowerCase();
  return lower === 'twitter' ? 'x' : lower;
}

type ExtractedVariant = { variant_id: string; strategy_id: string | null; variant_family: string | null };

/**
 * Pull a creator variant from one `creator_attachment_metadata[]` array,
 * mirroring strategyAttributionResolver's priority: root applied_variant /
 * root variant_id, then renderManifest.media_bundle.metadata.applied_variant.
 * Returns null when the attachment carries no variant.
 */
function extractVariantFromAttachments(attachments: unknown): ExtractedVariant | null {
  if (!Array.isArray(attachments)) return null;
  for (const raw of attachments) {
    const attachment = asObject(raw);
    if (!attachment) continue;

    const rootApplied = asObject(attachment.applied_variant);
    const rootVariantId = asString(attachment.variant_id) ?? asString(rootApplied?.variant_id);
    if (rootVariantId) {
      return {
        variant_id: rootVariantId,
        strategy_id: asString(rootApplied?.strategy_id),
        variant_family: asString(attachment.variant_family) ?? asString(rootApplied?.variant_family),
      };
    }

    for (const manifestKey of ['renderManifest', 'render_manifest']) {
      const manifest = asObject(attachment[manifestKey]);
      const mediaBundle = asObject(manifest?.media_bundle);
      const metadata = asObject(mediaBundle?.metadata);
      if (!metadata) continue;
      const applied = asObject(metadata.applied_variant);
      const variantId = asString(applied?.variant_id) ?? asString(metadata.variant_id);
      if (variantId) {
        return {
          variant_id: variantId,
          strategy_id: asString(applied?.strategy_id),
          variant_family: asString(applied?.variant_family) ?? asString(metadata.variant_family),
        };
      }
    }
  }
  return null;
}

/** Extract a creator variant from a creator_assets.metadata JSONB blob. */
function extractVariantFromAssetMetadata(metadata: unknown): ExtractedVariant | null {
  const meta = asObject(metadata);
  if (!meta) return null;
  const applied = asObject(meta.applied_variant);
  const variantId = asString(applied?.variant_id) ?? asString(meta.variant_id);
  if (!variantId) return null;
  return {
    variant_id: variantId,
    strategy_id: asString(applied?.strategy_id) ?? asString(meta.strategy_id),
    variant_family: asString(applied?.variant_family) ?? asString(meta.variant_family),
  };
}

/**
 * Collapse a set of extracted variants into a resolution. One distinct
 * variant_id → resolved. More than one → ambiguous (experiment in flight).
 * Zero → null (caller falls through / no attribution).
 */
function collapse(
  variants: ExtractedVariant[],
  source: 'scheduled_posts' | 'creator_assets',
): CampaignVariantResolution | null {
  if (variants.length === 0) return null;
  const distinct = [...new Set(variants.map((v) => v.variant_id))];
  if (distinct.length > 1) {
    return {
      status: 'ambiguous',
      variant_id: null,
      strategy_id: null,
      variant_family: null,
      source: null,
      distinct_variant_ids: distinct,
    };
  }
  const chosen = variants.find((v) => v.variant_id === distinct[0])!;
  return {
    status: 'resolved',
    variant_id: chosen.variant_id,
    strategy_id: chosen.strategy_id,
    variant_family: chosen.variant_family,
    source,
  };
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Resolve the creator-selected variant for a campaign + platform.
 *
 * Read-only and best-effort: any error → `none` (never throws; the caller
 * must continue minting without variant attribution). Source order:
 *   1. scheduled_posts.creator_attachment_metadata
 *   2. creator_assets.metadata.applied_variant
 *
 * Returns `ambiguous` (and never a guessed value) when more than one distinct
 * variant is in flight for the campaign+platform.
 */
export async function resolveCampaignVariant(
  campaignId: string | null | undefined,
  platform: string | null | undefined,
): Promise<CampaignVariantResolution> {
  const cid = asString(campaignId);
  const plat = normalizePlatform(platform);
  if (!cid || !plat) return NONE;

  // ── Source 1: scheduled_posts (campaign_id + platform keyed) ──────────
  try {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('platform, creator_attachment_metadata')
      .eq('campaign_id', cid)
      .limit(500);
    if (!error && Array.isArray(data)) {
      const variants: ExtractedVariant[] = [];
      for (const raw of data as Array<Record<string, unknown>>) {
        if (normalizePlatform(asString(raw.platform)) !== plat) continue;
        const v = extractVariantFromAttachments(raw.creator_attachment_metadata);
        if (v) variants.push(v);
      }
      const resolved = collapse(variants, 'scheduled_posts');
      if (resolved) return resolved;
    }
  } catch {
    // Best-effort — fall through to source 2.
  }

  // ── Source 2: creator_assets (metadata.campaign_id + platform_context) ─
  // creator_assets has no first-class campaign_id column; the orchestrator
  // stamps it into metadata, so we filter on the JSONB field best-effort.
  try {
    const { data, error } = await supabase
      .from('creator_assets')
      .select('platform_context, metadata')
      .eq('metadata->>campaign_id', cid)
      .limit(500);
    if (!error && Array.isArray(data)) {
      const variants: ExtractedVariant[] = [];
      for (const raw of data as Array<Record<string, unknown>>) {
        if (normalizePlatform(asString(raw.platform_context)) !== plat) continue;
        const v = extractVariantFromAssetMetadata(raw.metadata);
        if (v) variants.push(v);
      }
      const resolved = collapse(variants, 'creator_assets');
      if (resolved) return resolved;
    }
  } catch {
    // Best-effort — fall through to none.
  }

  return NONE;
}
