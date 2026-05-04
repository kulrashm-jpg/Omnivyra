import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import type { ExpectedEventTouchpoint } from './expectedEventEngine';
import { logger } from './logger';

const ATTRIBUTION_CONFLICT_TARGET = 'revenue_touchpoint_id';

type RevenueTouchpoint = Pick<
  ExpectedEventTouchpoint,
  'id' | 'company_id' | 'unified_person_id' | 'touchpoint_type' | 'occurred_at'
>;

type PriorTouchpointRow = {
  id: string;
  touchpoint_type: string;
  occurred_at: string;
};

type AttributionResultRow = {
  id: string;
  revenue_touchpoint_id: string;
  attributed_touchpoint_id: string;
};

export type AttributionProcessingResult = {
  attempted: number;
  created: number;
  skipped: number;
  skippedNoUnifiedPerson: number;
  skippedNoPriorTouchpoint: number;
  skippedDuplicates: number;
};

async function findLatestPriorTouchpoint(
  revenueTouchpoint: RevenueTouchpoint
): Promise<PriorTouchpointRow | null> {
  if (!revenueTouchpoint.unified_person_id) {
    return null;
  }

  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, touchpoint_type, occurred_at')
    .eq('company_id', revenueTouchpoint.company_id)
    .eq('unified_person_id', revenueTouchpoint.unified_person_id)
    .lt('occurred_at', revenueTouchpoint.occurred_at)
    .neq('touchpoint_type', 'revenue')
    .order('occurred_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to find latest prior touchpoint: ${error.message}`);
  }

  return ((data ?? []) as PriorTouchpointRow[])[0] ?? null;
}

export async function createLastTouchAttributionsForRevenueTouchpoints(
  touchpoints: RevenueTouchpoint[],
  context: Record<string, unknown> = {}
): Promise<AttributionProcessingResult> {
  const revenueTouchpoints = touchpoints.filter(
    (touchpoint) => touchpoint.touchpoint_type === 'revenue'
  );
  const rows: Array<Record<string, unknown>> = [];
  let skippedNoUnifiedPerson = 0;
  let skippedNoPriorTouchpoint = 0;

  for (const revenueTouchpoint of revenueTouchpoints) {
    const unifiedPersonId = revenueTouchpoint.unified_person_id;
    if (!unifiedPersonId) {
      skippedNoUnifiedPerson += 1;
      logger.info('attribution_skipped', {
        ...context,
        reason: 'no_unified_person_id',
        revenueTouchpointId: revenueTouchpoint.id,
        companyId: revenueTouchpoint.company_id,
        attributionType: 'last_touch',
      });
      continue;
    }

    const priorTouchpoint = await findLatestPriorTouchpoint(revenueTouchpoint);
    if (!priorTouchpoint) {
      skippedNoPriorTouchpoint += 1;
      logger.info('attribution_skipped', {
        ...context,
        reason: 'no_prior_touchpoint',
        revenueTouchpointId: revenueTouchpoint.id,
        companyId: revenueTouchpoint.company_id,
        unifiedPersonId,
        attributionType: 'last_touch',
      });
      continue;
    }

    rows.push({
      company_id: revenueTouchpoint.company_id,
      unified_person_id: unifiedPersonId,
      revenue_touchpoint_id: revenueTouchpoint.id,
      attributed_touchpoint_id: priorTouchpoint.id,
      attribution_type: 'last_touch',
    });
  }

  if (rows.length === 0) {
    return {
      attempted: revenueTouchpoints.length,
      created: 0,
      skipped: revenueTouchpoints.length,
      skippedNoUnifiedPerson,
      skippedNoPriorTouchpoint,
      skippedDuplicates: 0,
    };
  }

  const { data, error } = await supabase
    .from('attribution_results')
    .upsert(rows, {
      onConflict: ATTRIBUTION_CONFLICT_TARGET,
      ignoreDuplicates: true,
    })
    .select('id, revenue_touchpoint_id, attributed_touchpoint_id');

  if (error) {
    throw new Error(`Failed to create last-touch attribution: ${error.message}`);
  }

  const createdRows = (data ?? []) as AttributionResultRow[];
  const created = createdRows.length;
  const skippedDuplicates = rows.length - created;

  for (const row of createdRows) {
    logger.info('attribution_created', {
      ...context,
      attributionResultId: row.id,
      revenueTouchpointId: row.revenue_touchpoint_id,
      attributedTouchpointId: row.attributed_touchpoint_id,
      attributionType: 'last_touch',
    });
  }

  if (skippedDuplicates > 0) {
    logger.info('attribution_skipped', {
      ...context,
      reason: 'duplicate_revenue_touchpoint',
      skipped: skippedDuplicates,
      conflictTarget: ATTRIBUTION_CONFLICT_TARGET,
      attributionType: 'last_touch',
    });
  }

  return {
    attempted: revenueTouchpoints.length,
    created,
    skipped: skippedNoUnifiedPerson + skippedNoPriorTouchpoint + skippedDuplicates,
    skippedNoUnifiedPerson,
    skippedNoPriorTouchpoint,
    skippedDuplicates,
  };
}
