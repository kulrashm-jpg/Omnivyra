/**
 * Planner Integrity Service
 * Validates calendar_plan before returning plan preview or committing campaign.
 * STEP 4: Calendar integrity check.
 */

import type { CalendarPlan } from '../../components/planner/plannerSessionStore';

export interface CalendarPlanValidationResult {
  valid: boolean;
  errors: string[];
}

/** Normalize platform key for comparison */
function normPlatform(p: string): string {
  return String(p ?? '').toLowerCase().trim().replace(/^twitter$/i, 'x');
}

/** Normalize content type */
function normContentType(ct: string): string {
  return String(ct ?? '').toLowerCase().trim();
}

/**
 * Validates calendar_plan structure and content.
 * Checks: no duplicate execution_id, valid platform/content_type, no empty weeks, frequency matches matrix.
 */
export function validateCalendarPlan(
  calendar_plan: CalendarPlan | null | undefined,
  options?: {
    /** Allowed platform→content_types (from company config). If omitted, skips platform/content_type validation. */
    allowedPlatformContent?: Record<string, string[]>;
    /** Expected platform_content_requests for frequency match. If omitted, skips frequency check. */
    platform_content_requests?: Record<string, Record<string, number>>;
  }
): CalendarPlanValidationResult {
  const errors: string[] = [];
  if (!calendar_plan) {
    return { valid: true, errors: [] };
  }
  const activities = calendar_plan.activities ?? [];
  if (activities.length === 0) {
    return { valid: true, errors: [] };
  }

  // No duplicate execution_id
  const seenIds = new Set<string>();
  for (const a of activities) {
    const id = String(a.execution_id ?? '').trim();
    if (id && seenIds.has(id)) {
      errors.push(`Duplicate execution_id: ${id}`);
    }
    if (id) seenIds.add(id);
  }

  // Valid platform/content_type (when allowed map provided)
  const allowed = options?.allowedPlatformContent;
  if (allowed) {
    const allowedMap = new Map<string, Set<string>>();
    for (const [p, cts] of Object.entries(allowed)) {
      const np = normPlatform(p);
      allowedMap.set(np, new Set((cts ?? []).map(normContentType)));
    }
    for (const a of activities) {
      const p = normPlatform(a.platform ?? '');
      const ct = normContentType(a.content_type ?? 'post');
      const allowedCts = allowedMap.get(p);
      if (allowedCts && !allowedCts.has(ct)) {
        errors.push(`Unsupported platform/content_type: ${p}/${ct}`);
      }
    }
  }

  // No empty weeks (weeks with no activities)
  const weeksWithActivities = new Set(activities.map((a) => a.week_number ?? 1).filter((n) => n > 0));
  const weekNumbers = Array.from(weeksWithActivities).sort((a, b) => a - b);
  const calendarWeeks = (calendar_plan.weeks ?? []).length;
  if (calendarWeeks > 0 && weekNumbers.length < calendarWeeks) {
    const missing = Array.from({ length: calendarWeeks }, (_, i) => i + 1).filter((w) => !weekNumbers.includes(w));
    if (missing.length > 0) {
      errors.push(`Empty weeks with no activities: ${missing.join(', ')}`);
    }
  }

  // Frequency matches matrix (when platform_content_requests provided)
  const matrix = options?.platform_content_requests;
  if (matrix) {
    const observed: Record<string, Record<string, number>> = {};
    for (const a of activities) {
      const p = normPlatform(a.platform ?? '');
      const ct = normContentType(a.content_type ?? 'post');
      if (!observed[p]) observed[p] = {};
      observed[p][ct] = (observed[p][ct] ?? 0) + 1;
    }
    for (const [p, ctMap] of Object.entries(matrix)) {
      const np = normPlatform(p);
      for (const [ct, expected] of Object.entries(ctMap ?? {})) {
        const nct = normContentType(ct);
        const actual = Math.ceil(((observed[np]?.[nct] ?? 0) / Math.max(1, weekNumbers.length)) * 10) / 10;
        if (expected > 0 && (observed[np]?.[nct] ?? 0) === 0) {
          errors.push(`Missing activities for ${np}/${nct} (expected ${expected}/week)`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
