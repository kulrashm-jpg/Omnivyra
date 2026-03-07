/**
 * Weekly Activity Adapter — Flatten execution_items to card-ready activities
 *
 * Reads execution_items[].topic_slots[] and produces WeeklyActivity[] for the
 * Phase 3 weekly card board. Applies schedule defaults when fields are missing.
 */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_SCHEDULED_TIME = '09:00';

export interface WeeklyActivity {
  content_code: string;
  topic_code: string;
  topic: string;
  platform: string;
  content_type: string;
  execution_mode?: string;
  scheduled_day: number;
  scheduled_day_name: string;
  scheduled_time: string;
  repurpose_index?: number;
  repurpose_total?: number;
  execution_id?: string;
  week_number?: number;
  raw_slot: Record<string, unknown>;
}

function normalizeContentType(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 'post';
  return s;
}

function normalizePlatform(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 'linkedin';
  if (s === 'x') return 'twitter';
  return s;
}

/**
 * Flatten execution_items[].topic_slots[] into WeeklyActivity[].
 * Uses topic_code, content_code, scheduled_day, scheduled_time from slot.
 * Applies defaults: scheduled_day from day_index or round-robin; scheduled_time = "09:00".
 */
export function buildWeeklyActivitiesFromExecutionItems(
  week: Record<string, unknown> | null | undefined
): WeeklyActivity[] {
  const safe = week && typeof week === 'object' ? week : {};
  const execItems = Array.isArray((safe as any).execution_items)
    ? (safe as any).execution_items
    : [];
  const weekNumber = Number((safe as any).week ?? (safe as any).week_number ?? 0) || 0;

  const activities: WeeklyActivity[] = [];
  let slotIndex = 0;

  for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
    const exec = execItems[execIdx];
    if (!exec || typeof exec !== 'object') continue;

    const slots = Array.isArray(exec.topic_slots) ? exec.topic_slots : [];
    const platforms: string[] = Array.isArray(exec.selected_platforms)
      ? exec.selected_platforms.map((p: unknown) => normalizePlatform(p))
      : ['linkedin'];
    const primaryPlatform = platforms[0] ?? 'linkedin';
    const contentType = normalizeContentType(exec.content_type ?? 'post');

    for (let s = 0; s < slots.length; s += 1) {
      const slot = slots[s];
      if (!slot || typeof slot !== 'object') continue;

      const topic = String((slot as any).topic ?? '').trim() || 'Untitled';
      const topicCode = String((slot as any).topic_code ?? '').trim() || `T${execIdx + 1}`;
      const contentCode =
        String((slot as any).content_code ?? '').trim() || `${topicCode}${s + 1}`;
      const scheduledDayRaw = (slot as any).scheduled_day ?? (slot as any).day_index;
      const scheduledDay =
        Number.isFinite(scheduledDayRaw) && scheduledDayRaw >= 1 && scheduledDayRaw <= 7
          ? Math.floor(Number(scheduledDayRaw))
          : ((slotIndex % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
      const scheduledTime =
        typeof (slot as any).scheduled_time === 'string' &&
        (slot as any).scheduled_time.trim()
          ? String((slot as any).scheduled_time).trim()
          : DEFAULT_SCHEDULED_TIME;
      const repurposeIndex = Number.isFinite((slot as any).repurpose_index)
        ? Math.floor(Number((slot as any).repurpose_index))
        : undefined;
      const repurposeTotal = Number.isFinite((slot as any).repurpose_total)
        ? Math.floor(Number((slot as any).repurpose_total))
        : undefined;

      activities.push({
        content_code: contentCode,
        topic_code: topicCode,
        topic,
        platform: primaryPlatform,
        content_type: contentType,
        execution_mode:
          typeof (slot as any).execution_mode === 'string'
            ? (slot as any).execution_mode
            : undefined,
        scheduled_day: scheduledDay,
        scheduled_day_name: DAY_NAMES[scheduledDay - 1] ?? String(scheduledDay),
        scheduled_time: scheduledTime,
        repurpose_index: repurposeIndex,
        repurpose_total: repurposeTotal,
        execution_id: `wk${weekNumber}-${contentCode}`,
        week_number: weekNumber || undefined,
        raw_slot: slot as Record<string, unknown>,
      });
      slotIndex += 1;
    }
  }

  return activities;
}
