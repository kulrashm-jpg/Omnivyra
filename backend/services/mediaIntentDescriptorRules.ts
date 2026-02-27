export type MediaIntentDescriptor = {
  platform: string;
  recommended_type?: string;
  visual_goal?: string;
  visual_style?: string;
  text_overlay?: 'none' | 'optional' | 'recommended';
  aspect_ratio?: string;
  overlay_style?: string;
  thumbnail_style?: string;
  opening_scene_goal?: string;
  preview_frame_hint?: string;
};

const DEFAULT_MEDIA_INTENT: MediaIntentDescriptor = {
  platform: 'default',
  recommended_type: 'supporting_visual',
  visual_goal: 'clarity',
  visual_style: 'clean, brand-aligned',
  text_overlay: 'optional',
  aspect_ratio: '1:1',
};

const PLATFORM_MEDIA_INTENT: Record<string, Omit<MediaIntentDescriptor, 'platform'>> = {
  linkedin: {
    recommended_type: 'professional_image',
    visual_goal: 'authority_building',
    visual_style: 'clean, corporate',
    text_overlay: 'optional',
    aspect_ratio: '1:1',
  },
  instagram: {
    recommended_type: 'emotional_visual',
    visual_goal: 'scroll_stop',
    visual_style: 'vivid, human-centered',
    text_overlay: 'recommended',
    aspect_ratio: '4:5',
    overlay_style: 'bold',
  },
  facebook: {
    recommended_type: 'story_visual',
    visual_goal: 'engagement',
    visual_style: 'warm, relatable',
    text_overlay: 'optional',
    aspect_ratio: '1.91:1',
  },
  x: {
    recommended_type: 'minimal_graphic',
    visual_goal: 'fast_comprehension',
    visual_style: 'high contrast, simple',
    text_overlay: 'recommended',
    aspect_ratio: '16:9',
  },
  twitter: {
    recommended_type: 'minimal_graphic',
    visual_goal: 'fast_comprehension',
    visual_style: 'high contrast, simple',
    text_overlay: 'recommended',
    aspect_ratio: '16:9',
  },
  youtube: {
    thumbnail_style: 'high contrast face + text',
    opening_scene_goal: 'pattern interrupt',
    preview_frame_hint: 'result-focused shot',
    visual_goal: 'click_through',
    aspect_ratio: '16:9',
  },
};

export function getMediaIntentDescriptor(platform: string): MediaIntentDescriptor {
  const normalized = String(platform || '').trim().toLowerCase();
  const matched = PLATFORM_MEDIA_INTENT[normalized];
  if (!matched) {
    return { ...DEFAULT_MEDIA_INTENT, platform: normalized || 'default' };
  }
  return {
    platform: normalized,
    ...matched,
  };
}

