export const TREND_KINDS = [
  'opportunity_long',
  'competitor_movement',
  'source_quality',
  'moderation_trend',
  'conversion_trend',
  'escalation_pattern',
] as const;
export type TrendKind = (typeof TREND_KINDS)[number];

export const TREND_WINDOW_KINDS = ['30d', '90d', '180d', '365d'] as const;
export type TrendWindowKind = (typeof TREND_WINDOW_KINDS)[number];

export const TREND_WINDOW_DAYS: Record<TrendWindowKind, number> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};

export type TrendSeriesPoint = {
  bucket: string;
  value: number;
  components?: Record<string, number>;
};

export type IntelligenceTrendAggregation = {
  id: string;
  organization_id: string;
  trend_kind: TrendKind;
  window_kind: TrendWindowKind;
  window_start: string;
  window_end: string;
  dimensions: Record<string, string | number | null>;
  series: TrendSeriesPoint[];
  derivation_explanation: string | null;
  initiated_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
