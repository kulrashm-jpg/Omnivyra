import type React from 'react';
import type { DailyPlan } from './types';

export function handleDailyPlanDragStart(e: React.DragEvent, planId: string, dayOfWeek: string) {
  e.dataTransfer.setData('application/json', JSON.stringify({ planId, dayOfWeek }));
  e.dataTransfer.effectAllowed = 'move';
}

export function handleDailyPlanDragOver(e: React.DragEvent) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

export function buildDroppedWeekPlans(
  weekNumber: number,
  targetDay: string,
  dragPayload: { planId: string; dayOfWeek: string },
  editedWeekDailyPlans: Record<number, DailyPlan[]>,
  dailyPlans: DailyPlan[]
) {
  const { planId, dayOfWeek: sourceDay } = dragPayload;
  if (!planId || sourceDay === targetDay) return null;
  const weekList = editedWeekDailyPlans[weekNumber] ?? dailyPlans.filter((day) => day.weekNumber === weekNumber);
  return weekList.map((plan) => (plan.id === planId ? { ...plan, dayOfWeek: targetDay } : plan));
}

export function toggleExpandedKey(current: Set<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
