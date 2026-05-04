import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { completeExpectedEventInstanceFromFeedback } from './expectedEventEngine';
import { logger } from './logger';
import { reconcileAfterPromptResponse, type ReconciliationResult } from './reconciliationService';
import { normalizeSource } from './sourceNormalizationService';
import { createTouchpoint } from './touchpointService';

type PromptStatus = 'pending' | 'shown' | 'responded' | 'dismissed';

type IntelligencePromptRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  intelligence_gap_id: string;
  status: PromptStatus;
};

type IntelligenceGapRow = {
  id: string;
  expected_event_instance_id: string;
  gap_type: string;
  status: 'open' | 'resolved' | 'dismissed';
};

type PromptResponseRow = {
  id: string;
};

export type FeedbackResponseInput = {
  intelligence_prompt_id: string;
  response_type: string;
  response_payload?: unknown;
};

export type PromptFeedbackScope = {
  intelligencePromptId: string;
  companyId: string;
};

export type FeedbackProcessingResult = {
  intelligencePromptId: string;
  intelligenceGapId: string;
  promptResponseId: string;
  touchpointId: string;
  expectedEventsCompleted: number;
  gapsResolved: number;
  promptStatus: 'responded';
  reconciliation?: ReconciliationResult;
};

export class FeedbackProcessingError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'FeedbackProcessingError';
    this.statusCode = statusCode;
  }
}

function requireText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new FeedbackProcessingError(400, `${field} is required`);
  }
  return normalized;
}

function normalizeResponseType(value: unknown): string {
  return requireText(value, 'response_type').toLowerCase();
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new FeedbackProcessingError(400, 'response_payload must be an object');
  }
  return value as Record<string, unknown>;
}

function occurredAtFromPayload(payload: Record<string, unknown>): string {
  const raw = payload.occurred_at ?? payload.occurredAt;
  if (raw == null || raw === '') {
    return new Date().toISOString();
  }

  const timestamp = String(raw).trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new FeedbackProcessingError(400, 'response_payload.occurred_at must be a valid timestamp');
  }

  return timestamp;
}

async function loadPrompt(promptId: string): Promise<IntelligencePromptRow> {
  const { data, error } = await supabase
    .from('intelligence_prompts')
    .select('id, company_id, unified_person_id, intelligence_gap_id, status')
    .eq('id', promptId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load intelligence prompt: ${error.message}`);
  }

  if (!data) {
    throw new FeedbackProcessingError(404, 'Intelligence prompt not found');
  }

  return data as IntelligencePromptRow;
}

async function loadGap(gapId: string): Promise<IntelligenceGapRow> {
  const { data, error } = await supabase
    .from('intelligence_gaps')
    .select('id, expected_event_instance_id, gap_type, status')
    .eq('id', gapId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load intelligence gap: ${error.message}`);
  }

  if (!data) {
    throw new FeedbackProcessingError(404, 'Intelligence gap not found for prompt');
  }

  return data as IntelligenceGapRow;
}

async function insertPromptResponse(params: {
  prompt: IntelligencePromptRow;
  responseType: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase
    .from('intelligence_prompt_responses')
    .insert({
      intelligence_prompt_id: params.prompt.id,
      company_id: params.prompt.company_id,
      unified_person_id: params.prompt.unified_person_id,
      response_type: params.responseType,
      response_payload: params.payload,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to record prompt response: ${error.message}`);
  }

  const responseId = (data as PromptResponseRow).id;
  logger.info('intelligence_prompt_response_received', {
    intelligencePromptId: params.prompt.id,
    promptResponseId: responseId,
    companyId: params.prompt.company_id,
    unifiedPersonId: params.prompt.unified_person_id,
    responseType: params.responseType,
  });

  return responseId;
}

async function markPromptResponded(promptId: string): Promise<void> {
  const { error } = await supabase
    .from('intelligence_prompts')
    .update({ status: 'responded' })
    .eq('id', promptId)
    .in('status', ['pending', 'shown']);

  if (error) {
    throw new Error(`Failed to mark prompt responded: ${error.message}`);
  }
}

export async function getPromptFeedbackScope(
  intelligencePromptId: string
): Promise<PromptFeedbackScope> {
  const prompt = await loadPrompt(requireText(intelligencePromptId, 'intelligence_prompt_id'));
  return {
    intelligencePromptId: prompt.id,
    companyId: prompt.company_id,
  };
}

export async function processPromptFeedbackResponse(
  input: FeedbackResponseInput
): Promise<FeedbackProcessingResult> {
  const promptId = requireText(input.intelligence_prompt_id, 'intelligence_prompt_id');
  const responseType = normalizeResponseType(input.response_type);
  const payload = normalizePayload(input.response_payload);

  if (responseType !== 'revenue_update') {
    throw new FeedbackProcessingError(400, `Unsupported response_type: ${responseType}`);
  }

  const prompt = await loadPrompt(promptId);
  if (prompt.status !== 'pending' && prompt.status !== 'shown') {
    throw new FeedbackProcessingError(409, 'Prompt is not open for response');
  }

  const gap = await loadGap(prompt.intelligence_gap_id);
  const occurredAt = occurredAtFromPayload(payload);
  const promptResponseId = await insertPromptResponse({
    prompt,
    responseType,
    payload,
  });

  const context = {
    companyId: prompt.company_id,
    unifiedPersonId: prompt.unified_person_id,
    intelligencePromptId: prompt.id,
    intelligenceGapId: gap.id,
    expectedEventInstanceId: gap.expected_event_instance_id,
    promptResponseId,
    responseType,
  };

  const touchpointResult = await createTouchpoint(
    {
      companyId: prompt.company_id,
      unifiedPersonId: prompt.unified_person_id,
      source: 'manual',
      unifiedSource: normalizeSource('manual', {
        sourceType: 'internal',
        origin: 'prompt_response',
      }),
      touchpointType: 'revenue',
      referenceTable: 'intelligence_prompt_responses',
      referenceId: promptResponseId,
      occurredAt,
      metadata: {
        ...payload,
        response_type: responseType,
        intelligence_prompt_id: prompt.id,
        intelligence_gap_id: gap.id,
        expected_event_instance_id: gap.expected_event_instance_id,
        intelligence_prompt_response_id: promptResponseId,
      },
    },
    context
  );

  const touchpointId = touchpointResult.touchpointIds?.[0];
  if (!touchpointId) {
    throw new Error('Revenue touchpoint was not created for prompt response');
  }

  logger.info('intelligence_prompt_feedback_touchpoint_created', {
    ...context,
    touchpointId,
    touchpointsCreated: touchpointResult.created,
  });

  const completion = await completeExpectedEventInstanceFromFeedback({
    expectedEventInstanceId: gap.expected_event_instance_id,
    completedTouchpointId: touchpointId,
    context,
  });

  await markPromptResponded(prompt.id);

  let reconciliation: ReconciliationResult | undefined;
  try {
    reconciliation = await reconcileAfterPromptResponse({
      companyId: prompt.company_id,
      unifiedPersonId: prompt.unified_person_id,
      touchpointIds: [touchpointId],
      expectedEventInstanceIds: [gap.expected_event_instance_id],
      intelligenceGapIds: [gap.id],
      intelligencePromptId: prompt.id,
      context,
    });
  } catch (error) {
    logger.error('prompt_response_reconciliation_failed', {
      ...context,
      touchpointId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('intelligence_prompt_feedback_processed', {
    ...context,
    touchpointId,
    expectedEventsCompleted: completion.instancesCompleted,
    gapsResolved: completion.gapsResolved,
    reconciliation,
  });

  return {
    intelligencePromptId: prompt.id,
    intelligenceGapId: gap.id,
    promptResponseId,
    touchpointId,
    expectedEventsCompleted: completion.instancesCompleted,
    gapsResolved: completion.gapsResolved,
    promptStatus: 'responded',
    reconciliation,
  };
}
