/**
 * Mastery proficiency levels — deterministic thresholds over a 0..100 score.
 * Category proficiency and Overall Mastery both derive from these bands (no
 * activity/click/page-view input; the score is produced by the shared engine
 * from adoption factors). Pure + deterministic; no UI logic.
 */

export type MasteryLevel = 'not_started' | 'learning' | 'active' | 'advanced' | 'expert';

export interface MasteryLevelInfo {
  level: MasteryLevel;
  label: string;
}

/** Map a 0..100 percent to a proficiency band. Boundaries are fixed + deterministic. */
export function masteryLevel(percent: number): MasteryLevelInfo {
  const p = Number.isFinite(percent) ? percent : 0;
  if (p <= 0) return { level: 'not_started', label: 'Not started' };
  if (p < 25) return { level: 'learning', label: 'Learning' };
  if (p < 50) return { level: 'active', label: 'Active' };
  if (p < 80) return { level: 'advanced', label: 'Advanced' };
  return { level: 'expert', label: 'Expert' };
}
