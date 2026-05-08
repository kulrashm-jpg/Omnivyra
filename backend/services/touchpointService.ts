import { supabase } from '../db/supabaseClient';
import { logger } from './logger';
import { normalizeSource, type UnifiedSource } from './sourceNormalizationService';
import { ownedDbTable } from '../db/writeOwner';

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
  const { data, error } = await ownedDbTable('unified_touchpoints')
    .upsert(payload, {
      onConflict: 'company_id,reference_table,reference_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) {
    throw new Error(`Failed to create unified touchpoints: ${error.message}`);
  }

  const created = Array.isArray(data) ? data.length : 0;
  const result = {
    attempted: payload.length,
    created,
    skipped: payload.length - created,
  };

  logger.info('unified_touchpoints_created', {
    ...context,
    attempted: result.attempted,
    created: result.created,
    skipped: result.skipped,
  });

  return result;
}

export async function createTouchpoint(
  touchpoint: TouchpointInput,
  context: Record<string, unknown> = {}
): Promise<TouchpointWriteResult> {
  return bulkCreateTouchpoints([touchpoint], context);
}
