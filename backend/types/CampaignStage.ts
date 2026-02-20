/**
 * Campaign workflow stages in execution order.
 * planning → twelve_week_plan → daily_plan → charting → schedule
 */
export type CampaignStage =
  | 'planning'
  | 'twelve_week_plan'
  | 'daily_plan'
  | 'charting'   // social media alignment
  | 'schedule';

export const CAMPAIGN_STAGES: readonly CampaignStage[] = [
  'planning',
  'twelve_week_plan',
  'daily_plan',
  'charting',
  'schedule',
] as const;

export const STAGE_LABELS: Record<CampaignStage, string> = {
  planning: 'Planning',
  twelve_week_plan: 'Week Plan', // Base label; use getStageLabelWithDuration for "# Week Plan"
  daily_plan: 'Daily Plan',
  charting: 'Charting (Social Media Alignment)',
  schedule: 'Schedule',
};

/** Tailwind gradient classes for stage badges (e.g. bg-gradient-to-r) */
export const STAGE_GRADIENT: Record<CampaignStage, string> = {
  planning: 'from-blue-500 to-cyan-600',
  twelve_week_plan: 'from-indigo-500 to-purple-600',
  daily_plan: 'from-amber-500 to-orange-600',
  charting: 'from-teal-500 to-emerald-600',
  schedule: 'from-green-500 to-emerald-600',
};

export function getStageGradient(stage: string): string {
  return STAGE_GRADIENT[stage as CampaignStage] ?? 'from-gray-500 to-slate-600';
}

export function getStageLabel(stage: string): string {
  return STAGE_LABELS[stage as CampaignStage] ?? (stage?.charAt(0)?.toUpperCase() + (stage ?? '').slice(1)) ?? 'Planning';
}

/** Returns "# Week Plan" when stage is twelve_week_plan and duration is known; otherwise base label. */
export function getStageLabelWithDuration(stage: string, durationWeeks?: number | null): string {
  if (stage === 'twelve_week_plan' && typeof durationWeeks === 'number' && durationWeeks > 0) {
    return `${durationWeeks} Week Plan`;
  }
  return getStageLabel(stage);
}
