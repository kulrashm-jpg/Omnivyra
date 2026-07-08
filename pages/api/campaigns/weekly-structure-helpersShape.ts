/** Part 2/2 of weekly-structure-helpers.ts — verbatim split (barrel preserved; importers unchanged). */
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

import { type DailyPlanItem, normalizePlatformKey, deriveSynthPainPoint, deriveSynthOutcomePromise, deriveKeywords, deriveHashtags, deriveTextHook, deriveKeyPoints, deriveRepurposeAngles, deriveSEOFocus, deriveVisualHook, deriveImagePrompt, deriveVideoPrompt, deriveSceneDirection, requiresCreatorCreativeGuidance, SUB_TOPIC_ANGLES } from './weekly-structure-helpersAlloc';

const DEFAULT_ANGLES: Array<(theme: string, audience: string) => string> = [
  (t, a) => `${t}: what ${a} need to know`,
  (t, a) => `Practical ${t.toLowerCase()} insights for ${a}`,
  (t, a) => `${t} — the ${a} perspective`,
  (t, a) => `Understanding ${t.toLowerCase()}: a guide for ${a}`,
  (t, a) => `How to approach ${t.toLowerCase()} effectively`,
  (t, a) => `${t}: strategies that deliver results`,
  (t, a) => `The ${a} guide to ${t.toLowerCase()}`,
];

/**
 * Strip PLANNING META-SCAFFOLD from a card title so it reads as clean,
 * publishable copy rather than an internal planning instruction.
 *
 * The activity-card title doubles as the published caption (carousel/image
 * marketing copy mirrors it), so phrases like "5 slides on …", trailing
 * "every {audience} should see", and the upstream "Stop Doing {X} the Hard
 * Way" angle wrapper leak into what the reader sees. Operator feedback:
 * "we should have text that clearly defines the message, not 'five slides
 * on …' or progress." This unwraps those scaffolds to the core message.
 * Pure + idempotent; never returns empty (falls back to the raw input).
 */
export function sanitizeCardTitle(raw: string): string {
  const original = String(raw || '').trim();
  let s = original;
  // Unwrap clickbait angle wrappers to the core topic.
  s = s.replace(/\bstop doing\s+(.+?)\s+the hard way\b/gi, '$1');
  // Drop count/format scaffolds: "5 slides on …", "60s reel:", "in 30 seconds".
  s = s.replace(/^\s*\d+\s+slides?\s+on\s+/i, '');
  s = s.replace(/^\s*\d+\s*s(ec(ond)?s?)?\b\s*reel\s*[:—-]\s*/i, 'Reel: ');
  s = s.replace(/\b—?\s*in\s+\d+\s+seconds?\b/gi, '');
  // Drop trailing audience-echo scaffolds: "… every {audience} should see /
  // share / know / bookmark", "… that every {audience} should …", "… {audience}
  // need / miss / wish they …".
  s = s.replace(/\s+(that\s+)?every\s+.+?\s+(should|need to|needs to|needs?)\b.*$/i, '');
  s = s.replace(/\s+(the\s+\w+\s+)?every\s+.+?\s+(should|need|needs|needs to)\b.*$/i, '');
  // Collapse leftover whitespace + dangling separators.
  s = s.replace(/\s{2,}/g, ' ').replace(/[\s:—-]+$/, '').trim();
  return s || original;
}

export function deriveSubTopic(
  weekTheme: string,
  contentType: string,
  slotIndex: number,
  targetAudience: string,
): string {
  const ct = contentType.toLowerCase();
  const angles = SUB_TOPIC_ANGLES[ct] ?? DEFAULT_ANGLES;
  const audience = targetAudience || 'your audience';
  // Clean the base theme first (removes upstream "Stop Doing … the Hard Way"
  // style wrappers), then sanitize the composed title so the published
  // caption never carries planning scaffold.
  const cleanTheme = sanitizeCardTitle(weekTheme);
  return sanitizeCardTitle(angles[slotIndex % angles.length]!(cleanTheme, audience));
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
  const requiresMediaBrief =
    ['video', 'reel', 'reels', 'carousel', 'infographic', 'story', 'stories', 'short', 'shorts', 'tiktok', 'podcast', 'image'].includes(contentType) ||
    requiresCreatorCreativeGuidance(contentType);

  // PHASE CREATOR-BRIEF-ENRICHMENT-PARITY — creator rows must carry the same
  // non-empty strategic brief writer rows already get. Backfill ONLY missing
  // fields, ONLY for creator (requiresMediaBrief) rows, from the SAME existing
  // enrichment helpers (deriveSynthPainPoint / deriveSynthOutcomePromise) — no
  // new engine, no AI call. Writer/text rows keep their exact prior values
  // (eff* === original when !requiresMediaBrief); image/carousel already
  // populate these so the fallbacks are no-ops for them.
  const ne = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const effObjective = requiresMediaBrief
    ? (objective || (topicStr ? `Build awareness and engagement around ${topicStr}.` : 'Execute weekly objective.'))
    : objective;
  const effTargetAudience = requiresMediaBrief
    ? (target_audience || (theme ? `Audience engaged with ${theme}` : 'Target audience from campaign context'))
    : target_audience;
  const effSummary = requiresMediaBrief
    ? (summary || (topicStr ? `Address "${topicStr}"${theme ? ` within the "${theme}" narrative` : ''} for the target audience.` : ''))
    : summary;

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

  const baseIntentShape: Record<string, unknown> = intent && typeof intent === 'object'
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
  // Creator rows: guarantee a fully-populated intent (the renderer's Video
  // Production Guide reads pain_point / outcome_promise / narrative_style /
  // brief_summary). Backfill ONLY empty fields from item context + existing
  // synth helpers. Writer/text rows pass baseIntentShape through untouched.
  const intentShape: Record<string, unknown> = requiresMediaBrief
    ? {
        ...baseIntentShape,
        objective: ne(baseIntentShape.objective) || effObjective || '',
        target_audience: ne(baseIntentShape.target_audience) || effTargetAudience || '',
        brief_summary: ne(baseIntentShape.brief_summary) || effSummary || '',
        cta_type: ne(baseIntentShape.cta_type) || ne(item?.ctaType) || 'Soft CTA',
        strategic_role: baseIntentShape.strategic_role ?? '',
        pain_point: ne(baseIntentShape.pain_point) || ne(item?.whatProblemAreWeAddressing) || deriveSynthPainPoint(topicStr),
        outcome_promise: ne(baseIntentShape.outcome_promise) || ne(item?.whatShouldReaderLearn) || deriveSynthOutcomePromise(topicStr, contentType),
        narrative_style: ne(baseIntentShape.narrative_style) || 'clear, practical, outcome-driven',
      }
    : baseIntentShape;

  const platform_notes: string[] = Array.isArray(enrichedItem?.validation_notes)
    ? [...enrichedItem.validation_notes]
    : typeof enrichedItem?.format_requirements === 'object' && enrichedItem.format_requirements != null
      ? [JSON.stringify(enrichedItem.format_requirements)]
      : [];

  // ── TEXT enrichment ────────────────────────────────────────────────────
  const hook = !requiresMediaBrief
    ? (typeof (intent as any)?.hook === 'string' && (intent as any).hook.trim()
        ? String((intent as any).hook).trim()
        : deriveTextHook(topicStr, contentType))
    : undefined;
  const key_points = !requiresMediaBrief
    ? (Array.isArray((intent as any)?.key_points) && (intent as any).key_points.length > 0
        ? ((intent as any).key_points as unknown[]).filter((k): k is string => typeof k === 'string')
        : deriveKeyPoints(topicStr, objective, contentType))
    : undefined;
  const seo_focus = !requiresMediaBrief
    ? (typeof (intent as any)?.seo_focus === 'string' && (intent as any).seo_focus.trim()
        ? String((intent as any).seo_focus).trim()
        : deriveSEOFocus(topicStr, objective))
    : undefined;
  const repurpose_angles = !requiresMediaBrief
    ? deriveRepurposeAngles(topicStr, contentType)
    : undefined;

  // ── CREATOR enrichment ─────────────────────────────────────────────────
  const itemPlatforms = Array.isArray(item?.platformTargets) ? item.platformTargets : [];
  const visual_hook = requiresMediaBrief ? deriveVisualHook(topicStr, contentType) : undefined;
  const image_prompt = requiresMediaBrief ? deriveImagePrompt(topicStr, contentType, itemPlatforms) : undefined;
  const video_prompt = (requiresMediaBrief && contentType !== 'carousel') ? deriveVideoPrompt(topicStr, contentType, itemPlatforms) : undefined;
  const scene_direction = requiresMediaBrief ? deriveSceneDirection(topicStr, contentType) : undefined;

  // ── Creator instructions block (rich) ──────────────────────────────────
  const instructionsParts: string[] = [];
  if (effObjective) instructionsParts.push(`Objective: ${effObjective}`);
  if (effSummary) instructionsParts.push(`Brief: ${effSummary}`);
  if (effTargetAudience) instructionsParts.push(`Audience: ${effTargetAudience}`);
  if (item?.desiredAction || intent?.cta_type) {
    instructionsParts.push(`CTA: ${String(item?.desiredAction || intent?.cta_type || '').trim() || '—'}`);
  }
  if (item?.narrativeStyle) instructionsParts.push(`Tone: ${item.narrativeStyle}`);
  if (requiresMediaBrief) {
    if (visual_hook) instructionsParts.push(`Visual hook (0–3s): ${visual_hook}`);
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
      instructionsParts.push(`Repurpose as:\n${repurpose_angles.map(a => `  • ${a}`).join('\n')}`);
    }
  }
  const instructions_for_creator = instructionsParts.join('\n');

  return {
    theme: theme || undefined,
    objective: effObjective || undefined,
    target_audience: effTargetAudience || undefined,
    summary: effSummary || undefined,
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
  variantMetadata?: Record<string, unknown>;
  adaptive_performance_insights?: Record<string, unknown>;
  /** When provided (e.g. from BOLT executionConfig.tentative_start), used when campaign lacks start_date. */
  campaign_start_date?: string;
  /** When true (BOLT), restrict to text content only: post, blog, article, story, thread, poll. Exclude video, carousel, reels, etc. */
  boltTextOnly?: boolean;
  /** Per-format post count from user selection e.g. { article: 2, newsletter: 1 }. Overrides equal-distribution fallback. */
  format_frequency?: Record<string, number>;
  /** Whether content is shared across platforms (same_day_per_topic) or unique per platform (staggered). */
  cross_platform_sharing?: boolean | { enabled: boolean };
  /** Cross-campaign conflict decision from the launch UI: avoid (default) / skip / override. */
  conflict_policy?: 'avoid' | 'skip' | 'override';
}

/** Core logic for generating weekly structure. Callable from API or BOLT pipeline. */

