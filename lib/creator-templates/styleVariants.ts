/**
 * Production style variants — named visual languages built by INHERITANCE
 * from the canonical DEFAULT_*_STYLE. Each variant overrides only the
 * properties that differ; everything else is inherited via spread, so there
 * are no duplicated complete styles and no duplicated constants. The renderer
 * is unchanged — variants are pure data consumed through the existing
 * resolveTemplate() → *Style path.
 *
 * CONSUMPTION (per the renderer built in TEMPLATE-003…009):
 *   - infographic: FULLY consumed — colours, card style, decoration, density.
 *     Variants visibly + verifiably change the rendered infographic.
 *   - image:       the imageStyle BASE preset is consumed, but per-platform
 *     presets override most base fields for known platforms, so only
 *     non-overridden base props (panel opacity, brand mode, max-lines) surface.
 *   - carousel:    the deck renderer currently consumes only carouselStyle.canvas;
 *     overlay-base variant props are inert until a future deck-overlay wiring.
 */

import { DEFAULT_INFOGRAPHIC_STYLE, type InfographicStyleSchema } from './infographicStyle';
import { DEFAULT_IMAGE_STYLE, type ImageStyleSchema } from './imageStyle';
import { DEFAULT_CAROUSEL_STYLE, type CarouselStyleSchema } from './carouselStyle';

/* ── Infographic variants (fully renderer-consumed) ─────────────────── */

type IgOver = {
  panel?: string; innerPanel?: string; primaryText?: string; bodyText?: string; tinyLabelText?: string;
  cornerRadius?: number; fillOpacity?: number; stripeWidth?: number; stripeRadius?: number;
  waveEnabled?: boolean; ambientOpacity?: number; ctaCorner?: number; ctaOpacity?: number;
};
function igVariant(o: IgOver): InfographicStyleSchema {
  const D = DEFAULT_INFOGRAPHIC_STYLE;
  return {
    ...D,
    color_scheme: {
      ...D.color_scheme,
      panel: o.panel ?? D.color_scheme.panel,
      innerPanel: o.innerPanel ?? D.color_scheme.innerPanel,
      primaryText: o.primaryText ?? D.color_scheme.primaryText,
      bodyText: o.bodyText ?? D.color_scheme.bodyText,
      tinyLabelText: o.tinyLabelText ?? D.color_scheme.tinyLabelText,
    },
    card_style: {
      ...D.card_style,
      cornerRadius: o.cornerRadius ?? D.card_style.cornerRadius,
      fillOpacity: o.fillOpacity ?? D.card_style.fillOpacity,
      accentStripeWidth: o.stripeWidth ?? D.card_style.accentStripeWidth,
      accentStripeRadius: o.stripeRadius ?? D.card_style.accentStripeRadius,
    },
    decoration_style: {
      ...D.decoration_style,
      wave: { ...D.decoration_style.wave, enabled: o.waveEnabled ?? D.decoration_style.wave.enabled },
      ambientFill: { ...D.decoration_style.ambientFill, opacity: o.ambientOpacity ?? D.decoration_style.ambientFill.opacity },
      ctaFooter: { ...D.decoration_style.ctaFooter, cornerRadius: o.ctaCorner ?? D.decoration_style.ctaFooter.cornerRadius, opacity: o.ctaOpacity ?? D.decoration_style.ctaFooter.opacity },
    },
  };
}

export const INFOGRAPHIC_VARIANTS: Readonly<Record<string, InfographicStyleSchema>> = Object.freeze({
  default: DEFAULT_INFOGRAPHIC_STYLE,
  'executive-report': igVariant({ primaryText: '#0f172a', innerPanel: '#f1f5f9', cornerRadius: 8, stripeWidth: 8, waveEnabled: false, ambientOpacity: 0.02, ctaCorner: 8 }),
  modern: igVariant({ cornerRadius: 22, stripeWidth: 4, ambientOpacity: 0.06, ctaCorner: 22 }),
  corporate: igVariant({ primaryText: '#1e293b', innerPanel: '#f1f5f9', cornerRadius: 6, stripeWidth: 8, waveEnabled: false, ctaCorner: 6 }),
  startup: igVariant({ cornerRadius: 24, bodyText: '#475569', ambientOpacity: 0.07, ctaCorner: 24 }),
  dark: igVariant({ panel: '#0f172a', innerPanel: '#1e293b', primaryText: '#f8fafc', bodyText: '#cbd5e1', tinyLabelText: '#94a3b8', cornerRadius: 16 }),
  minimal: igVariant({ cornerRadius: 4, fillOpacity: 1, stripeWidth: 0, waveEnabled: false, ambientOpacity: 0, ctaCorner: 4, ctaOpacity: 0.08 }),
  editorial: igVariant({ primaryText: '#1a1a1a', bodyText: '#3f3f46', innerPanel: '#faf9f6', cornerRadius: 2, stripeWidth: 3, waveEnabled: false }),
  technical: igVariant({ primaryText: '#0b1220', innerPanel: '#f8fafc', cornerRadius: 0, stripeWidth: 4, stripeRadius: 0, waveEnabled: false, ambientOpacity: 0, ctaCorner: 0 }),
  premium: igVariant({ panel: '#fffdf7', innerPanel: '#faf7ef', primaryText: '#1c1917', bodyText: '#44403c', cornerRadius: 16, fillOpacity: 1, ctaCorner: 16 }),
  government: igVariant({ primaryText: '#0b3d91', innerPanel: '#f1f5f9', cornerRadius: 0, stripeWidth: 10, stripeRadius: 0, waveEnabled: false, ambientOpacity: 0.02 }),
  healthcare: igVariant({ primaryText: '#065f46', innerPanel: '#f0fdf4', cornerRadius: 18, ambientOpacity: 0.05, ctaCorner: 18 }),
  financial: igVariant({ primaryText: '#064e3b', innerPanel: '#f1f5f9', cornerRadius: 6, stripeWidth: 8, waveEnabled: false }),
});

/* ── Image variants (base preset; partially shadowed by platform presets) ─ */

type ImgOver = {
  panelOpacity?: number; widthNormal?: number; widthDense?: number; margin?: number;
  brandImage?: 'compact' | 'standard'; brandDefault?: 'compact' | 'standard';
  footer?: 'subtle' | 'standard'; cta?: 'subtle' | 'standard' | 'strong';
  maxHeadNormal?: number; maxHeadDense?: number;
  // Overlay text colors — the renderer-consumed, NON-platform-shadowed knob
  // that carries each variant's visual identity on every platform. Kept light
  // for legibility over the dark scrim (no rendering redesign).
  title?: string; body?: string; support?: string;
};
function imgVariant(o: ImgOver): ImageStyleSchema {
  const D = DEFAULT_IMAGE_STYLE;
  return {
    ...D,
    panel: { ...D.panel, opacity: o.panelOpacity ?? D.panel.opacity, widthRatio: { normal: o.widthNormal ?? D.panel.widthRatio.normal, dense: o.widthDense ?? D.panel.widthRatio.dense } },
    safe_margins: { base: o.margin ?? D.safe_margins.base },
    typography: { ...D.typography, maxHeadlineLines: { normal: o.maxHeadNormal ?? D.typography.maxHeadlineLines.normal, dense: o.maxHeadDense ?? D.typography.maxHeadlineLines.dense } },
    colorScheme: { title: o.title ?? D.colorScheme.title, body: o.body ?? D.colorScheme.body, support: o.support ?? D.colorScheme.support },
    branding: { imageMode: o.brandImage ?? D.branding.imageMode, defaultMode: o.brandDefault ?? D.branding.defaultMode },
    footer: { mode: o.footer ?? D.footer.mode },
    cta: { ...D.cta, prominence: o.cta ?? D.cta.prominence },
  };
}

export const IMAGE_VARIANTS: Readonly<Record<string, ImageStyleSchema>> = Object.freeze({
  default: DEFAULT_IMAGE_STYLE,
  editorial: imgVariant({ panelOpacity: 0.34, margin: 96, footer: 'subtle', cta: 'subtle', maxHeadNormal: 3, title: '#fdf6e3', body: 'rgba(253,246,227,0.92)' }),
  corporate: imgVariant({ panelOpacity: 0.5, margin: 72, footer: 'standard', cta: 'standard', brandImage: 'standard', title: '#eef2ff', body: 'rgba(238,242,255,0.92)' }),
  minimal: imgVariant({ panelOpacity: 0.3, margin: 100, footer: 'subtle', cta: 'subtle', maxHeadNormal: 2, title: '#f8fafc', body: 'rgba(248,250,252,0.9)' }),
  modern: imgVariant({ panelOpacity: 0.42, margin: 80, footer: 'subtle', cta: 'standard', title: '#f0f9ff', body: 'rgba(240,249,255,0.92)' }),
  premium: imgVariant({ panelOpacity: 0.4, margin: 104, brandImage: 'standard', brandDefault: 'standard', cta: 'subtle', title: '#faf7ef', body: 'rgba(250,247,239,0.92)' }),
  dark: imgVariant({ panelOpacity: 0.6, margin: 80, footer: 'standard', cta: 'standard', title: '#e2e8f0', body: 'rgba(226,232,240,0.9)' }),
  bold: imgVariant({ panelOpacity: 0.55, margin: 72, cta: 'strong', maxHeadNormal: 3, title: '#fff7ed', body: 'rgba(255,247,237,0.94)' }),
  vibrant: imgVariant({ panelOpacity: 0.5, margin: 76, cta: 'strong', title: '#fef2f2', body: 'rgba(254,242,242,0.94)' }),
  elegant: imgVariant({ panelOpacity: 0.36, margin: 96, footer: 'subtle', cta: 'subtle', title: '#faf5ff', body: 'rgba(250,245,255,0.92)' }),
  technical: imgVariant({ panelOpacity: 0.52, margin: 64, footer: 'standard', cta: 'standard', maxHeadNormal: 3, title: '#ecfeff', body: 'rgba(236,254,255,0.92)' }),
});

/* ── Carousel variants (currently deck-dormant beyond canvas) ───────── */

type CarOver = { panelOpacity?: number; cornerRadius?: number; waveEnabled?: boolean; brand?: 'compact' | 'standard' };
function carVariant(o: CarOver): CarouselStyleSchema {
  const D = DEFAULT_CAROUSEL_STYLE;
  return {
    ...D,
    panel: { ...D.panel, opacity: o.panelOpacity ?? D.panel.opacity },
    frame: { cornerRadius: o.cornerRadius ?? D.frame.cornerRadius },
    decoration: { wave: { enabled: o.waveEnabled ?? D.decoration.wave.enabled } },
    branding: { mode: o.brand ?? D.branding.mode },
  };
}

export const CAROUSEL_VARIANTS: Readonly<Record<string, CarouselStyleSchema>> = Object.freeze({
  default: DEFAULT_CAROUSEL_STYLE,
  // panelOpacity is the carousel knob that surfaces through the deck overlay
  // (the default platform presets do not override it); each variant uses a
  // distinct opacity so non-default variants render visibly differently.
  educational: carVariant({ cornerRadius: 28, panelOpacity: 0.48 }),
  presentation: carVariant({ cornerRadius: 12, panelOpacity: 0.50, brand: 'standard' }),
  magazine: carVariant({ cornerRadius: 8, panelOpacity: 0.46 }),
  executive: carVariant({ cornerRadius: 6, panelOpacity: 0.52, brand: 'standard' }),
  startup: carVariant({ cornerRadius: 32, panelOpacity: 0.44 }),
  storytelling: carVariant({ cornerRadius: 24, panelOpacity: 0.38, waveEnabled: true }),
  premium: carVariant({ cornerRadius: 16, panelOpacity: 0.40, brand: 'standard' }),
  minimal: carVariant({ cornerRadius: 4, panelOpacity: 0.30, waveEnabled: false }),
});

/* ── Template → variant assignment (explicit, one variant per template) ── */

const INFOGRAPHIC_VARIANT_BY_ID: Readonly<Record<string, string>> = {
  'sys-infographic-statistics': 'financial',
  'sys-infographic-process': 'corporate',
  'sys-infographic-timeline': 'modern',
  'sys-infographic-comparison': 'editorial',
  'sys-infographic-hierarchy': 'executive-report',
  'sys-infographic-framework': 'minimal',
  'sys-infographic-pyramid': 'premium',
  'sys-infographic-funnel': 'startup',
  'sys-infographic-lifecycle': 'healthcare',
  'sys-infographic-roadmap': 'technical',
  'sys-infographic-matrix': 'government',
  'sys-infographic-decision-tree': 'dark',
};
const IMAGE_VARIANT_BY_ID: Readonly<Record<string, string>> = {
  'sys-image-headline': 'bold',
  'sys-image-headline-sub-cta': 'modern',
  'sys-image-quote-author': 'editorial',
  'sys-image-logo-only': 'minimal',
  'sys-image-thought-leadership': 'editorial',
  'sys-image-statistic': 'technical',
  'sys-image-product-highlight': 'modern',
  'sys-image-testimonial': 'elegant',
  'sys-image-announcement': 'bold',
  'sys-image-myth-fact': 'corporate',
  'sys-image-before-after': 'modern',
  'sys-image-checklist': 'minimal',
  'sys-image-promotion': 'vibrant',
  'sys-image-event': 'premium',
  'sys-image-behind-the-scenes': 'premium',
  'sys-banner-website-hero': 'bold',
  'sys-banner-webinar': 'modern',
  'sys-banner-event': 'premium',
  'sys-banner-sale': 'vibrant',
  'sys-banner-product-launch': 'modern',
  'sys-banner-hiring': 'corporate',
  'sys-banner-newsletter': 'minimal',
  'sys-banner-cta': 'bold',
};
const CAROUSEL_VARIANT_BY_ID: Readonly<Record<string, string>> = {
  'sys-carousel-educational-5': 'educational',
  'sys-carousel-storytelling-7': 'storytelling',
  'sys-carousel-checklist-10': 'minimal',
  'sys-carousel-step-by-step': 'educational',
  'sys-carousel-framework': 'executive',
  'sys-carousel-case-study': 'premium',
  'sys-carousel-before-after': 'storytelling',
  'sys-carousel-mistakes': 'magazine',
  'sys-carousel-comparison': 'presentation',
  'sys-carousel-tips': 'startup',
  'sys-carousel-faq': 'minimal',
  'sys-carousel-timeline': 'storytelling',
};

/** The variant key assigned to a template (for telemetry / preview labels). */
export function variantKeyForTemplate(id: string, family: 'image' | 'carousel' | 'infographic'): string {
  if (family === 'infographic') return INFOGRAPHIC_VARIANT_BY_ID[id] ?? 'default';
  if (family === 'carousel') return CAROUSEL_VARIANT_BY_ID[id] ?? 'default';
  return IMAGE_VARIANT_BY_ID[id] ?? 'default';
}

/* ── CREATOR-106: Marketing Sample (blueprint) → infographic variant ──────────
 * When a user picks a Marketing Sample (a visual style like `technology`,
 * `finance`, `editorial`) and generates an infographic, the output must align with
 * that sample's look. The 51 sample styles map onto the 12 infographic treatments:
 * direct name match first, then this semantic table, else `default`. */
const BLUEPRINT_TO_INFOGRAPHIC_VARIANT: Readonly<Record<string, string>> = {
  luxury: 'premium', magazine: 'editorial', bold: 'executive-report', gradient: 'modern',
  abstract: 'modern', brutalist: 'technical', vintage: 'editorial', retro: 'editorial',
  glassmorphism: 'modern', neumorphism: 'minimal', technology: 'technical', finance: 'financial',
  education: 'corporate', construction: 'government', restaurant: 'premium', travel: 'startup',
  retail: 'startup', fashion: 'premium', 'luxury-brand': 'premium', illustration: 'startup',
  'flat-illustration': 'startup', isometric: 'technical', 'paper-cut': 'editorial', futuristic: 'technical',
  dashboard: 'technical', infographic: 'modern', 'abstract-3d': 'modern', 'minimal-3d': 'minimal',
  comparison: 'editorial', statistic: 'financial', quote: 'editorial', timeline: 'modern',
  checklist: 'minimal', framework: 'executive-report', saas: 'technical', analytics: 'financial',
};

/** The infographic variant key a Marketing Sample / blueprint id resolves to. */
export function infographicVariantForBlueprint(id: string): string {
  if (!id) return 'default';
  if (INFOGRAPHIC_VARIANTS[id]) return id;                          // corporate, modern, minimal, editorial, dark, healthcare
  return BLUEPRINT_TO_INFOGRAPHIC_VARIANT[id] ?? 'default';
}

/** The infographic style schema a Marketing Sample / blueprint id should render with. */
export function infographicStyleForBlueprint(id: string): InfographicStyleSchema {
  return INFOGRAPHIC_VARIANTS[infographicVariantForBlueprint(id)] ?? DEFAULT_INFOGRAPHIC_STYLE;
}

/** Returns the family-specific style schema fields a template should carry,
 *  resolved by its assigned variant. Spread onto the template at build time. */
export function styleFieldsForTemplate(id: string, family: 'image' | 'carousel' | 'infographic'):
  Pick<{ infographicStyle: InfographicStyleSchema; imageStyle: ImageStyleSchema; carouselStyle: CarouselStyleSchema }, never> &
  { infographicStyle?: InfographicStyleSchema; imageStyle?: ImageStyleSchema; carouselStyle?: CarouselStyleSchema } {
  const key = variantKeyForTemplate(id, family);
  if (family === 'infographic') return { infographicStyle: INFOGRAPHIC_VARIANTS[key] ?? DEFAULT_INFOGRAPHIC_STYLE };
  if (family === 'carousel') return { carouselStyle: CAROUSEL_VARIANTS[key] ?? DEFAULT_CAROUSEL_STYLE };
  return { imageStyle: IMAGE_VARIANTS[key] ?? DEFAULT_IMAGE_STYLE };
}
