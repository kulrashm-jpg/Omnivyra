/**
 * Image visual-language schema — the IMAGE family implementation of the
 * canonical Creator Template domain (see ./types.ts). Mirrors the role of
 * ./infographicStyle.ts for the image/banner family.
 *
 * A style describes ONLY deterministic visual language (canvas, safe margins,
 * the base overlay typography/panel scale, background, border radius, branding
 * + CTA placement). It NEVER carries content.
 *
 * `DEFAULT_IMAGE_STYLE` is a faithful DATA mirror of the platform-NEUTRAL
 * BASE overlay preset the renderer builds in
 * `creatorAssetRenderer.ts → getOverlayPreset` (the `base` object), plus the
 * banner canvas and the fallback gradient. Per-platform/density overrides
 * (linkedin/instagram/… branches) remain computed in the renderer on top of
 * this base — they are a documented migration gap, not encoded here.
 *
 * Pure data + types — client/server safe, no I/O.
 */

export type ImageOverlayTypography = {
  fontFamily: string;
  /** Base sizes — `{ normal, dense }` where the renderer picks by density. */
  hookSize: number;
  headlineSize: { normal: number; dense: number };
  insightSize: { normal: number; dense: number };
  supportSize: number;
  ctaSize: number;
  maxHeadlineLines: { normal: number; dense: number };
  maxInsightLines: { normal: number; dense: number };
  maxSupportLines: number;
  headlineChars: { normal: number; dense: number };
  insightChars: { normal: number; dense: number };
  supportChars: number;
};

export type ImagePanelStyle = {
  /** Scrim panel width as a fraction of canvas width — `{ normal, dense }`. */
  widthRatio: { normal: number; dense: number };
  /** Scrim panel opacity over the base image. */
  opacity: number;
};

export type ImageBackgroundStyle = {
  /** Fallback gradient stops used when no provider/brand image is present. */
  fallbackGradient: string[];
  /** Outer frame corner radius (the fallback canvas rect). */
  cornerRadius: number;
};

/** A value that may vary by content density (`{normal,dense}`) or by whether
 *  the asset is a wide single image (`{wide,narrow}`). Scalars never vary. */
export type PresetVariant<T> = T | { normal: T; dense: T } | { wide: T; narrow: T };

/** A platform's deterministic overlay-preset overrides on top of the base.
 *  Every field is optional — absent → the base value is kept. This is the
 *  externalized form of the per-platform branches in `getOverlayPreset`. */
export type PlatformOverlayPreset = {
  name: string;
  panelWidthRatio?: PresetVariant<number>;
  panelOpacity?: number;
  margin?: number;
  hookSize?: number;
  headlineSize?: PresetVariant<number>;
  insightSize?: PresetVariant<number>;
  supportSize?: number;
  ctaSize?: number;
  maxHeadlineLines?: PresetVariant<number>;
  maxInsightLines?: PresetVariant<number>;
  maxSupportLines?: PresetVariant<number>;
  headlineChars?: PresetVariant<number>;
  insightChars?: PresetVariant<number>;
  supportChars?: number;
  ctaProminence?: PresetVariant<'subtle' | 'standard' | 'strong'>;
  footerMode?: PresetVariant<'hidden' | 'subtle' | 'standard'>;
  brandMode?: PresetVariant<'compact' | 'subtle' | 'standard'>;
};

export type ImageStyleSchema = {
  /** Family + per-platform canvases. The single source of truth for sizes. */
  canvas: {
    banner: { width: number; height: number };
    default: { width: number; height: number };
    /** Per-platform image-feed canvas (key = normalized platform). */
    byPlatform: Record<string, { width: number; height: number }>;
  };
  /** Base safe margin (renderer's `base.margin`). */
  safe_margins: { base: number };
  typography: ImageOverlayTypography;
  panel: ImagePanelStyle;
  /** Overlay text colors rendered over the scrim — title / body / support.
   *  NOT platform-specific; the single canonical home for the (previously
   *  hardcoded) overlay text colors. Default == the renderer's white stack. */
  colorScheme: { title: string; body: string; support: string };
  background: ImageBackgroundStyle;
  /** CTA treatment — prominence + where it sits. */
  cta: { prominence: 'subtle' | 'standard' | 'strong'; placement: 'panel' };
  /** Brand-mark mode by output kind (renderer's `base.brandMode`). */
  branding: { imageMode: 'compact' | 'standard'; defaultMode: 'compact' | 'standard' };
  /** Footer treatment. */
  footer: { mode: 'subtle' | 'standard' };
  /** Per-platform overlay-preset overrides (the externalized getOverlayPreset
   *  matrix). Key = normalized platform; 'x' also covers 'twitter'. Absent
   *  platform → base only. */
  platformPresets: Record<string, PlatformOverlayPreset>;
};

/** Faithful encoding of the renderer's platform-neutral base overlay preset. */
export const DEFAULT_IMAGE_STYLE: ImageStyleSchema = {
  canvas: {
    banner: { width: 1600, height: 900 },
    default: { width: 1200, height: 1200 },
    byPlatform: {
      linkedin: { width: 1200, height: 675 },
      x: { width: 1200, height: 675 },
      twitter: { width: 1200, height: 675 },
      reddit: { width: 1200, height: 675 },
      instagram: { width: 1080, height: 1350 },
      facebook: { width: 1080, height: 1350 },
      threads: { width: 1080, height: 1350 },
      pinterest: { width: 1000, height: 1500 },
    },
  },
  safe_margins: { base: 86 },
  typography: {
    fontFamily: 'Inter, Arial',
    hookSize: 24,
    headlineSize: { normal: 58, dense: 50 },
    insightSize: { normal: 31, dense: 28 },
    supportSize: 24,
    ctaSize: 27,
    maxHeadlineLines: { normal: 2, dense: 3 },
    maxInsightLines: { normal: 2, dense: 3 },
    maxSupportLines: 1,
    headlineChars: { normal: 22, dense: 25 },
    insightChars: { normal: 40, dense: 44 },
    supportChars: 48,
  },
  panel: { widthRatio: { normal: 0.7, dense: 0.74 }, opacity: 0.42 },
  // Faithful mirror of the renderer's hardcoded overlay text stack
  // (headingColor / insightColor / supportColor) → byte-identical default.
  colorScheme: { title: '#ffffff', body: 'rgba(255,255,255,0.94)', support: 'rgba(255,255,255,0.78)' },
  background: { fallbackGradient: ['#111827', '#2347A8', '#0E9F9B'], cornerRadius: 36 },
  cta: { prominence: 'standard', placement: 'panel' },
  branding: { imageMode: 'compact', defaultMode: 'standard' },
  footer: { mode: 'subtle' },
  platformPresets: {
    linkedin: {
      name: 'linkedin-editorial',
      margin: 54,
      panelWidthRatio: { wide: 0.62, narrow: 0.66 },
      hookSize: 20,
      headlineSize: { normal: 42, dense: 36 },
      insightSize: { wide: 21, narrow: 23 },
      supportSize: 19,
      ctaSize: 21,
      headlineChars: { normal: 28, dense: 31 },
      insightChars: { wide: 52, narrow: 48 },
      maxInsightLines: { wide: 1, narrow: 2 },
      maxSupportLines: { wide: 0, narrow: 1 },
      ctaProminence: 'standard',
      footerMode: { wide: 'hidden', narrow: 'subtle' },
    },
    instagram: {
      name: 'instagram-visual',
      panelWidthRatio: 0.78,
      margin: 76,
      headlineSize: { normal: 56, dense: 48 },
      insightSize: { normal: 29, dense: 26 },
      ctaProminence: 'strong',
      footerMode: 'subtle',
    },
    facebook: {
      name: 'facebook-community',
      panelWidthRatio: 0.74,
      headlineSize: { normal: 57, dense: 50 },
      ctaProminence: 'strong',
      footerMode: 'standard',
    },
    x: {
      name: 'x-compact',
      margin: 48,
      panelWidthRatio: 0.56,
      hookSize: 18,
      headlineSize: { normal: 40, dense: 34 },
      insightSize: 20,
      ctaSize: 19,
      headlineChars: { normal: 28, dense: 31 },
      insightChars: 56,
      maxInsightLines: 1,
      maxSupportLines: 0,
      ctaProminence: 'subtle',
      footerMode: 'hidden',
      brandMode: 'compact',
    },
    threads: {
      name: 'threads-clean',
      panelWidthRatio: 0.64,
      headlineSize: { normal: 52, dense: 44 },
      insightSize: 25,
      insightChars: 52,
      maxInsightLines: 1,
      maxSupportLines: 0,
      ctaProminence: 'subtle',
      footerMode: 'hidden',
      brandMode: 'compact',
    },
    reddit: {
      name: 'reddit-low-brand',
      margin: 52,
      panelWidthRatio: 0.6,
      hookSize: 18,
      headlineSize: { normal: 40, dense: 34 },
      insightSize: 20,
      ctaSize: 19,
      headlineChars: { normal: 29, dense: 32 },
      insightChars: 56,
      maxInsightLines: 1,
      maxSupportLines: 0,
      ctaProminence: 'subtle',
      footerMode: 'hidden',
      brandMode: 'subtle',
      panelOpacity: 0.32,
    },
    pinterest: {
      name: 'pinterest-pin',
      margin: 72,
      panelWidthRatio: 0.72,
      panelOpacity: 0.46,
      hookSize: 20,
      headlineSize: { normal: 52, dense: 44 },
      insightSize: { normal: 26, dense: 24 },
      supportSize: 22,
      ctaSize: 24,
      headlineChars: { normal: 22, dense: 26 },
      insightChars: { normal: 42, dense: 46 },
      maxHeadlineLines: { normal: 2, dense: 3 },
      maxInsightLines: 2,
      maxSupportLines: 0,
      ctaProminence: 'standard',
      footerMode: 'subtle',
      brandMode: 'compact',
    },
  },
};
