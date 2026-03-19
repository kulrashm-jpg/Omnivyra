/**
 * Campaign Expansion Engine — Layer 3 (Zero GPT)
 *
 * Takes a CampaignStrategy (from Layer 2) + MappedWeeklySkeleton (from strategyMapper)
 * and deterministically expands them into a full campaign plan with daily content slots.
 *
 * NO GPT calls. Every expansion is rule-based or template-driven using:
 *   - tryTemplateBlueprintFor() from aiTemplateLayer
 *   - assembleFromFragments() from fragmentCache
 *   - storeFragments() to populate fragment reuse for subsequent campaigns
 *   - Funnel-stage aware content type mapping
 *
 * Output is stored in DB as the twelve_week_plan blueprint JSON.
 */

import { tryTemplateBlueprintFor } from './aiTemplateLayer';
import { assembleFromFragments, storeFragments } from './fragmentCache';
import type { CampaignStrategy } from './campaignStrategyEngine';
import type { MappedWeeklySkeleton, WeeklyStrategy, FunnelStage } from './strategyMapper';
import type { DeterministicExecutionItem } from './deterministicWeeklySkeleton';
import type { ContentBlueprint } from './contentBlueprintCache';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExpandedContentSlot {
  /** Stable ID for deduplication and cache keying */
  slot_id:      string;
  week:         number;
  day:          number;        // 1–7
  platform:     string;
  content_type: string;
  topic:        string;
  angle:        string;        // how-to | list | case-study | announcement | question | mistake
  funnel_stage: FunnelStage;
  blueprint:    ContentBlueprint;
  cta:          string;
  source:       'template' | 'fragment' | 'rule-based';
}

export interface ExpandedWeekPlan {
  week:         number;
  theme:        string;
  funnel_stage: FunnelStage;
  objective:    string;
  slots:        ExpandedContentSlot[];
}

export interface ExpandedCampaignPlan {
  campaign_id:    string;
  strategy:       CampaignStrategy;
  weeks:          ExpandedWeekPlan[];
  total_posts:    number;
  confidence:     number;
  generated_at:   string;
  /** True if any slot required GPT (should always be false from this engine) */
  gpt_used:       boolean;
}

// ── Content angle rotation ────────────────────────────────────────────────────

const ANGLE_SEQUENCE: string[] = ['how-to', 'list', 'case-study', 'mistake', 'question', 'announcement'];

function pickAngle(strategy: CampaignStrategy, slotIndex: number): string {
  const angles = strategy.content_angles.length > 0 ? strategy.content_angles : ANGLE_SEQUENCE;
  return angles[slotIndex % angles.length];
}

function pickCta(strategy: CampaignStrategy, slotIndex: number): string {
  const ctaPatterns = strategy.cta_patterns.length > 0 ? strategy.cta_patterns : [
    'Save this for later.',
    'Share with someone who needs this.',
    'Comment your thoughts below.',
    'Follow for more.',
  ];
  return ctaPatterns[slotIndex % ctaPatterns.length];
}

// ── Topic expansion from theme + angle ────────────────────────────────────────

function expandTopicFromAngle(
  theme: string,
  angle: string,
  audience: string,
  week: number,
): string {
  const audLabel = audience.split(',')[0].trim(); // take first segment if composite

  const expansions: Record<string, (t: string, a: string, w: number) => string> = {
    'how-to':       (t, a, w) => `How to ${t.toLowerCase().replace(/^introducing\s+/i, '').replace(/^building\s+/i, '')} — A practical guide for ${a}`,
    'list':         (t, a, w) => `${(w % 5) + 3} key insights about ${t.toLowerCase()} every ${a} should know`,
    'case-study':   (t, a, w) => `Real results: how ${a}s are achieving ${t.toLowerCase().replace(/^maximizing\s+/i, '')}`,
    'mistake':      (t, a, w) => `Stop making this mistake with ${t.toLowerCase()} — it's costing you more than you think`,
    'question':     (t, a, w) => `Are you ${a}? Here's what most people get wrong about ${t.toLowerCase()}`,
    'announcement': (t, a, w) => `${t} — here's what this means for ${a}`,
    'trend':        (t, a, w) => `The ${t.toLowerCase()} trend every ${a} needs to understand right now`,
  };

  const fn = expansions[angle] ?? expansions['how-to'];
  return fn(theme, audLabel, week);
}

// ── Platform adaptation ────────────────────────────────────────────────────────

function adaptHookForPlatform(hook: string, platform: string): string {
  switch (platform.toLowerCase()) {
    case 'x':
    case 'twitter': {
      // Truncate to 240 chars for tweet content (leaving room for URL)
      const words = hook.split(' ');
      let result = '';
      for (const w of words) {
        if ((result + ' ' + w).trim().length > 240) break;
        result = result ? result + ' ' + w : w;
      }
      return result || hook.slice(0, 240);
    }
    case 'instagram':
      return hook + ' 👇';
    case 'linkedin':
      return hook;
    default:
      return hook;
  }
}

// ── Slot ID generation ────────────────────────────────────────────────────────

function makeSlotId(campaignId: string, week: number, platform: string, slotIndex: number): string {
  return `${campaignId.slice(0, 8)}_w${week}_${platform}_s${slotIndex}`;
}

// ── Day spread for weekly slots ───────────────────────────────────────────────

function spreadToDays(slotCount: number, weeklyFrequency: number): number[] {
  // Distribute posts across 5 working days
  const days: number[] = [];
  const availableDays = [1, 2, 3, 4, 5]; // Mon–Fri
  const step = Math.max(1, Math.floor(5 / Math.max(slotCount, 1)));

  for (let i = 0; i < slotCount; i++) {
    days.push(availableDays[Math.min(i * step, 4)]);
  }
  return days;
}

// ── Per-slot blueprint generation (template-first, no GPT) ───────────────────

function generateSlotBlueprint(
  topic: string,
  angle: string,
  contentType: string,
  audience: string,
  cta: string,
  platform: string,
  strategy: CampaignStrategy,
): { blueprint: ContentBlueprint; source: ExpandedContentSlot['source'] } {
  // 1. Template layer
  const template = tryTemplateBlueprintFor(topic, contentType, strategy.positioning, audience);
  if (template) {
    return { blueprint: { ...template, cta }, source: 'template' };
  }

  // 2. Fragment reuse
  const fragment = assembleFromFragments(topic, contentType, 'Soft CTA', audience);
  if (fragment) {
    return { blueprint: { ...fragment, cta }, source: 'fragment' };
  }

  // 3. Rule-based fallback
  const adaptedHook = adaptHookForPlatform(topic, platform);
  const blueprint: ContentBlueprint = {
    hook:       adaptedHook,
    key_points: [
      `Why this matters for ${audience.split(',')[0].trim()}`,
      `The most common approach — and why it falls short`,
      `A better way: practical steps you can start today`,
    ],
    cta,
  };

  // Store the rule-based result as a fragment for future reuse
  storeFragments(blueprint, {
    topic,
    contentType,
    ctaType: 'Soft CTA',
    audience,
  });

  return { blueprint, source: 'rule-based' };
}

// ── Week expansion ────────────────────────────────────────────────────────────

function expandWeek(
  campaignId: string,
  weekStrategy: WeeklyStrategy,
  executionItems: DeterministicExecutionItem[],
  strategy: CampaignStrategy,
  globalSlotCounter: { n: number },
): ExpandedWeekPlan {
  const slots: ExpandedContentSlot[] = [];

  for (const item of executionItems) {
    const slotsForItem = item.topic_slots ?? [];
    const platforms    = item.selected_platforms.length > 0 ? item.selected_platforms : ['linkedin'];
    const days         = spreadToDays(slotsForItem.length, item.count_per_week);

    for (let i = 0; i < slotsForItem.length; i++) {
      const slot       = slotsForItem[i];
      const platform   = platforms[i % platforms.length];
      const angle      = pickAngle(strategy, globalSlotCounter.n);
      const cta        = pickCta(strategy, globalSlotCounter.n);
      globalSlotCounter.n++;

      // Prefer slot-level topic if set, otherwise expand from week theme
      const rawTopic = slot.topic
        || expandTopicFromAngle(weekStrategy.theme, angle, strategy.audience, weekStrategy.week);

      const { blueprint, source } = generateSlotBlueprint(
        rawTopic,
        angle,
        item.content_type,
        strategy.audience,
        cta,
        platform,
        strategy,
      );

      slots.push({
        slot_id:      makeSlotId(campaignId, weekStrategy.week, platform, globalSlotCounter.n),
        week:         weekStrategy.week,
        day:          days[i] ?? 1,
        platform,
        content_type: item.content_type,
        topic:        rawTopic,
        angle,
        funnel_stage: weekStrategy.funnel_stage,
        blueprint,
        cta,
        source,
      });
    }
  }

  return {
    week:         weekStrategy.week,
    theme:        weekStrategy.theme,
    funnel_stage: weekStrategy.funnel_stage,
    objective:    weekStrategy.primary_objective,
    slots,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Expand a CampaignStrategy + MappedWeeklySkeleton into a full content calendar.
 * ZERO GPT calls. All outputs are deterministic or template-driven.
 *
 * @param campaignId - Campaign ID (for slot ID generation)
 * @param strategy   - Output from generateCampaignStrategy() (Layer 2)
 * @param mapped     - Output from mapStrategyToSkeleton() (strategyMapper)
 * @returns ExpandedCampaignPlan — ready to be stored in twelve_week_plan
 */
export function expandCampaign(
  campaignId: string,
  strategy: CampaignStrategy,
  mapped: MappedWeeklySkeleton,
): ExpandedCampaignPlan {
  const globalSlotCounter = { n: 0 };
  const weeks: ExpandedWeekPlan[] = [];

  for (const weekStrategy of mapped.weekly_strategies) {
    const expanded = expandWeek(
      campaignId,
      weekStrategy,
      mapped.skeleton.execution_items,
      strategy,
      globalSlotCounter,
    );
    weeks.push(expanded);
  }

  const totalPosts   = weeks.reduce((sum, w) => sum + w.slots.length, 0);
  const templateHits = weeks.flatMap(w => w.slots).filter(s => s.source === 'template').length;
  const fragmentHits = weeks.flatMap(w => w.slots).filter(s => s.source === 'fragment').length;

  const expansionConfidence = totalPosts > 0
    ? Math.min(1, (templateHits + fragmentHits * 0.9) / totalPosts + strategy.confidence * 0.4)
    : strategy.confidence;

  return {
    campaign_id:  campaignId,
    strategy,
    weeks,
    total_posts:  totalPosts,
    confidence:   Math.round(expansionConfidence * 100) / 100,
    generated_at: new Date().toISOString(),
    gpt_used:     false, // Layer 3 never touches GPT
  };
}

/**
 * Compute a confidence score for the expanded plan.
 * Low confidence (<0.65) triggers optional Layer 4 refinement for premium users.
 */
export function assessExpansionConfidence(plan: ExpandedCampaignPlan): number {
  const slots         = plan.weeks.flatMap(w => w.slots);
  const templateRate  = slots.filter(s => s.source === 'template').length / Math.max(slots.length, 1);
  const fragmentRate  = slots.filter(s => s.source === 'fragment').length / Math.max(slots.length, 1);
  const strategyScore = plan.strategy.confidence;

  // Weighted confidence: strategy 40%, template coverage 35%, fragment reuse 25%
  return Math.round((strategyScore * 0.40 + templateRate * 0.35 + fragmentRate * 0.25) * 100) / 100;
}
