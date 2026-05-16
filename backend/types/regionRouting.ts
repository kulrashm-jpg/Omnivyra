export const REGION_FAILOVER_STRATEGIES = ['manual', 'operator_approved'] as const;
export type RegionFailoverStrategy = (typeof REGION_FAILOVER_STRATEGIES)[number];

export const DEFAULT_PRIMARY_REGION = 'us-east-1' as const;

export type RegionRouting = {
  id: string;
  organization_id: string;
  primary_region: string;
  failover_region: string | null;
  partition_routing: Record<string, string>;
  failover_strategy: RegionFailoverStrategy;
  metadata: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};
