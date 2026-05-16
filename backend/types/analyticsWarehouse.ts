export const WAREHOUSE_FACT_KINDS = [
  'opportunity_daily',
  'source_roi_daily',
  'escalation_daily',
  'execution_daily',
  'moderation_daily',
  'cost_daily',
  'sla_daily',
] as const;
export type WarehouseFactKind = (typeof WAREHOUSE_FACT_KINDS)[number];

export const MATERIALIZATION_STATUSES = ['complete', 'partial', 'failed'] as const;
export type MaterializationStatus = (typeof MATERIALIZATION_STATUSES)[number];

export const WAREHOUSE_DEFAULT_LOOKBACK_DAYS = 30 as const;
export const WAREHOUSE_MAX_WINDOW_DAYS = 365 as const;

export type AnalyticsWarehouseFact = {
  id: string;
  organization_id: string;
  fact_kind: WarehouseFactKind;
  bucket_start: string;
  bucket_end: string;
  dimensions: Record<string, string | number | null>;
  measures: Record<string, number>;
  materialization_id: string | null;
  created_at: string;
};

export type AnalyticsMaterialization = {
  id: string;
  organization_id: string;
  fact_kind: WarehouseFactKind;
  window_start: string;
  window_end: string;
  rows_written: number;
  status: MaterializationStatus;
  detail: string | null;
  initiated_by: string | null;
  created_at: string;
};
