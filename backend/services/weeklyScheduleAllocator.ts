/**
 * Weekly Schedule Allocator — Single Source of Truth for Scheduling
 *
 * Assigns schedule metadata to weekly activities (topic_slots) deterministically.
 * No AI. All scheduling fields are set here; no other service should assign schedule.
 *
 * Phase 2: Extends Phase 1 cleanup. Daily planner reads these values; does not generate them.
 * Phase 6: Uses schedulingIntelligence for platform best days and best times.
 */

import {
  getPlatformBestDayNumbers,
  getPlatformDefaultTime,
} from './schedulingIntelligence';

export type TimezoneMode = 'regional' | 'single_timezone';

export type WeeklyActivitySlot = {
  topic?: string | null;
  intent?: Record<string, unknown>;
  master_content_id?: string;
  day_index?: number;
  global_progression_index?: number;
  progression_step?: number;
  /** Scheduling fields (populated by this service) */
  topic_code?: string | null;
  content_code?: string | null;
  scheduled_day?: number | null;
  scheduled_time?: string | null;
  target_regions?: string[];
  timezone_mode?: TimezoneMode;
  repurpose_index?: number;
  repurpose_total?: number;
  [key: string]: unknown;
};

export type ExecutionItemInput = {
  content_type?: string;
  selected_platforms?: string[];
  topic_slots?: WeeklyActivitySlot[];
  [key: string]: unknown;
};

export type WeeklyActivityInput = {
  week_number?: number;
  execution_items?: ExecutionItemInput[];
  [key: string]: unknown;
};

export type AssignWeeklyScheduleInput = {
  weeklyActivities: WeeklyActivityInput | WeeklyActivityInput[];
  campaignStartDate?: string | null;
  region?: string | string[] | null;
};

const TOPIC_CODE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DEFAULT_SCHEDULED_TIME = '09:00';
const DEFAULT_TIMEZONE_MODE: TimezoneMode = 'regional';

function normalizeTopicKey(topic: string): string {
  return String(topic ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Generate topic codes sequentially: Topic 1 → A, Topic 2 → B, Topic 3 → C.
 */
function getTopicCode(index: number): string {
  if (index < 0) return 'A';
  if (index < TOPIC_CODE_LETTERS.length) return TOPIC_CODE_LETTERS[index]!;
  const high = Math.floor(index / TOPIC_CODE_LETTERS.length) - 1;
  const low = index % TOPIC_CODE_LETTERS.length;
  return (high >= 0 ? TOPIC_CODE_LETTERS[high]! : '') + TOPIC_CODE_LETTERS[low]!;
}

/**
 * Assign schedule metadata to all topic_slots in weekly activities.
 *
 * Rules:
 * - Spread activities across the week (1–7).
 * - Avoid placing two items from the same topic on the same day.
 * - Respect repurpose order spacing (minimum 1 day between consecutive items in same topic).
 * - Default scheduled_time = "09:00".
 */
export function assignWeeklySchedule(
  input: AssignWeeklyScheduleInput
): WeeklyActivityInput | WeeklyActivityInput[] {
  const weeks = Array.isArray(input.weeklyActivities)
    ? input.weeklyActivities
    : [input.weeklyActivities];
  const regionArr = Array.isArray(input.region)
    ? input.region
    : typeof input.region === 'string' && input.region
      ? [input.region]
      : [];
  const targetRegions = regionArr.map((r) => String(r).trim().toLowerCase()).filter(Boolean);

  for (const week of weeks) {
    const execItems = Array.isArray(week?.execution_items) ? week.execution_items : [];
    if (execItems.length === 0) continue;

    // 1. Collect all slots with (execIdx, slotIdx, slot, topicKey, platform)
    const allSlots: Array<{ execIdx: number; slotIdx: number; slot: WeeklyActivitySlot; topicKey: string; platform: string }> = [];
    for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
      const exec = execItems[execIdx];
      const platforms = Array.isArray(exec?.selected_platforms) ? exec.selected_platforms : [];
      const platform = String(platforms[0] ?? 'linkedin').trim().toLowerCase();
      const platformKey = platform === 'x' ? 'twitter' : platform;
      const slots = Array.isArray(exec?.topic_slots) ? exec!.topic_slots! : [];
      for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
        const slot = slots[slotIdx];
        if (!slot || typeof slot !== 'object') continue;
        const topic = String(slot.topic ?? '').trim();
        if (!topic) continue;
        allSlots.push({ execIdx, slotIdx, slot, topicKey: normalizeTopicKey(topic), platform: platformKey });
      }
    }

    if (allSlots.length === 0) continue;

    // 2. Assign topic codes: unique topics → A, B, C
    const topicKeyToCode = new Map<string, string>();
    const topicKeysOrdered: string[] = [];
    for (const { topicKey } of allSlots) {
      if (!topicKeyToCode.has(topicKey)) {
        const code = getTopicCode(topicKeysOrdered.length);
        topicKeyToCode.set(topicKey, code);
        topicKeysOrdered.push(topicKey);
      }
    }

    // 3. Per-topic: content codes A1, A2, A3 and repurpose_index/repurpose_total
    const topicKeyToSlotIndices = new Map<string, number[]>();
    for (let i = 0; i < allSlots.length; i += 1) {
      const { topicKey } = allSlots[i]!;
      const arr = topicKeyToSlotIndices.get(topicKey) ?? [];
      arr.push(i);
      topicKeyToSlotIndices.set(topicKey, arr);
    }

    for (const [topicKey, indices] of topicKeyToSlotIndices) {
      const topicCode = topicKeyToCode.get(topicKey) ?? 'A';
      const total = indices.length;
      for (let r = 0; r < indices.length; r += 1) {
        const idx = indices[r]!;
        const { slot } = allSlots[idx]!;
        slot.topic_code = topicCode;
        slot.content_code = `${topicCode}${r + 1}`;
        slot.repurpose_index = r + 1;
        slot.repurpose_total = total;
      }
    }

    // 4. Assign scheduled_day: prefer platform best days, spread across week, avoid same topic on same day
    const dayBySlotIndex = assignDaysAvoidSameTopicSameDay(allSlots, topicKeyToSlotIndices);

    for (let i = 0; i < allSlots.length; i += 1) {
      const { slot, execIdx, platform } = allSlots[i]!;
      const day = dayBySlotIndex.get(i) ?? slot.day_index ?? null;
      slot.scheduled_day = day;
      const defaultTime = getPlatformDefaultTime(platform);
      slot.scheduled_time = slot.scheduled_time ?? defaultTime;
      slot.target_regions = Array.isArray(slot.target_regions) ? slot.target_regions : targetRegions.slice();
      slot.timezone_mode = slot.timezone_mode ?? DEFAULT_TIMEZONE_MODE;
      if (day != null) slot.day_index = day;
    }
  }

  return Array.isArray(input.weeklyActivities) ? weeks : weeks[0]!;
}

/** Defaults for backward compatibility when reading slots that lack scheduling fields. */
export const SCHEDULE_DEFAULTS = {
  scheduled_day: null as number | null,
  scheduled_time: null as string | null,
  target_regions: [] as string[],
  timezone_mode: 'regional' as TimezoneMode,
  repurpose_index: 1,
  repurpose_total: 1,
} as const;

/**
 * Apply schedule defaults to a slot for backward compatibility.
 * Use when reading weekly activities that may predate the scheduling model.
 */
export function applyScheduleDefaults<T extends Record<string, unknown>>(slot: T): T & typeof SCHEDULE_DEFAULTS {
  return {
    ...slot,
    scheduled_day: (slot as any).scheduled_day ?? (slot as any).day_index ?? SCHEDULE_DEFAULTS.scheduled_day,
    scheduled_time: (slot as any).scheduled_time ?? SCHEDULE_DEFAULTS.scheduled_time,
    target_regions: Array.isArray((slot as any).target_regions) ? (slot as any).target_regions : SCHEDULE_DEFAULTS.target_regions,
    timezone_mode: ((slot as any).timezone_mode as TimezoneMode) ?? SCHEDULE_DEFAULTS.timezone_mode,
    repurpose_index: Number((slot as any).repurpose_index) || SCHEDULE_DEFAULTS.repurpose_index,
    repurpose_total: Number((slot as any).repurpose_total) || SCHEDULE_DEFAULTS.repurpose_total,
  } as T & typeof SCHEDULE_DEFAULTS;
}

/**
 * Assign days 1-7 so that:
 * - Prefer platform best days (Phase 6).
 * - Spread activities across the week.
 * - No two items from the same topic share the same day.
 * - Consecutive items in a topic (by repurpose_index) are at least 1 day apart.
 */
function assignDaysAvoidSameTopicSameDay(
  allSlots: Array<{ execIdx: number; slotIdx: number; slot: WeeklyActivitySlot; topicKey: string; platform: string }>,
  topicKeyToSlotIndices: Map<string, number[]>
): Map<number, number> {
  const result = new Map<number, number>();
  const days = 7;

  const topicKeysOrdered: string[] = [];
  const seen = new Set<string>();
  for (const { topicKey } of allSlots) {
    if (!seen.has(topicKey)) {
      seen.add(topicKey);
      topicKeysOrdered.push(topicKey);
    }
  }

  for (const topicKey of topicKeysOrdered) {
    const indices = topicKeyToSlotIndices.get(topicKey) ?? [];
    const usedDays = new Set<number>();

    for (let r = 0; r < indices.length; r += 1) {
      const slotIdx = indices[r]!;
      const { slot, platform } = allSlots[slotIdx]!;
      const repurposeIndex = slot.repurpose_index ?? r + 1;
      const repurposeTotal = slot.repurpose_total ?? indices.length;

      const bestDays = getPlatformBestDayNumbers(platform).filter((d) => d >= 1 && d <= 7);

      let candidateDay: number;
      if (repurposeTotal <= 1) {
        candidateDay = bestDays[0] ?? 1;
      } else {
        const spacing = Math.floor(days / repurposeTotal);
        const spreadDay = Math.min(days, Math.max(1, 1 + (repurposeIndex - 1) * Math.max(1, spacing)));
        const bestAvailable = bestDays.find((d) => !usedDays.has(d));
        candidateDay = bestAvailable ?? spreadDay;
      }

      let day = candidateDay;
      let attempts = 0;
      while (usedDays.has(day) && attempts < days) {
        day = (day % days) + 1;
        attempts += 1;
      }
      if (usedDays.has(day)) {
        for (const d of [...bestDays, 1, 2, 3, 4, 5, 6, 7]) {
          if (!usedDays.has(d)) {
            day = d;
            break;
          }
        }
      }
      if (usedDays.has(day)) {
        for (let d = 1; d <= days; d += 1) {
          if (!usedDays.has(d)) {
            day = d;
            break;
          }
        }
      }
      usedDays.add(day);
      result.set(slotIdx, day);
      slot.scheduled_day = day;
    }
  }

  return result;
}
