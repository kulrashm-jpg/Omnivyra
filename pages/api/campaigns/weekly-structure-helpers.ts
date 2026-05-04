// AUTH EXEMPT: non-route API helper module without default handler
import { NextApiRequest, NextApiResponse } from 'next';

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

// â”€â”€â”€ STOP WORDS for keyword extraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  // Topic words â†’ PascalCase tag
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
  if (!t) return 'Here is what most marketers get wrong â€” and how to fix it.';
  if (ct === 'poll') return `Quick question: how do you currently approach ${t}?`;
  if (ct === 'thread') return `A thread on ${t} â€” everything you need to know in 10 tweets. ðŸ§µ`;
  if (ct === 'newsletter') return `This week we're breaking down ${t} â€” and why it matters more than ever.`;
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

/** Derive 4â€“5 key points to build content from. */
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
    angles.push(`Turn statistics/frameworks into LinkedIn carousel (5â€“7 slides)`);
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
  if (tl.includes('how to') || tl.includes('guide') || tl.includes('step')) return `How-to search intent: "${t}" â€” target informational queries`;
  if (tl.includes('vs') || tl.includes('compare') || tl.includes('best')) return `Comparison intent: position for "${t}" decision-stage queries`;
  if (tl.includes('what is') || tl.includes('definition') || tl.includes('meaning')) return `Educational intent: own the definition of "${t}"`;
  if (tl.includes('tool') || tl.includes('software') || tl.includes('platform')) return `Commercial intent: target buyers searching "${t} tools"`;
  return `Thought leadership on "${t}" â€” target informational + branded queries`;
}

// â”€â”€â”€ CREATOR-SPECIFIC derivation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Derive a visual hook (first 3 seconds). */
export function deriveVisualHook(topic: string, contentType: string): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const safe = t || 'this topic';
  if (ct === 'reel' || ct === 'video') {
    const hooks = [
      `Open on creator looking directly at camera: "You're probably getting ${safe} completely wrong â€” here's proof."`,
      `Quick-cut montage of the problem, then freeze frame with text: "The fix is simpler than you think."`,
      `Start mid-action: show a before/after result for ${safe} with no intro â€” let the result hook the viewer.`,
      `Creator asks direct question to camera: "How much are you spending on ${safe} with zero ROI?" Pause. "Watch this."`,
    ];
    return hooks[Math.abs(topic.length) % hooks.length]!;
  }
  if (ct === 'carousel') return `Slide 1: Bold headline â€” "${safe}" with a single striking stat or question. No fluff, immediate value signal.`;
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
  return `${aspectRatio} format â€” ${styleBase}. Subject: visual representation of "${t}". Mood: confident, forward-looking. No text overlays. High contrast. Real people or abstract concept art preferred. Brand-safe, no stock photo clichÃ©s.`;
}

/** Derive video/reel direction for creator. */
export function deriveVideoPrompt(topic: string, contentType: string, platforms: string[]): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const isTikTok = platforms.some(p => String(p).toLowerCase().includes('tiktok'));
  const duration = isTikTok ? '15â€“30s' : ct === 'reel' ? '30â€“60s' : '60â€“90s';
  const ratio = isTikTok || ct === 'reel' ? '9:16 vertical' : '16:9 horizontal';
  return `${duration} ${ratio} video. Hook (0â€“3s): pattern interrupt â€” bold statement or surprising visual about "${t}". Build (3â€“20s): explain the core insight or process with on-screen text/b-roll. Payoff (final 5s): clear call to action â€” follow, comment, or click link. Captions: always on. Pacing: fast cuts (every 2â€“4s). Energy: confident, direct to camera or strong voiceover.`;
}

/** Derive scene-by-scene direction for longer creator content. */
export function deriveSceneDirection(topic: string, contentType: string): string {
  const t = String(topic ?? '').trim();
  const ct = String(contentType ?? '').toLowerCase();
  const safe = t || 'the topic';
  if (ct === 'carousel') {
    return [
      `Slide 1 (Hook): Bold headline stating the core problem or insight about ${safe}. One sentence, large text.`,
      `Slide 2 (Context): Why this matters now â€” 1â€“2 sentences + supporting stat or data point.`,
      `Slide 3â€“5 (Core value): Each slide covers one key point with a short headline + 2â€“3 bullet sub-points.`,
      `Slide 6 (Case/example): Brief real-world example or before/after scenario.`,
      `Slide 7 (CTA): Clear next step â€” "Save this", "Follow for more", or "Comment your question below".`,
    ].join('\n');
  }
  if (ct === 'video' || ct === 'reel') {
    return [
      `Scene 1 (0â€“3s): Creator on camera or bold text-over â€” hook statement about ${safe}.`,
      `Scene 2 (3â€“10s): Quick "here's what I mean" â€” show the problem visually or state a stat.`,
      `Scene 3 (10â€“25s): The solution/framework â€” 3 rapid points with screen text reinforcing each.`,
      `Scene 4 (25â€“35s): Proof â€” show a result, testimonial quote, or before/after.`,
      `Scene 5 (35â€“end): CTA â€” "Comment X if you want the full guide" or "Follow for part 2".`,
    ].join('\n');
  }
  if (ct === 'story') {
    return [
      `Frame 1: Single bold question about ${safe} â€” high contrast background, minimal text.`,
      `Frame 2: Quick "here's the truth" statement with a striking visual or colour block.`,
      `Frame 3: The one thing to do differently â€” swipe-up or sticker CTA.`,
    ].join('\n');
  }
  return `Open with hook about ${safe} â†’ deliver core value in 3 clear beats â†’ close with CTA.`;
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
const SUB_TOPIC_ANGLES: Record<string, Array<(theme: string, audience: string) => string>> = {
  // â”€â”€ Text content types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    (t, a) => `${t} breakdown â€” what ${a} get wrong`,
    (t, a) => `A thread on ${t.toLowerCase()} that every ${a} should bookmark`,
    (t, a) => `Unpacking ${t.toLowerCase()}: the thread ${a} need`,
    (t, a) => `Here's what I learned about ${t.toLowerCase()} (thread)`,
    (t, a) => `The ${t.toLowerCase()} thread: myths vs reality`,
    (t, a) => `Thread: ${t.toLowerCase()} â€” step by step for ${a}`,
  ],
  blog: [
    (t, a) => `The definitive blog post on ${t.toLowerCase()} for ${a}`,
    (t, a) => `${t}: what every ${a} should know in 2026`,
    (t, a) => `How to master ${t.toLowerCase()} â€” a guide for ${a}`,
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
  // â”€â”€ Creator content types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  video: [
    (t, a) => `Watch: ${t} â€” what ${a} need to see`,
    (t, a) => `Video explainer: ${t.toLowerCase()} in under 3 minutes`,
    (t, a) => `Behind the scenes of ${t.toLowerCase()}`,
    (t, a) => `${t}: the visual breakdown for ${a}`,
    (t, a) => `Day in the life: putting ${t.toLowerCase()} into practice`,
    (t, a) => `${t} explained â€” visual guide for ${a}`,
    (t, a) => `Talking head: why ${t.toLowerCase()} changes everything`,
  ],
  reel: [
    (t, a) => `60s reel: ${t} â€” the quick take`,
    (t, a) => `Reel: 3 facts about ${t.toLowerCase()} ${a} miss`,
    (t, a) => `${t} in 30 seconds â€” hook, story, CTA`,
    (t, a) => `Quick reel: the ${t.toLowerCase()} myth vs reality`,
    (t, a) => `Reel: before vs after ${t.toLowerCase()}`,
    (t, a) => `Trending reel: ${t.toLowerCase()} challenge for ${a}`,
    (t, a) => `${t}: the reel every ${a} should share`,
  ],
  reels: [
    (t, a) => `60s reel: ${t} â€” the quick take`,
    (t, a) => `Reel: 3 facts about ${t.toLowerCase()} ${a} miss`,
    (t, a) => `${t} in 30 seconds â€” hook, story, CTA`,
    (t, a) => `Quick reel: the ${t.toLowerCase()} myth vs reality`,
    (t, a) => `Reel: before vs after ${t.toLowerCase()}`,
    (t, a) => `Trending reel: ${t.toLowerCase()} challenge for ${a}`,
    (t, a) => `${t}: the reel every ${a} should share`,
  ],
  carousel: [
    (t, a) => `Carousel: ${t} â€” swipe for the full story`,
    (t, a) => `5 slides on ${t.toLowerCase()} every ${a} should see`,
    (t, a) => `${t} step-by-step carousel guide`,
    (t, a) => `Carousel: myths vs facts about ${t.toLowerCase()}`,
    (t, a) => `The ${t.toLowerCase()} carousel: data that matters to ${a}`,
    (t, a) => `Swipe through: ${t.toLowerCase()} playbook for ${a}`,
    (t, a) => `Carousel: what ${a} get wrong about ${t.toLowerCase()}`,
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
    (t, a) => `Short: ${t} â€” the 60-second version`,
    (t, a) => `YouTube Short: ${t.toLowerCase()} hack for ${a}`,
    (t, a) => `${t} in under a minute â€” watch now`,
    (t, a) => `Short: top takeaway on ${t.toLowerCase()}`,
    (t, a) => `Quick short: why ${a} care about ${t.toLowerCase()}`,
    (t, a) => `${t}: the short that stops the scroll`,
    (t, a) => `Shorts series: ${t.toLowerCase()} episode ${'{'}1{'}'}`,
  ],
  image: [
    (t, a) => `Infographic: ${t} at a glance`,
    (t, a) => `Visual: ${t.toLowerCase()} data ${a} should know`,
    (t, a) => `${t} â€” the image that tells the story`,
    (t, a) => `Quote card: the best insight on ${t.toLowerCase()}`,
    (t, a) => `Visual breakdown: ${t.toLowerCase()} for ${a}`,
    (t, a) => `${t}: the chart every ${a} needs to see`,
    (t, a) => `Infographic: ${t.toLowerCase()} before vs after`,
  ],
  banner: [
    (t, a) => `Banner: ${t} â€” your visual hook`,
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
    (t, a) => `Tell us: ${t} â€” where does your team stand?`,
    (t, a) => `Reader poll: the most underrated ${t.toLowerCase()} habit`,
    (t, a) => `Poll: ${t.toLowerCase()} â€” budget, people, or tools first?`,
  ],
  short_story: [
    (t, a) => `Short story: the day ${t.toLowerCase()} clicked for me`,
    (t, a) => `A founder's tale â€” ${t.toLowerCase()} lessons from the trenches`,
    (t, a) => `True story: how ${a} fixed their ${t.toLowerCase()} approach`,
    (t, a) => `The moment ${t.toLowerCase()} changed our ${a} playbook`,
    (t, a) => `Short story: ${t.toLowerCase()} â€” from confusion to clarity`,
    (t, a) => `A coffee-shop lesson in ${t.toLowerCase()} for ${a}`,
    (t, a) => `Narrative: the quiet turning point in ${t.toLowerCase()}`,
  ],
  tweet: [
    (t, a) => `Tweet: one hot take on ${t.toLowerCase()} ${a} won't admit`,
    (t, a) => `${t.toLowerCase()} â€” in one sentence for ${a}`,
    (t, a) => `Tweet: the most counterintuitive truth about ${t.toLowerCase()}`,
    (t, a) => `Short tweet: ${t} in plain English`,
    (t, a) => `Tweet: ${t.toLowerCase()} â€” what ${a} wish they knew sooner`,
    (t, a) => `A single tweet-sized insight on ${t.toLowerCase()}`,
    (t, a) => `Tweet drop: ${t} â€” the no-fluff version`,
  ],
};

const DEFAULT_ANGLES: Array<(theme: string, audience: string) => string> = [
  (t, a) => `${t}: what ${a} need to know`,
  (t, a) => `Practical ${t.toLowerCase()} insights for ${a}`,
  (t, a) => `${t} â€” the ${a} perspective`,
  (t, a) => `Understanding ${t.toLowerCase()}: a guide for ${a}`,
  (t, a) => `How to approach ${t.toLowerCase()} effectively`,
  (t, a) => `${t}: strategies that deliver results`,
  (t, a) => `The ${a} guide to ${t.toLowerCase()}`,
];

export function deriveSubTopic(
  weekTheme: string,
  contentType: string,
  slotIndex: number,
  targetAudience: string,
): string {
  const ct = contentType.toLowerCase();
  const angles = SUB_TOPIC_ANGLES[ct] ?? DEFAULT_ANGLES;
  const audience = targetAudience || 'your audience';
  return angles[slotIndex % angles.length]!(weekTheme, audience);
}

export function buildTopicReference(weekNumber: number, topicIndex: number): string {
  return `w${weekNumber}.t${topicIndex + 1}`;
}

/** First-class creator card for one daily activity. Additive; all fields optional for backward compatibility. */
export type CreatorCard = {
  theme?: string;
  objective?: string;
  target_audience?: string;
  summary?: string;
  keywords?: string[];
  hashtags?: string[];
  intent?: Record<string, unknown>;
  platform_notes?: string[];
  instructions_for_creator?: string;
  // Text content enrichment
  hook?: string;
  key_points?: string[];
  seo_focus?: string;
  repurpose_angles?: string[];
  // Creator content enrichment
  visual_hook?: string;
  image_prompt?: string;
  video_prompt?: string;
  scene_direction?: string;
};

/**
 * Build a creator card from week blueprint, daily item, and enriched output.
 * Used at daily generation time only; does not alter planning logic.
 * Missing fields degrade gracefully (empty string or empty array).
 */
export function buildCreatorCard(
  week: any,
  item: DailyPlanItem,
  enrichedItem: any
): CreatorCard {
  const capsule = (week?.weeklyContextCapsule ?? week?.weekly_context_capsule) as any;
  const theme =
    (typeof week?.phase_label === 'string' && week.phase_label.trim()) ||
    (typeof week?.primary_objective === 'string' && week.primary_objective.trim()) ||
    (typeof capsule?.campaignTheme === 'string' && capsule.campaignTheme.trim()) ||
    (typeof week?.theme === 'string' && week.theme.trim()) ||
    '';

  const intent = (enrichedItem?.intent ?? item?.writerBrief) as Record<string, unknown> | undefined;
  const objective =
    (typeof item?.dailyObjective === 'string' && item.dailyObjective.trim()) ||
    (typeof enrichedItem?.objective === 'string' && enrichedItem.objective.trim()) ||
    (typeof intent?.objective === 'string' && (intent.objective as string).trim()) ||
    '';

  const target_audience =
    (typeof item?.whoAreWeWritingFor === 'string' && item.whoAreWeWritingFor.trim()) ||
    (typeof enrichedItem?.target_audience === 'string' && enrichedItem.target_audience.trim()) ||
    (typeof intent?.target_audience === 'string' && (intent.target_audience as string).trim()) ||
    (typeof capsule?.audienceProfile === 'string' && capsule.audienceProfile.trim()) ||
    '';

  const summary =
    (typeof item?.briefSummary === 'string' && item.briefSummary.trim()) ||
    (typeof intent?.brief_summary === 'string' && (intent.brief_summary as string).trim()) ||
    (typeof item?.writingIntent === 'string' && item.writingIntent.trim()) ||
    '';

  const topicStr = typeof item?.topicTitle === 'string' ? item.topicTitle.trim() : '';
  const contentType = String(item?.contentType || enrichedItem?.content_type || enrichedItem?.contentType || '').toLowerCase();
  const isCreatorType = ['video', 'reel', 'reels', 'carousel', 'story', 'stories', 'shorts', 'tiktok'].includes(contentType);

  // Keywords: enrich from topic + objective
  const keywords: string[] = Array.isArray(enrichedItem?.keywords)
    ? (enrichedItem.keywords as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 10)
    : deriveKeywords(topicStr, objective);

  // Hashtags: AI output takes priority, then week extras, then derived
  const hashtags: string[] = Array.isArray(enrichedItem?.hashtags)
    ? enrichedItem.hashtags.filter((h: unknown) => typeof h === 'string').slice(0, 10)
    : Array.isArray((week?.week_extras as any)?.hashtag_suggestions)
      ? ((week.week_extras as any).hashtag_suggestions as string[]).filter(Boolean).slice(0, 10)
      : deriveHashtags(topicStr, contentType, objective);

  const intentShape: Record<string, unknown> = intent && typeof intent === 'object'
    ? {
        objective: intent.objective ?? '',
        target_audience: intent.target_audience ?? '',
        brief_summary: intent.brief_summary ?? '',
        cta_type: intent.cta_type ?? item?.ctaType ?? '',
        strategic_role: intent.strategic_role ?? '',
        pain_point: intent.pain_point ?? '',
        outcome_promise: intent.outcome_promise ?? '',
        narrative_style: item?.narrativeStyle ?? intent.writing_angle ?? '',
      }
    : {};

  const platform_notes: string[] = Array.isArray(enrichedItem?.validation_notes)
    ? [...enrichedItem.validation_notes]
    : typeof enrichedItem?.format_requirements === 'object' && enrichedItem.format_requirements != null
      ? [JSON.stringify(enrichedItem.format_requirements)]
      : [];

  // â”€â”€ TEXT enrichment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const hook = !isCreatorType
    ? (typeof (intent as any)?.hook === 'string' && (intent as any).hook.trim()
        ? String((intent as any).hook).trim()
        : deriveTextHook(topicStr, contentType))
    : undefined;
  const key_points = !isCreatorType
    ? (Array.isArray((intent as any)?.key_points) && (intent as any).key_points.length > 0
        ? ((intent as any).key_points as unknown[]).filter((k): k is string => typeof k === 'string')
        : deriveKeyPoints(topicStr, objective, contentType))
    : undefined;
  const seo_focus = !isCreatorType
    ? (typeof (intent as any)?.seo_focus === 'string' && (intent as any).seo_focus.trim()
        ? String((intent as any).seo_focus).trim()
        : deriveSEOFocus(topicStr, objective))
    : undefined;
  const repurpose_angles = !isCreatorType
    ? deriveRepurposeAngles(topicStr, contentType)
    : undefined;

  // â”€â”€ CREATOR enrichment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const itemPlatforms = Array.isArray(item?.platformTargets) ? item.platformTargets : [];
  const visual_hook = isCreatorType ? deriveVisualHook(topicStr, contentType) : undefined;
  const image_prompt = isCreatorType ? deriveImagePrompt(topicStr, contentType, itemPlatforms) : undefined;
  const video_prompt = (isCreatorType && contentType !== 'carousel') ? deriveVideoPrompt(topicStr, contentType, itemPlatforms) : undefined;
  const scene_direction = isCreatorType ? deriveSceneDirection(topicStr, contentType) : undefined;

  // â”€â”€ Creator instructions block (rich) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const instructionsParts: string[] = [];
  if (objective) instructionsParts.push(`Objective: ${objective}`);
  if (summary) instructionsParts.push(`Brief: ${summary}`);
  if (target_audience) instructionsParts.push(`Audience: ${target_audience}`);
  if (item?.desiredAction || intent?.cta_type) {
    instructionsParts.push(`CTA: ${String(item?.desiredAction || intent?.cta_type || '').trim() || 'â€”'}`);
  }
  if (item?.narrativeStyle) instructionsParts.push(`Tone: ${item.narrativeStyle}`);
  if (isCreatorType) {
    if (visual_hook) instructionsParts.push(`Visual hook (0â€“3s): ${visual_hook}`);
    if (scene_direction) instructionsParts.push(`\nScene direction:\n${scene_direction}`);
    if (image_prompt) instructionsParts.push(`\nImage prompt: ${image_prompt}`);
    if (video_prompt) instructionsParts.push(`\nVideo direction: ${video_prompt}`);
  } else {
    if (hook) instructionsParts.push(`Opening hook: ${hook}`);
    if (seo_focus) instructionsParts.push(`SEO focus: ${seo_focus}`);
    if (key_points && key_points.length > 0) {
      instructionsParts.push(`Key points to cover:\n${key_points.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`);
    }
    if (repurpose_angles && repurpose_angles.length > 0) {
      instructionsParts.push(`Repurpose as:\n${repurpose_angles.map(a => `  â€¢ ${a}`).join('\n')}`);
    }
  }
  const instructions_for_creator = instructionsParts.join('\n');

  return {
    theme: theme || undefined,
    objective: objective || undefined,
    target_audience: target_audience || undefined,
    summary: summary || undefined,
    keywords: keywords.length > 0 ? keywords : undefined,
    hashtags: hashtags.length > 0 ? hashtags : undefined,
    intent: Object.keys(intentShape).length > 0 ? intentShape : undefined,
    platform_notes: platform_notes.length > 0 ? platform_notes : undefined,
    instructions_for_creator: instructions_for_creator.trim() || undefined,
    // Text
    hook: hook || undefined,
    key_points: key_points && key_points.length > 0 ? key_points : undefined,
    seo_focus: seo_focus || undefined,
    repurpose_angles: repurpose_angles && repurpose_angles.length > 0 ? repurpose_angles : undefined,
    // Creator
    visual_hook: visual_hook || undefined,
    image_prompt: image_prompt || undefined,
    video_prompt: video_prompt || undefined,
    scene_direction: scene_direction || undefined,
  };
}

export function buildDayTopics(topicOrder: string[], topicWeights: number[]): string[][] {
  const topics = topicOrder.length ? topicOrder : ['Week topic'];
  const weights = topicWeights.length === topics.length ? topicWeights : topics.map(() => 1);
  const n = topics.length;
  const dayTopics: string[][] = Array.from({ length: 7 }, () => []);

  if (n >= 7) {
    const base = Math.floor(n / 7);
    let rem = n % 7;
    let cursor = 0;
    for (let d = 0; d < 7; d += 1) {
      const size = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      dayTopics[d] = topics.slice(cursor, cursor + size);
      cursor += size;
    }
    return dayTopics;
  }

  const daysPerTopic = topics.map(() => 1);
  let remaining = 7 - n;
  while (remaining > 0) {
    let bestIdx = 0;
    for (let i = 1; i < n; i += 1) {
      if (weights[i] > weights[bestIdx]) bestIdx = i;
    }
    daysPerTopic[bestIdx] += 1;
    remaining -= 1;
  }

  let day = 0;
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < daysPerTopic[i]; k += 1) {
      if (day < 7) dayTopics[day].push(topics[i]);
      day += 1;
    }
  }
  for (let d = 0; d < 7; d += 1) {
    if (dayTopics[d].length === 0) dayTopics[d] = [topics[topics.length - 1]];
  }
  return dayTopics;
}

export function computeTopicAssignedDays(dayTopics: string[][]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let d = 0; d < dayTopics.length; d += 1) {
    const dayIndex = d + 1;
    for (const topic of dayTopics[d]) {
      const arr = map.get(topic) ?? [];
      arr.push(dayIndex);
      map.set(topic, arr);
    }
  }
  return map;
}

export function validateDailyPlan(params: { items: DailyPlanItem[]; topicOrder: string[] }): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const { items, topicOrder } = params;

  const daySet = new Set(items.map((i) => i.dayIndex));
  for (let d = 1; d <= 7; d += 1) {
    if (!daySet.has(d)) errors.push(`Missing dayIndex ${d}`);
  }

  const topicSet = new Set(items.map((i) => i.topicTitle));
  for (const t of topicOrder) {
    if (!topicSet.has(t)) errors.push(`Missing topic "${t}" in daily items`);
  }

  const topicOrderSet = new Set(topicOrder);
  const orphans = items.filter((i) => !topicOrderSet.has(i.topicTitle));
  if (orphans.length > 0) errors.push(`Found ${orphans.length} orphan daily item(s) with unknown topicTitle`);

  return { ok: errors.length === 0, errors };
}

export function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeDayDate(params: { campaignStart: string; weekNumber: number; dayIndex: number }): string {
  const start = new Date(params.campaignStart);
  const offsetDays = (params.weekNumber - 1) * 7 + (params.dayIndex - 1);
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return toIsoDateOnly(date);
}

export function buildDeterministicDailyObjective(input: {
  weekIntent: string;
  topicTitle: string;
  topicDayPosition: 'start' | 'middle' | 'end';
}): string {
  const step =
    input.topicDayPosition === 'start'
      ? 'Introduce the core idea'
      : input.topicDayPosition === 'end'
        ? 'Synthesize and apply the idea'
        : 'Deepen understanding with a focused angle';
  return `${step} for "${input.topicTitle}" to advance: ${input.weekIntent}`;
}

export function getDefaultPlatformTargets(week: CampaignBlueprintWeek): string[] {
  const allocation = week.platform_allocation || {};
  const sorted = Object.entries(allocation)
    .map(([p, c]) => ({ platform: normalizePlatformKey(p), count: Number(c) || 0 }))
    .sort((a, b) => b.count - a.count);
  const top = sorted[0]?.platform || 'linkedin';
  return [top];
}

export function deriveContentGuidance(brief: WeeklyTopicWritingBrief | null | undefined): DailyPlanItem['contentGuidance'] {
  const g = (brief as any)?.contentTypeGuidance;
  if (g && typeof g === 'object') {
    return {
      primaryFormat: String((g as any).primaryFormat ?? 'long-form social post'),
      maxWordTarget: Number((g as any).maxWordTarget ?? 800) || 800,
      platformWithHighestLimit: String((g as any).platformWithHighestLimit ?? 'linkedin'),
    };
  }
  return { primaryFormat: 'long-form social post', maxWordTarget: 800, platformWithHighestLimit: 'linkedin' };
}

export async function refineDailyObjectivesWithLLM(params: {
  companyId?: string | null;
  weekNumber: number;
  weeklyContextCapsule?: Record<string, unknown> | null;
  items: DailyPlanItem[];
}): Promise<DailyPlanItem[]> {
  // HARD RULE: daily planner is execution-only. It must never mutate weekly intent.
  // Keep this function as a no-op to preserve architecture, but do not allow any rewrite.
  return params.items;
}

export function stableStringify(value: any): string {
  const seen = new WeakSet<object>();
  const walk = (v: any): any => {
    if (v == null) return v;
    if (typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

export function assertDailyIntentNotMutated(params: {
  sourceIntent: any;
  dailyItem: Pick<DailyPlanItem, 'dailyObjective' | 'whoAreWeWritingFor' | 'ctaType' | 'briefSummary' | 'writerBrief'>;
  candidate: any;
  stage: string;
}) {
  const src = params.sourceIntent;
  if (!src || typeof src !== 'object') throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');

  const objective = params.dailyItem.dailyObjective;
  const target_audience = params.dailyItem.whoAreWeWritingFor;
  const cta_type = params.dailyItem.ctaType;
  const brief_summary = params.dailyItem.briefSummary;
  const writer_brief = params.dailyItem.writerBrief;

  if (objective !== src.objective) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (target_audience !== src.target_audience) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (cta_type !== src.cta_type) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (brief_summary !== src.brief_summary) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (stableStringify(writer_brief) !== stableStringify(src)) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');

  const cand = params.candidate ?? {};
  const candObjective = cand.objective ?? cand.dailyObjective ?? null;
  const candAudience = cand.target_audience ?? cand.whoAreWeWritingFor ?? null;
  const candCta = cand.cta_type ?? cand.ctaType ?? null;
  const candBrief = cand.brief_summary ?? cand.briefSummary ?? null;
  const candWriter = cand.writer_brief ?? cand.writerBrief ?? null;

  if (candObjective !== src.objective) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (candAudience !== src.target_audience) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (candCta !== src.cta_type) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (candBrief !== src.brief_summary) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (stableStringify(candWriter) !== stableStringify(src)) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
}

export function assertDailyExecutionIdentityNotMutated(params: {
  source_execution: { content_type: string; platform: string; topic: string };
  candidate: any;
  stage: 'daily-build' | 'writer-ready' | 'post-validate' | 'post-enrich';
}) {
  const src = params.source_execution;
  const srcContentType = String(src?.content_type ?? '');
  const srcPlatform = String(src?.platform ?? '');
  const srcTopic = String(src?.topic ?? '');
  if (!srcContentType || !srcPlatform || !srcTopic) {
    throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  }

  const cand = params.candidate ?? {};
  const candContentType = String(cand.content_type ?? cand.contentType ?? '');
  const candPlatform = String(cand.platform ?? '');
  const candTopic = String(cand.topic ?? cand.title ?? cand.topicTitle ?? '');
  if (!candContentType || !candPlatform || !candTopic) {
    throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  }

  if (candContentType !== srcContentType) throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  if (candPlatform !== srcPlatform) throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  if (candTopic !== srcTopic) throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
}

export function assertDailyGlobalProgressionNotMutated(params: {
  source_global_progression_index: number;
  candidate: any;
  stage: 'daily-build' | 'writer-ready' | 'post-validate' | 'post-enrich';
}) {
  const src = Number(params.source_global_progression_index);
  if (!Number.isFinite(src) || src < 1) {
    throw new Error('DAILY_GLOBAL_PROGRESSION_MUTATION_NOT_ALLOWED');
  }
  const cand = params.candidate ?? {};
  const n = Number(cand.global_progression_index ?? cand.globalProgressionIndex ?? cand.globalProgressionIndex);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('DAILY_GLOBAL_PROGRESSION_MUTATION_NOT_ALLOWED');
  }
  if (n !== src) {
    throw new Error('DAILY_GLOBAL_PROGRESSION_MUTATION_NOT_ALLOWED');
  }
}

/** Input for generateWeeklyStructure. Matches API request body. */
export interface GenerateWeeklyStructureInput {
  week?: number;
  weeks?: number[];
  campaignId?: string;
  companyId?: string;
  auto_rebalance?: boolean;
  auto_optimize_distribution?: boolean;
  enable_campaign_waves?: boolean;
  distribution_mode?: string;
  eligible_platforms?: string[];
  posts_per_week?: number;
  bolt_run_id?: string;
  adaptive_performance_insights?: Record<string, unknown>;
  /** When provided (e.g. from BOLT executionConfig.tentative_start), used when campaign lacks start_date. */
  campaign_start_date?: string;
  /** When true (BOLT), restrict to text content only: post, blog, article, story, thread, poll. Exclude video, carousel, reels, etc. */
  bolt_text_only?: boolean;
  /** Per-format post count from user selection e.g. { article: 2, newsletter: 1 }. Overrides equal-distribution fallback. */
  format_frequency?: Record<string, number>;
  /** Whether content is shared across platforms (same_day_per_topic) or unique per platform (staggered). */
  cross_platform_sharing?: boolean | { enabled: boolean };
}

/** Core logic for generating weekly structure. Callable from API or BOLT pipeline. */

