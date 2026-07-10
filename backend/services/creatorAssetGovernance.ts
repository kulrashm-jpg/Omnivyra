export type GovernedAssetType =
  | 'supporting_image'
  | 'banner'
  | 'infographic'
  | 'carousel'
  | 'brand_card'
  | 'pdf'
  | 'slider';

export type AssetGovernanceProfile = {
  maxWordsPerSlide?: number;
  maxTextAreaPercent?: number;
  allowCTA: boolean;
  allowParagraphs: boolean;
  allowHeadline: boolean;
  allowMetrics: boolean;
  allowDenseCopy: boolean;
  visualPriority: 'visual' | 'balanced' | 'copy';
};

export type PlatformVisualProfile = {
  preferredDensity: 'low' | 'medium' | 'high';
  preferredTypographyScale: 'compact' | 'standard' | 'large';
  visualStyle: 'professional' | 'concise' | 'visual_first' | 'social_balanced';
  ctaTolerance: 'none' | 'low' | 'medium';
  carouselBehavior: 'framework' | 'concise' | 'visual_sequence' | 'balanced';
};

export type CreatorQualityScore = {
  cleanliness: number;
  readability: number;
  clutterRisk: number;
  ctaAbuseRisk: number;
  duplicationRisk: number;
  typographySafety: number;
  visualHierarchy: number;
  warnings: string[];
  rejected: boolean;
};

export type VisualGovernanceValidation = {
  ok: boolean;
  warnings: string[];
  errors: string[];
  profile: AssetGovernanceProfile;
  platformProfile: PlatformVisualProfile;
  textAreaPercent: number;
  wordCount: number;
};

export const ASSET_GOVERNANCE_PROFILES: Record<GovernedAssetType, AssetGovernanceProfile> = {
  supporting_image: {
    maxWordsPerSlide: 0,
    maxTextAreaPercent: 0,
    allowCTA: false,
    allowParagraphs: false,
    allowHeadline: false,
    allowMetrics: false,
    allowDenseCopy: false,
    visualPriority: 'visual',
  },
  banner: {
    // Text-inside-image (embedded_copy) templates carry STRUCTURED copy — headline +
    // subheadline + CTA (+ an optional hook) — which is legitimately ~24-28 words; the prior 14
    // (tuned for a single hero headline) failed those closed with text_density_exceeds_profile.
    // Raised to 30 (still below carousel's 34); maxTextAreaPercent + the renderer's per-region
    // line caps remain the true overflow guards.
    maxWordsPerSlide: 30,
    maxTextAreaPercent: 18,
    allowCTA: true,
    allowParagraphs: false,
    allowHeadline: true,
    allowMetrics: false,
    allowDenseCopy: false,
    visualPriority: 'balanced',
  },
  infographic: {
    maxWordsPerSlide: 72,
    maxTextAreaPercent: 34,
    allowCTA: false,
    allowParagraphs: false,
    allowHeadline: true,
    allowMetrics: true,
    allowDenseCopy: false,
    visualPriority: 'balanced',
  },
  carousel: {
    maxWordsPerSlide: 34,
    maxTextAreaPercent: 28,
    allowCTA: true,
    allowParagraphs: false,
    allowHeadline: true,
    allowMetrics: true,
    allowDenseCopy: false,
    visualPriority: 'balanced',
  },
  brand_card: {
    maxWordsPerSlide: 22,
    maxTextAreaPercent: 20,
    allowCTA: false,
    allowParagraphs: false,
    allowHeadline: true,
    allowMetrics: false,
    allowDenseCopy: false,
    visualPriority: 'copy',
  },
  pdf: {
    maxWordsPerSlide: 110,
    maxTextAreaPercent: 42,
    allowCTA: true,
    allowParagraphs: true,
    allowHeadline: true,
    allowMetrics: true,
    allowDenseCopy: true,
    visualPriority: 'copy',
  },
  slider: {
    maxWordsPerSlide: 42,
    maxTextAreaPercent: 30,
    allowCTA: true,
    allowParagraphs: false,
    allowHeadline: true,
    allowMetrics: true,
    allowDenseCopy: false,
    visualPriority: 'balanced',
  },
};

export const PLATFORM_VISUAL_PROFILES: Record<string, PlatformVisualProfile> = {
  linkedin: {
    preferredDensity: 'medium',
    preferredTypographyScale: 'standard',
    visualStyle: 'professional',
    ctaTolerance: 'low',
    carouselBehavior: 'framework',
  },
  x: {
    preferredDensity: 'low',
    preferredTypographyScale: 'compact',
    visualStyle: 'concise',
    ctaTolerance: 'low',
    carouselBehavior: 'concise',
  },
  twitter: {
    preferredDensity: 'low',
    preferredTypographyScale: 'compact',
    visualStyle: 'concise',
    ctaTolerance: 'low',
    carouselBehavior: 'concise',
  },
  instagram: {
    preferredDensity: 'low',
    preferredTypographyScale: 'large',
    visualStyle: 'visual_first',
    ctaTolerance: 'medium',
    carouselBehavior: 'visual_sequence',
  },
  facebook: {
    preferredDensity: 'medium',
    preferredTypographyScale: 'standard',
    visualStyle: 'social_balanced',
    ctaTolerance: 'medium',
    carouselBehavior: 'balanced',
  },
};

function words(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

/**
 * Reduce copy to fit a word budget while keeping it COMPLETE: keep as many whole
 * sentences as fit within maxWords (so the slide never ends mid-thought). Only if
 * not even the first sentence fits does it fall back to a whole-word cut. This is
 * a governance safety net — the generators are told the budget so copy usually
 * already fits.
 */
function trimCopyToWordBudget(value: string, maxWords: number): string {
  const sentences = value.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [value];
  const kept: string[] = [];
  let count = 0;
  for (const sentence of sentences) {
    const w = words(sentence).length;
    if (count + w > maxWords) break;
    kept.push(sentence);
    count += w;
  }
  if (kept.length > 0) return kept.join(' ').trim();
  // First sentence alone exceeds the budget → whole-word cut as a last resort.
  return words(value).slice(0, maxWords).join(' ');
}

function normalizeAssetType(value: string): GovernedAssetType {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'supporting_image'
    || normalized === 'banner'
    || normalized === 'infographic'
    || normalized === 'carousel'
    || normalized === 'brand_card'
    || normalized === 'pdf'
    || normalized === 'slider'
  ) {
    return normalized;
  }
  if (normalized === 'image') return 'supporting_image';
  return 'supporting_image';
}

export function resolveAssetGovernanceProfile(assetType: string): AssetGovernanceProfile {
  return ASSET_GOVERNANCE_PROFILES[normalizeAssetType(assetType)];
}

export function resolvePlatformVisualProfile(platform: string): PlatformVisualProfile {
  return PLATFORM_VISUAL_PROFILES[String(platform || '').toLowerCase()] ?? PLATFORM_VISUAL_PROFILES.linkedin;
}

export function autoCorrectVisualCopy(input: {
  assetType: string;
  textBlocks: string[];
  allowCTA?: boolean;
}): { textBlocks: string[]; corrections: string[] } {
  const profile = resolveAssetGovernanceProfile(input.assetType);
  const corrections: string[] = [];
  const maxWords = profile.maxWordsPerSlide ?? 28;
  const textBlocks = input.textBlocks.map((block) => {
    let next = block.replace(/\s+/g, ' ').trim();
    if (!profile.allowCTA || input.allowCTA === false) {
      const stripped = next.replace(/\b(book a demo|learn more|buy now|subscribe|click here)\b/gi, '').trim();
      if (stripped !== next) corrections.push('removed_cta');
      next = stripped;
    }
    const tokens = words(next);
    if (tokens.length > maxWords) {
      corrections.push('reduced_text_density');
      // Keep complete sentences within the word budget instead of a mid-thought
      // word-count chop, so overlay/slide copy always reads as finished.
      next = trimCopyToWordBudget(next, maxWords);
    }
    // Profiles that forbid paragraph overlays (single-hero images / banners) must
    // carry ONE sentence per field — a MULTI-sentence block is flagged as a
    // paragraph and fails the render manifest CLOSED. Collapse to the first
    // sentence so legitimate multi-sentence AI copy renders instead of hard-
    // failing generation. (Word budget above already bounds length; we do NOT
    // impose a char cap here — that would override profiles like brand_card whose
    // word budget legitimately exceeds the paragraph char threshold.)
    if (!profile.allowParagraphs && next && /[.!?]\s+\S/.test(next)) {
      const firstSentence = next.match(/[^.!?]+[.!?]?/)?.[0]?.trim();
      if (firstSentence && firstSentence !== next) { next = firstSentence; corrections.push('collapsed_to_single_line'); }
    }
    return next;
  }).filter(Boolean);
  return { textBlocks, corrections: [...new Set(corrections)] };
}

export function scoreCreatorQuality(input: {
  assetType: string;
  platform: string;
  textBlocks: string[];
  hasCTA?: boolean;
  duplicateText?: boolean;
  overlapRisk?: boolean;
  tinyTextRisk?: boolean;
}): CreatorQualityScore {
  const profile = resolveAssetGovernanceProfile(input.assetType);
  const platform = resolvePlatformVisualProfile(input.platform);
  const text = input.textBlocks.join(' ');
  const wordCount = words(text).length;
  const maxWords = Math.max(1, profile.maxWordsPerSlide ?? 32);
  const densityRatio = wordCount / maxWords;
  const warnings: string[] = [];
  if (densityRatio > 1) warnings.push('text_density_exceeds_profile');
  if (input.hasCTA && !profile.allowCTA) warnings.push('cta_policy_violation');
  if (input.duplicateText) warnings.push('duplication_risk');
  if (input.overlapRisk) warnings.push('typography_overlap_risk');
  if (input.tinyTextRisk) warnings.push('tiny_text_risk');
  if (platform.preferredDensity === 'low' && densityRatio > 0.75) warnings.push('platform_density_mismatch');

  const cleanliness = Math.max(0, 100 - Math.round(densityRatio * 35) - (input.overlapRisk ? 25 : 0));
  const readability = Math.max(0, 100 - (input.tinyTextRisk ? 35 : 0) - Math.max(0, wordCount - maxWords));
  const clutterRisk = Math.min(100, Math.round(densityRatio * 65) + (input.overlapRisk ? 25 : 0));
  const ctaAbuseRisk = input.hasCTA && !profile.allowCTA ? 100 : input.hasCTA ? 35 : 0;
  const duplicationRisk = input.duplicateText ? 100 : 0;
  const typographySafety = Math.max(0, 100 - (input.overlapRisk ? 55 : 0) - (input.tinyTextRisk ? 35 : 0));
  const visualHierarchy = Math.max(0, profile.allowHeadline ? 85 - Math.round(densityRatio * 15) : 70);
  return {
    cleanliness,
    readability,
    clutterRisk,
    ctaAbuseRisk,
    duplicationRisk,
    typographySafety,
    visualHierarchy,
    warnings,
    rejected: warnings.includes('cta_policy_violation') || warnings.includes('typography_overlap_risk'),
  };
}

export function estimateTextAreaPercent(input: {
  textBlocks: string[];
  width?: number;
  height?: number;
  typographyScale?: 'compact' | 'standard' | 'large';
}): number {
  const width = Math.max(1, input.width ?? 1200);
  const height = Math.max(1, input.height ?? 1200);
  const scale = input.typographyScale === 'large' ? 1.35 : input.typographyScale === 'compact' ? 0.82 : 1;
  const characters = input.textBlocks.join(' ').replace(/\s+/g, ' ').trim().length;
  const estimatedPixels = characters * 18 * 28 * scale;
  return Math.min(100, Math.round((estimatedPixels / (width * height)) * 100));
}

export function validateVisualGovernance(input: {
  assetType: string;
  platform: string;
  textBlocks: string[];
  hasCTA?: boolean;
  textAreaPercent?: number;
  paragraphCount?: number;
  duplicateText?: boolean;
  overlapRisk?: boolean;
  tinyTextRisk?: boolean;
}): VisualGovernanceValidation {
  const profile = resolveAssetGovernanceProfile(input.assetType);
  const platformProfile = resolvePlatformVisualProfile(input.platform);
  const text = input.textBlocks.join(' ').replace(/\s+/g, ' ').trim();
  const wordCount = words(text).length;
  const textAreaPercent = input.textAreaPercent ?? estimateTextAreaPercent({
    textBlocks: input.textBlocks,
    typographyScale: platformProfile.preferredTypographyScale,
  });
  const warnings: string[] = [];
  const errors: string[] = [];
  const maxWords = profile.maxWordsPerSlide ?? Number.POSITIVE_INFINITY;

  if (wordCount > maxWords) errors.push('text_density_exceeds_profile');
  if (textAreaPercent > (profile.maxTextAreaPercent ?? 100)) errors.push('text_area_exceeds_profile');
  if (input.hasCTA && !profile.allowCTA) errors.push('cta_policy_violation');
  if ((input.paragraphCount ?? 0) > 0 && !profile.allowParagraphs) errors.push('paragraph_overlay_forbidden');
  if (input.duplicateText) errors.push('thread_duplication_forbidden');
  if (input.overlapRisk) errors.push('typography_overlap_risk');
  if (input.tinyTextRisk) errors.push('tiny_text_risk');
  if (platformProfile.preferredDensity === 'low' && wordCount > Math.max(12, maxWords * 0.75)) {
    warnings.push('platform_density_mismatch');
  }
  if (profile.visualPriority === 'visual' && wordCount > 0) errors.push('visual_priority_rejects_text_overlay');
  if (!profile.allowHeadline && wordCount > 0) errors.push('headline_overlay_forbidden');

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    profile,
    platformProfile,
    textAreaPercent,
    wordCount,
  };
}

export function buildPreviewGovernanceWarnings(input: {
  validation: VisualGovernanceValidation;
  quality: CreatorQualityScore;
}): string[] {
  return [...new Set([
    ...input.validation.errors,
    ...input.validation.warnings,
    ...input.quality.warnings,
    input.quality.cleanliness < 70 ? 'visual_cleanliness_low' : '',
    input.quality.readability < 70 ? 'readability_low' : '',
    input.quality.visualHierarchy < 70 ? 'visual_hierarchy_weak' : '',
  ].filter(Boolean))];
}
