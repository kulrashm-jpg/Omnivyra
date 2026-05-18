/**
 * Strategy domain — audience (Phase-2 Step-5).
 */

export interface StrategyAudienceSegment {
  id: string;
  label: string;
  description?: string;
  pains?: string[];
  goals?: string[];
  channels?: string[];
}

export interface StrategyAudience {
  /** Primary audience as a single descriptive string (legacy-compatible). */
  primary: string;
  segments: StrategyAudienceSegment[];
}
