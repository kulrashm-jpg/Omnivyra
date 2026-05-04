import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { evaluateMissedExpectedEvents } from './expectedEventEngine';
import { logger } from './logger';

type ReconciliationTrigger =
  | 'touchpoint_created'
  | 'prompt_response'
  | 'ingestion_completed'
  | 'scheduler'
  | 'manual';

type ExpectedEventStatus = 'pending' | 'completed' | 'missed';

type ExpectedEventCandidateRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  trigger_touchpoint_id: string;
  expected_event_type: string;
  due_at: string;
  status: ExpectedEventStatus;
};

type TouchpointScopeRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
};

type TouchpointMatchRow = {
  id: string;
  occurred_at: string;
};

type GapRow = {
  id: string;
  company_id: string;
  expected_event_instance_id: string;
};

type IdRow = {
  id: string;
};

type PromptAutoResolvedRow = {
  id: string;
  intelligence_gap_id: string;
};

export type ReconciliationInput = {
  trigger: ReconciliationTrigger;
  companyId?: string | null;
  companyIds?: string[];
  unifiedPersonId?: string | null;
  unifiedPersonIds?: string[];
  touchpointIds?: string[];
  expectedEventInstanceIds?: string[];
  intelligenceGapIds?: string[];
  intelligencePromptId?: string | null;
  ingestionRunId?: string | null;
  now?: string | Date;
  context?: Record<string, unknown>;
};

export type ReconciliationResult = {
  trigger: ReconciliationTrigger;
  expectedEventsCompleted: number;
  expectedEventsMissed: number;
  gapsResolved: number;
  actionsCompleted: number;
  promptsResponded: number;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))
  );
}

function normalizeNow(value?: string | Date): string | Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;

  const timestamp = value.trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error('Reconciliation now must be a valid timestamp');
  }

  return timestamp;
}

async function loadTouchpointScope(touchpointIds: string[]): Promise<TouchpointScopeRow[]> {
  const ids = uniqueStrings(touchpointIds);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, company_id, unified_person_id')
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to load touchpoint reconciliation scope: ${error.message}`);
  }

  return (data ?? []) as TouchpointScopeRow[];
}

async function loadCandidateExpectedEvents(params: {
  companyIds: string[];
  unifiedPersonIds: string[];
  expectedEventInstanceIds: string[];
}): Promise<ExpectedEventCandidateRow[]> {
  let query = supabase
    .from('expected_event_instances')
    .select('id, company_id, unified_person_id, trigger_touchpoint_id, expected_event_type, due_at, status')
    .in('status', ['pending', 'missed']);

  if (params.companyIds.length === 1) {
    query = query.eq('company_id', params.companyIds[0]);
  } else if (params.companyIds.length > 1) {
    query = query.in('company_id', params.companyIds);
  }

  if (params.unifiedPersonIds.length === 1) {
    query = query.eq('unified_person_id', params.unifiedPersonIds[0]);
  } else if (params.unifiedPersonIds.length > 1) {
    query = query.in('unified_person_id', params.unifiedPersonIds);
  }

  if (params.expectedEventInstanceIds.length > 0) {
    query = query.in('id', params.expectedEventInstanceIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load expected events for reconciliation: ${error.message}`);
  }

  return (data ?? []) as ExpectedEventCandidateRow[];
}

async function loadTriggerOccurredAt(triggerTouchpointIds: string[]): Promise<Map<string, string>> {
  const ids = uniqueStrings(triggerTouchpointIds);
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, occurred_at')
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to load trigger touchpoints for reconciliation: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as TouchpointMatchRow[]).map((touchpoint) => [
      touchpoint.id,
      touchpoint.occurred_at,
    ])
  );
}

async function findMatchingTouchpoint(
  expectedEvent: ExpectedEventCandidateRow,
  triggerOccurredAt?: string
): Promise<string | null> {
  if (!expectedEvent.unified_person_id) {
    return null;
  }

  let query = supabase
    .from('unified_touchpoints')
    .select('id, occurred_at')
    .eq('company_id', expectedEvent.company_id)
    .eq('unified_person_id', expectedEvent.unified_person_id)
    .eq('touchpoint_type', expectedEvent.expected_event_type)
    .neq('id', expectedEvent.trigger_touchpoint_id)
    .order('occurred_at', { ascending: true })
    .limit(1);

  if (triggerOccurredAt) {
    query = query.gte('occurred_at', triggerOccurredAt);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to find matching touchpoint for expected event ${expectedEvent.id}: ${error.message}`);
  }

  const match = ((data ?? []) as TouchpointMatchRow[])[0];
  return match?.id ?? null;
}

async function completeExpectedEventsFromExistingTouchpoints(params: {
  companyIds: string[];
  unifiedPersonIds: string[];
  expectedEventInstanceIds: string[];
}): Promise<string[]> {
  const candidates = await loadCandidateExpectedEvents(params);
  if (candidates.length === 0) return [];

  const triggerOccurredAt = await loadTriggerOccurredAt(
    candidates.map((candidate) => candidate.trigger_touchpoint_id)
  );
  const completedIds: string[] = [];

  for (const candidate of candidates) {
    const matchingTouchpointId = await findMatchingTouchpoint(
      candidate,
      triggerOccurredAt.get(candidate.trigger_touchpoint_id)
    );

    if (!matchingTouchpointId) {
      continue;
    }

    const { data, error } = await supabase
      .from('expected_event_instances')
      .update({
        status: 'completed',
        completed_touchpoint_id: matchingTouchpointId,
      })
      .eq('id', candidate.id)
      .in('status', ['pending', 'missed'])
      .select('id');

    if (error) {
      throw new Error(`Failed to complete expected event during reconciliation: ${error.message}`);
    }

    completedIds.push(...((data ?? []) as IdRow[]).map((row) => row.id));
  }

  return completedIds;
}

async function loadOpenGaps(params: {
  companyIds: string[];
  expectedEventInstanceIds: string[];
  intelligenceGapIds: string[];
}): Promise<GapRow[]> {
  let query = supabase
    .from('intelligence_gaps')
    .select('id, company_id, expected_event_instance_id')
    .eq('status', 'open');

  if (params.companyIds.length === 1) {
    query = query.eq('company_id', params.companyIds[0]);
  } else if (params.companyIds.length > 1) {
    query = query.in('company_id', params.companyIds);
  }

  if (params.expectedEventInstanceIds.length > 0) {
    query = query.in('expected_event_instance_id', params.expectedEventInstanceIds);
  }

  if (params.intelligenceGapIds.length > 0) {
    query = query.in('id', params.intelligenceGapIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load open intelligence gaps for reconciliation: ${error.message}`);
  }

  return (data ?? []) as GapRow[];
}

async function resolveOpenGapsForCompletedExpectedEvents(params: {
  companyIds: string[];
  expectedEventInstanceIds: string[];
  intelligenceGapIds: string[];
}): Promise<string[]> {
  const openGaps = await loadOpenGaps(params);
  if (openGaps.length === 0) return [];

  const expectedIds = uniqueStrings(openGaps.map((gap) => gap.expected_event_instance_id));
  const { data: completedEvents, error: completedError } = await supabase
    .from('expected_event_instances')
    .select('id')
    .in('id', expectedIds)
    .eq('status', 'completed');

  if (completedError) {
    throw new Error(`Failed to load completed expected events for reconciliation: ${completedError.message}`);
  }

  const completedExpectedIds = new Set(((completedEvents ?? []) as IdRow[]).map((row) => row.id));
  const resolvableGapIds = openGaps
    .filter((gap) => completedExpectedIds.has(gap.expected_event_instance_id))
    .map((gap) => gap.id);

  if (resolvableGapIds.length === 0) return [];

  const { data, error } = await supabase
    .from('intelligence_gaps')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    })
    .in('id', resolvableGapIds)
    .eq('status', 'open')
    .select('id');

  if (error) {
    throw new Error(`Failed to resolve intelligence gaps during reconciliation: ${error.message}`);
  }

  return ((data ?? []) as IdRow[]).map((row) => row.id);
}

async function loadResolvedGapIds(params: {
  companyIds: string[];
  intelligenceGapIds: string[];
}): Promise<string[]> {
  let query = supabase
    .from('intelligence_gaps')
    .select('id')
    .eq('status', 'resolved');

  if (params.companyIds.length === 1) {
    query = query.eq('company_id', params.companyIds[0]);
  } else if (params.companyIds.length > 1) {
    query = query.in('company_id', params.companyIds);
  }

  if (params.intelligenceGapIds.length > 0) {
    query = query.in('id', params.intelligenceGapIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load resolved gaps for reconciliation: ${error.message}`);
  }

  return ((data ?? []) as IdRow[]).map((row) => row.id);
}

async function completeActionsForResolvedGaps(resolvedGapIds: string[]): Promise<number> {
  const gapIds = uniqueStrings(resolvedGapIds);
  if (gapIds.length === 0) return 0;

  const recommendationKeys = gapIds.map((gapId) => `intelligence_gap:${gapId}`);
  const { data, error } = await supabase
    .from('intelligence_actions')
    .update({
      action_status: 'completed',
      evaluated_at: new Date().toISOString(),
    })
    .eq('source', 'intelligence_gap')
    .in('recommendation_key', recommendationKeys)
    .in('action_status', ['pending', 'in_progress'])
    .select('id');

  if (error) {
    throw new Error(`Failed to complete intelligence actions during reconciliation: ${error.message}`);
  }

  return ((data ?? []) as IdRow[]).length;
}

async function respondPromptsForResolvedGaps(resolvedGapIds: string[]): Promise<number> {
  const gapIds = uniqueStrings(resolvedGapIds);
  if (gapIds.length === 0) return 0;

  const { data, error } = await supabase
    .from('intelligence_prompts')
    .update({
      status: 'responded',
    })
    .in('intelligence_gap_id', gapIds)
    .in('status', ['pending', 'shown'])
    .select('id, intelligence_gap_id');

  if (error) {
    throw new Error(`Failed to respond intelligence prompts during reconciliation: ${error.message}`);
  }

  const resolvedPrompts = (data ?? []) as PromptAutoResolvedRow[];
  if (resolvedPrompts.length > 0) {
    logger.info('prompt_auto_resolved', {
      promptsResponded: resolvedPrompts.length,
      promptIds: resolvedPrompts.map((prompt) => prompt.id),
      intelligenceGapIds: uniqueStrings(
        resolvedPrompts.map((prompt) => prompt.intelligence_gap_id)
      ),
    });
  }

  return resolvedPrompts.length;
}

export async function reconcileIntelligenceState(
  input: ReconciliationInput
): Promise<ReconciliationResult> {
  const touchpointScope = await loadTouchpointScope(input.touchpointIds ?? []);
  const companyIds = uniqueStrings([
    input.companyId,
    ...(input.companyIds ?? []),
    ...touchpointScope.map((touchpoint) => touchpoint.company_id),
  ]);
  const unifiedPersonIds = uniqueStrings([
    input.unifiedPersonId,
    ...(input.unifiedPersonIds ?? []),
    ...touchpointScope.map((touchpoint) => touchpoint.unified_person_id),
  ]);
  const expectedEventInstanceIds = uniqueStrings(input.expectedEventInstanceIds ?? []);
  const intelligenceGapIds = uniqueStrings(input.intelligenceGapIds ?? []);
  const now = normalizeNow(input.now);

  logger.info('intelligence_reconciliation_triggered', {
    ...(input.context ?? {}),
    trigger: input.trigger,
    companyIds,
    unifiedPersonIds,
    touchpointIds: uniqueStrings(input.touchpointIds ?? []),
    expectedEventInstanceIds,
    intelligenceGapIds,
    intelligencePromptId: input.intelligencePromptId ?? null,
    ingestionRunId: input.ingestionRunId ?? null,
  });

  const completedExpectedEventIds = await completeExpectedEventsFromExistingTouchpoints({
    companyIds,
    unifiedPersonIds,
    expectedEventInstanceIds,
  });

  let expectedEventsMissed = 0;
  if (companyIds.length > 0) {
    for (const companyId of companyIds) {
      expectedEventsMissed += await evaluateMissedExpectedEvents({ companyId, now });
    }
  } else {
    expectedEventsMissed = await evaluateMissedExpectedEvents({ now });
  }

  const newlyResolvedGapIds = await resolveOpenGapsForCompletedExpectedEvents({
    companyIds,
    expectedEventInstanceIds: uniqueStrings([
      ...expectedEventInstanceIds,
      ...completedExpectedEventIds,
    ]),
    intelligenceGapIds,
  });
  const resolvedGapIds = await loadResolvedGapIds({
    companyIds,
    intelligenceGapIds: uniqueStrings([...intelligenceGapIds, ...newlyResolvedGapIds]),
  });
  const actionsCompleted = await completeActionsForResolvedGaps(resolvedGapIds);
  const promptsResponded = await respondPromptsForResolvedGaps(resolvedGapIds);

  const result: ReconciliationResult = {
    trigger: input.trigger,
    expectedEventsCompleted: completedExpectedEventIds.length,
    expectedEventsMissed,
    gapsResolved: newlyResolvedGapIds.length,
    actionsCompleted,
    promptsResponded,
  };

  logger.info('intelligence_reconciliation_completed', {
    ...(input.context ?? {}),
    ...result,
    companyIds,
    unifiedPersonIds,
    intelligencePromptId: input.intelligencePromptId ?? null,
    ingestionRunId: input.ingestionRunId ?? null,
  });

  return result;
}

export async function reconcileAfterTouchpointsCreated(params: {
  touchpointIds: string[];
  context?: Record<string, unknown>;
}): Promise<ReconciliationResult> {
  return reconcileIntelligenceState({
    trigger: 'touchpoint_created',
    touchpointIds: params.touchpointIds,
    context: params.context,
  });
}

export async function reconcileAfterPromptResponse(params: {
  companyId: string;
  unifiedPersonId?: string | null;
  touchpointIds?: string[];
  expectedEventInstanceIds?: string[];
  intelligenceGapIds?: string[];
  intelligencePromptId?: string | null;
  context?: Record<string, unknown>;
}): Promise<ReconciliationResult> {
  return reconcileIntelligenceState({
    trigger: 'prompt_response',
    companyId: params.companyId,
    unifiedPersonId: params.unifiedPersonId,
    touchpointIds: params.touchpointIds,
    expectedEventInstanceIds: params.expectedEventInstanceIds,
    intelligenceGapIds: params.intelligenceGapIds,
    intelligencePromptId: params.intelligencePromptId,
    context: params.context,
  });
}

export async function reconcileAfterIngestionCompletion(params: {
  companyId: string;
  ingestionRunId?: string | null;
  context?: Record<string, unknown>;
}): Promise<ReconciliationResult> {
  return reconcileIntelligenceState({
    trigger: 'ingestion_completed',
    companyId: params.companyId,
    ingestionRunId: params.ingestionRunId,
    context: params.context,
  });
}
