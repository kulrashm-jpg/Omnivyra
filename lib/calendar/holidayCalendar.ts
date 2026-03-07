/**
 * Holiday Calendar — Regional holiday lookup for scheduling intelligence.
 * Phase 6: india, usa, uk.
 */

export interface HolidayEntry {
  date: string;
  name: string;
}

const HOLIDAYS: Record<string, HolidayEntry[]> = {
  india: [
    { date: '2025-01-26', name: 'Republic Day' },
    { date: '2025-03-08', name: 'Holi' },
    { date: '2025-04-14', name: 'Ambedkar Jayanti' },
    { date: '2025-08-15', name: 'Independence Day' },
    { date: '2025-10-02', name: 'Gandhi Jayanti' },
    { date: '2025-10-24', name: 'Diwali' },
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-27', name: 'Holi' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-11-12', name: 'Diwali' },
  ],
  usa: [
    { date: '2025-01-01', name: "New Year's Day" },
    { date: '2025-01-20', name: 'Martin Luther King Jr. Day' },
    { date: '2025-02-17', name: "Presidents' Day" },
    { date: '2025-05-26', name: 'Memorial Day' },
    { date: '2025-07-04', name: 'Independence Day' },
    { date: '2025-09-01', name: 'Labor Day' },
    { date: '2025-11-27', name: 'Thanksgiving' },
    { date: '2025-12-25', name: 'Christmas' },
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-07-04', name: 'Independence Day' },
    { date: '2026-11-26', name: 'Thanksgiving' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  uk: [
    { date: '2025-01-01', name: "New Year's Day" },
    { date: '2025-04-18', name: 'Good Friday' },
    { date: '2025-04-21', name: 'Easter Monday' },
    { date: '2025-05-05', name: 'Early May Bank Holiday' },
    { date: '2025-05-26', name: 'Spring Bank Holiday' },
    { date: '2025-08-25', name: 'Summer Bank Holiday' },
    { date: '2025-12-25', name: 'Christmas Day' },
    { date: '2025-12-26', name: 'Boxing Day' },
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-28', name: 'Boxing Day (substitute)' },
  ],
};

/**
 * Get regional holidays for a given year.
 * Returns array of { date, name }.
 */
export function getRegionalHolidays(region: string, year: number): HolidayEntry[] {
  const key = String(region ?? '').trim().toLowerCase();
  const yearStr = String(year);
  const entries = HOLIDAYS[key] ?? [];
  return entries.filter((h) => h.date.startsWith(yearStr));
}

/**
 * Get holidays within a date range (inclusive).
 */
export function getRegionalHolidaysInRange(
  region: string,
  startDate: string,
  endDate: string
): HolidayEntry[] {
  const key = String(region ?? '').trim().toLowerCase();
  const entries = HOLIDAYS[key] ?? [];
  const start = startDate.replace(/-/g, '');
  const end = endDate.replace(/-/g, '');
  return entries.filter((h) => {
    const d = h.date.replace(/-/g, '');
    return d >= start && d <= end;
  });
}
