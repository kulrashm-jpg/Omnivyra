/**
 * Platform-native visual adaptation (Phase 3).
 *
 * Per-platform adjustment rules applied on top of a campaign's DNA.
 * Adapts framing / density / focal hierarchy / realism balance /
 * whitespace / CTA emphasis / visual energy / human presence — while
 * preserving campaign coherence (emotional tone + realism profile +
 * composition family stay inherited from the DNA).
 *
 * Pure, deterministic. No DB / fetch. Provider-agnostic.
 */

export type PlatformId =
  | 'linkedin'
  | 'instagram'
  | 'x'
  | 'twitter'
  | 'tiktok'
  | 'facebook'
  | 'banner'
  | 'hero_graphic'
  | 'email_header'
  | 'landing_page'
  | 'default';

export type DensityAdjustment = 'tighter' | 'lighter' | 'normal';
export type WhitespaceDiscipline = 'tight' | 'generous' | 'normal';
export type CtaEmphasis = 'restrained' | 'visible' | 'absent';
export type VisualEnergy = 'low' | 'moderate' | 'high';
export type HumanNudge = 'subtle' | 'present' | 'absent';

export type PlatformAdaptation = {
  platform: PlatformId;
  framingAdjustment: string;
  densityAdjustment: DensityAdjustment;
  focalHierarchyHint: string;
  realismBalanceHint: string;
  whitespaceDiscipline: WhitespaceDiscipline;
  ctaEmphasis: CtaEmphasis;
  visualEnergy: VisualEnergy;
  humanPresenceNudge: HumanNudge;
  promptLines: ReadonlyArray<string>;
};

const ADAPTATIONS: Record<PlatformId, PlatformAdaptation> = {
  linkedin: {
    platform: 'linkedin',
    framingAdjustment: 'editorial restraint, asymmetric off-center subject, conservative framing',
    densityAdjustment: 'lighter',
    focalHierarchyHint: 'one decisive focal element, generous breathing room',
    realismBalanceHint: 'editorial documentary realism, subdued tone',
    whitespaceDiscipline: 'generous',
    ctaEmphasis: 'restrained',
    visualEnergy: 'low',
    humanPresenceNudge: 'subtle',
    promptLines: [
      'LinkedIn native rendering: editorial restraint, executive tone, generous whitespace discipline.',
      'Conservative framing; one focal idea with calm depth around it.',
    ],
  },
  instagram: {
    platform: 'instagram',
    framingAdjustment: 'visual storytelling composition, intentional foreground hook',
    densityAdjustment: 'normal',
    focalHierarchyHint: 'rich foreground subject + atmospheric backdrop',
    realismBalanceHint: 'cinematic documentary realism, emotionally evocative',
    whitespaceDiscipline: 'normal',
    ctaEmphasis: 'restrained',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'present',
    promptLines: [
      'Instagram native rendering: stronger visual storytelling, emotional composition, richer visual presence.',
      'Lean into atmospheric depth; humans may be present and integrated with environment.',
    ],
  },
  x: {
    platform: 'x',
    framingAdjustment: 'punchy decisive framing, immediate readability',
    densityAdjustment: 'normal',
    focalHierarchyHint: 'one immediate focal element, fast read',
    realismBalanceHint: 'editorial cinematic, decisive but restrained',
    whitespaceDiscipline: 'normal',
    ctaEmphasis: 'restrained',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'subtle',
    promptLines: [
      'X native rendering: punchy decisive framing optimized for in-feed scroll.',
      'One immediate focal element; calm depth; no decorative clutter.',
    ],
  },
  twitter: {
    platform: 'twitter',
    framingAdjustment: 'punchy decisive framing, immediate readability',
    densityAdjustment: 'normal',
    focalHierarchyHint: 'one immediate focal element, fast read',
    realismBalanceHint: 'editorial cinematic, decisive but restrained',
    whitespaceDiscipline: 'normal',
    ctaEmphasis: 'restrained',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'subtle',
    promptLines: [
      'Twitter native rendering: punchy decisive framing optimized for in-feed scroll.',
      'One immediate focal element; calm depth; no decorative clutter.',
    ],
  },
  tiktok: {
    platform: 'tiktok',
    framingAdjustment: 'dynamic vertical-optimized framing, candid energy',
    densityAdjustment: 'tighter',
    focalHierarchyHint: 'energetic foreground subject, vertical-first composition',
    realismBalanceHint: 'candid documentary realism, energetic',
    whitespaceDiscipline: 'tight',
    ctaEmphasis: 'visible',
    visualEnergy: 'high',
    humanPresenceNudge: 'present',
    promptLines: [
      'TikTok native rendering: higher energy, dynamic vertical-optimized framing, candid realism.',
      'Real moment of motion or interaction; human subjects engage with environment naturally.',
    ],
  },
  facebook: {
    platform: 'facebook',
    framingAdjustment: 'conversational framing, accessible composition',
    densityAdjustment: 'normal',
    focalHierarchyHint: 'one warm focal subject, balanced depth',
    realismBalanceHint: 'editorial documentary, warm tonal balance',
    whitespaceDiscipline: 'normal',
    ctaEmphasis: 'restrained',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'subtle',
    promptLines: [
      'Facebook native rendering: conversational framing with warm tonal balance.',
      'Accessible composition; one focal subject; balanced ambient depth.',
    ],
  },
  banner: {
    platform: 'banner',
    framingAdjustment: 'horizontal hero composition, single-element hierarchy',
    densityAdjustment: 'lighter',
    focalHierarchyHint: 'single hero element with extreme negative space',
    realismBalanceHint: 'cinematic editorial restraint',
    whitespaceDiscipline: 'generous',
    ctaEmphasis: 'visible',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'absent',
    promptLines: [
      'Banner / hero rendering: horizontal hero composition with extreme negative space discipline.',
      'Single hero subject; calm ambient depth; humans typically absent unless brand DNA explicitly requires.',
    ],
  },
  hero_graphic: {
    platform: 'hero_graphic',
    framingAdjustment: 'cinematic hero composition, decisive focal idea',
    densityAdjustment: 'lighter',
    focalHierarchyHint: 'one decisive hero with deep ambient context',
    realismBalanceHint: 'cinematic premium',
    whitespaceDiscipline: 'generous',
    ctaEmphasis: 'restrained',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'absent',
    promptLines: [
      'Hero graphic rendering: cinematic hero composition with decisive focal idea.',
      'Single hero subject; deep atmospheric depth; humans typically absent.',
    ],
  },
  email_header: {
    platform: 'email_header',
    framingAdjustment: 'compact horizontal framing optimized for inbox preview',
    densityAdjustment: 'lighter',
    focalHierarchyHint: 'one subject + calm ambient backdrop, short-read composition',
    realismBalanceHint: 'editorial restraint',
    whitespaceDiscipline: 'generous',
    ctaEmphasis: 'restrained',
    visualEnergy: 'low',
    humanPresenceNudge: 'absent',
    promptLines: [
      'Email header rendering: compact horizontal framing optimized for inbox preview.',
      'Short-read composition; one subject + calm ambient backdrop; humans typically absent.',
    ],
  },
  landing_page: {
    platform: 'landing_page',
    framingAdjustment: 'cinematic hero composition with controlled ambient depth',
    densityAdjustment: 'normal',
    focalHierarchyHint: 'hero subject + supporting context cue + ambient atmosphere',
    realismBalanceHint: 'cinematic editorial',
    whitespaceDiscipline: 'generous',
    ctaEmphasis: 'visible',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'subtle',
    promptLines: [
      'Landing page rendering: cinematic hero composition with controlled ambient depth.',
      'Hero subject anchored by one supporting context cue; humans subtle when present.',
    ],
  },
  default: {
    platform: 'default',
    framingAdjustment: 'asymmetric editorial framing, decisive focal idea',
    densityAdjustment: 'normal',
    focalHierarchyHint: 'one focal subject with calm ambient depth',
    realismBalanceHint: 'editorial cinematic',
    whitespaceDiscipline: 'normal',
    ctaEmphasis: 'restrained',
    visualEnergy: 'moderate',
    humanPresenceNudge: 'subtle',
    promptLines: [],
  },
};

function normalize(platform: string | null | undefined): PlatformId {
  const k = String(platform ?? '').toLowerCase().trim();
  if (k in ADAPTATIONS) return k as PlatformId;
  return 'default';
}

export function resolvePlatformAdaptation(platform: string | null | undefined): PlatformAdaptation {
  return ADAPTATIONS[normalize(platform)];
}

/** Diagnostics — full catalog. */
export function listPlatformAdaptations(): ReadonlyArray<PlatformAdaptation> {
  return Object.values(ADAPTATIONS);
}
