/**
 * Creator → Variant strategy id mapping.
 *
 * The Creator UI collects (`type`, `subtype`/`structureMode`) inputs.
 * The variant + analytics registries key off canonical strategy ids
 * (`image:quote-image`, `infographic:comparison`, …). This module is
 * the canonical adapter between the two — pure functions, no
 * side effects, importable from any client surface.
 *
 * Naming convention (matches purposeStrategyRegistry):
 *
 *   image:<purpose>-image
 *   carousel:<purpose>-carousel
 *   infographic:<purpose>        ← bare purpose key for infographic
 */

import type { VariantFamily } from '../../components/variant-experience/useVariantApi';

export type CreatorTypeForVariant = 'image' | 'carousel' | 'infographic';

/* ── Slug normalization ────────────────────────────────────────── */

function slug(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** Known purpose slugs per creator type — used as a guard so we
 *  return null for unknown subtype values rather than producing a
 *  bogus strategy id that won't resolve in the registry. */
const KNOWN_PURPOSES: Record<CreatorTypeForVariant, ReadonlyArray<string>> = {
  image: ['promotional', 'educational', 'quote', 'product-showcase', 'brand-focus'],
  carousel: ['educational', 'framework', 'story', 'product-showcase', 'presentation'],
  infographic: ['stats', 'process', 'timeline', 'comparison', 'framework', 'roadmap'],
};

/**
 * Resolve a strategy id from a Creator type + subtype/structureMode.
 * Returns null when the inputs don't map to a declared strategy (the
 * embedding surface MUST treat null as "no variant selection
 * available" and skip the variant card).
 */
export function resolveCreatorStrategyId(
  type: CreatorTypeForVariant | string | null | undefined,
  subtype: string | null | undefined,
): string | null {
  const t = slug(type);
  if (t !== 'image' && t !== 'carousel' && t !== 'infographic') return null;
  const purpose = slug(subtype);
  if (!purpose) return null;
  const allowed = KNOWN_PURPOSES[t];
  if (!allowed.includes(purpose)) return null;
  if (t === 'infographic') return `infographic:${purpose}`;
  return `${t}:${purpose}-${t}`;
}

/* ── Query-string serialization ────────────────────────────────── */

/**
 * Encode variant context for navigation between surfaces (e.g. Writer
 * → Creator). Always returns a partial object that the next page can
 * spread into its existing URL handling.
 */
export function encodeVariantQuery(input: {
  variantMode?: 'default' | 'best_variant' | 'v1' | 'v2' | 'v3' | 'top_3_variants' | 'experiment' | null;
  variantFamily?: VariantFamily | null;
  variantId?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.variantMode) out.variant_mode = input.variantMode;
  if (input.variantFamily) out.variant_family = input.variantFamily;
  if (input.variantId) out.variant_id = input.variantId;
  return out;
}

/**
 * Decode variant context off a URL query (`router.query` shape).
 * Filters out invalid values so legacy callers' empty / unrelated
 * query keys are ignored.
 */
export function decodeVariantQuery(query: Record<string, string | string[] | undefined>): {
  variantMode: 'default' | 'best_variant' | 'v1' | 'v2' | 'v3' | 'top_3_variants' | 'experiment' | null;
  variantFamily: VariantFamily | null;
  variantId: string | null;
} {
  const raw = (k: string) => {
    const v = query[k];
    return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? '') : '';
  };
  const mode = raw('variant_mode');
  const family = raw('variant_family');
  const variantId = raw('variant_id');
  return {
    variantMode: (['default','best_variant','v1','v2','v3','top_3_variants','experiment'] as const).includes(mode as any)
      ? (mode as any)
      : null,
    variantFamily: family === 'v1' || family === 'v2' || family === 'v3' ? family : null,
    variantId: variantId || null,
  };
}
