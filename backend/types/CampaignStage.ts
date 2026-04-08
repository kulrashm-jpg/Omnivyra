/**
 * Campaign workflow stages in execution order.
 * planning → week_plan → daily_plan → schedule
 *
 * Legacy: 'twelve_week_plan' is kept for backward compatibility with existing DB records.
 */
export type CampaignStage =
  | 'planning'
  | 'week_plan'
  | 'twelve_week_plan' // legacy alias — treat same as 'week_plan'
  | 'daily_plan'
  | 'schedule';

export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
  'planning',
  'week_plan',
  'daily_plan',
  'schedule',
] as const;

export const STAGE_LABELS: Record<CampaignStage, string> = {
  planning: 'Planning',
  week_plan: 'Week Plan', // Base label; use getStageLabelWithDuration for "# Week Plan"
  twelve_week_plan: 'Week Plan', // legacy alias
  daily_plan: 'Daily Plan',
  schedule: 'Schedule',
};

/** Tailwind gradient classes for stage badges (e.g. bg-gradient-to-r) */
export const STAGE_GRADIENT: Record<CampaignStage, string> = {
  planning: 'from-blue-500 to-cyan-600',
  week_plan: 'from-indigo-500 to-purple-600',
  twelve_week_plan: 'from-indigo-500 to-purple-600', // legacy alias
  daily_plan: 'from-amber-500 to-orange-600',
  schedule: 'from-green-500 to-emerald-600',
};

/** Returns true if the stage is a week-plan stage (current or legacy). */
export function isWeekPlanStage(stage: string): boolean {
  return stage === 'week_plan' || stage === 'twelve_week_plan';
}

export function getStageGradient(stage: string): string {
  return STAGE_GRADIENT[stage as CampaignStage] ?? 'from-gray-500 to-slate-600';
}

export function getStageLabel(stage: string): string {
  // Map legacy 'charting' stage to 'schedule' silently
  if (stage === 'charting') return STAGE_LABELS.schedule;
  const known = STAGE_LABELS[stage as CampaignStage];
  if (known) return known;
  const s = String(stage || '').trim();
  if (!s) return 'Planning';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Returns "# Week Plan" when stage is a week-plan stage and duration is known; otherwise base label. */
export function getStageLabelWithDuration(stage: string, durationWeeks?: number | null): string {
  if (isWeekPlanStage(stage) && typeof durationWeeks === 'number' && durationWeeks > 0) {
    return `${durationWeeks} Week Plan`;
  }
  return getStageLabel(stage);
}
