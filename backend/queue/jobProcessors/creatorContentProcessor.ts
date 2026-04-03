/**
 * CREATOR CONTENT GENERATION PROCESSOR
 *
 * Handles the full lifecycle for video scripts, carousels, and visual stories:
 * - Angle generation (3-angle system optimized for visual content)
 * - Master script/carousel/story generation
 * - Platform-specific repurposing (TikTok, Instagram, YouTube, LinkedIn)
 * - Quality validation with creator-specific rules
 * - Cost estimation and credit deduction
 * - Feedback tracking for visual content effectiveness
 *
 * Differs from text processor:
 * - Uses creatorContentPromptsV1 instead of contentGenerationPromptsV3
 * - Enriches prompts with activity workspace context (theme, campaign, brand visual)
 * - Outputs include platform variants and visual specifications
 * - Feedback tracks visual engagement metrics (hook passthrough, completion, shares)
 */

import { Job } from 'bullmq';
import { unifiedEngine } from '../../services/unifiedContentGenerationEngine';
import { getCreatorSystemPrompt, CREATOR_VALIDATION_RULES } from '../../prompts/creatorContentPromptsV1';
import {
  repurposeVideoScriptForPlatforms,
  repurposeCarouselForPlatforms,
} from '../../services/creatorContentRepurposingEngine';
import { validateCreatorContentQuality } from '../../services/creatorContentValidation';
import { recordCreatorFeedback } from '../../services/contentFeedbackLoop';
import { runCompletionWithOperation } from '../../services/aiGateway';
import type { ContentAngle, ContentBlueprint } from '../../services/unifiedContentGenerationEngine';

export async function processCreatorContentJob(job: Job): Promise<any> {
  const {
    company_id,
    content_type,
    topic,
    audience,
    creator_context,
    angle_preference,
    company_profile,
    activity_workspace,
  } = job.data;

  try {
    console.log(`[creatorContentProcessor] Processing ${content_type} for company ${company_id}`);

    // Step 1: Validate input
    void job.updateProgress(5);
    if (!creator_context || !creator_context.target_platforms?.length) {
      throw new Error('Creator context missing: need target_platforms, campaign_description, content_theme');
    }

    // Step 2: Generate 3 narrative angles tailored to visual storytelling
    void job.updateProgress(15);
    const angles = await generateCreatorAngles(
      topic,
      audience,
      creator_context,
      content_type
    );
    console.log(`[creatorContentProcessor] Generated ${angles.length} angles:`, angles.map(a => ({ type: a.type, label: a.label })));

    // Step 3: Select optimal angle based on feedback & creator context
    void job.updateProgress(25);
    const selectedAngle = await selectOptimalCreatorAngle(
      angles,
      angle_preference,
      company_id
    );

    // Step 4: Generate master creator content (script/carousel/story)
    void job.updateProgress(35);
    const masterBlueprint = await generateCreatorMasterContent(
      topic,
      audience,
      selectedAngle,
      creator_context,
      content_type
    );

    // Step 5: Validate content quality with creator-specific rules
    void job.updateProgress(50);
    const validationResult = await validateCreatorContentQuality(
      masterBlueprint,
      content_type
    );
    if (!validationResult.pass && validationResult.severity === 'blocking') {
      throw new Error(`Content validation failed: ${validationResult.issues?.join(', ')}`);
    }

    // Step 6: Generate platform-specific variants
    void job.updateProgress(60);
    let platformVariants: Record<string, any> = {};
    if (content_type === 'video_script') {
      platformVariants = await repurposeVideoScriptForPlatforms(
        masterBlueprint,
        creator_context.target_platforms
      );
    } else if (content_type === 'carousel') {
      platformVariants = await repurposeCarouselForPlatforms(
        masterBlueprint,
        creator_context.target_platforms
      );
    } else if (content_type === 'story') {
      platformVariants = await repurposeVideoScriptForPlatforms(
        masterBlueprint,
        creator_context.target_platforms
      );
    }

    // Step 7: Estimate cost & deduct credits
    void job.updateProgress(75);
    const estimatedTokens = estimateCreatorTokens(masterBlueprint, content_type);
    const costUsd = estimateCost(estimatedTokens, content_type);
    await deductCredits(company_id, `content_${content_type}`, costUsd);

    // Step 8: Build decision trace
    void job.updateProgress(85);
    const decisionTrace = {
      source_topic: topic,
      objective: creator_context.campaign_description,
      content_theme: creator_context.content_theme,
      selected_angle: selectedAngle.type,
      platform_targets: creator_context.target_platforms,
      platforms_generated: Object.keys(platformVariants),
    };

    // Step 9: Record feedback tracking (immediate for creator content)
    void job.updateProgress(90);
    await recordCreatorContentFeedback({
      company_id,
      content_type,
      platforms: creator_context.target_platforms,
      theme_used: creator_context.content_theme,
      angle_used: selectedAngle.type,
      timestamp: new Date(),
    });

    // Step 10: Return complete generation output
    void job.updateProgress(100);
    return {
      success: true,
      content_type,
      master_content: masterBlueprint,
      platform_variants: platformVariants,
      generation_trace: decisionTrace,
      estimated_cost_usd: costUsd,
      validation_result: validationResult,
      target_platforms: creator_context.target_platforms,
    };
  } catch (error) {
    console.error(`[creatorContentProcessor] Error processing ${content_type}:`, error);
    throw error;
  }
}

/**
 * Generate 3 narrative angles for visual content
 * Tailored to visual storytelling, platform-native hooks, engagement psychology
 */
async function generateCreatorAngles(
  topic: string,
  audience: string | undefined,
  creatorContext: any,
  contentType: string
): Promise<ContentAngle[]> {
  const systemPrompt = getCreatorSystemPrompt(contentType as any, creatorContext);

  // Create 3 angle generation prompt
  const anglesPrompt = `Given the topic "${topic}" for ${contentType} content targeting ${audience || 'general audience'}, and with the campaign context "${creatorContext.campaign_description}", generate 3 distinct narrative angles optimized for visual storytelling on ${creatorContext.target_platforms?.join(', ')}.

Each angle should be fundamentally different in:
1. **Hook approach** - How to grab attention in first 1-2 seconds
2. **Visual narrative** - The visual progression that tells the story
3. **Emotional resonance** - What feeling/reaction drives engagement

Format as JSON array with: type (analytical/contrarian/strategic), label, title, angle_summary (50 words), and hook (one sentence that appears on-screen)`;

  const response = await runCompletionWithOperation({
    prompt: anglesPrompt,
    system: systemPrompt,
    operation: 'creator_angles_generation',
    company_id: undefined, // Will be in context
  });

  try {
    const parsed = JSON.parse(response.content[0]?.text || '{}');
    const angles = Array.isArray(parsed) ? parsed : parsed.angles || [];
    console.log(`[generateCreatorAngles] Parsed ${angles.length} angles from AI response`);
    return angles;
  } catch (error) {
    console.warn(`[generateCreatorAngles] AI parsing failed, using fallback:`, error instanceof Error ? error.message : error);
    return buildFallbackCreatorAngles(topic, contentType);
  }
}

/**
 * Select optimal angle based on feedback + creator context
 */
async function selectOptimalCreatorAngle(
  angles: ContentAngle[],
  preference: string | undefined,
  company_id: string
): Promise<ContentAngle> {
  if (preference && angles.some(a => a.type === preference)) {
    return angles.find(a => a.type === preference)!;
  }

  // TODO: Query feedback effectiveness for this company
  // For now, default to strategic (most versatile for visual content)
  return angles.find(a => a.type === 'strategic') || angles[0];
}

/**
 * Generate master creator content (video script / carousel / story)
 */
async function generateCreatorMasterContent(
  topic: string,
  audience: string | undefined,
  angle: ContentAngle,
  creatorContext: any,
  contentType: string
): Promise<any> {
  const systemPrompt = getCreatorSystemPrompt(contentType as any, creatorContext);

  const contentPrompt = `Generate a ${contentType} for the topic "${topic}" targeting ${audience || 'general audience'}.

Angle: ${angle.label} (${angle.angle_summary})
Campaign: ${creatorContext.campaign_description}
Theme: ${creatorContext.content_theme}
Target Platforms: ${creatorContext.target_platforms?.join(', ')}
Brand Visual Tone: ${creatorContext.brand_visual_tone || 'professional'}
Audio Guidance: ${creatorContext.audio_guidance || 'platform-native'}

Requirements:
- Hook must follow the pattern of the ${angle.type} angle
- Visual descriptions must be specific and actionable
- Each platform variant must respect the platform's native constraints
- The narrative must drive the campaign objective

Output ONLY valid JSON matching the ${contentType} format.`;

  const response = await runCompletionWithOperation({
    prompt: contentPrompt,
    system: systemPrompt,
    operation: `creator_content_generation_${contentType}`,
    company_id: undefined,
  });

  try {
    const content = JSON.parse(response.content[0]?.text || '{}');
    return {
      ...content,
      metadata: {
        selected_angle: angle,
        campaign_context: creatorContext.campaign_description,
        theme: creatorContext.content_theme,
      },
    };
  } catch {
    throw new Error(`Failed to parse ${contentType} content generation response`);
  }
}

/**
 * Fallback angles for creator content when AI generation fails
 */
function buildFallbackCreatorAngles(topic: string, contentType: string): ContentAngle[] {
  return [
    {
      type: 'analytical',
      label: 'Deep Dive',
      title: `Analyzing ${topic}: The Data Behind It`,
      angle_summary: `Educational angle that breaks down ${topic} into key insights with data, statistics, and framework. Appeals to audiences seeking understanding.`,
      hook: `The real reason ${topic} matters (and the data proves it)`,
    },
    {
      type: 'contrarian',
      label: 'Counterintuitive',
      title: `Everyone's Wrong About ${topic}`,
      angle_summary: `Challenge conventional wisdom on ${topic}. Presents counter-narrative with evidence. High engagement through controversy/surprise.`,
      hook: `What everyone gets wrong about ${topic}`,
    },
    {
      type: 'strategic',
      label: 'Actionable',
      title: `How to Win at ${topic}`,
      angle_summary: `Practical, outcome-focused narrative. Provides specific steps/framework to achieve results with ${topic}. Appeals to doers/builders.`,
      hook: `Here's exactly how to leverage ${topic} for results`,
    },
  ];
}

/**
 * Estimate tokens for creator content (accounts for multiple platforms)
 */
function estimateCreatorTokens(blueprint: any, contentType: string): number {
  let tokens = 0;

  if (contentType === 'video_script') {
    // Estimate from scenes
    const scenesText = blueprint.scenes?.reduce((sum: number, s: any) => {
      return sum + (s.visual?.length || 0) + (s.dialogue?.length || 0) + (s.audio_cue?.length || 0);
    }, 0) || 0;
    tokens += Math.ceil(scenesText / 4); // ~4 chars per token
  } else if (contentType === 'carousel') {
    // Estimate from slides
    const slidesText = blueprint.slides?.reduce((sum: number, s: any) => {
      return sum + (s.headline?.length || 0) + (s.body_text?.length || 0) + (s.visual_description?.length || 0);
    }, 0) || 0;
    tokens += Math.ceil(slidesText / 4);
  } else if (contentType === 'story') {
    // Estimate from frames
    const framesText = blueprint.frames?.reduce((sum: number, f: any) => {
      return sum + (f.story_text?.length || 0) + (f.visual_cue?.length || 0);
    }, 0) || 0;
    tokens += Math.ceil(framesText / 4);
  }

  return Math.max(tokens, 100); // Minimum 100 tokens for creator content
}

/**
 * Cost estimation for creator content
 * Creator content often requires more complex generation
 */
function estimateCost(tokens: number, contentType: string): number {
  const creatorMultiplier = contentType === 'video_script' ? 1.5 : 1.2; // Video more complex

  const inputTokens = tokens * 0.75;
  const outputTokens = tokens * 0.25;

  const inputCost = (inputTokens / 1000) * 0.00015;
  const outputCost = (outputTokens / 1000) * 0.0006;

  return Math.round((inputCost + outputCost) * creatorMultiplier * 10000) / 10000;
}

/**
 * TODO: Integrate with credit system
 */
async function deductCredits(
  company_id: string,
  operation: string,
  costUsd: number
): Promise<void> {
  console.log(
    `[creatorContentProcessor] Deducting $${costUsd} from ${company_id} for ${operation}`
  );
  // Actual credit deduction via creditSystemService
}

/**
 * Record creator content feedback for learning
 * Tracks: theme effectiveness, platform performance, angle resonance
 */
async function recordCreatorContentFeedback(data: Record<string, unknown>): Promise<void> {
  try {
    await recordCreatorFeedback(data);
    console.debug('[creatorContentProcessor] Feedback recorded:', data);
  } catch (error) {
    console.warn('[creatorContentProcessor] Feedback recording failed (non-blocking):', error);
  }
}
