/**
 * Enterprise 3-Panel Execution Layout — types.
 */

export const PANEL_MODES = ['CLOSED', 'SIDE', 'FULLSCREEN'] as const;
export type PanelMode = (typeof PANEL_MODES)[number];

export interface CampaignContextItem {
  id: string;
  name: string;
  /** Optional link (e.g. for navigation) */
  href?: string;
}

export interface ExecutionFilters {
  stage?: string | null;
  owner?: string | null;
  approvalStatus?: string | null;
}

export type CenterViewMode = 'pipeline' | 'radar' | 'portfolio';
