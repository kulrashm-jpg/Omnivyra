/** Part 1/2 of weekly-structure-helpers.ts — verbatim split (barrel preserved; importers unchanged). */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import {
  CREATOR_DAILY_GUIDANCE_FIELDS,
  getCreatorGovernance,
  isGuidanceOnlyFormat,
  normalizeCreatorFormat,
} from '../../../lib/shared/creatorGovernanceRegistry';

import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import {
  enrichDailyItemWithPlatformRequirements,
  validateDailyItemAgainstPlatformRules,
} from '../../../backend/services/platformExecutionValidator';
import {
  analyzeValidationResults,
  generatePlanningFeedback,
} from '../../../backend/services/campaignExecutionFeedbackService';
import { getPlatformRules } from '../../../backend/services/platformIntelligenceService';
import {
  analyzeExecutionFeedback,
  suggestPublishingStrategy,
} from '../../../backend/services/publishingOptimizationService';
import { generatePlatformWaveSchedule } from '../../../backend/services/campaignWaveService';
/** Daily distribution removed: schedule (day_index) comes from weekly plan only. */
import { getCompanyPerformanceInsights } from '../../../backend/services/campaignLearningService';
import {
  buildCampaignContext,
  getCampaignContext,
  setCampaignContext,
  type CampaignContext,
} from '../../../backend/services/contextCompressionService';
import { getStrategyMemory } from '../../../backend/services/campaignStrategyMemoryService';
import { getCachedStrategyProfile } from '../../../backend/services/strategyProfileCache';
import { getLatestCampaignVersionByCampaignId } from '../../../backend/db/campaignVersionStore';
import type { CampaignBlueprintWeek, WeeklyTopicWritingBrief } from '../../../backend/types/CampaignBlueprint';
import { filterBoltContentTypeMix } from '../../../backend/utils/boltTextContentConfig';
import {
  getExecutionCategoryForContentType,

  executionCategoryToAiGenerated,
} from '../../../backend/services/plannerActivityCardService';

import { type CreatorCard, buildCreatorCard } from './weeklyStructureHelpersShape';

export const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export type DailyPlanItem = {
  dayIndex: number;
  weekNumber: number;
  topicTitle: string;
  topicReference: string;
  globalProgressionIndex: number;
  dailyObjective: string;
  platformTargets: string[];
  contentType: string;
  briefSummary: string;
  writerBrief?: any;
  writingIntent: string;
  whoAreWeWritingFor: string;
  whatProblemAreWeAddressing: string;
  whatShouldReaderLearn: string;
  desiredAction: string;
  narrativeStyle: string;
  contentGuidance: {
    primaryFormat: string;
    maxWordTarget: number;
    platformWithHighestLimit: string;
  };
  ctaType: string;
  kpiTarget: string;
  /** Stable id for one logical content piece (optional, backward compatible). */
  masterContentId?: string;
  /**
   * CAMPAIGN-IMPL-004A — planner-emitted Master-Idea seed: the normalized base
   * business concept this asset was derived from. All format variants sharing a
   * base concept carry the same seed so they resolve to one Master Idea id.
   * Optional/backward compatible — absent on legacy + AI-decide rows.
   */
  masterIdeaSeed?: string;
};

export type CreativeGuidance = {
  theme: string;
  hook: string;
  visual_direction: string;
  shot_guidance: string[];
  scene_direction: string;
  CTA_direction: string;
  platform_adaptation: Record<string, string>;
  repurposing_guidance: string[];
  caption_direction: string;
  posting_guidance: string;
  production_notes: string[];
  production_checklist: string[];
  talking_points: string[];
  b_roll_ideas: string[];
};

type DailyObjectiveRefinement = {
  dayIndex: number;
  topicReference: string;
  dailyObjective: string;
};

export function normalizePlatformKey(platform: string): string {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'twitter') return 'x';
  return p;
}

/** Derive a meaningful pain point for synthesized slots (BOLT/legacy campaigns without AI-generated intents). */
export function deriveSynthPainPoint(topic: string): string {
  const t = String(topic ?? '').trim().toLowerCase();
  if (t.includes('pricing') || t.includes('price')) return 'Unclear value proposition and pricing expectations';
  if (t.includes('onboarding')) return 'Slow onboarding and long time-to-value for new customers';
  if (t.includes('trust') || t.includes('credibility')) return 'Low trust in the solution among potential buyers';
  if (t.includes('lead') || t.includes('pipeline')) return 'Inconsistent lead flow and unpredictable pipeline';
  if (t.includes('brand')) return 'Building brand recognition and differentiation in a crowded market';
  if (t.includes('content')) return 'Creating content that resonates with the right audience consistently';
  if (t.includes('growth') || t.includes('scale')) return 'Scaling reach and engagement without losing quality';
  if (t.includes('social') || t.includes('community')) return 'Maintaining a consistent and engaging social media presence';
  if (t.includes('seo') || t.includes('search') || t.includes('organic')) return 'Low organic visibility and inadequate search traffic';
  if (t.includes('email') || t.includes('newsletter')) return 'Low open rates and declining subscriber engagement';
  if (t.includes('retention') || t.includes('churn')) return 'High churn and difficulty retaining customers long-term';
  if (t.includes('conversion') || t.includes('funnel')) return 'Weak conversion rates through the marketing funnel';
  if (t.includes('product') || t.includes('feature')) return 'Communicating product value and differentiation clearly';
  if (t.includes('team') || t.includes('culture')) return 'Aligning team and culture messaging with audience expectations';
  const topicStr = String(topic ?? '').trim();
  return topicStr ? `Uncertainty about ${topicStr} and how to approach it effectively` : 'Unclear next steps and priorities';
}

/** Derive a meaningful outcome promise for synthesized slots (BOLT/legacy campaigns without AI-generated intents). */
export function deriveSynthOutcomePromise(topic: string, contentType: string): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const safe = t || 'this topic';
  if (ct === 'article' || ct === 'blog') return `Reader gains a deep understanding of ${safe} with actionable takeaways to apply immediately.`;
  if (ct === 'video' || ct === 'reel') return `Viewer walks away with a clear mental model for ${safe} and knows the first step to take.`;
  if (ct === 'carousel') return `Audience has a visual framework for ${safe} that they can reference and share.`;
  if (ct === 'thread') return `Reader follows the full arc from problem to solution for ${safe} in a single sitting.`;
  if (ct === 'poll') return `Audience reflects on their own stance on ${safe} and sees how peers think about it.`;
  return `Reader understands ${safe}, why it matters now, and the next concrete step to take.`;
}

// ─── STOP WORDS for keyword extraction ─────────────────────────────────────
const STOP_WORDS = new Set([
  'this','that','with','from','have','will','your','their','about','what','when','where',
  'which','there','these','those','some','into','over','than','then','them','they',
  'also','each','most','make','more','such','only','both','does','here','just','like',
  'very','much','even','well','back','been','come','good','give','know','long','many',
  'much','need','same','take','tell','look','come','want','show','think','help',
]);

/** Extract meaningful SEO keywords from a topic string. */
export function deriveKeywords(topic: string, objective: string = ''): string[] {
  const raw = `${topic} ${objective}`;
  const words = raw.split(/[\s\-_,;:|\/\\]+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
  // also add bigrams from the topic for SEO
  const topicWords = String(topic ?? '').split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()).filter(w => w.length >= 3);
  const bigrams: string[] = [];
  for (let i = 0; i < topicWords.length - 1; i++) {
    const bigram = `${topicWords[i]} ${topicWords[i+1]}`;
    if (bigram.length > 6) bigrams.push(bigram);
  }
  const uniq = [...new Set([...words, ...bigrams])];
  return uniq.slice(0, 10);
}

/** Derive SEO-optimised hashtags for a topic + content type. */
export function deriveHashtags(topic: string, contentType: string, objective: string = ''): string[] {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  // Topic words → PascalCase tag
  const topicTag = t.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('').replace(/[^a-zA-Z0-9]/g, '');
  // Content type tag
  const ctTag: Record<string, string> = {
    article: 'ContentMarketing', blog: 'BlogPost', post: 'SocialMedia', thread: 'Thread',
    newsletter: 'Newsletter', poll: 'Poll', video: 'VideoMarketing', reel: 'Reels',
    carousel: 'Carousel', story: 'Stories',
  };
  const typeTag = ctTag[ct] ?? 'MarketingContent';
  // Objective keyword
  const objWords = String(objective ?? '').split(/\s+/).filter(w => w.length >= 5 && !STOP_WORDS.has(w.toLowerCase())).slice(0, 2);
  const objTag = objWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const candidates = [topicTag, typeTag, 'Marketing', 'B2BMarketing', 'GrowthStrategy', objTag].filter(Boolean);
  return [...new Set(candidates)].slice(0, 6);
}

/** Derive an opening hook for text content. */
export function deriveTextHook(topic: string, contentType: string): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  if (!t) return 'Here is what most marketers get wrong — and how to fix it.';
  if (ct === 'poll') return `Quick question: how do you currently approach ${t}?`;
  if (ct === 'thread') return `A thread on ${t} — everything you need to know in 10 tweets. 🧵`;
  if (ct === 'newsletter') return `This week we're breaking down ${t} — and why it matters more than ever.`;
  if (ct === 'article' || ct === 'blog') return `Most businesses get ${t} completely wrong. Here's the framework that actually works.`;
  // Generic social post hooks
  const hooks = [
    `Everyone talks about ${t}. Almost nobody does it right.`,
    `${t} changed how we approach our marketing. Here's what we learned.`,
    `The uncomfortable truth about ${t} (and what to do about it).`,
    `If you're struggling with ${t}, this is for you.`,
  ];
  return hooks[Math.abs(t.length) % hooks.length]!;
}

/** Derive 4–5 key points to build content from. */
export function deriveKeyPoints(topic: string, objective: string, contentType: string): string[] {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const safe = t || 'this topic';
  const isLongForm = ct === 'article' || ct === 'blog' || ct === 'newsletter';
  const base = [
    `Why ${safe} matters now and what changed in the market`,
    `The most common mistakes when approaching ${safe}`,
    `A proven framework for ${safe} that drives results`,
    `How to measure success and iterate on your ${safe} strategy`,
  ];
  if (isLongForm) {
    base.push(`Real-world example: how a brand used ${safe} to grow their audience`);
    base.push(`Next steps: how to start implementing this today`);
  } else {
    base.push(`One actionable takeaway you can apply this week`);
  }
  return base;
}

/** Derive repurpose angles for a text content piece. */
export function deriveRepurposeAngles(topic: string, contentType: string): string[] {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const angles: string[] = [];
  if (ct === 'article' || ct === 'blog') {
    angles.push(`Break into 5-tweet thread highlighting each key point`);
    angles.push(`Turn statistics/frameworks into LinkedIn carousel (5–7 slides)`);
    angles.push(`Extract 3 pull quotes for standalone social posts`);
    angles.push(`Record a 60-second video summary for Reels/Shorts`);
    angles.push(`Condense into a LinkedIn newsletter intro with link-back`);
  } else if (ct === 'post') {
    angles.push(`Expand into a long-form article with research and examples`);
    angles.push(`Turn into a visual carousel with one point per slide`);
    angles.push(`Adapt as a poll to gauge audience opinion on ${t}`);
    angles.push(`Record a 30-second video version for Reels`);
  } else if (ct === 'thread') {
    angles.push(`Compile into a blog post with expanded explanations`);
    angles.push(`Turn each tweet into a slide for a LinkedIn carousel`);
    angles.push(`Extract the strongest tweet as a standalone post`);
  } else if (ct === 'carousel') {
    angles.push(`Record a walkthrough video explaining each slide`);
    angles.push(`Write a companion blog post expanding on each point`);
    angles.push(`Extract 1 stat/insight per slide as individual posts`);
  }
  if (angles.length === 0) {
    angles.push(`Repurpose as a short-form video summary`);
    angles.push(`Expand into a long-form companion article`);
    angles.push(`Extract key stats or quotes as standalone posts`);
  }
  return angles;
}

/** Derive SEO focus line for a topic. */
export function deriveSEOFocus(topic: string, objective: string = ''): string {
  const t = String(topic ?? '').trim();
  if (!t) return 'Brand authority and thought leadership';
  const tl = t.toLowerCase();
  if (tl.includes('how to') || tl.includes('guide') || tl.includes('step')) return `How-to search intent: "${t}" — target informational queries`;
  if (tl.includes('vs') || tl.includes('compare') || tl.includes('best')) return `Comparison intent: position for "${t}" decision-stage queries`;
  if (tl.includes('what is') || tl.includes('definition') || tl.includes('meaning')) return `Educational intent: own the definition of "${t}"`;
  if (tl.includes('tool') || tl.includes('software') || tl.includes('platform')) return `Commercial intent: target buyers searching "${t} tools"`;
  return `Thought leadership on "${t}" — target informational + branded queries`;
}

// ─── CREATOR-SPECIFIC derivation ───────────────────────────────────────────

/** Derive a visual hook (first 3 seconds). */
export function deriveVisualHook(topic: string, contentType: string): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const safe = t || 'this topic';
  if (ct === 'reel' || ct === 'video') {
    const hooks = [
      `Open on creator looking directly at camera: "You're probably getting ${safe} completely wrong — here's proof."`,
      `Quick-cut montage of the problem, then freeze frame with text: "The fix is simpler than you think."`,
      `Start mid-action: show a before/after result for ${safe} with no intro — let the result hook the viewer.`,
      `Creator asks direct question to camera: "How much are you spending on ${safe} with zero ROI?" Pause. "Watch this."`,
    ];
    return hooks[Math.abs(topic.length) % hooks.length]!;
  }
  if (ct === 'carousel') return `Slide 1: Bold headline — "${safe}" with a single striking stat or question. No fluff, immediate value signal.`;
  if (ct === 'story') return `Frame 1: Single striking stat or bold claim about ${safe} over a high-contrast background. Text only, 3 words max.`;
  return `Open with the most surprising fact or contrarian statement about ${safe} to stop the scroll.`;
}

/** Derive image prompt for AI image generation (for static visuals). */
export function deriveImagePrompt(topic: string, contentType: string, platforms: string[]): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const isInstagram = platforms.some(p => String(p).toLowerCase().includes('instagram'));
  const isLinkedIn = platforms.some(p => String(p).toLowerCase().includes('linkedin'));
  const aspectRatio = isInstagram ? '1:1 square' : isLinkedIn ? '1.91:1 landscape' : '9:16 vertical';
  const styleBase = isLinkedIn
    ? 'clean, professional, minimal, corporate photography style, soft shadows'
    : 'vibrant, modern, social-first design, bold typography overlay possible';
  return `${aspectRatio} format — ${styleBase}. Subject: visual representation of "${t}". Mood: confident, forward-looking. No text overlays. High contrast. Real people or abstract concept art preferred. Brand-safe, no stock photo clichés.`;
}

/** Derive video/reel direction for creator. */
export function deriveVideoPrompt(topic: string, contentType: string, platforms: string[]): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const isTikTok = platforms.some(p => String(p).toLowerCase().includes('tiktok'));
  const duration = isTikTok ? '15–30s' : ct === 'reel' ? '30–60s' : '60–90s';
  const ratio = isTikTok || ct === 'reel' ? '9:16 vertical' : '16:9 horizontal';
  return `${duration} ${ratio} video. Hook (0–3s): pattern interrupt — bold statement or surprising visual about "${t}". Build (3–20s): explain the core insight or process with on-screen text/b-roll. Payoff (final 5s): clear call to action — follow, comment, or click link. Captions: always on. Pacing: fast cuts (every 2–4s). Energy: confident, direct to camera or strong voiceover.`;
}

/** Derive scene-by-scene direction for longer creator content. */
export function deriveSceneDirection(topic: string, contentType: string): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const safe = t || 'the topic';
  if (ct === 'carousel') {
    return [
      `Slide 1 (Hook): Bold headline stating the core problem or insight about ${safe}. One sentence, large text.`,
      `Slide 2 (Context): Why this matters now — 1–2 sentences + supporting stat or data point.`,
      `Slide 3–5 (Core value): Each slide covers one key point with a short headline + 2–3 bullet sub-points.`,
      `Slide 6 (Case/example): Brief real-world example or before/after scenario.`,
      `Slide 7 (CTA): Clear next step — "Save this", "Follow for more", or "Comment your question below".`,
    ].join('\n');
  }
  if (ct === 'video' || ct === 'reel') {
    return [
      `Scene 1 (0–3s): Creator on camera or bold text-over — hook statement about ${safe}.`,
      `Scene 2 (3–10s): Quick "here's what I mean" — show the problem visually or state a stat.`,
      `Scene 3 (10–25s): The solution/framework — 3 rapid points with screen text reinforcing each.`,
      `Scene 4 (25–35s): Proof — show a result, testimonial quote, or before/after.`,
      `Scene 5 (35–end): CTA — "Comment X if you want the full guide" or "Follow for part 2".`,
    ].join('\n');
  }
  if (ct === 'story') {
    return [
      `Frame 1: Single bold question about ${safe} — high contrast background, minimal text.`,
      `Frame 2: Quick "here's the truth" statement with a striking visual or colour block.`,
      `Frame 3: The one thing to do differently — swipe-up or sticker CTA.`,
    ].join('\n');
  }
  return `Open with hook about ${safe} → deliver core value in 3 clear beats → close with CTA.`;
}

export function requiresCreatorCreativeGuidance(contentType: string): boolean {
  const normalized = normalizeCreatorFormat(contentType);
  const governance = getCreatorGovernance(normalized);
  return Boolean(
    governance?.guidance_only ||
    governance?.requires_human_production ||
    CREATOR_DAILY_GUIDANCE_FIELDS.length > 0 && ['video', 'reel', 'short', 'story', 'podcast'].includes(normalized)
  );
}

function platformGuidance(platforms: string[], contentType: string): Record<string, string> {
  const normalizedType = normalizeCreatorFormat(contentType);
  const targets = platforms.length > 0 ? platforms : ['linkedin'];
  return Object.fromEntries(targets.map((platform) => {
    const p = normalizePlatformKey(platform);
    const guidance =
      p === 'instagram' || p === 'instagram_reels'
        ? `Adapt ${normalizedType} for visual-first pacing, short caption support, and a clear first-frame hook.`
        : p === 'tiktok'
          ? `Adapt ${normalizedType} for fast opening motion, direct creator delivery, and concise on-screen beats.`
          : p === 'youtube' || p === 'youtube_shorts'
            ? `Adapt ${normalizedType} for search-friendly title framing, clear retention beats, and a direct close.`
            : p === 'x'
              ? `Adapt ${normalizedType} into a concise caption/thread angle with the strongest hook first.`
              : `Adapt ${normalizedType} with a professional caption, clear value promise, and direct CTA.`;
    return [p, guidance];
  }));
}

export function buildCreativeGuidance(input: {
  week: any;
  item: DailyPlanItem;
  enrichedItem: any;
  creatorCard?: CreatorCard | null;
}): CreativeGuidance | null {
  const contentType = normalizeCreatorFormat(input.item?.contentType || input.enrichedItem?.content_type || input.enrichedItem?.contentType || '');
  if (!requiresCreatorCreativeGuidance(contentType)) return null;

  const creatorCard = input.creatorCard ?? buildCreatorCard(input.week, input.item, input.enrichedItem);
  const intent = (input.enrichedItem?.intent ?? input.item?.writerBrief ?? {}) as Record<string, unknown>;
  const topic = String(input.item?.topicTitle || input.enrichedItem?.topic || '').trim();
  const theme = String(creatorCard.theme || input.week?.theme || input.week?.phase_label || input.item?.briefSummary || topic).trim();
  const cta = String(input.item?.desiredAction || intent.cta_type || creatorCard.intent?.cta_type || 'Guide the audience to the next useful step').trim();
  const platforms = Array.isArray(input.item?.platformTargets) ? input.item.platformTargets.map(String).filter(Boolean) : [];
  const visualHook = String(creatorCard.visual_hook || deriveVisualHook(topic, contentType)).trim();
  const sceneDirection = String(creatorCard.scene_direction || deriveSceneDirection(topic, contentType)).trim();
  const talkingPoints = [
    String(intent.pain_point || input.item?.whatProblemAreWeAddressing || '').trim(),
    String(intent.outcome_promise || input.item?.whatShouldReaderLearn || '').trim(),
    String(input.item?.dailyObjective || creatorCard.objective || '').trim(),
  ].filter(Boolean);
  const repurposeGuidance = [
    `Turn the core idea into platform-native captions for ${platforms.length > 0 ? platforms.join(', ') : 'the selected platforms'}.`,
    `Keep the same hook and CTA while changing pacing, length, and caption framing per platform.`,
    `Reuse the strongest talking point as the caption opener for non-video placements.`,
  ];

  return {
    theme,
    hook: visualHook,
    visual_direction: String(creatorCard.image_prompt || deriveImagePrompt(topic, contentType, platforms)).trim(),
    shot_guidance: [
      `Open with a direct visual or spoken hook: ${visualHook}`,
      `Show the problem or contrast behind ${topic || theme}.`,
      `Move into the practical insight or proof point.`,
      `Close with the CTA: ${cta}`,
    ],
    scene_direction: sceneDirection,
    CTA_direction: cta,
    platform_adaptation: platformGuidance(platforms, contentType),
    repurposing_guidance: repurposeGuidance,
    caption_direction: `Write a caption that leads with "${visualHook}", supports the idea with one concrete detail, and ends with "${cta}".`,
    posting_guidance: `Publish as a production-ready creator brief. Do not schedule or publish automatically until human-produced media is attached.`,
    production_notes: [
      `Human production required for ${contentType}.`,
      `Keep the first three seconds focused on the hook.`,
      `Capture enough visual coverage to create shorter repurposed cuts and still-image excerpts.`,
    ],
    production_checklist: [
      'Confirm final hook and CTA before recording.',
      'Capture primary talking-head or product/action shot.',
      'Capture supporting b-roll for each talking point.',
      'Prepare platform-native caption and hashtags.',
      'Attach finished media before any scheduling or publishing step.',
    ],
    talking_points: talkingPoints.length > 0 ? talkingPoints : [
      input.item?.briefSummary || topic || theme,
      input.item?.dailyObjective || 'Explain the practical value clearly.',
      cta,
    ].filter(Boolean),
    b_roll_ideas: [
      `Close-up or screen capture showing ${topic || theme}.`,
      'Behind-the-scenes production shot.',
      'Visual proof, example, workflow, or result that supports the claim.',
      'CTA end-frame or branded closing visual.',
    ],
  };
}

export function normalizeTopicKey(topic: string): string {
  const s = String(topic || '').trim();
  const withoutIndex = s.replace(/^\(?\s*\d+\s*[\)\.\-:]\s*/g, '');
  return withoutIndex
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pickContentType(contentTypeMix: string[] | undefined, index: number): string {
  const mix = Array.isArray(contentTypeMix) ? contentTypeMix : [];
  if (mix.length === 0) return 'post';
  const normalized = mix.map((s) => {
    const lower = String(s || '').toLowerCase();
    if (lower.includes('video')) return 'video';
    if (lower.includes('article') || lower.includes('blog')) return 'article';
    if (lower.includes('poll')) return 'poll';
    if (lower.includes('carousel')) return 'carousel';
    if (lower.includes('story')) return 'story';
    if (lower.includes('reel')) return 'reel';
    if (lower.includes('thread')) return 'thread';
    return 'post';
  });
  return normalized[index % normalized.length] || 'post';
}

/**
 * Derive a unique sub-topic from a week theme + content type + slot index.
 * Used when the blueprint has fewer unique topics than activity card slots,
 * so each card gets a distinct, meaningful title instead of a numbered duplicate.
 *
 * The angles are deterministic (no AI call) and rotate based on slot index.
 */
export const SUB_TOPIC_ANGLES: Record<string, Array<(theme: string, audience: string) => string>> = {
  // ── Text content types ──────────────────────────────────────────────
  post: [
    (t, a) => `Why ${t} matters for ${a}`,
    (t, a) => `Common ${t.toLowerCase()} mistakes ${a} should avoid`,
    (t, a) => `${t}: key metrics to track`,
    (t, a) => `Quick wins for ${t.toLowerCase()}`,
    (t, a) => `${t} checklist for ${a}`,
    (t, a) => `The truth about ${t.toLowerCase()} nobody talks about`,
    (t, a) => `3 ways to improve ${t.toLowerCase()} this week`,
  ],
  article: [
    (t, a) => `The complete guide to ${t.toLowerCase()} for ${a}`,
    (t, a) => `${t} strategy: lessons from top performers`,
    (t, a) => `How ${a} can build long-term ${t.toLowerCase()}`,
    (t, a) => `${t}: from fundamentals to advanced tactics`,
    (t, a) => `Why your ${t.toLowerCase()} approach needs a rethink`,
    (t, a) => `Deep dive: ${t.toLowerCase()} frameworks that work`,
    (t, a) => `${t} playbook for ${a}`,
  ],
  newsletter: [
    (t, a) => `The complete guide to ${t.toLowerCase()} for ${a}`,
    (t, a) => `${t} strategy: lessons from top performers`,
    (t, a) => `How ${a} can build long-term ${t.toLowerCase()}`,
    (t, a) => `${t}: from fundamentals to advanced tactics`,
    (t, a) => `Why your ${t.toLowerCase()} approach needs a rethink`,
    (t, a) => `Deep dive: ${t.toLowerCase()} frameworks that work`,
    (t, a) => `${t} playbook for ${a}`,
  ],
  thread: [
    (t, a) => `Thread: ${t} explained in simple terms`,
    (t, a) => `${t} breakdown — what ${a} get wrong`,
    (t, a) => `A thread on ${t.toLowerCase()} that every ${a} should bookmark`,
    (t, a) => `Unpacking ${t.toLowerCase()}: the thread ${a} need`,
    (t, a) => `Here's what I learned about ${t.toLowerCase()} (thread)`,
    (t, a) => `The ${t.toLowerCase()} thread: myths vs reality`,
    (t, a) => `Thread: ${t.toLowerCase()} — step by step for ${a}`,
  ],
  blog: [
    (t, a) => `The definitive blog post on ${t.toLowerCase()} for ${a}`,
    (t, a) => `${t}: what every ${a} should know in 2026`,
    (t, a) => `How to master ${t.toLowerCase()} — a guide for ${a}`,
    (t, a) => `${t} best practices: what the data says`,
    (t, a) => `Why ${a} are rethinking ${t.toLowerCase()}`,
    (t, a) => `${t}: lessons from the field`,
    (t, a) => `Everything ${a} need to know about ${t.toLowerCase()}`,
  ],
  white_paper: [
    (t, a) => `Whitepaper: The state of ${t.toLowerCase()} for ${a}`,
    (t, a) => `${t} research report: insights for ${a}`,
    (t, a) => `${t}: a data-driven analysis for ${a}`,
    (t, a) => `The ${a} whitepaper on ${t.toLowerCase()} strategy`,
    (t, a) => `${t}: emerging trends and opportunities for ${a}`,
  ],
  // ── Creator content types ───────────────────────────────────────────
  video: [
    (t, a) => `Watch: ${t} — what ${a} need to see`,
    (t, a) => `Video explainer: ${t.toLowerCase()} in under 3 minutes`,
    (t, a) => `Behind the scenes of ${t.toLowerCase()}`,
    (t, a) => `${t}: the visual breakdown for ${a}`,
    (t, a) => `Day in the life: putting ${t.toLowerCase()} into practice`,
    (t, a) => `${t} explained — visual guide for ${a}`,
    (t, a) => `Talking head: why ${t.toLowerCase()} changes everything`,
  ],
  reel: [
    (t, a) => `60s reel: ${t} — the quick take`,
    (t, a) => `Reel: 3 facts about ${t.toLowerCase()} ${a} miss`,
    (t, a) => `${t} in 30 seconds — hook, story, CTA`,
    (t, a) => `Quick reel: the ${t.toLowerCase()} myth vs reality`,
    (t, a) => `Reel: before vs after ${t.toLowerCase()}`,
    (t, a) => `Trending reel: ${t.toLowerCase()} challenge for ${a}`,
    (t, a) => `${t}: the reel every ${a} should share`,
  ],
  reels: [
    (t, a) => `60s reel: ${t} — the quick take`,
    (t, a) => `Reel: 3 facts about ${t.toLowerCase()} ${a} miss`,
    (t, a) => `${t} in 30 seconds — hook, story, CTA`,
    (t, a) => `Quick reel: the ${t.toLowerCase()} myth vs reality`,
    (t, a) => `Reel: before vs after ${t.toLowerCase()}`,
    (t, a) => `Trending reel: ${t.toLowerCase()} challenge for ${a}`,
    (t, a) => `${t}: the reel every ${a} should share`,
  ],
  carousel: [
    (t, a) => `Carousel: ${t} — swipe for the full story`,
    (t, a) => `5 slides on ${t.toLowerCase()} every ${a} should see`,
    (t, a) => `${t} step-by-step carousel guide`,
    (t, a) => `Carousel: myths vs facts about ${t.toLowerCase()}`,
    (t, a) => `The ${t.toLowerCase()} carousel: data that matters to ${a}`,
    (t, a) => `Swipe through: ${t.toLowerCase()} playbook for ${a}`,
    (t, a) => `Carousel: what ${a} get wrong about ${t.toLowerCase()}`,
  ],
  infographic: [
    (t, a) => `Infographic: ${t} in one clear visual`,
    (t, a) => `${t} data map for ${a}`,
    (t, a) => `Visual framework: ${t} at a glance`,
    (t, a) => `${t} process infographic for ${a}`,
    (t, a) => `The ${t.toLowerCase()} comparison chart`,
    (t, a) => `${t}: stats and signals ${a} should track`,
    (t, a) => `Infographic checklist for ${t.toLowerCase()}`,
  ],
  story: [
    (t, a) => `Story: behind the scenes of ${t.toLowerCase()}`,
    (t, a) => `Quick story: ${t} tip for ${a}`,
    (t, a) => `Story poll: how do you approach ${t.toLowerCase()}?`,
    (t, a) => `${t} story: ask me anything`,
    (t, a) => `Story: day in the life with ${t.toLowerCase()}`,
    (t, a) => `${t}: the story ${a} are sharing`,
    (t, a) => `Story countdown: ${t.toLowerCase()} launch`,
  ],
  stories: [
    (t, a) => `Story: behind the scenes of ${t.toLowerCase()}`,
    (t, a) => `Quick story: ${t} tip for ${a}`,
    (t, a) => `Story poll: how do you approach ${t.toLowerCase()}?`,
    (t, a) => `${t} story: ask me anything`,
    (t, a) => `Story: day in the life with ${t.toLowerCase()}`,
    (t, a) => `${t}: the story ${a} are sharing`,
    (t, a) => `Story countdown: ${t.toLowerCase()} launch`,
  ],
  shorts: [
    (t, a) => `Short: ${t} — the 60-second version`,
    (t, a) => `YouTube Short: ${t.toLowerCase()} hack for ${a}`,
    (t, a) => `${t} in under a minute — watch now`,
    (t, a) => `Short: top takeaway on ${t.toLowerCase()}`,
    (t, a) => `Quick short: why ${a} care about ${t.toLowerCase()}`,
    (t, a) => `${t}: the short that stops the scroll`,
    (t, a) => `Shorts series: ${t.toLowerCase()} episode ${'{'}1{'}'}`,
  ],
  image: [
    (t, a) => `Infographic: ${t} at a glance`,
    (t, a) => `Visual: ${t.toLowerCase()} data ${a} should know`,
    (t, a) => `${t} — the image that tells the story`,
    (t, a) => `Quote card: the best insight on ${t.toLowerCase()}`,
    (t, a) => `Visual breakdown: ${t.toLowerCase()} for ${a}`,
    (t, a) => `${t}: the chart every ${a} needs to see`,
    (t, a) => `Infographic: ${t.toLowerCase()} before vs after`,
  ],
  banner: [
    (t, a) => `Banner: ${t} — your visual hook`,
    (t, a) => `Cover image: ${t.toLowerCase()} campaign for ${a}`,
    (t, a) => `${t} banner: designed to stop the scroll`,
    (t, a) => `Profile banner: ${t.toLowerCase()} statement`,
    (t, a) => `Event banner: ${t.toLowerCase()} launch`,
  ],
  poll: [
    (t, a) => `Poll: what's your biggest ${t.toLowerCase()} challenge?`,
    (t, a) => `Vote: the #1 ${t.toLowerCase()} priority for ${a}`,
    (t, a) => `Quick poll: how do ${a} rank ${t.toLowerCase()} tactics?`,
    (t, a) => `Poll: which ${t.toLowerCase()} approach wins for ${a}?`,
    (t, a) => `Tell us: ${t} — where does your team stand?`,
    (t, a) => `Reader poll: the most underrated ${t.toLowerCase()} habit`,
    (t, a) => `Poll: ${t.toLowerCase()} — budget, people, or tools first?`,
  ],
  short_story: [
    (t, a) => `Short story: the day ${t.toLowerCase()} clicked for me`,
    (t, a) => `A founder's tale — ${t.toLowerCase()} lessons from the trenches`,
    (t, a) => `True story: how ${a} fixed their ${t.toLowerCase()} approach`,
    (t, a) => `The moment ${t.toLowerCase()} changed our ${a} playbook`,
    (t, a) => `Short story: ${t.toLowerCase()} — from confusion to clarity`,
    (t, a) => `A coffee-shop lesson in ${t.toLowerCase()} for ${a}`,
    (t, a) => `Narrative: the quiet turning point in ${t.toLowerCase()}`,
  ],
  tweet: [
    (t, a) => `Tweet: one hot take on ${t.toLowerCase()} ${a} won't admit`,
    (t, a) => `${t.toLowerCase()} — in one sentence for ${a}`,
    (t, a) => `Tweet: the most counterintuitive truth about ${t.toLowerCase()}`,
    (t, a) => `Short tweet: ${t} in plain English`,
    (t, a) => `Tweet: ${t.toLowerCase()} — what ${a} wish they knew sooner`,
    (t, a) => `A single tweet-sized insight on ${t.toLowerCase()}`,
    (t, a) => `Tweet drop: ${t} — the no-fluff version`,
  ],
};

