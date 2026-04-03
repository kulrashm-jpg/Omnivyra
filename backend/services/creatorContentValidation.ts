/**
 * CREATOR CONTENT VALIDATION SERVICE
 *
 * Validates video scripts, carousels, and visual stories against creator-specific rules.
 * Checks for:
 * - All required structural elements
 * - Hook effectiveness (attention grab)
 * - Visual coherence and platform fit
 * - Platform-specific constraints
 * - Engagement signals in content structure
 */

import { CreatorContentType, CREATOR_VALIDATION_RULES } from '../prompts/creatorContentPromptsV1';

export interface CreatorValidationResult {
  pass: boolean;
  severity?: 'info' | 'warning' | 'blocking';
  issues?: string[];
  auto_repairs?: string[];
  quality_assessment?: {
    hook_strength: 'weak' | 'moderate' | 'strong';
    narrative_flow: 'disjointed' | 'adequate' | 'compelling';
    visual_clarity: 'unclear' | 'clear' | 'vivid';
    platform_fit: Record<string, 'poor' | 'adequate' | 'excellent'>;
  };
}

/**
 * Validate creator content quality
 */
export async function validateCreatorContentQuality(
  blueprint: any,
  contentType: CreatorContentType
): Promise<CreatorValidationResult> {
  const rules = CREATOR_VALIDATION_RULES[contentType];
  const issues: string[] = [];
  const autoRepairs: string[] = [];
  const qualityAssessment: any = {};

  // Validate based on content type
  if (contentType === 'video_script') {
    return validateVideoScript(blueprint, rules, issues, autoRepairs, qualityAssessment);
  } else if (contentType === 'carousel') {
    return validateCarousel(blueprint, rules, issues, autoRepairs, qualityAssessment);
  } else if (contentType === 'story') {
    return validateStory(blueprint, rules, issues, autoRepairs, qualityAssessment);
  }

  return {
    pass: false,
    severity: 'blocking',
    issues: [`Unknown content type: ${contentType}`],
  };
}

/**
 * Validate video script
 */
function validateVideoScript(
  script: any,
  rules: any,
  issues: string[],
  autoRepairs: string[],
  qualityAssessment: any
): CreatorValidationResult {
  // Check hook exists and is strong
  if (!script.hook_scene) {
    issues.push('Missing hook_scene (critical for video engagement)');
  } else {
    const hookStrength = assessHookStrength(script.hook_scene);
    qualityAssessment.hook_strength = hookStrength;
    if (hookStrength === 'weak') {
      issues.push('Hook is weak - needs stronger opening statement');
    }
  }

  // Check scenes
  const sceneCount = script.scenes?.length || 0;
  if (sceneCount < rules.min_scenes) {
    issues.push(
      `Too few scenes: ${sceneCount}, need at least ${rules.min_scenes}`
    );
  }
  if (sceneCount > rules.max_scenes) {
    issues.push(
      `Too many scenes: ${sceneCount}, max ${rules.max_scenes}`
    );
  }

  // Check scene quality
  if (script.scenes) {
    script.scenes.forEach((scene: any, idx: number) => {
      if (!scene.visual || scene.visual.length < 10) {
        issues.push(`Scene ${idx + 1}: visual description too vague`);
      }
      if (!scene.audio_cue) {
        issues.push(`Scene ${idx + 1}: missing audio direction`);
      }
    });
  }

  // Check duration
  const totalDuration = (script.hook_scene?.duration_seconds || 2) +
    (script.scenes?.reduce((sum: number, s: any) => sum + (s.duration_seconds || 3), 0) || 0) +
    (script.cta_scene ? 2 : 0);

  if (totalDuration < rules.min_duration) {
    issues.push(
      `Script too short: ${totalDuration}s, need at least ${rules.min_duration}s`
    );
  }
  if (totalDuration > rules.max_duration) {
    issues.push(
      `Script too long: ${totalDuration}s, max ${rules.max_duration}s`
    );
  }

  // Check CTA
  if (!script.cta_scene) {
    issues.push('Missing call-to-action scene');
  }

  // Assess narrative flow
  qualityAssessment.narrative_flow = assessNarrativeFlow(script);
  qualityAssessment.visual_clarity = assessVisualClarity(script);

  // Assess platform fit
  qualityAssessment.platform_fit = assessVideoPlatformFit(script);

  const severity = issues.length === 0 ? undefined : issues.some(i => i.includes('critical')) ? 'blocking' : 'warning';

  return {
    pass: issues.length === 0,
    severity,
    issues: issues.length > 0 ? issues : undefined,
    auto_repairs: autoRepairs.length > 0 ? autoRepairs : undefined,
    quality_assessment: qualityAssessment,
  };
}

/**
 * Validate carousel
 */
function validateCarousel(
  carousel: any,
  rules: any,
  issues: string[],
  autoRepairs: string[],
  qualityAssessment: any
): CreatorValidationResult {
  const slideCount = carousel.slides?.length || 0;

  if (slideCount < rules.min_slides) {
    issues.push(
      `Too few slides: ${slideCount}, need at least ${rules.min_slides}`
    );
  }
  if (slideCount > rules.max_slides) {
    issues.push(
      `Too many slides: ${slideCount}, max ${rules.max_slides}`
    );
  }

  // Check hook slide
  const firstSlide = carousel.slides?.[0];
  if (!firstSlide?.headline || firstSlide.headline.length < 5) {
    issues.push('First slide hook headline missing or too short');
  }

  // Check each slide
  if (carousel.slides) {
    carousel.slides.forEach((slide: any, idx: number) => {
      if (!slide.visual_description || slide.visual_description.length < 10) {
        issues.push(`Slide ${idx + 1}: visual description too vague`);
      }
      if (slide.body_text && slide.body_text.length < rules.min_text_per_slide) {
        issues.push(
          `Slide ${idx + 1}: text too short (${slide.body_text.length} chars, need ${rules.min_text_per_slide})`
        );
      }
    });
  }

  // Check CTA slide
  if (!carousel.cta_slide) {
    issues.push('Missing call-to-action slide');
  } else if (!carousel.cta_slide.cta_text) {
    issues.push('CTA slide missing action text');
  }

  qualityAssessment.narrative_flow = assessCarouselFlow(carousel);
  qualityAssessment.visual_clarity = assessVisualClarity(carousel);
  qualityAssessment.platform_fit = assessCarouselPlatformFit(carousel);

  const severity = issues.length === 0 ? undefined : 'warning';

  return {
    pass: issues.length === 0,
    severity,
    issues: issues.length > 0 ? issues : undefined,
    auto_repairs: autoRepairs.length > 0 ? autoRepairs : undefined,
    quality_assessment: qualityAssessment,
  };
}

/**
 * Validate story
 */
function validateStory(
  story: any,
  rules: any,
  issues: string[],
  autoRepairs: string[],
  qualityAssessment: any
): CreatorValidationResult {
  const frameCount = story.frames?.length || 0;

  if (frameCount < rules.min_frames) {
    issues.push(
      `Too few frames: ${frameCount}, need at least ${rules.min_frames}`
    );
  }
  if (frameCount > rules.max_frames) {
    issues.push(
      `Too many frames: ${frameCount}, max ${rules.max_frames}`
    );
  }

  // Check duration
  const totalDuration = story.frames?.reduce((sum: number, f: any) => sum + (f.duration_seconds || 3), 0) || 0;
  if (totalDuration < rules.min_duration) {
    issues.push(
      `Story too short: ${totalDuration}s, need at least ${rules.min_duration}s`
    );
  }
  if (totalDuration > rules.max_duration) {
    issues.push(
      `Story too long: ${totalDuration}s, max ${rules.max_duration}s`
    );
  }

  // Check narrative arc
  if (!story.narrative_intent) {
    issues.push('Missing narrative intent/theme');
  }

  // Check frames
  if (story.frames) {
    story.frames.forEach((frame: any, idx: number) => {
      if (!frame.visual_cue || frame.visual_cue.length < 5) {
        issues.push(`Frame ${idx + 1}: visual cue too vague`);
      }
      if (!frame.emotional_beat) {
        issues.push(`Frame ${idx + 1}: missing emotional beat`);
      }
    });
  }

  // Check CTA
  if (!story.resolution_frame) {
    issues.push('Missing resolution frame with CTA');
  }

  qualityAssessment.narrative_flow = assessStoryNarrative(story);
  qualityAssessment.visual_clarity = assessVisualClarity(story);
  qualityAssessment.platform_fit = assessStoryPlatformFit(story);

  const severity = issues.length === 0 ? undefined : 'warning';

  return {
    pass: issues.length === 0,
    severity,
    issues: issues.length > 0 ? issues : undefined,
    auto_repairs: autoRepairs.length > 0 ? autoRepairs : undefined,
    quality_assessment: qualityAssessment,
  };
}

/**
 * Assessment functions
 */

function assessHookStrength(hookScene: any): 'weak' | 'moderate' | 'strong' {
  const text = hookScene.text || '';
  const visual = hookScene.visual || '';

  let strength = 0;

  // Strong hooks have specific, intriguing language
  const strongIndicators = ['must', 'never', 'shocking', 'viral', 'secret', 'hidden', 'reveal', 'prove'];
  strength += strongIndicators.filter(s => text.toLowerCase().includes(s)).length > 0 ? 1 : 0;

  // Hook length matters (35-80 chars is sweet spot)
  if (text.length >= 35 && text.length <= 80) strength += 1;

  // Visual cue specificity
  if (visual.length > 20 && visual.toLowerCase().includes('dynamic')) strength += 1;

  return strength >= 2 ? 'strong' : strength >= 1 ? 'moderate' : 'weak';
}

function assessNarrativeFlow(script: any): 'disjointed' | 'adequate' | 'compelling' {
  const scenes = script.scenes || [];
  if (scenes.length < 2) return 'disjointed';

  // Check for logical progression
  let flowScore = 0;
  for (let i = 0; i < scenes.length - 1; i++) {
    const current = scenes[i];
    const next = scenes[i + 1];
    // If next scene has transition, flow is likely good
    if (next.transition && next.transition !== 'cut') flowScore += 1;
  }

  const flowPercent = flowScore / (scenes.length - 1);
  return flowPercent > 0.7 ? 'compelling' : flowPercent > 0.3 ? 'adequate' : 'disjointed';
}

function assessCarouselFlow(carousel: any): 'disjointed' | 'adequate' | 'compelling' {
  const slides = carousel.slides || [];
  if (slides.length < 2) return 'disjointed';

  // Check if slides progress logically
  let hasProgression = true;
  for (let i = 0; i < slides.length - 1; i++) {
    if (!slides[i].body_text || !slides[i + 1].body_text) {
      hasProgression = false;
      break;
    }
  }

  return hasProgression ? 'compelling' : 'adequate';
}

function assessStoryNarrative(story: any): 'disjointed' | 'adequate' | 'compelling' {
  const frames = story.frames || [];
  if (frames.length < 2) return 'disjointed';

  // Check for emotional arc
  const emotionalBeats = frames.filter((f: any) => f.emotional_beat).length;
  const emotionalPercent = emotionalBeats / frames.length;

  return emotionalPercent > 0.8 ? 'compelling' : emotionalPercent > 0.5 ? 'adequate' : 'disjointed';
}

function assessVisualClarity(content: any): 'unclear' | 'clear' | 'vivid' {
  // Get all visual descriptions
  let visualDescriptions: string[] = [];

  if (content.scenes) {
    visualDescriptions = content.scenes
      .map((s: any) => s.visual || '')
      .filter((v: string) => v.length > 0);
  } else if (content.slides) {
    visualDescriptions = content.slides
      .map((s: any) => s.visual_description || '')
      .filter((v: string) => v.length > 0);
  } else if (content.frames) {
    visualDescriptions = content.frames
      .map((f: any) => f.visual_cue || '')
      .filter((v: string) => v.length > 0);
  }

  if (visualDescriptions.length === 0) return 'unclear';

  const avgLength = visualDescriptions.reduce((sum, v) => sum + v.length, 0) / visualDescriptions.length;
  const vividIndicators = visualDescriptions.filter(v =>
    /zoom|pan|fade|vibrant|dynamic|slow|fast|movement/i.test(v)
  ).length;

  const vividPercent = vividIndicators / visualDescriptions.length;

  return avgLength > 50 && vividPercent > 0.5 ? 'vivid' : avgLength > 20 && vividPercent > 0.2 ? 'clear' : 'unclear';
}

function assessVideoPlatformFit(script: any): Record<string, 'poor' | 'adequate' | 'excellent'> {
  const platformMetadata = script.platform_notes || {};
  const fit: Record<string, any> = {};

  const platforms = platformMetadata.recommended_platforms || ['tiktok', 'instagram_reels'];
  for (const platform of platforms) {
    fit[platform] = 'adequate'; // Default
  }

  return fit;
}

function assessCarouselPlatformFit(carousel: any): Record<string, 'poor' | 'adequate' | 'excellent'> {
  const metadata = carousel.platform_metadata || {};
  const fit: Record<string, any> = {};

  const platforms = ['instagram', 'pinterest', 'linkedin'];
  for (const platform of platforms) {
    fit[platform] = 'adequate'; // Default
  }

  return fit;
}

function assessStoryPlatformFit(story: any): Record<string, 'poor' | 'adequate' | 'excellent'> {
  const metadata = story.engagement_strategy || {};
  const fit: Record<string, any> = {};

  const platforms = ['instagram', 'tiktok', 'youtube'];
  for (const platform of platforms) {
    fit[platform] = 'adequate'; // Default
  }

  return fit;
}
