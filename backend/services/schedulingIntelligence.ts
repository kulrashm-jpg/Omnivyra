/**
 * Scheduling Intelligence — Phase 6
 *
 * Provides platform best days, best time windows, and regional holiday awareness.
 * Used by weeklyScheduleAllocator and contentDistributionIntelligence.
 */

import {
  getRegionalHolidays as getHolidaysForYear,
  getRegionalHolidaysInRange,
  type HolidayEntry,
} from '../../lib/calendar/holidayCalendar';

export interface TimeWindow {
  start: string;
  end: string;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PLATFORM_BEST_DAYS: Record<string, string[]> = {
  linkedin: ['Tue', 'Wed', 'Thu'],
  twitter: ['Tue', 'Wed', 'Thu', 'Fri'],
  x: ['Tue', 'Wed', 'Thu', 'Fri'],
  blog: ['Wed', 'Fri'],
  youtube: ['Thu', 'Fri', 'Sat'],
  instagram: ['Tue', 'Wed', 'Fri'],
  facebook: ['Wed', 'Thu', 'Fri'],
  tiktok: ['Tue', 'Thu', 'Fri'],
  pinterest: ['Sat', 'Sun'],
  default: ['Tue', 'Wed', 'Thu'],
};

const PLATFORM_BEST_TIMES: Record<string, TimeWindow[]> = {
  linkedin: [
    { start: '08:00', end: '10:00' },
    { start: '17:00', end: '18:00' },
  ],
  twitter: [{ start: '12:00', end: '15:00' }],
  x: [{ start: '12:00', end: '15:00' }],
  blog: [{ start: '09:00', end: '11:00' }],
  youtube: [{ start: '18:00', end: '21:00' }],
  instagram: [
    { start: '11:00', end: '13:00' },
    { start: '19:00', end: '21:00' },
  ],
  facebook: [{ start: '09:00', end: '13:00' }],
  tiktok: [{ start: '19:00', end: '21:00' }],
  default: [{ start: '09:00', end: '10:00' }],
};

function normalizePlatform(platform: string): string {
  const s = String(platform ?? '').trim().toLowerCase();
  return s === 'x' ? 'twitter' : s;
}

/**
 * Get recommended posting days per platform (short names: Tue, Wed, etc).
 */
export function getPlatformBestDays(platform: string): string[] {
  const key = normalizePlatform(platform);
  return PLATFORM_BEST_DAYS[key] ?? PLATFORM_BEST_DAYS.default;
}

/**
 * Get day numbers (1-7) for platform best days. Mon=1, Tue=2, ..., Sun=7.
 */
export function getPlatformBestDayNumbers(platform: string): number[] {
  const dayNames = getPlatformBestDays(platform);
  return dayNames.map((d) => {
    const idx = DAY_NAMES.indexOf(d);
    return idx >= 0 ? idx + 1 : 0;
  }).filter((n) => n > 0);
}

/**
 * Get recommended posting time windows per platform.
 */
export function getPlatformBestTimes(platform: string): TimeWindow[] {
  const key = normalizePlatform(platform);
  return PLATFORM_BEST_TIMES[key] ?? PLATFORM_BEST_TIMES.default;
}

/**
 * Pick a default time from the platform's first best window (use start time).
 */
export function getPlatformDefaultTime(platform: string): string {
  const windows = getPlatformBestTimes(platform);
  return windows[0]?.start ?? '09:00';
}

/**
 * Get regional holidays for a year.
 */
export function getRegionalHolidaysByYear(region: string, year: number): HolidayEntry[] {
  return getHolidaysForYear(region, year);
}

/**
 * Get regional holidays within a date range.
 */
export function getRegionalHolidays(
  region: string,
  dateRange: { start: string; end: string }
): HolidayEntry[] {
  return getRegionalHolidaysInRange(region, dateRange.start, dateRange.end);
}

/**
 * Check if a date string (YYYY-MM-DD) is a holiday in any of the given regions.
 */
export function isDateHoliday(dateStr: string, regions: string[]): HolidayEntry | null {
  const normalized = dateStr.replace(/T.*/, '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  for (const r of regions) {
    const key = String(r ?? '').trim().toLowerCase();
    const entries = getHolidaysForYear(key, parseInt(normalized.slice(0, 4), 10));
    const found = entries.find((h) => h.date === normalized);
    if (found) return found;
  }
  return null;
}
