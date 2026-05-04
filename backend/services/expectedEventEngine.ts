import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  detectIntelligenceGaps,
  resolveIntelligenceGapsForExpectedEvents,
} from './gapDetectionService';
import { logger } from './logger';
import type { UnifiedSource } from './sourceNormalizationService';

export type ExpectedEventTouchpoint = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  source: string;
  unified_source: UnifiedSource | Record<string, unknown> | null;
  touchpoint_type: string;
  reference_table: string;
  reference_id: string;
  occurred_at: string;
  metadata?: Record<string, unknown> | null;
};

type ExpectedEventDefinitionRow = {
  id: string;
  company_id: string | null;
  source_provider: string;
  trigger_event_type: string;
  expected_event_type: string;
  max_delay_hours: number;
  is_required: boolean;
};

type ExpectedEventInstanceRow = {
  id: string;
};

export type ExpectedEventEngineResult = {
  instancesCreated: number;
  instancesCompleted: number;
  instancesMissed: number;
};

export type ExpectedEventFeedbackCompletionResult = {
  instancesCompleted: number;
  gapsResolved: number;
};

function sourceProviderForTouchpoint(touchpoint: ExpectedEventTouchpoint): string {
  const provider =
    touchpoint.unified_source &&
    typeof touchpoint.unified_source === 'object' &&
    'provider' in touchpoint.unified_source
      ? String((touchpoint.unified_source as Record<string, unknown>).provider ?? '')
      : '';

  return provider.trim().toLowerCase() || touchpoint.source.trim().toLowerCase();
}

function dueAtFromTouchpoint(touchpoint: ExpectedEventTouchpoint, maxDelayHours: number): string {
  const base = Date.parse(touchpoint.occurred_at);
  if (Number.isNaN(base)) {
    throw new Error(`Touchpoint ${touchpoint.id} has invalid occurred_at`);
  }

  return new Date(base + maxDelayHours * 60 * 60 * 1000).toISOString();
}

async function loadDefinitionsForTouchpoint(
  touchpoint: ExpectedEventTouchpoint
): Promise<ExpectedEventDefinitionRow[]> {
  const provider = sourceProviderForTouchpoint(touchpoint);
  if (!provider) {
    return [];
  }

  const { data, error } = await supabase
    .from('expected_event_definitions')
    .select('id, company_id, source_provider, trigger_event_type, expected_event_type, max_delay_hours, is_required')
    .eq('source_provider', provider)
    .eq('trigger_event_type', touchpoint.touchpoint_type)
    .or(`company_id.is.null,company_id.eq.${touchpoint.company_id}`);

  if (error) {
    throw new Error(`Failed to load expected event definitions: ${error.message}`);
  }

  return (data ?? []) as ExpectedEventDefinitionRow[];
}

async function createExpectedEventInstances(
  touchpoints: ExpectedEventTouchpoint[],
  context: Record<string, unknown>
): Promise<number> {
  const rows: Array<Record<string, unknown>> = [];

  for (const touchpoint of touchpoints) {
    if (!touchpoint.unified_person_id) {
      continue;
    }

    const definitions = await loadDefinitionsForTouchpoint(touchpoint);
    for (const definition of definitions) {
      rows.push({
        company_id: touchpoint.company_id,
        unified_person_id: touchpoint.unified_person_id,
        trigger_touchpoint_id: touchpoint.id,
        expected_event_type: definition.expected_event_type,
        due_at: dueAtFromTouchpoint(touchpoint, definition.max_delay_hours),
        status: 'pending',
      });
    }
  }

  if (rows.length === 0) {
    return 0;
  }

  const { data, error } = await supabase
    .from('expected_event_instances')
    .upsert(rows, {
      onConflict: 'trigger_touchpoint_id,expected_event_type',
      ignoreDuplicates: true,
    })
    .select('id');

  if (error) {
    throw new Error(`Failed to create expected event instances: ${error.message}`);
  }

  const created = Array.isArray(data) ? data.length : 0;
  logger.info('expected_events_created', {
    ...context,
    attempted: rows.length,
    created,
    skipped: rows.length - created,
  });

  return created;
}

async function completePendingExpectedEvents(
  touchpoints: ExpectedEventTouchpoint[],
  context: Record<string, unknown>
): Promise<number> {
  let completed = 0;

  for (const touchpoint of touchpoints) {
    if (!touchpoint.unified_person_id) {
      continue;
    }

    const { data: pending, error: pendingError } = await supabase
      .from('expected_event_instances')
      .select('id')
      .eq('company_id', touchpoint.company_id)
      .eq('unified_person_id', touchpoint.unified_person_id)
      .eq('expected_event_type', touchpoint.touchpoint_type)
      .eq('status', 'pending')
      .gte('due_at', touchpoint.occurred_at)
      .neq('trigger_touchpoint_id', touchpoint.id);

    if (pendingError) {
      throw new Error(`Failed to load pending expected events: ${pendingError.message}`);
    }

    const ids = ((pending ?? []) as ExpectedEventInstanceRow[]).map((row) => row.id);
    if (ids.length === 0) {
      continue;
    }

    const { data, error } = await supabase
      .from('expected_event_instances')
      .update({
        status: 'completed',
        completed_touchpoint_id: touchpoint.id,
      })
      .in('id', ids)
      .select('id');

    if (error) {
      throw new Error(`Failed to complete expected events: ${error.message}`);
    }

    const completedIds = ((data ?? []) as ExpectedEventInstanceRow[]).map((row) => row.id);
    completed += completedIds.length;

    if (completedIds.length > 0) {
      await resolveIntelligenceGapsForExpectedEvents(completedIds);
    }
  }

  if (completed > 0) {
    logger.info('expected_events_completed', {
      ...context,
      completed,
    });
  }

  return completed;
}

export async function evaluateMissedExpectedEvents(params: {
  companyId?: string;
  now?: string | Date;
} = {}): Promise<number> {
  const now = params.now instanceof Date
    ? params.now.toISOString()
    : params.now ?? new Date().toISOString();

  let query = supabase
    .from('expected_event_instances')
    .update({ status: 'missed' })
    .eq('status', 'pending')
    .lt('due_at', now)
    .select('id');

  if (params.companyId) {
    query = query.eq('company_id', params.companyId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to mark missed expected events: ${error.message}`);
  }

  const missed = Array.isArray(data) ? data.length : 0;
  if (missed > 0) {
    const missedIds = ((data ?? []) as ExpectedEventInstanceRow[]).map((row) => row.id);
    await detectIntelligenceGaps({
      companyId: params.companyId,
      expectedEventInstanceIds: missedIds,
    });

    logger.info('expected_events_missed', {
      companyId: params.companyId ?? null,
      missed,
    });
  }

  return missed;
}

export async function completeExpectedEventInstanceFromFeedback(params: {
  expectedEventInstanceId: string;
  completedTouchpointId: string;
  context?: Record<string, unknown>;
}): Promise<ExpectedEventFeedbackCompletionResult> {
  const expectedEventInstanceId = params.expectedEventInstanceId.trim();
  const completedTouchpointId = params.completedTouchpointId.trim();

  if (!expectedEventInstanceId) {
    throw new Error('expectedEventInstanceId is required to complete feedback loop');
  }

  if (!completedTouchpointId) {
    throw new Error('completedTouchpointId is required to complete feedback loop');
  }

  const { data, error } = await supabase
    .from('expected_event_instances')
    .update({
      status: 'completed',
      completed_touchpoint_id: completedTouchpointId,
    })
    .eq('id', expectedEventInstanceId)
    .in('status', ['pending', 'missed'])
    .select('id');

  if (error) {
    throw new Error(`Failed to complete expected event from feedback: ${error.message}`);
  }

  const completedIds = ((data ?? []) as ExpectedEventInstanceRow[]).map((row) => row.id);
  const gapResolution = completedIds.length > 0
    ? await resolveIntelligenceGapsForExpectedEvents(completedIds)
    : { gapsResolved: 0 };

  if (completedIds.length > 0 || gapResolution.gapsResolved > 0) {
    logger.info('expected_event_completed_from_feedback', {
      ...(params.context ?? {}),
      expectedEventInstanceId,
      completedTouchpointId,
      instancesCompleted: completedIds.length,
      gapsResolved: gapResolution.gapsResolved,
    });
  }

  return {
    instancesCompleted: completedIds.length,
    gapsResolved: gapResolution.gapsResolved,
  };
}

export async function handleTouchpointsCreated(
  touchpoints: ExpectedEventTouchpoint[],
  context: Record<string, unknown> = {}
): Promise<ExpectedEventEngineResult> {
  if (touchpoints.length === 0) {
    return {
      instancesCreated: 0,
      instancesCompleted: 0,
      instancesMissed: 0,
    };
  }

  const instancesCreated = await createExpectedEventInstances(touchpoints, context);
  const instancesCompleted = await completePendingExpectedEvents(touchpoints, context);
  const companyIds = [...new Set(touchpoints.map((touchpoint) => touchpoint.company_id))];
  let instancesMissed = 0;

  for (const companyId of companyIds) {
    instancesMissed += await evaluateMissedExpectedEvents({ companyId });
  }

  return {
    instancesCreated,
    instancesCompleted,
    instancesMissed,
  };
}
