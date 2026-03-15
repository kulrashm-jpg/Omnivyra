/**
 * Planner Command Interpreter
 * Applies structured planner commands to calendar_plan.
 * Does NOT regenerate weeks — only adds, removes, or modifies existing activities.
 * Preserves existing execution_id values; only new activities get new IDs.
 */

import type { PlannerCommand } from '../types/plannerCommands';

/** Minimal calendar plan shape for interpreter (avoids circular/component imports). */
export interface PlannerCalendarActivity {
  execution_id?: string;
  week_number?: number;
  platform?: string;
  content_type?: string;
  title?: string;
  theme?: string;
  day?: string;
}
export interface PlannerCalendarDay {
  week_number: number;
  day: string;
  activities: PlannerCalendarActivity[];
}
export interface PlannerCalendarPlan {
  weeks?: unknown[];
  days?: PlannerCalendarDay[];
  activities?: PlannerCalendarActivity[];
}

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function normalizePlatform(p: string): string {
  return String(p ?? '').toLowerCase().trim().replace(/^twitter$/i, 'x');
}

function normalizeDay(d: string): string {
  const n = String(d ?? '').trim();
  if (!n) return 'Monday';
  const lower = n.toLowerCase();
  const match = DAYS_ORDER.find((day) => day.toLowerCase().startsWith(lower) || lower.startsWith(day.toLowerCase()));
  return match ?? DAYS_ORDER[Math.abs(n.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 7)];
}

/** Rebuild days and weeks from activities. */
function rebuildFromActivities(activities: PlannerCalendarActivity[]): { days: PlannerCalendarDay[]; weeks: unknown[] } {
  const byKey = new Map<string, PlannerCalendarActivity[]>();
  const weekNums = new Set<number>();

  for (const a of activities) {
    const wn = a.week_number ?? 1;
    weekNums.add(wn);
    const day = a.day ?? 'Monday';
    const key = `${wn}-${day}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(a);
  }

  const days: PlannerCalendarDay[] = [];
  for (const [key, acts] of byKey) {
    const [wnStr, day] = key.split('-');
    const week_number = parseInt(wnStr!, 10) || 1;
    days.push({ week_number, day: day ?? 'Monday', activities: acts });
  }
  days.sort(
    (a, b) =>
      a.week_number - b.week_number ||
      DAYS_ORDER.indexOf(a.day) - DAYS_ORDER.indexOf(b.day)
  );

  const weekList = Array.from(weekNums).sort((a, b) => a - b);
  const weeks = weekList.map((w) => ({
    week: w,
    theme: `Week ${w}`,
    phase_label: `Week ${w}`,
    daily_execution_items: activities
      .filter((a) => (a.week_number ?? 1) === w)
      .sort((a, b) => DAYS_ORDER.indexOf(a.day ?? '') - DAYS_ORDER.indexOf(b.day ?? '')),
  }));

  return { days, weeks };
}

function getMaxWeek(activities: PlannerCalendarActivity[]): number {
  if (activities.length === 0) return 12;
  return Math.max(...activities.map((a) => a.week_number ?? 1), 1);
}

function nextExecutionId(activities: PlannerCalendarActivity[], prefix: string): string {
  const ids = new Set(activities.map((a) => a.execution_id).filter(Boolean));
  for (let i = 1; i < 10000; i++) {
    const cand = `${prefix}-${i}`;
    if (!ids.has(cand)) return cand;
  }
  return `${prefix}-${Date.now()}`;
}

/** Build allowed platform/content_type set from matrix. Empty = no restriction. */
function buildAllowedFromMatrix(
  matrix?: Record<string, Record<string, number>> | null
): Set<string> {
  const allowed = new Set<string>();
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return allowed;
  for (const [p, ctMap] of Object.entries(matrix)) {
    const np = normalizePlatform(p);
    if (!np) continue;
    for (const [ct, freq] of Object.entries(ctMap ?? {})) {
      const nct = String(ct ?? '').toLowerCase().trim();
      if (nct && typeof freq === 'number' && freq > 0) {
        allowed.add(`${np}|${nct}`);
      }
    }
  }
  return allowed;
}

export class PlannerCommandValidationError extends Error {
  readonly code = 'PLANNER_COMMAND_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'PlannerCommandValidationError';
  }
}

/**
 * Apply a single planner command to calendar_plan.
 * Returns updated calendar_plan.
 * STEP 6: Rejects AI commands that introduce unsupported platform/content_type.
 */
export function applyPlannerCommand(
  command: PlannerCommand,
  calendar_plan: PlannerCalendarPlan,
  platform_content_requests?: Record<string, Record<string, number>> | null
): PlannerCalendarPlan {
  const allowed = buildAllowedFromMatrix(platform_content_requests);
  let activities = [...(calendar_plan.activities ?? [])];
  const maxWeek = getMaxWeek(activities);
  const themeBase = (calendar_plan.weeks?.[0] as { theme?: string })?.theme ?? 'Campaign';

  switch (command.action) {
    case 'add_activity': {
      const platform = normalizePlatform(command.platform);
      const content_type = (command.content_type ?? 'post').toLowerCase().trim();
      if (allowed.size > 0 && !allowed.has(`${platform}|${content_type}`)) {
        throw new PlannerCommandValidationError(
          `Platform "${platform}" with content type "${content_type}" is not configured for this company. Add it in Structure tab first.`
        );
      }
      const day = normalizeDay(command.day ?? 'Monday');
      const freq = Math.max(1, Math.min(14, command.frequency ?? 1));

      const existingIds = new Set(activities.map((a) => a.execution_id).filter(Boolean));
      for (let w = 1; w <= maxWeek; w++) {
        for (let f = 0; f < freq; f++) {
          const execId = nextExecutionId(activities, `cmd-add-${platform}-${content_type}`);
          activities.push({
            execution_id: execId,
            week_number: w,
            platform,
            content_type,
            title: themeBase,
            theme: themeBase,
            day: freq === 1 ? day : DAYS_ORDER[(f % DAYS_ORDER.length)],
          });
        }
      }
      break;
    }

    case 'remove_platform': {
      const platform = normalizePlatform(command.platform);
      activities = activities.filter((a) => normalizePlatform(a.platform ?? '') !== platform);
      break;
    }

    case 'change_frequency': {
      const platform = normalizePlatform(command.platform);
      const content_type = (command.content_type ?? 'post').toLowerCase().trim();
      if (allowed.size > 0 && !allowed.has(`${platform}|${content_type}`)) {
        throw new PlannerCommandValidationError(
          `Platform "${platform}" with content type "${content_type}" is not configured. Cannot change frequency.`
        );
      }
      const targetFreq = Math.max(0, Math.min(14, command.frequency));

      const matching = activities.filter(
        (a) =>
          normalizePlatform(a.platform ?? '') === platform &&
          (a.content_type ?? 'post').toLowerCase() === content_type
      );
      const currentPerWeek = new Map<number, number>();
      for (const a of matching) {
        const wn = a.week_number ?? 1;
        currentPerWeek.set(wn, (currentPerWeek.get(wn) ?? 0) + 1);
      }

      if (targetFreq === 0) {
        activities = activities.filter((a) => !matching.includes(a));
      } else {
        const toKeep = new Set(matching.map((a) => a.execution_id));
        const byWeek = new Map<number, PlannerCalendarActivity[]>();
        for (const a of matching) {
          const wn = a.week_number ?? 1;
          if (!byWeek.has(wn)) byWeek.set(wn, []);
          byWeek.get(wn)!.push(a);
        }

        let kept = 0;
        const newActivities = activities.filter((a) => !toKeep.has(a.execution_id ?? ''));
        for (let w = 1; w <= maxWeek; w++) {
          const weekMatching = byWeek.get(w) ?? [];
          const currentCount = weekMatching.length;
          if (currentCount >= targetFreq) {
            for (let i = 0; i < targetFreq; i++) {
              newActivities.push(weekMatching[i]!);
              kept++;
            }
          } else {
            for (const a of weekMatching) newActivities.push(a);
            kept += weekMatching.length;
            for (let i = currentCount; i < targetFreq; i++) {
              const execId = nextExecutionId(newActivities, `cmd-freq-${platform}-${content_type}`);
              newActivities.push({
                execution_id: execId,
                week_number: w,
                platform,
                content_type,
                title: themeBase,
                theme: themeBase,
                day: DAYS_ORDER[i % DAYS_ORDER.length] ?? 'Monday',
              });
            }
          }
        }
        activities = newActivities;
      }
      break;
    }

    case 'move_activity': {
      const platform = normalizePlatform(command.platform);
      const content_type = (command.content_type ?? 'post').toLowerCase().trim();
      const day = normalizeDay(command.day);

      activities = activities.map((a) => {
        if (
          normalizePlatform(a.platform ?? '') === platform &&
          (a.content_type ?? 'post').toLowerCase() === content_type
        ) {
          return { ...a, day };
        }
        return a;
      });
      break;
    }

    case 'delete_activity': {
      const id = String(command.execution_id ?? '').trim();
      if (id) {
        activities = activities.filter((a) => a.execution_id !== id);
      }
      break;
    }
  }

  const { days, weeks } = rebuildFromActivities(activities);
  return {
    weeks: calendar_plan.weeks?.length ? weeks : undefined,
    days,
    activities,
  };
}

/**
 * Apply multiple planner commands in sequence.
 */
export function applyPlannerCommands(
  commands: PlannerCommand[],
  calendar_plan: PlannerCalendarPlan,
  platform_content_requests?: Record<string, Record<string, number>> | null
): PlannerCalendarPlan {
  let plan = calendar_plan;
  for (const cmd of commands) {
    plan = applyPlannerCommand(cmd, plan, platform_content_requests);
  }
  return plan;
}
