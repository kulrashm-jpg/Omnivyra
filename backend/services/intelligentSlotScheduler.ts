/**
 * Intelligent Slot Scheduler
 *
 * Assigns optimal day + time to each content slot using:
 * 1. Research-based optimal windows (contentSchedulingIntelligence.ts) as baseline
 * 2. LLM pass for holiday/cultural/seasonal adjustments
 * 3. Collision avoidance — same platform won't dominate the same day
 *
 * Falls back to deterministic schedule if LLM is unavailable.
 */

import { generateCampaignPlan } from './aiGateway';
import {
  getOptimalDays,
  getOptimalTime,
  describeScheduleForPrompt,
  type DayWindow,
} from '../constants/contentSchedulingIntelligence';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export type InputSlot = {
  platform: string;
  contentType: string;
};

export type ScheduledSlot = {
  dayOfWeek: string;
  platform: string;
  contentType: string;
  optimalTime: string;
  schedulingRationale: string;
};

type LLMScheduleItem = {
  slot_index: number;
  dayOfWeek: string;
  optimalTime: string;
  rationale: string;
};

/**
 * Compute the week start date (Monday) from campaign start + week number.
 */
function computeWeekStart(campaignStart: string, weekNumber: number): Date {
  const base = new Date(campaignStart.replace(/T.*/, 'T00:00:00'));
  base.setDate(base.getDate() + (weekNumber - 1) * 7);
  return base;
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * List the 7 calendar dates for the week (Mon–Sun).
 */
function weekDates(weekStart: Date): Array<{ day: string; date: string }> {
  return DAYS_ORDER.map((day, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return { day, date: formatDate(d) };
  });
}

/**
 * Deterministic scheduler (no LLM).
 * Assigns the highest-scoring available day for each slot while avoiding collisions.
 * Uses engagement research from contentSchedulingIntelligence.ts.
 */
function deterministicSchedule(
  slots: InputSlot[],
  weekStart: Date,
  avoidDates?: Set<string>
): ScheduledSlot[] {
  const dates = weekDates(weekStart);
  // dayUsage: how many slots are already assigned to each day
  const dayUsage = new Map<string, number>(DAYS_ORDER.map((d) => [d, 0]));

  return slots.map((slot) => {
    const windows: DayWindow[] = getOptimalDays(slot.platform, slot.contentType, 7);

    // Pick the best day that isn't over-loaded (≤ 2 already) and isn't a holiday
    const pick = windows.find((w) => {
      if ((dayUsage.get(w.day) ?? 0) >= 2) return false; // max 2 per day
      if (avoidDates) {
        const dateEntry = dates.find((d) => d.day === w.day);
        if (dateEntry && avoidDates.has(dateEntry.date)) return false;
      }
      return true;
    }) ?? windows[0]; // fallback to top choice even if busy

    dayUsage.set(pick.day, (dayUsage.get(pick.day) ?? 0) + 1);

    return {
      dayOfWeek: pick.day,
      platform: slot.platform,
      contentType: slot.contentType,
      optimalTime: pick.optimalTime,
      schedulingRationale: pick.rationale,
    };
  });
}

/**
 * Ask the LLM to refine the schedule considering:
 * - Holiday proximity (based on exact week dates provided)
 * - Cultural/seasonal context
 * - Content type peak engagement
 * - Cross-platform collision avoidance
 *
 * Returns null if LLM fails; caller must use deterministic fallback.
 */
async function llmRefineSchedule(
  slots: InputSlot[],
  deterministicResult: ScheduledSlot[],
  weekDatesInfo: Array<{ day: string; date: string }>,
  campaignContext?: {
    campaignName?: string;
    targetAudience?: string;
    region?: string;
    brandVoice?: string;
  }
): Promise<ScheduledSlot[] | null> {
  if (slots.length === 0) return deterministicResult;

  const slotDescriptions = slots.map((s, i) =>
    `Slot ${i + 1}: ${s.platform}/${s.contentType} — research baseline: ${deterministicResult[i]?.dayOfWeek} ${deterministicResult[i]?.optimalTime}`
  ).join('\n');

  const scheduleGuide = [...new Set(slots.map((s) => `${s.platform}/${s.contentType}`))].map((key) => {
    const [platform, contentType] = key.split('/');
    return describeScheduleForPrompt(platform, contentType);
  }).join('\n');

  const weekCalendar = weekDatesInfo.map((d) => `${d.day} ${d.date}`).join(', ');

  const systemPrompt = `You are a social media scheduling strategist with expertise in global content calendars.
You will receive a list of content slots with research-based day assignments and must:
1. Verify or adjust for upcoming holidays, cultural events, or seasonal patterns in the target region
2. Ensure no platform posts more than twice on the same day
3. Consider the content type's peak engagement window (provided in the research guide)
4. Factor in time zones if the audience region is known
5. Return ONLY valid JSON — no markdown, no prose.`;

  const userPrompt = JSON.stringify({
    week_calendar: weekCalendar,
    target_region: campaignContext?.region ?? 'Global / English-speaking markets',
    campaign_name: campaignContext?.campaignName ?? '',
    target_audience: campaignContext?.targetAudience ?? '',
    brand_voice: campaignContext?.brandVoice ?? '',
    content_slots: slotDescriptions,
    research_based_schedule_guide: scheduleGuide,
    instructions: [
      'For each slot, confirm or adjust the day assignment based on holidays and cultural context.',
      'If a day falls on or adjacent to a major holiday in the target region, move the post to the next best research-backed day.',
      'If multiple slots land on the same day with the same platform, redistribute to avoid feed saturation.',
      'For each slot return: slot_index (1-based), dayOfWeek, optimalTime (HH:MM), rationale (1 sentence explaining the choice including holiday/cultural reason if applicable).',
    ],
    response_format: {
      schedule: [
        { slot_index: 1, dayOfWeek: 'Tuesday', optimalTime: '09:00', rationale: 'example' },
      ],
    },
  });

  try {
    const result = await generateCampaignPlan({
      companyId: null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' } as any,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = typeof result?.output === 'string'
      ? JSON.parse(result.output)
      : result?.output;

    const items: LLMScheduleItem[] = Array.isArray(raw?.schedule) ? raw.schedule : [];
    if (items.length === 0) return null;

    // Map LLM results back onto slots (by slot_index)
    const refined: ScheduledSlot[] = [...deterministicResult];
    for (const item of items) {
      const idx = Number(item.slot_index) - 1;
      if (idx < 0 || idx >= slots.length) continue;
      const day = String(item.dayOfWeek ?? '').trim();
      const time = String(item.optimalTime ?? '').trim();
      const rationale = String(item.rationale ?? '').trim();
      if (DAYS_ORDER.includes(day) && /^\d{2}:\d{2}$/.test(time)) {
        refined[idx] = {
          ...refined[idx],
          dayOfWeek: day,
          optimalTime: time,
          schedulingRationale: rationale || refined[idx].schedulingRationale,
        };
      }
    }
    return refined;
  } catch (err) {
    console.warn('[intelligentSlotScheduler] LLM refinement failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Main export: schedule slots with research-based intelligence + LLM holiday/cultural pass.
 *
 * @param slots          - List of { platform, contentType } to schedule
 * @param campaignStart  - Campaign start date (YYYY-MM-DD)
 * @param weekNumber     - Which week of the campaign (1-based)
 * @param campaignContext - Optional context for LLM pass (audience, region, brand voice)
 * @returns              Scheduled slots with dayOfWeek, optimalTime, and rationale
 */
export async function scheduleSlotIntelligently(
  slots: InputSlot[],
  campaignStart: string,
  weekNumber: number,
  campaignContext?: {
    campaignName?: string;
    targetAudience?: string;
    region?: string;
    brandVoice?: string;
  }
): Promise<ScheduledSlot[]> {
  if (slots.length === 0) return [];

  const weekStart = computeWeekStart(campaignStart, weekNumber);
  const dates = weekDates(weekStart);

  // Step 1: Deterministic baseline from research data
  const baseline = deterministicSchedule(slots, weekStart);

  // Step 2: LLM refinement for holiday/cultural awareness (non-blocking)
  const refined = await llmRefineSchedule(slots, baseline, dates, campaignContext);

  const final = refined ?? baseline;

  // Step 3: Ensure no more than 2 posts per day per platform (post-LLM safety pass)
  const platformDayCount = new Map<string, number>(); // `platform:day` -> count
  return final.map((slot) => {
    const key = `${slot.platform}:${slot.dayOfWeek}`;
    const count = platformDayCount.get(key) ?? 0;
    if (count >= 2) {
      // Find next available day for this platform
      const windows = getOptimalDays(slot.platform, slot.contentType, 7);
      const available = windows.find((w) => {
        const k = `${slot.platform}:${w.day}`;
        return (platformDayCount.get(k) ?? 0) < 2 && w.day !== slot.dayOfWeek;
      });
      if (available) {
        platformDayCount.set(`${slot.platform}:${available.day}`, (platformDayCount.get(`${slot.platform}:${available.day}`) ?? 0) + 1);
        return {
          ...slot,
          dayOfWeek: available.day,
          optimalTime: available.optimalTime,
          schedulingRationale: `${slot.schedulingRationale} (rescheduled: same-platform collision avoided)`,
        };
      }
    }
    platformDayCount.set(key, count + 1);
    return slot;
  });
}

/**
 * Synchronous deterministic-only scheduler (no LLM, no async).
 * Used as an immediate fallback when async scheduling is not possible.
 */
export function scheduleSlotsDeterministic(
  slots: InputSlot[],
  campaignStart: string,
  weekNumber: number
): ScheduledSlot[] {
  const weekStart = computeWeekStart(campaignStart, weekNumber);
  return deterministicSchedule(slots, weekStart);
}
