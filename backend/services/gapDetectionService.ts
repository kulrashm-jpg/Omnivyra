import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { scoreIntelligenceGap, type IntelligenceScoreResult } from './intelligenceScoringService';
import { logger } from './logger';
import { generatePromptsForGaps } from './promptGenerationService';

type ExpectedEventInstanceRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  trigger_touchpoint_id: string;
  expected_event_type: string;
  due_at: string;
  status: 'pending' | 'completed' | 'missed';
};

type IntelligenceGapRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  expected_event_instance_id: string;
  gap_type: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'resolved' | 'dismissed';
};

type TriggerTouchpointRow = {
  id: string;
  source: string | null;
  unified_source: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

type ResolvedGapRow = {
  id: string;
  company_id: string;
};

type GapDetectionResult = {
  scanned: number;
  gapsCreated: number;
  gapDuplicatesSkipped: number;
  actionsCreated: number;
  promptsCreated: number;
  promptDuplicatesAvoided: number;
};

type GapResolutionResult = {
  gapsResolved: number;
};

type GapConfidenceResult = {
  confidence: number;
  components: {
    base: number;
    missingUnifiedPerson: number;
    noAttribution: number;
    missingUnifiedSource: number;
  };
  attributionChecked: boolean;
};

function gapTypeForExpectedEvent(expectedEventType: string): string {
  const normalized = expectedEventType.trim().toLowerCase();
  if (normalized === 'revenue') return 'missing_revenue';
  return `missing_${normalized || 'event'}`;
}

function priorityForGap(gapType: string): 'low' | 'medium' | 'high' {
  if (gapType === 'missing_revenue') return 'high';
  return 'medium';
}

function titleForGap(gapType: string): string {
  if (gapType === 'missing_revenue') return 'Missing revenue data for lead';
  return 'Missing expected marketing event';
}

function descriptionForGap(gap: IntelligenceGapRow): string {
  if (gap.gap_type === 'missing_revenue') {
    return 'A lead was created, but no revenue event was recorded before the expected due time.';
  }

  return `Expected event was not recorded: ${gap.gap_type.replace(/^missing_/, '')}.`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))
  );
}

async function loadMissedExpectedEvents(params: {
  companyId?: string;
  expectedEventInstanceIds?: string[];
}): Promise<ExpectedEventInstanceRow[]> {
  let query = supabase
    .from('expected_event_instances')
    .select('id, company_id, unified_person_id, trigger_touchpoint_id, expected_event_type, due_at, status')
    .eq('status', 'missed');

  if (params.companyId) {
    query = query.eq('company_id', params.companyId);
  }

  if (params.expectedEventInstanceIds && params.expectedEventInstanceIds.length > 0) {
    query = query.in('id', params.expectedEventInstanceIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to scan missed expected events: ${error.message}`);
  }

  return (data ?? []) as ExpectedEventInstanceRow[];
}

async function loadTriggerTouchpoints(
  triggerTouchpointIds: string[]
): Promise<Map<string, TriggerTouchpointRow>> {
  const ids = uniqueStrings(triggerTouchpointIds);
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, source, unified_source, metadata')
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to load trigger touchpoints for gap scoring: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as TriggerTouchpointRow[]).map((touchpoint) => [touchpoint.id, touchpoint])
  );
}

function scoreGapWithFallback(params: {
  gapType: string;
  dueAt: string;
  triggerTouchpoint?: TriggerTouchpointRow | null;
  now: string;
  fallbackPriority: IntelligenceGapRow['priority'];
  expectedEventInstanceId: string;
}): {
  priority: IntelligenceGapRow['priority'];
  score: IntelligenceScoreResult | null;
} {
  try {
    const score = scoreIntelligenceGap({
      gapType: params.gapType,
      dueAt: params.dueAt,
      now: params.now,
      metadata: params.triggerTouchpoint?.metadata ?? {},
      unifiedSource: params.triggerTouchpoint?.unified_source ?? null,
    });

    return {
      priority: score.priority,
      score,
    };
  } catch (error) {
    logger.warn('intelligence_gap_scoring_failed', {
      expectedEventInstanceId: params.expectedEventInstanceId,
      gapType: params.gapType,
      fallbackPriority: params.fallbackPriority,
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      priority: params.fallbackPriority,
      score: null,
    };
  }
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasUnifiedSource(unifiedSource?: Record<string, unknown> | null): boolean {
  if (!unifiedSource || typeof unifiedSource !== 'object') {
    return false;
  }

  const provider = String(unifiedSource.provider ?? '').trim();
  const category = String(unifiedSource.category ?? '').trim();
  return Boolean(provider || category);
}

async function hasAttributionForUnifiedPerson(params: {
  companyId: string;
  unifiedPersonId: string;
}): Promise<boolean> {
  const { count, error } = await supabase
    .from('attribution_results')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', params.companyId)
    .eq('unified_person_id', params.unifiedPersonId);

  if (error) {
    throw new Error(`Failed to check attribution confidence signal: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

async function calculateGapConfidence(params: {
  instance: ExpectedEventInstanceRow;
  gapType: string;
  triggerTouchpoint?: TriggerTouchpointRow | null;
}): Promise<GapConfidenceResult> {
  const components: GapConfidenceResult['components'] = {
    base: 100,
    missingUnifiedPerson: params.instance.unified_person_id ? 0 : -20,
    noAttribution: 0,
    missingUnifiedSource: hasUnifiedSource(params.triggerTouchpoint?.unified_source) ? 0 : -10,
  };
  let attributionChecked = false;

  if (params.gapType === 'missing_revenue' && params.instance.unified_person_id) {
    attributionChecked = true;
    const hasAttribution = await hasAttributionForUnifiedPerson({
      companyId: params.instance.company_id,
      unifiedPersonId: params.instance.unified_person_id,
    });
    if (!hasAttribution) {
      components.noAttribution = -20;
    }
  }

  return {
    confidence: clampConfidence(
      components.base +
        components.missingUnifiedPerson +
        components.noAttribution +
        components.missingUnifiedSource
    ),
    components,
    attributionChecked,
  };
}

async function calculateGapConfidenceWithFallback(params: {
  instance: ExpectedEventInstanceRow;
  gapType: string;
  triggerTouchpoint?: TriggerTouchpointRow | null;
}): Promise<GapConfidenceResult | null> {
  try {
    return await calculateGapConfidence(params);
  } catch (error) {
    logger.warn('intelligence_gap_confidence_failed', {
      expectedEventInstanceId: params.instance.id,
      gapType: params.gapType,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function createActionsForGaps(gaps: IntelligenceGapRow[]): Promise<number> {
  let created = 0;

  for (const gap of gaps) {
    const recommendationKey = `intelligence_gap:${gap.id}`;
    const { data: existing, error: existingError } = await supabase
      .from('intelligence_actions')
      .select('id')
      .eq('company_id', gap.company_id)
      .eq('source', 'intelligence_gap')
      .eq('recommendation_key', recommendationKey)
      .limit(1);

    if (existingError) {
      throw new Error(`Failed to check intelligence gap action: ${existingError.message}`);
    }

    if (existing && existing.length > 0) {
      continue;
    }

    const { error } = await supabase.from('intelligence_actions').insert({
      company_id: gap.company_id,
      source: 'intelligence_gap',
      recommendation_type: gap.gap_type,
      recommendation_message: titleForGap(gap.gap_type),
      action_status: 'pending',
      recommendation_key: recommendationKey,
      linked_insight_type: 'expected_event_gap',
      recommendation_context: {
        intelligence_gap_id: gap.id,
        expected_event_instance_id: gap.expected_event_instance_id,
        unified_person_id: gap.unified_person_id,
        gap_type: gap.gap_type,
        priority: gap.priority,
        title: titleForGap(gap.gap_type),
        description: descriptionForGap(gap),
      },
      baseline_metrics: {},
      outcome_metrics: {},
      manual_override: {},
    });

    if (error) {
      throw new Error(`Failed to create intelligence action for gap ${gap.id}: ${error.message}`);
    }

    created += 1;
  }

  return created;
}

export async function detectIntelligenceGaps(params: {
  companyId?: string;
  expectedEventInstanceIds?: string[];
} = {}): Promise<GapDetectionResult> {
  const missed = await loadMissedExpectedEvents(params);
  if (missed.length === 0) {
    return {
      scanned: 0,
      gapsCreated: 0,
      gapDuplicatesSkipped: 0,
      actionsCreated: 0,
      promptsCreated: 0,
      promptDuplicatesAvoided: 0,
    };
  }

  const triggerTouchpoints = await loadTriggerTouchpoints(
    missed.map((instance) => instance.trigger_touchpoint_id)
  );
  const now = new Date().toISOString();

  const rows = await Promise.all(missed.map(async (instance) => {
    const gapType = gapTypeForExpectedEvent(instance.expected_event_type);
    const fallbackPriority = priorityForGap(gapType);
    const triggerTouchpoint = triggerTouchpoints.get(instance.trigger_touchpoint_id) ?? null;
    const scored = scoreGapWithFallback({
      gapType,
      dueAt: instance.due_at,
      triggerTouchpoint,
      now,
      fallbackPriority,
      expectedEventInstanceId: instance.id,
    });
    const confidence = await calculateGapConfidenceWithFallback({
      instance,
      gapType,
      triggerTouchpoint,
    });

    return {
      company_id: instance.company_id,
      unified_person_id: instance.unified_person_id,
      expected_event_instance_id: instance.id,
      gap_type: gapType,
      priority: scored.priority,
      status: 'open',
      metadata: {
        expected_event_type: instance.expected_event_type,
        due_at: instance.due_at,
        trigger_touchpoint_id: instance.trigger_touchpoint_id,
        source: triggerTouchpoint?.source ?? null,
        unified_source: triggerTouchpoint?.unified_source ?? null,
        score: scored.score?.score ?? null,
        ...(confidence
          ? {
              confidence: confidence.confidence,
              confidence_scoring: {
                version: 'data_confidence_v1',
                components: confidence.components,
                attribution_checked: confidence.attributionChecked,
                scored_at: now,
              },
            }
          : {}),
        delay_hours: scored.score?.delayHours ?? null,
        revenue_potential: scored.score?.revenuePotential ?? null,
        source_category: scored.score?.sourceCategory ?? null,
        scoring: scored.score
          ? {
              version: 'deterministic_v1',
              priority: scored.priority,
              components: scored.score.components,
              scored_at: now,
            }
          : {
              version: 'fallback_static_priority',
              priority: scored.priority,
              scored_at: now,
          },
      },
    };
  }));

  const { data, error } = await supabase
    .from('intelligence_gaps')
    .upsert(rows, {
      onConflict: 'expected_event_instance_id',
      ignoreDuplicates: true,
    })
    .select('id, company_id, unified_person_id, expected_event_instance_id, gap_type, priority, status');

  if (error) {
    throw new Error(`Failed to create intelligence gaps: ${error.message}`);
  }

  const gaps = (data ?? []) as IntelligenceGapRow[];
  const gapDuplicatesSkipped = missed.length - gaps.length;
  const actionsCreated = await createActionsForGaps(gaps);
  const promptResult = await generatePromptsForGaps(gaps);

  if (gaps.length > 0 || gapDuplicatesSkipped > 0) {
    logger.info('intelligence_gaps_created', {
      companyId: params.companyId ?? null,
      scanned: missed.length,
      gapsCreated: gaps.length,
      gapDuplicatesSkipped,
      actionsCreated,
      promptsCreated: promptResult.promptsCreated,
      promptDuplicatesAvoided: promptResult.duplicatesAvoided,
    });
  }

  if (gapDuplicatesSkipped > 0) {
    logger.info('intelligence_gap_duplicates_skipped', {
      companyId: params.companyId ?? null,
      scanned: missed.length,
      gapsCreated: gaps.length,
      skipped: gapDuplicatesSkipped,
      conflictTarget: 'expected_event_instance_id',
    });
  }

  return {
    scanned: missed.length,
    gapsCreated: gaps.length,
    gapDuplicatesSkipped,
    actionsCreated,
    promptsCreated: promptResult.promptsCreated,
    promptDuplicatesAvoided: promptResult.duplicatesAvoided,
  };
}

export async function resolveIntelligenceGapsForExpectedEvents(
  expectedEventInstanceIds: string[]
): Promise<GapResolutionResult> {
  const ids = expectedEventInstanceIds.filter(Boolean);
  if (ids.length === 0) {
    return { gapsResolved: 0 };
  }

  const { data, error } = await supabase
    .from('intelligence_gaps')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    })
    .in('expected_event_instance_id', ids)
    .eq('status', 'open')
    .select('id, company_id');

  if (error) {
    throw new Error(`Failed to resolve intelligence gaps: ${error.message}`);
  }

  const resolvedGaps = (data ?? []) as ResolvedGapRow[];
  const gapsResolved = resolvedGaps.length;

  if (resolvedGaps.length > 0) {
    const recommendationKeys = resolvedGaps.map((gap) => `intelligence_gap:${gap.id}`);
    const { error: actionError } = await supabase
      .from('intelligence_actions')
      .update({
        action_status: 'completed',
        evaluated_at: new Date().toISOString(),
      })
      .eq('source', 'intelligence_gap')
      .in('recommendation_key', recommendationKeys)
      .in('action_status', ['pending', 'in_progress']);

    if (actionError) {
      throw new Error(`Failed to complete intelligence gap actions: ${actionError.message}`);
    }
  }

  if (gapsResolved > 0) {
    logger.info('intelligence_gaps_resolved', {
      expectedEventInstanceIds: ids,
      gapsResolved,
    });
  }

  return { gapsResolved };
}
