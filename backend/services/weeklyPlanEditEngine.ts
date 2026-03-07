/**
 * Weekly Plan Edit Engine — AI-assisted schedule edits using content codes
 *
 * Modifies existing weekly plans (execution_items[].topic_slots[]) based on
 * structured edit operations. Does NOT modify weeklyScheduleAllocator.
 *
 * Phase 4: Edit existing schedules only.
 */

import type { EditOperation } from './weeklyPlanCommandParser';

const DEFAULT_SCHEDULED_TIME = '09:00';
const MAX_ACTIVITIES_PER_DAY = 3;
const MIN_DAYS_BETWEEN_SAME_TOPIC = 1;

type SlotRef = { execIdx: number; slotIdx: number; slot: Record<string, unknown> };
type PlanWeek = Record<string, unknown>;

function getSlotsByContentCode(week: PlanWeek): Map<string, SlotRef> {
  const map = new Map<string, SlotRef>();
  const execItems = Array.isArray((week as any).execution_items)
    ? (week as any).execution_items
    : [];
  for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
    const slots = Array.isArray(execItems[execIdx]?.topic_slots)
      ? execItems[execIdx].topic_slots
      : [];
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
      const slot = slots[slotIdx];
      if (!slot || typeof slot !== 'object') continue;
      const code = String((slot as any).content_code ?? '').trim().toUpperCase();
      if (code) map.set(code, { execIdx, slotIdx, slot: slot as Record<string, unknown> });
    }
  }
  return map;
}

function getAllSlots(week: PlanWeek): SlotRef[] {
  const arr: SlotRef[] = [];
  const execItems = Array.isArray((week as any).execution_items)
    ? (week as any).execution_items
    : [];
  for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
    const slots = Array.isArray(execItems[execIdx]?.topic_slots)
      ? execItems[execIdx].topic_slots
      : [];
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
      const slot = slots[slotIdx];
      if (slot && typeof slot === 'object') {
        arr.push({ execIdx, slotIdx, slot: slot as Record<string, unknown> });
      }
    }
  }
  return arr;
}

function clampDay(day: number): number {
  return Math.max(1, Math.min(7, Math.floor(day)));
}

function countByDay(week: PlanWeek): Map<number, number> {
  const byDay = new Map<number, number>();
  for (let d = 1; d <= 7; d += 1) byDay.set(d, 0);
  for (const { slot } of getAllSlots(week)) {
    const d = Number((slot as any).scheduled_day ?? (slot as any).day_index);
    if (d >= 1 && d <= 7) byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  return byDay;
}

function getDaysUsedByTopic(week: PlanWeek, excludeSlot: SlotRef | null): Map<string, number[]> {
  const byTopic = new Map<string, number[]>();
  const topicCode = (s: Record<string, unknown>) =>
    String((s as any).topic_code ?? '').trim().toUpperCase();
  for (const { slot } of getAllSlots(week)) {
    if (excludeSlot && slot === excludeSlot.slot) continue;
    const tc = topicCode(slot);
    if (!tc) continue;
    const d = Number((slot as any).scheduled_day ?? (slot as any).day_index);
    if (d >= 1 && d <= 7) {
      const arr = byTopic.get(tc) ?? [];
      arr.push(d);
      byTopic.set(tc, arr);
    }
  }
  return byTopic;
}

/** Find next available day satisfying: not over capacity, same-topic spacing. */
function findNextAvailableDay(
  week: PlanWeek,
  topicCode: string,
  excludeContentCode?: string
): number {
  const byDay = countByDay(week);
  const topicDays = Array.from(getDaysUsedByTopic(week, null).get(topicCode) ?? []);

  for (let d = 1; d <= 7; d += 1) {
    const count = byDay.get(d) ?? 0;
    if (count >= MAX_ACTIVITIES_PER_DAY) continue;
    const tooClose = topicDays.some(
      (td) => Math.abs(td - d) < MIN_DAYS_BETWEEN_SAME_TOPIC
    );
    if (tooClose) continue;
    return d;
  }
  return 1;
}

function recomputeRepurposeForTopic(
  week: PlanWeek,
  topicCode: string
): void {
  const execItems = Array.isArray((week as any).execution_items)
    ? (week as any).execution_items
    : [];
  const slotsForTopic: SlotRef[] = [];
  for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
    const slots = Array.isArray(execItems[execIdx]?.topic_slots)
      ? execItems[execIdx].topic_slots
      : [];
    for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
      const slot = slots[slotIdx];
      if (!slot || typeof slot !== 'object') continue;
      const tc = String((slot as any).topic_code ?? '').trim().toUpperCase();
      if (tc === topicCode) {
        slotsForTopic.push({ execIdx, slotIdx, slot: slot as Record<string, unknown> });
      }
    }
  }
  const total = slotsForTopic.length;
  slotsForTopic.forEach(({ slot }, i) => {
    (slot as any).repurpose_index = i + 1;
    (slot as any).repurpose_total = total;
  });
}

export interface ApplyEditsResult {
  success: boolean;
  week: PlanWeek;
  applied: number;
  errors: string[];
}

/**
 * Apply edit operations to a plan week. Mutates week in place.
 * Validation: max 3/day, same-topic spacing >= 1 day, scheduled_day 1-7.
 */
export function applyWeeklyPlanEdits(
  planWeek: PlanWeek,
  editInstructions: EditOperation[]
): ApplyEditsResult {
  const errors: string[] = [];
  let applied = 0;
  const week = planWeek;
  const byCode = getSlotsByContentCode(week);
  const execItems = Array.isArray((week as any).execution_items)
    ? (week as any).execution_items
    : [];

  for (const op of editInstructions) {
    if (op.type === 'move') {
      const ref = byCode.get(op.content_code.toUpperCase());
      if (!ref) {
        errors.push(`Activity ${op.content_code} not found`);
        continue;
      }
      const day = clampDay(op.day);
      const byDay = countByDay(week);
      const current = byDay.get(day) ?? 0;
      const oldDay = Number((ref.slot as any).scheduled_day ?? (ref.slot as any).day_index);
      const wouldExceed = oldDay !== day && current >= MAX_ACTIVITIES_PER_DAY;
      if (wouldExceed) {
        const altDay = findNextAvailableDay(
          week,
          String((ref.slot as any).topic_code ?? '').trim(),
          op.content_code
        );
        (ref.slot as any).scheduled_day = altDay;
        (ref.slot as any).day_index = altDay;
      } else {
        (ref.slot as any).scheduled_day = day;
        (ref.slot as any).day_index = day;
      }
      (ref.slot as any).scheduled_time = op.time || DEFAULT_SCHEDULED_TIME;
      applied += 1;
      continue;
    }

    if (op.type === 'swap') {
      const refA = byCode.get(op.content_code_a.toUpperCase());
      const refB = byCode.get(op.content_code_b.toUpperCase());
      if (!refA) {
        errors.push(`Activity ${op.content_code_a} not found`);
        continue;
      }
      if (!refB) {
        errors.push(`Activity ${op.content_code_b} not found`);
        continue;
      }
      const dayA = Number((refA.slot as any).scheduled_day ?? (refA.slot as any).day_index);
      const dayB = Number((refB.slot as any).scheduled_day ?? (refB.slot as any).day_index);
      const timeA = String((refA.slot as any).scheduled_time ?? DEFAULT_SCHEDULED_TIME);
      const timeB = String((refB.slot as any).scheduled_time ?? DEFAULT_SCHEDULED_TIME);
      (refA.slot as any).scheduled_day = dayB;
      (refA.slot as any).day_index = dayB;
      (refA.slot as any).scheduled_time = timeB;
      (refB.slot as any).scheduled_day = dayA;
      (refB.slot as any).day_index = dayA;
      (refB.slot as any).scheduled_time = timeA;
      applied += 1;
      continue;
    }

    if (op.type === 'delay') {
      const ref = byCode.get(op.content_code.toUpperCase());
      if (!ref) {
        errors.push(`Activity ${op.content_code} not found`);
        continue;
      }
      const currentDay = Number((ref.slot as any).scheduled_day ?? (ref.slot as any).day_index) || 1;
      const newDay = clampDay(currentDay + (op.days || 1));
      (ref.slot as any).scheduled_day = newDay;
      (ref.slot as any).day_index = newDay;
      applied += 1;
      continue;
    }

    if (op.type === 'advance') {
      const ref = byCode.get(op.content_code.toUpperCase());
      if (!ref) {
        errors.push(`Activity ${op.content_code} not found`);
        continue;
      }
      const currentDay = Number((ref.slot as any).scheduled_day ?? (ref.slot as any).day_index) || 1;
      const newDay = clampDay(currentDay - (op.days || 1));
      (ref.slot as any).scheduled_day = newDay;
      (ref.slot as any).day_index = newDay;
      applied += 1;
      continue;
    }

    if (op.type === 'delete') {
      const ref = byCode.get(op.content_code.toUpperCase());
      if (!ref) {
        errors.push(`Activity ${op.content_code} not found`);
        continue;
      }
      const topicCode = String((ref.slot as any).topic_code ?? '').trim().toUpperCase();
      const slots = execItems[ref.execIdx]?.topic_slots;
      if (Array.isArray(slots)) {
        slots.splice(ref.slotIdx, 1);
        byCode.delete(op.content_code.toUpperCase());
        recomputeRepurposeForTopic(week, topicCode);
        applied += 1;
      }
      continue;
    }

    if (op.type === 'add') {
      const topicCode = op.topic_code.toUpperCase();
      let targetExecIdx = -1;
      let templateSlot: Record<string, unknown> | null = null;
      let maxContentNum = 0;

      for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
        const slots = Array.isArray(execItems[execIdx]?.topic_slots)
          ? execItems[execIdx].topic_slots
          : [];
        for (const slot of slots) {
          if (!slot || typeof slot !== 'object') continue;
          const tc = String((slot as any).topic_code ?? '').trim().toUpperCase();
          if (tc !== topicCode) continue;
          targetExecIdx = execIdx;
          templateSlot = slot as Record<string, unknown>;
          const code = String((slot as any).content_code ?? '').trim();
          const numMatch = code.match(/(\d+)$/);
          if (numMatch) {
            const n = parseInt(numMatch[1]!, 10);
            if (n > maxContentNum) maxContentNum = n;
          }
        }
      }

      if (targetExecIdx < 0 || !templateSlot) {
        errors.push(`Topic ${topicCode} not found`);
        continue;
      }

      const newContentCode = `${topicCode}${maxContentNum + 1}`;
      const nextDay = findNextAvailableDay(week, topicCode);
      const exec = execItems[targetExecIdx];
      const slots = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      const newSlot: Record<string, unknown> = {
        ...templateSlot,
        content_code: newContentCode,
        scheduled_day: nextDay,
        scheduled_time: DEFAULT_SCHEDULED_TIME,
        day_index: nextDay,
        repurpose_index: slots.length + 1,
        repurpose_total: slots.length + 1,
      };
      if (op.platform) (newSlot as any).platform = op.platform;
      if (op.content_type) (newSlot as any).content_type = op.content_type;
      slots.push(newSlot);
      (exec as any).topic_slots = slots;
      recomputeRepurposeForTopic(week, topicCode);
      applied += 1;
    }
  }

  return {
    success: applied > 0,
    week,
    applied,
    errors,
  };
}
