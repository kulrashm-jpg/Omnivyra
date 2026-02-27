export type MediaType = 'image' | 'video' | 'thumbnail' | 'illustration';
export type MediaOrientation = 'portrait' | 'landscape' | 'square';

export type PlatformMediaSearchRule = {
  media_type: MediaType;
  orientation: MediaOrientation;
  style_tags: string[];
  platform_reason: string;
};

export type MediaRequirement = {
  role: string;
  media_type: MediaType;
  required: boolean;
  orientation: MediaOrientation;
};

const DEFAULT_MEDIA_SEARCH_RULE: PlatformMediaSearchRule = {
  media_type: 'image',
  orientation: 'landscape',
  style_tags: ['clean', 'high quality'],
  platform_reason: 'Balanced visual style for cross-platform adaptation.',
};

const PLATFORM_MEDIA_SEARCH_RULES: Record<string, PlatformMediaSearchRule> = {
  linkedin: {
    media_type: 'image',
    orientation: 'landscape',
    style_tags: ['professional', 'corporate', 'clean'],
    platform_reason: 'Professional feed visuals typically perform best with clear, business-oriented compositions.',
  },
  instagram: {
    media_type: 'image',
    orientation: 'portrait',
    style_tags: ['emotional', 'aesthetic', 'high contrast'],
    platform_reason: 'Portrait, high-emotion visuals match scrolling behavior and visual-first discovery.',
  },
  youtube: {
    media_type: 'thumbnail',
    orientation: 'landscape',
    style_tags: ['high contrast', 'face', 'bold text'],
    platform_reason: 'High-contrast thumbnail framing improves click-through in video browsing contexts.',
  },
  facebook: {
    media_type: 'image',
    orientation: 'landscape',
    style_tags: ['relatable', 'warm', 'clean'],
    platform_reason: 'Feed-native visuals with relatable context tend to support engagement on Facebook.',
  },
  x: {
    media_type: 'image',
    orientation: 'landscape',
    style_tags: ['high contrast', 'minimal', 'bold'],
    platform_reason: 'Fast-scan timeline content benefits from minimal, high-contrast visual cues.',
  },
  twitter: {
    media_type: 'image',
    orientation: 'landscape',
    style_tags: ['high contrast', 'minimal', 'bold'],
    platform_reason: 'Fast-scan timeline content benefits from minimal, high-contrast visual cues.',
  },
};

export function getPlatformMediaSearchRule(platform: string): PlatformMediaSearchRule {
  const normalized = String(platform || '').trim().toLowerCase();
  return PLATFORM_MEDIA_SEARCH_RULES[normalized] || DEFAULT_MEDIA_SEARCH_RULE;
}

export function getMediaRequirements(content_type: string, platform: string): MediaRequirement[] {
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const normalizedType = String(content_type || '').trim().toLowerCase() || 'post';

  if (normalizedPlatform === 'youtube') {
    return [
      { role: 'thumbnail', media_type: 'thumbnail', required: true, orientation: 'landscape' },
      {
        role: normalizedType === 'short' ? 'preview_frame' : 'cover',
        media_type: 'image',
        required: false,
        orientation: 'landscape',
      },
    ];
  }

  if (normalizedPlatform === 'instagram') {
    if (normalizedType === 'reel' || normalizedType === 'video' || normalizedType === 'story') {
      return [
        { role: 'primary_visual', media_type: 'video', required: true, orientation: 'portrait' },
        { role: 'cover', media_type: 'image', required: false, orientation: 'portrait' },
      ];
    }
    return [
      { role: 'primary_visual', media_type: 'image', required: true, orientation: 'portrait' },
      { role: 'support_visual', media_type: 'illustration', required: false, orientation: 'portrait' },
    ];
  }

  if (normalizedPlatform === 'linkedin') {
    if (normalizedType === 'video') {
      return [
        { role: 'primary_visual', media_type: 'video', required: true, orientation: 'landscape' },
        { role: 'cover', media_type: 'image', required: false, orientation: 'landscape' },
      ];
    }
    return [
      { role: 'primary_visual', media_type: 'image', required: true, orientation: 'landscape' },
      { role: 'support_visual', media_type: 'illustration', required: false, orientation: 'landscape' },
    ];
  }

  if (normalizedPlatform === 'x' || normalizedPlatform === 'twitter') {
    return [
      { role: 'primary_visual', media_type: normalizedType === 'video' ? 'video' : 'image', required: true, orientation: 'landscape' },
      { role: 'support_visual', media_type: 'illustration', required: false, orientation: 'landscape' },
    ];
  }

  if (normalizedPlatform === 'facebook') {
    return [
      { role: 'primary_visual', media_type: normalizedType === 'video' ? 'video' : 'image', required: true, orientation: 'landscape' },
      { role: 'cover', media_type: 'image', required: false, orientation: 'landscape' },
    ];
  }

  return [
    { role: 'primary_visual', media_type: 'image', required: true, orientation: 'landscape' },
    { role: 'support_visual', media_type: 'illustration', required: false, orientation: 'landscape' },
  ];
}

