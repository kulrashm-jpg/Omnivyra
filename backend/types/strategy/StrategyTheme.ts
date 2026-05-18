/**
 * Strategy domain — campaign theme (Phase-2 Step-5).
 * Superset of the planner StrategicThemeEntry + orchestration linkage.
 */

export interface StrategyTheme {
  id: string;
  week?: number;
  title: string;
  phase_label?: string;
  objective?: string;
  content_focus?: string;
  cta_focus?: string;
  /** Linkage into the strategy model. */
  content_pillar_id?: string | null;
  messaging_pillar_id?: string | null;
}
