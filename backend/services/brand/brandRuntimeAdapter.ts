/**
 * Unified Brand Runtime — Phase 1C (compatibility adapter).
 *
 * Bridges a BrandRuntime to the CreatorBrandKit shape the visual renderers
 * already consume, so each visual consumer can later migrate one at a time with
 * ZERO behavior drift.
 *
 * Zero-drift strategy: REUSE resolveCreatorBrandKit so every derived field
 * (accent, contrastProfile, overlayStrategy, layoutVariantId, renderIdentityHash,
 * brandMark, fallbackInitials) is produced by the exact same code the renderer
 * uses today. We only feed it the runtime's brand data through the channels it
 * already reads (assetPayload.color_palette + metadata.brand_context.profile),
 * then overlay the runtime's canonical accent + real brand font — both no-ops
 * for a defaults-only runtime.
 *
 * SCOPE: this is a pure mapping function. It is DEAD CODE after this commit —
 * no renderer/content/consumer imports or calls it.
 */
import { resolveCreatorBrandKit, type CreatorBrandKit } from '../creatorBrandKit';
import type { BrandRuntime } from './brandRuntime';

// Fonts that are themselves defaults (not a real customer brand font). When the
// runtime's bodyFont is one of these we keep the kit's current font so a
// defaults-only runtime is byte-identical to today's kit.
const DEFAULT_FONTS = new Set(['Inter, Arial', 'Arial, Helvetica, sans-serif']);

// The runtime's "no profile" name default. Not injected so the resolver keeps
// its own default ('OMNIVYRA') → zero drift for a defaults-only runtime.
const RUNTIME_DEFAULT_NAME = 'Brand';

/** Per-asset render context the renderer already had (platform/assetType drive
 *  geometry + identity hashing; the asset's own metadata may carry operator
 *  overrides). Passing it keeps a branded render geometrically identical to the
 *  legacy path — only the brand SOURCE changes. Defaults to {} so the original
 *  no-arg call (and its zero-drift test) is unchanged. */
export interface BrandKitAssetContext {
  assetPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  platform?: string | null;
  assetType?: string | null;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Map a BrandRuntime to the exact CreatorBrandKit shape renderers consume. */
export function brandRuntimeToCreatorBrandKit(rt: BrandRuntime, asset: BrandKitAssetContext = {}): CreatorBrandKit {
  // Only inject brand fields that are genuinely present, through the same
  // metadata channels resolveCreatorBrandKit reads. Absent fields (undefined)
  // fall through to the resolver's existing defaults.
  const profile: Record<string, unknown> = {};
  if (rt.name && rt.name !== RUNTIME_DEFAULT_NAME) profile.companyName = rt.name;
  if (rt.logo.primary) profile.logoUrl = rt.logo.primary;
  if (rt.logo.favicon) profile.faviconUrl = rt.logo.favicon;
  if (rt.voice.tone) profile.brandTone = rt.voice.tone;
  if (rt.industry) profile.industry = rt.industry;
  if (rt.domain) profile.domain = rt.domain;
  if (rt.tagline) profile.tagline = rt.tagline;

  // Merge the runtime brand over the asset's own context: keep the asset's
  // metadata + brand_context.overrides (geometry/operator overrides) but layer
  // the runtime profile + authoritative palette on top.
  const assetMeta = asObject(asset.metadata);
  const assetBrandContext = asObject(assetMeta.brand_context);
  const assetProfile = asObject(assetBrandContext.profile);

  const kit = resolveCreatorBrandKit({
    companyId: rt.companyId,
    tenantId: rt.companyId,
    assetPayload: { ...asObject(asset.assetPayload), color_palette: rt.colors.palette },
    metadata: { ...assetMeta, brand_context: { ...assetBrandContext, profile: { ...assetProfile, ...profile } } },
    platform: asset.platform ?? undefined,
    assetType: asset.assetType ?? undefined,
  });

  const brandFont = DEFAULT_FONTS.has(rt.typography.bodyFont)
    ? kit.typography.fontFamily          // keep current font (no drift)
    : rt.typography.bodyFont;            // real brand font

  return {
    ...kit,
    // Canonical accent comes from the runtime (WCAG-validated), NOT palette[1].
    // No-op for a defaults-only runtime where runtime.accent equals the kit's
    // chooseAccent() result.
    accentColor: rt.colors.accent,
    typography: {
      ...kit.typography,
      fontFamily: brandFont,
      pdfFont: rt.typography.pdfFont || kit.typography.pdfFont,
      headingWeight: rt.typography.headingWeight ?? kit.typography.headingWeight,
      bodyWeight: rt.typography.bodyWeight ?? kit.typography.bodyWeight,
    },
  };
}
