/**
 * Phase 9 — Multi-region readiness.
 *
 * Per-tenant region routing configuration. Phase 9 ships READS + WRITES
 * only — no autonomous failover. A multi-region runtime would consult
 * `region_routing` to pick the right partition; the failover decision
 * remains an explicit operator action (`failover_strategy = 'manual' |
 * 'operator_approved'`).
 *
 * Hard guarantees:
 *   • One routing row per organization (UNIQUE).
 *   • No autonomous failover. Strategy is descriptive metadata.
 *   • Tenant-first reads.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  DEFAULT_PRIMARY_REGION,
  type RegionFailoverStrategy,
  type RegionRouting,
} from '../types/regionRouting';

export async function getRegionRouting(organizationId: string): Promise<RegionRouting | null> {
  const { data } = await ownedDbTable('region_routing')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();
  return (data as RegionRouting | null) ?? null;
}

export type UpsertRegionRoutingInput = {
  organizationId: string;
  primaryRegion?: string;
  failoverRegion?: string | null;
  partitionRouting?: Record<string, string>;
  failoverStrategy?: RegionFailoverStrategy;
  metadata?: Record<string, unknown>;
  updatedBy: string | null;
};

export async function upsertRegionRouting(input: UpsertRegionRoutingInput): Promise<RegionRouting> {
  const existing = await getRegionRouting(input.organizationId);
  const payload = {
    primary_region: input.primaryRegion ?? existing?.primary_region ?? DEFAULT_PRIMARY_REGION,
    failover_region: typeof input.failoverRegion !== 'undefined' ? input.failoverRegion : (existing?.failover_region ?? null),
    partition_routing: input.partitionRouting ?? existing?.partition_routing ?? {},
    failover_strategy: input.failoverStrategy ?? existing?.failover_strategy ?? 'manual',
    metadata: input.metadata ?? existing?.metadata ?? {},
    updated_by: input.updatedBy,
  };

  if (existing) {
    const upd = await ownedDbTable('region_routing')
      .update(payload)
      .eq('organization_id', input.organizationId)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`region_routing_update_failed:${upd.error?.message ?? 'unknown'}`);
    return upd.data as RegionRouting;
  }

  const ins = await ownedDbTable('region_routing')
    .insert({ organization_id: input.organizationId, ...payload })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`region_routing_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as RegionRouting;
}
