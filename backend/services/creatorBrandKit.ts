import { createHash } from 'crypto';

export type CreatorBrandMarkType = 'logo' | 'favicon' | 'initials';

export type CreatorBrandKit = {
  tenantId: string | null;
  companyId: string | null;
  companyName: string;
  logoUrl: string;
  faviconUrl: string;
  resolvedBrandMark: string;
  resolvedBrandMarkType: CreatorBrandMarkType;
  fallbackInitials: string;
  palette: string[];
  normalizedPalette: string[];
  typography: {
    fontFamily: string;
    pdfFont: string;
    headingWeight: number;
    bodyWeight: number;
  };
  tone: string;
  audience: string;
  industry: string;
  domain: string;
  socialHandles: Record<string, string>;
  contrastProfile: {
    backgroundColor: string;
    accentContrastOnDark: number;
    accentContrastOnLight: number;
    ctaTextColor: string;
    textColor: string;
    mutedTextColor: string;
    panelOpacity: number;
    corrections: string[];
  };
  accentColor: string;
  overlayStrategy: {
    textColor: string;
    headingColor: string;
    mutedTextColor: string;
    panelFill: string;
    panelOpacity: number;
    ctaFill: string;
    ctaTextColor: string;
    footerColor: string;
    shadeStartOpacity: number;
    shadeMidOpacity: number;
  };
  rendererIdentityVersion: string;
  layoutVariantId: string;
  renderIdentityHash: string;
};

type ResolveBrandKitInput = {
  assetPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  companyId?: string | null;
  tenantId?: string | null;
  platform?: string | null;
  assetType?: string | null;
};

const RENDERER_IDENTITY_VERSION = 'creator-brandkit-v1';
const DEFAULT_PALETTE = ['#111827', '#2563eb', '#14b8a6'];
const SAFE_ACCENT = '#38bdf8';

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clean(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function toHex(value: unknown): string | null {
  const raw = clean(value);
  const match = /^#?([0-9a-f]{6})$/i.exec(raw);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (value: number) => {
    const next = value / 255;
    return next <= 0.03928 ? next / 12.92 : Math.pow((next + 0.055) / 1.055, 2.4);
  };
  return (0.2126 * channel(rgb.r)) + (0.7152 * channel(rgb.g)) + (0.0722 * channel(rgb.b));
}

export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function normalizePalette(input: unknown[]): string[] {
  const colors = input.flatMap((value) => String(value ?? '').split(/[,;\s]+/))
    .map(toHex)
    .filter((value): value is string => Boolean(value));
  const deduped = Array.from(new Set(colors));
  const palette = [...deduped, ...DEFAULT_PALETTE].slice(0, 5);
  return Array.from(new Set(palette)).slice(0, 5);
}

function getPaletteCandidates(input: ResolveBrandKitInput): unknown[] {
  const metadata = safeObject(input.metadata);
  const assetPayload = safeObject(input.assetPayload);
  const selected = safeObject(metadata.selected_brand_assets);
  const brandContext = safeObject(metadata.brand_context);
  const overrides = safeObject(brandContext.overrides);
  const profile = safeObject(brandContext.profile);
  return [
    ...(Array.isArray(assetPayload.color_palette) ? assetPayload.color_palette : []),
    selected.brandColors,
    selected.brand_colors,
    overrides.brandColors,
    overrides.brand_colors,
    profile.brandColors,
    profile.brand_colors,
    profile.brand_colors_hex,
    metadata.brand_colors,
  ];
}

function getSocialHandles(profile: Record<string, unknown>, overrides: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, string> {
  const candidate = safeObject(overrides.socialHandles);
  const profileHandles = safeObject(profile.socialHandles || profile.social_handles);
  const metadataHandles = safeObject(metadata.socialHandles || metadata.social_handles);
  const merged = { ...metadataHandles, ...profileHandles, ...candidate };
  return Object.fromEntries(
    Object.entries(merged)
      .map(([key, value]) => [key, clean(value)])
      .filter(([, value]) => Boolean(value)),
  );
}

function fallbackInitials(companyName: string): string {
  const words = companyName.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'OV';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function chooseAccent(palette: string[]): { accentColor: string; corrections: string[] } {
  const corrections: string[] = [];
  const candidate = palette.find((color) => contrastRatio(color, '#020617') >= 3.2)
    || palette.find((color) => contrastRatio(color, '#ffffff') >= 3.2)
    || SAFE_ACCENT;
  if (candidate === SAFE_ACCENT && !palette.includes(SAFE_ACCENT)) {
    corrections.push('unsafe_accent_replaced');
  }
  return { accentColor: candidate, corrections };
}

function hashShort(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function resolveBrandFields(input: ResolveBrandKitInput) {
  const metadata = safeObject(input.metadata);
  const selected = safeObject(metadata.selected_brand_assets);
  const brandContext = safeObject(metadata.brand_context);
  const overrides = safeObject(brandContext.overrides);
  const profile = safeObject(brandContext.profile);
  const profileIdentity = safeObject(profile.identity);
  const companyName = clean(
    selected.companyName
      || selected.company_name
      || overrides.companyName
      || overrides.company_name
      || profile.companyName
      || profile.company_name
      || profile.name
      || metadata.company_name
      || 'OMNIVYRA',
  );
  return {
    metadata,
    selected,
    overrides,
    profile,
    companyName,
    logoUrl: clean(selected.logoUrl || selected.logo_url || overrides.logoUrl || overrides.logo_url || profile.logoUrl || profile.logo_url),
    faviconUrl: clean(selected.faviconUrl || selected.favicon_url || overrides.faviconUrl || overrides.favicon_url || profile.faviconUrl || profile.favicon_url),
    tone: clean(selected.brandTone || selected.brand_tone || overrides.brandTone || overrides.brand_tone || profile.brandTone || profile.brand_tone || profile.brand_voice || metadata.tone),
    audience: clean(selected.audience || overrides.audience || profile.audience || profile.target_audience || metadata.audience),
    industry: clean(selected.industry || overrides.industry || profile.industry || profile.category || metadata.industry),
    domain: clean(selected.domain || overrides.domain || profile.domain || profile.website || profile.website_url || profileIdentity.domain || metadata.domain),
    tagline: clean(selected.tagline || overrides.tagline || profile.tagline || metadata.tagline),
    socialHandles: getSocialHandles(profile, overrides, metadata),
  };
}

export function resolveCreatorBrandKit(input: ResolveBrandKitInput = {}): CreatorBrandKit {
  const fields = resolveBrandFields(input);
  const palette = normalizePalette(getPaletteCandidates(input));
  const normalizedPalette = palette.slice(0, 3);
  const { accentColor, corrections } = chooseAccent(normalizedPalette);
  const accentContrastOnDark = contrastRatio(accentColor, '#020617');
  const accentContrastOnLight = contrastRatio(accentColor, '#ffffff');
  const ctaTextColor = accentContrastOnLight >= accentContrastOnDark ? '#ffffff' : '#06121f';
  const lowAccentContrast = Math.max(accentContrastOnDark, accentContrastOnLight) < 3.2;
  const panelOpacity = lowAccentContrast ? 0.58 : 0.46;
  const brandMark = fields.logoUrl || fields.faviconUrl || fallbackInitials(fields.companyName);
  const brandMarkType: CreatorBrandMarkType = fields.logoUrl ? 'logo' : fields.faviconUrl ? 'favicon' : 'initials';
  const tenantId = clean(input.tenantId || fields.metadata.tenant_id || fields.metadata.tenantId || input.companyId || fields.metadata.company_id) || null;
  const companyId = clean(input.companyId || fields.metadata.company_id || fields.metadata.companyId) || null;
  const layoutVariantId = `brand-${hashShort({
    tenantId,
    companyId,
    companyName: fields.companyName,
    platform: input.platform,
    assetType: input.assetType,
    palette: normalizedPalette,
    tone: fields.tone,
    industry: fields.industry,
    audience: fields.audience,
  })}`;
  const renderIdentityHash = hashShort({
    tenantId,
    companyId,
    companyName: fields.companyName,
    mark: brandMark,
    palette: normalizedPalette,
    platform: input.platform,
    assetType: input.assetType,
    version: RENDERER_IDENTITY_VERSION,
  });

  return {
    tenantId,
    companyId,
    companyName: fields.companyName,
    logoUrl: fields.logoUrl,
    faviconUrl: fields.faviconUrl,
    resolvedBrandMark: brandMark,
    resolvedBrandMarkType: brandMarkType,
    fallbackInitials: fallbackInitials(fields.companyName),
    palette,
    normalizedPalette,
    typography: {
      fontFamily: 'Arial, Helvetica, sans-serif',
      pdfFont: 'Helvetica',
      headingWeight: 900,
      bodyWeight: 600,
    },
    tone: fields.tone,
    audience: fields.audience,
    industry: fields.industry,
    domain: fields.domain,
    socialHandles: fields.socialHandles,
    contrastProfile: {
      backgroundColor: normalizedPalette[0] || DEFAULT_PALETTE[0],
      accentContrastOnDark: Math.round(accentContrastOnDark * 100) / 100,
      accentContrastOnLight: Math.round(accentContrastOnLight * 100) / 100,
      ctaTextColor,
      textColor: '#ffffff',
      mutedTextColor: '#e2e8f0',
      panelOpacity,
      corrections: lowAccentContrast ? [...corrections, 'overlay_strengthened_for_contrast'] : corrections,
    },
    accentColor,
    overlayStrategy: {
      textColor: '#ffffff',
      headingColor: '#ffffff',
      mutedTextColor: '#e2e8f0',
      panelFill: '#0f172a',
      panelOpacity,
      ctaFill: accentColor,
      ctaTextColor,
      footerColor: '#f8fafc',
      shadeStartOpacity: 0.86,
      shadeMidOpacity: lowAccentContrast ? 0.56 : 0.46,
    },
    rendererIdentityVersion: RENDERER_IDENTITY_VERSION,
    layoutVariantId,
    renderIdentityHash,
  };
}

export function normalizeBrandMark(brandKit: CreatorBrandKit): {
  source: string;
  type: CreatorBrandMarkType;
  fallbackInitials: string;
} {
  return {
    source: brandKit.resolvedBrandMark,
    type: brandKit.resolvedBrandMarkType,
    fallbackInitials: brandKit.fallbackInitials,
  };
}

export function buildCreatorBrandKitMetadata(brandKit: CreatorBrandKit, input: {
  platform?: string | null;
  overlayConfiguration?: Record<string, unknown>;
  exportCapabilities?: string[];
} = {}): Record<string, unknown> {
  return {
    tenantId: brandKit.tenantId,
    companyId: brandKit.companyId,
    creatorBrandKit: brandKit,
    paletteUsed: brandKit.normalizedPalette,
    logoSource: brandKit.resolvedBrandMarkType,
    rendererVersion: brandKit.rendererIdentityVersion,
    layoutVariantId: brandKit.layoutVariantId,
    platformContext: input.platform || null,
    overlayConfiguration: input.overlayConfiguration || brandKit.overlayStrategy,
    exportCapabilities: input.exportCapabilities || ['preview', 'download'],
    renderIdentityHash: brandKit.renderIdentityHash,
  };
}
