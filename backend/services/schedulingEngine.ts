/**
 * Scheduling Intelligence Engine
 * BOLT: assigns optimal posting times by platform and prevents same-day collisions.
 * Rule-based, deterministic, no LLM.
 */

export type SlotInput = {
  platform?: string;
  day?: string;
  day_index?: number;
  day_name?: string;
  time?: string;
  short_topic?: string;
  full_topic?: string;
  content_type?: string;
  reasoning?: string;
};

const PLATFORM_TIMES: Record<string, string> = {
  linkedin: '09:30',
  x: '13:00',
  blog: '08:00',
  youtube: '18:00',
};

const DEFAULT_TIME = '10:00';

const COLLISION_STAGGER_MINUTES = 60;

export type SchedulingOptions = {
  /** Override default platform times (e.g. from historical engagement signals). */
  platformTimeOverrides?: Record<string, string>;
};



/**
 * Merge default platform times with overrides. Overrides take precedence.
 */
function getEffectiveTimes(options?: SchedulingOptions): Record<string, string> {
  const overrides = options?.platformTimeOverrides ?? {};
  return { ...PLATFORM_TIMES, ...overrides };
}

/**
 * Add minutes to "HH:MM" time string. Wraps past midnight.
 */
function addMinutesToTime(timeStr: string, minutes: number): string {
  const parts = String(timeStr ?? '00:00').split(':');
  const h = parseInt(parts[0] ?? '0', 10) || 0;
  const m = parseInt(parts[1] ?? '0', 10) || 0;
  let totalMinutes = h * 60 + m + minutes;
  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const nh = Math.floor(totalMinutes / 60) % 24;
  const nm = totalMinutes % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/**
 * Content-canonical platform normalization: `twitter` → `x`.
 *
 * `PLATFORM_TIMES` above is keyed on the content vocabulary (`x: '13:00'`), and
 * so are the overrides its caller builds. Using
 * `constants/platforms.normalizePlatform` — which canonicalizes `x` → `twitter`
 * for the connector / analytics domain — turned every lookup into a miss, so
 * X slots silently fell through to DEFAULT_TIME instead of their 13:00 slot.
 *
 * Conversion to the DB representation happens only at the persistence seam,
 * `canonicalizePlatformForDb`.
 */
function normalizePlatform(platform: string | null | undefined): string {
  return String(platform ?? '').trim().toLowerCase().replace(/^twitter$/, 'x');
}

/**
 * Resolve base time for a slot from effective platform times or default.
 */
function resolveBaseTime(slot: SlotInput, effectiveTimes: Record<string, string>): string {
  const existing = String(slot.time ?? '').trim();
  if (existing && /^\d{1,2}:\d{2}$/.test(existing)) return existing;
  const platform = normalizePlatform(slot.platform ?? '');
  return effectiveTimes[platform] ?? DEFAULT_TIME;
}

/**
 * Assign posting times to slots.
 * - Keeps existing time when slot.time is set.
 * - Otherwise uses effectiveTimes[platform] || DEFAULT_TIME (effectiveTimes = PLATFORM_TIMES + overrides).
 * - Prevents same-day collisions by staggering each additional slot by +60 minutes.
 * - Preserves original slot order.
 */
export function assignPostingTimes<T extends SlotInput>(
  slots: T[],
  options?: SchedulingOptions
): T[] {
  const effectiveTimes = getEffectiveTimes(options);
  const byDay = new Map<number, T[]>();
  for (const slot of slots) {
    const dayKey = slot.day_index ?? 1;
    const arr = byDay.get(dayKey) ?? [];
    arr.push(slot);
    byDay.set(dayKey, arr);
  }

  const daySlotIndex = new Map<T, number>();
  for (const [, daySlots] of byDay) {
    daySlots.forEach((slot, i) => daySlotIndex.set(slot, i));
  }

  return slots.map((slot) => {
    const dayKey = slot.day_index ?? 1;
    const daySlots = byDay.get(dayKey) ?? [slot];
    const indexInDay = daySlotIndex.get(slot) ?? 0;
    const baseTime = resolveBaseTime(daySlots[0] ?? slot, effectiveTimes);
    const time =
      indexInDay === 0
        ? baseTime
        : addMinutesToTime(baseTime, indexInDay * COLLISION_STAGGER_MINUTES);
    return { ...slot, time } as T;
  });
}
