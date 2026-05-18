/**
 * Strategy domain — messaging (Phase-2 Step-5).
 */

export interface StrategyMessagingPillar {
  id: string;
  message: string;
  supporting_points?: string[];
  cta?: string;
  /** Optional link to a content pillar id. */
  content_pillar_id?: string | null;
}

export interface StrategyContentPillar {
  id: string;
  label: string;
  description?: string;
}
