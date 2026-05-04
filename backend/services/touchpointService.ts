import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  createLastTouchAttributionsForRevenueTouchpoints,
  type AttributionProcessingResult,
} from './attributionService';
import { handleTouchpointsCreated, type ExpectedEventTouchpoint } from './expectedEventEngine';
import { logger } from './logger';
import { reconcileAfterTouchpointsCreated, type ReconciliationResult } from './reconciliationService';
import { normalizeSource, type UnifiedSource } from './sourceNormalizationService';

const TOUCHPOINT_CONFLICT_TARGET = 'company_id,reference_table,reference_id,touchpoint_type';

export type TouchpointInput = {
  companyId: string;
  unifiedPersonId?: string | null;
  source: string;
  unifiedSource?: UnifiedSource | null;
  touchpointType: string;
  referenceTable: string;
  referenceId: string;
  occurredAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

export type TouchpointWriteResult = {
  attempted: number;
  created: number;
  skipped: number;
  touchpointIds?: string[];
  expectedEventsCreated?: number;
  expectedEventsCompleted?: number;
  expectedEventsMissed?: number;
  attribution?: AttributionProcessingResult;
  reconciliation?: ReconciliationResult;
};

function requireText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${field} is required to create a touchpoint`);
  }
  return normalized;
}

function normalizeOccurredAt(value?: string | Date | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const timestamp = value instanceof Date ? value.toISOString() : String(value).trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error('occurredAt must be a valid timestamp');
  }

  return timestamp;
}

function normalizeMetadata(value?: Record<string, unknown> | null): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('metadata must be an object when provided');
  }
  return value;
}

function toDbPayload(input: TouchpointInput): Record<string, unknown> {
  const source = requireText(input.source, 'source');

  return {
    company_id: requireText(input.companyId, 'companyId'),
    unified_person_id: input.unifiedPersonId ?? null,
    source,
    unified_source: input.unifiedSource ?? normalizeSource(source),
    touchpoint_type: requireText(input.touchpointType, 'touchpointType'),
    reference_table: requireText(input.referenceTable, 'referenceTable'),
    reference_id: requireText(input.referenceId, 'referenceId'),
    occurred_at: normalizeOccurredAt(input.occurredAt),
    metadata: normalizeMetadata(input.metadata),
  };
}

export async function bulkCreateTouchpoints(
  touchpoints: TouchpointInput[],
  context: Record<string, unknown> = {}
): Promise<TouchpointWriteResult> {
  if (touchpoints.length === 0) {
    return { attempted: 0, created: 0, skipped: 0 };
  }

  const payload = touchpoints.map((touchpoint) => toDbPayload(touchpoint));
  const { data, error } = await supabase
    .from('unified_touchpoints')
    .upsert(payload, {
      onConflict: TOUCHPOINT_CONFLICT_TARGET,
      ignoreDuplicates: true,
    })
    .select('id, company_id, unified_person_id, source, unified_source, touchpoint_type, reference_table, reference_id, occurred_at, metadata');

  if (error) {
    throw new Error(`Failed to create unified touchpoints: ${error.message}`);
  }

  const createdTouchpoints = (data ?? []) as ExpectedEventTouchpoint[];
  const created = createdTouchpoints.length;
  const result: TouchpointWriteResult = {
    attempted: payload.length,
    created,
    skipped: payload.length - created,
    touchpointIds: createdTouchpoints.map((touchpoint) => touchpoint.id),
  };

  logger.info('unified_touchpoints_created', {
    ...context,
    attempted: result.attempted,
    created: result.created,
    skipped: result.skipped,
    conflictTarget: TOUCHPOINT_CONFLICT_TARGET,
  });

  if (result.skipped > 0) {
    logger.info('unified_touchpoints_duplicates_skipped', {
      ...context,
      attempted: result.attempted,
      created: result.created,
      skipped: result.skipped,
      conflictTarget: TOUCHPOINT_CONFLICT_TARGET,
    });
  }

  if (created > 0) {
    try {
      const expectedEventResult = await handleTouchpointsCreated(
        createdTouchpoints,
        context
      );
      result.expectedEventsCreated = expectedEventResult.instancesCreated;
      result.expectedEventsCompleted = expectedEventResult.instancesCompleted;
      result.expectedEventsMissed = expectedEventResult.instancesMissed;
    } catch (error) {
      logger.error('expected_event_engine_failed', {
        ...context,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const revenueTouchpoints = createdTouchpoints.filter(
        (touchpoint) => touchpoint.touchpoint_type === 'revenue'
      );
      if (revenueTouchpoints.length > 0) {
        result.attribution = await createLastTouchAttributionsForRevenueTouchpoints(
          revenueTouchpoints,
          context
        );
      }
    } catch (error) {
      logger.error('attribution_processing_failed', {
        ...context,
        touchpointIds: result.touchpointIds ?? [],
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      result.reconciliation = await reconcileAfterTouchpointsCreated({
        touchpointIds: result.touchpointIds ?? [],
        context,
      });
    } catch (error) {
      logger.error('touchpoint_reconciliation_failed', {
        ...context,
        touchpointIds: result.touchpointIds ?? [],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function createTouchpoint(
  touchpoint: TouchpointInput,
  context: Record<string, unknown> = {}
): Promise<TouchpointWriteResult> {
  return bulkCreateTouchpoints([touchpoint], context);
}
