/**
 * CREATOR CONTENT REPURPOSING ENGINE
 *
 * Adapts generated creator content for multiple platforms while preserving core narrative.
 * Different from text repurposing - handles:
 * - Video script duration/pacing for each platform
 * - Carousel layout & text optimization per platform
 * - Hook strategy adapted to platform behavior
 * - Visual/audio cues adjusted for platform native patterns
 *
 * Output: Platform-specific variants ready for creator tools or editing software
 */

export interface PlatformAdaptation {
  platform: string;
  duration?: number;
  aspect_ratio?: string;
  hook_pattern: string;
  text_optimization: string;
  audio_strategy: string;
  formatting_rules: string[];
  estimated_engagement: {
    hook_passthrough: number; // % expected to get hooked
    completion_rate: number; // % expected to complete
    engagement_rate: number; // estimated likes/comments/shares rate
  };
}

/**
 * Adapt video script for different platforms
 * Handles duration constraints, pacing, hook patterns
 */
export async function repurposeVideoScriptForPlatforms(
  masterScript: any,
  targetPlatforms: string[]
): Promise<Record<string, any>> {
  const platformVariants: Record<string, any> = {};

  const platformConfigs: Record<string, PlatformAdaptation> = {
    tiktok: {
      platform: 'tiktok',
      duration: 15,
      aspect_ratio: '9:16',
      hook_pattern: 'fast-cut pattern recognition hook - pattern interruption within 1 second',
      text_optimization: 'minimal on-screen text, heavy voiceover or captions, trending audio required',
      audio_strategy: 'MUST use trending audio or high-energy soundtrack, sync cuts to beat changes',
      formatting_rules: [
        'Min 4 cuts per 15 seconds (1 cut per ~3.75 seconds)',
        'Hook occupies first 1 second (not 2-3)',
        'Use trending sounds library',
        'Rapid text changes force re-engagement',
        'Platform native transitions (zoom, slide, cut)',
      ],
      estimated_engagement: {
        hook_passthrough: 0.65, // TikTok algorithm shows heavy on hook
        completion_rate: 0.38,
        engagement_rate: 0.08, // higher engagement on TikTok
      },
    },
    instagram_reels: {
      platform: 'instagram_reels',
      duration: 30,
      aspect_ratio: '9:16',
      hook_pattern: 'intrigue hook - curiosity gap with promise of revelation by frame 3',
      text_optimization: 'balanced on-screen text + captions, Instagram audience reads more',
      audio_strategy: 'use trending reels audio OR music library tracks, sync to music beats',
      formatting_rules: [
        'Optimal 6-8 cuts for 30 seconds',
        'Hook takes 2-3 seconds (allows story setup)',
        'Text overlays with brand colors',
        'Slower pacing than TikTok',
        'Call-to-action at end (link, DM, follow)',
      ],
      estimated_engagement: {
        hook_passthrough: 0.72,
        completion_rate: 0.45,
        engagement_rate: 0.06,
      },
    },
    youtube_shorts: {
      platform: 'youtube_shorts',
      duration: 60,
      aspect_ratio: '9:16',
      hook_pattern: 'authority hook - expertise/insight hook that builds trust immediately',
      text_optimization: 'can use longer explanatory text, YouTube audience reads for learning',
      audio_strategy: 'voiceover preferred, clear audio quality important, music secondary',
      formatting_rules: [
        'Optimal 6-10 cuts for 60 seconds',
        'Hook takes 3-4 seconds (allows premise establishment)',
        'Clear dialogue/voiceover',
        'Educational pacing - time for explanation',
        'End screen with subscribe CTA',
      ],
      estimated_engagement: {
        hook_passthrough: 0.68,
        completion_rate: 0.52,
        engagement_rate: 0.05,
      },
    },
    linkedin: {
      platform: 'linkedin',
      duration: 45,
      aspect_ratio: '16:9', // LinkedIn prefers landscape for professional content
      hook_pattern: 'professional insight hook - business benefit hook within 2 seconds',
      text_optimization: 'verbose text encouraged, LinkedIn skrolls for business intelligence',
      audio_strategy: 'optional (many view muted), consider on-screen text + captions',
      formatting_rules: [
        'Slower pacing, more substantial',
        'Professional tone maintained',
        'Data/stats in visuals',
        'Call-to-action for engagement (comments, shares)',
        'Aspect ratio 16:9 or 1:1 for mobile',
      ],
      estimated_engagement: {
        hook_passthrough: 0.55,
        completion_rate: 0.48,
        engagement_rate: 0.04,
      },
    },
  };

  for (const platform of targetPlatforms) {
    const config = platformConfigs[platform];
    if (!config) continue;

    // Condense video script for platform duration
    const condensedScript = condenseVideoScript(masterScript, config.duration);

    // Adapt hook for platform pattern
    const adaptedHook = adaptHookForPlatform(condensedScript.hook_scene, config.hook_pattern);

    // Re-pace scenes for platform cut frequency
    const repairedScenes = repaceScenes(condensedScript.scenes, config.duration, config.formatting_rules);

    // Optimize text for platform reading behavior
    const textOptimized = optimizeTextForPlatform(
      repairedScenes,
      config.text_optimization
    );

    // Adapt audio strategy
    const audioAdapted = adaptAudioStrategy(textOptimized, config.audio_strategy, platform);

    platformVariants[platform] = {
      platform,
      master_script_adapted: true,
      duration: config.duration,
      aspect_ratio: config.aspect_ratio,
      hook: adaptedHook,
      scenes: audioAdapted,
      cta: masterScript.cta_scene,
      platform_metadata: {
        hook_pattern_used: config.hook_pattern,
        estimated_engagement: config.estimated_engagement,
        formatting_notes: config.formatting_rules,
      },
    };
  }

  return platformVariants;
}

/**
 * Condense video script to fit platform duration
 */
function condenseVideoScript(script: any, targetDuration: number): any {
  const currentDuration = script.scenes.reduce((sum: number, s: any) => sum + (s.duration_seconds || 3), 0) +
    (script.hook_scene?.duration_seconds || 2) +
    (script.cta_scene ? 2 : 0);

  const compressionRatio = targetDuration / currentDuration;

  if (compressionRatio >= 0.95) return script; // No compression needed

  const compressedScenes = script.scenes
    .slice(0, Math.max(3, Math.floor(script.scenes.length * compressionRatio)))
    .map((scene: any) => ({
      ...scene,
      duration_seconds: Math.ceil(scene.duration_seconds * compressionRatio),
    }));

  return {
    ...script,
    scenes: compressedScenes,
  };
}

/**
 * Adapt hook to match platform-specific pattern
 */
function adaptHookForPlatform(hookScene: any, pattern: string): any {
  return {
    ...hookScene,
    pacing_rule: `Hook must follow pattern: ${pattern}`,
    critical: `This is your make-or-break moment. Viewer scroll decision happens in first 1-2 seconds.`,
  };
}

/**
 * Re-pace scenes for optimal cuts per platform
 */
function repaceScenes(scenes: any[], duration: number, rules: string[]): any[] {
  // Calculate optimal cut frequency from rules
  const cutsPerSecondMatch = rules
    .find(r => r.includes('cut'))
    ?.match(/(\d+(?:\.\d+)?)\s*cut/i);

  const cutsPerSecond = cutsPerSecondMatch ? parseFloat(cutsPerSecondMatch[1]) / duration : 0.25;
  const targetCuts = Math.max(3, Math.floor(duration * cutsPerSecond));

  // Redistribute cuts across scenes
  const sceneQuality = scenes.length / targetCuts; // scenes per cut
  const adjustedScenes = scenes.map(scene => ({
    ...scene,
    cut_indicator: scene.transition !== 'no_cut',
    pacing_indicator: sceneQuality > 1.5 ? 'slow' : 'fast',
  }));

  return adjustedScenes;
}

/**
 * Optimize text for platform reading behavior
 */
function optimizeTextForPlatform(scenes: any[], strategy: string): any[] {
  const isVerbose = strategy.includes('verbose') || strategy.includes('reads');
  const isMinimal = strategy.includes('minimal') || strategy.includes('captions');

  return scenes.map((scene: any) => {
    if (isVerbose) {
      return {
        ...scene,
        // Expand text with explanation
        dialogue: expandText(scene.dialogue),
      };
    } else if (isMinimal) {
      return {
        ...scene,
        // Reduce text, emphasize visual
        dialogue: minimizeText(scene.dialogue),
      };
    }
    return scene;
  });
}

/**
 * Adapt audio strategy for platform
 */
function adaptAudioStrategy(scenes: any[], strategy: string, platform: string): any[] {
  return scenes.map((scene: any) => ({
    ...scene,
    audio_strategy_adapted: strategy,
    platform_audio_note:
      platform === 'tiktok'
        ? 'REQUIRED: Use trending audio from TikTok library or high-energy music that syncs to cuts'
        : platform === 'instagram_reels'
          ? 'Reels audio library trending tracks recommended, music + voiceover balance'
          : platform === 'linkedin'
            ? 'Optional: Professional voiceover preferred, clear audio quality crucial'
            : 'Platform-appropriate audio',
  }));
}

function expandText(original: string): string {
  // Expand brief dialogue to fuller explanation
  return original ? `${original} — this approach helps you understand...` : '';
}

function minimizeText(original: string): string {
  // Reduce to essentials
  return original ? original.split('—')[0].trim() : '';
}

/**
 * Carousel repurposing for different platforms
 * Instagram carousel ≠ Pinterest ≠ LinkedIn carousel
 */
export async function repurposeCarouselForPlatforms(
  masterCarousel: any,
  targetPlatforms: string[]
): Promise<Record<string, any>> {
  const platformVariants: Record<string, any> = {};

  const carouselConfigs: Record<string, any> = {
    instagram: {
      max_slides: 10,
      optimal_slides: 5,
      text_limit_per_slide: 150,
      aspect_ratio: '1:1',
      include_captions: true,
      save_optimization: 'educational carousel (how-to, tips)',
    },
    pinterest: {
      max_slides: 50,
      optimal_slides: 7,
      text_limit_per_slide: 200,
      aspect_ratio: '1000:1500', // Portrait for pins
      include_captions: true,
      save_optimization: 'how-to guide, tips and tricks',
    },
    linkedin: {
      max_slides: 20,
      optimal_slides: 5,
      text_limit_per_slide: 250,
      aspect_ratio: '1.2:1', // Landscape
      include_captions: false,
      save_optimization: 'professional insights, industry trends',
    },
    tiktok: {
      max_slides: 10,
      optimal_slides: 3,
      text_limit_per_slide: 100,
      aspect_ratio: '9:16', // Vertical
      include_captions: true,
      save_optimization: 'quick tips, trending format',
    },
  };

  for (const platform of targetPlatforms) {
    const config = carouselConfigs[platform];
    if (!config) continue;

    // Trim or expand slide count for platform
    const adaptedSlides = masterCarousel.slides
      .slice(0, config.optimal_slides)
      .map((slide: any) => ({
        ...slide,
        text_adapted: optimizeSlideText(slide, config.text_limit_per_slide),
        visual_aspect_ratio: config.aspect_ratio,
      }));

    platformVariants[platform] = {
      platform,
      total_slides: adaptedSlides.length,
      slides: adaptedSlides,
      platform_metadata: {
        optimal_saves_count: config.optimal_slides,
        text_optimization: config.save_optimization,
        aspect_ratio: config.aspect_ratio,
      },
    };
  }

  return platformVariants;
}

function optimizeSlideText(slide: any, limit: number): any {
  const originalText = slide.body_text || '';
  if (originalText.length <= limit) return slide;

  return {
    ...slide,
    body_text: originalText.substring(0, limit) + '...',
  };
}
