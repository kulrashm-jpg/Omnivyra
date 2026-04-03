import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import {
  DecisionObjectEntityTypeSchema,
  DecisionObjectEvidenceSchema,
  DecisionObjectStatusSchema,
} from '../contracts/decisionObject';
import { assertAllowedDecisionType } from './decisionTypeRegistry';
import { standardizeDecisionScores } from './decisionScoringService';
import { validateActionPayload } from './actionRegistryService';
import { recomputePrioritizationForDecisionWrites } from './prioritizationService';

const DecisionReportTierSchema = z.enum(['snapshot', 'growth', 'deep']);
const ActionPayloadSchema = z.record(z.string(), z.unknown());

function isNonEmptyJson(value: Record<string, unknown> | Array<Record<string, unknown>>): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

export const DecisionObjectWriteSchema = z.object({
  company_id: z.string().uuid(),
  report_tier: DecisionReportTierSchema,
  source_service: z.string().trim().min(1),
  entity_type: DecisionObjectEntityTypeSchema,
  entity_id: z.string().uuid().nullable().optional(),
  issue_type: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  evidence: DecisionObjectEvidenceSchema,
  impact_traffic: z.number().min(0).max(100),
  impact_conversion: z.number().min(0).max(100),
  impact_revenue: z.number().min(0).max(100),
  priority_score: z.number().min(0).max(100),
  effort_score: z.number().min(0).max(100),
  confidence_score: z.number().min(0).max(1),
  recommendation: z.string().trim().min(1),
  action_type: z.string().trim().min(1),
  action_payload: ActionPayloadSchema,
  status: DecisionObjectStatusSchema.default('open'),
  last_changed_by: z.enum(['system', 'user']).default('system'),
}).superRefine((value, ctx) => {
  const isGlobal = value.entity_type === 'global';
  const hasEntity = Boolean(value.entity_id);

  if (isGlobal && hasEntity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entity_id'],
      message: 'Global decision objects must not include entity_id.',
    });
  }

  if (!isGlobal && !hasEntity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entity_id'],
      message: 'Non-global decision objects must include entity_id.',
    });
  }

  if (!isNonEmptyJson(value.evidence)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidence'],
      message: 'Decision objects must include evidence.',
    });
  }

  if (Object.keys(value.action_payload).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['action_payload'],
      message: 'Decision objects must include action payload.',
    });
  }
});

export type DecisionReportTier = z.infer<typeof DecisionReportTierSchema>;
export type DecisionObjectWriteInput = z.infer<typeof DecisionObjectWriteSchema>;

export interface PersistedDecisionObject extends DecisionObjectWriteInput {
  id: string;
  execution_score: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  ignored_at: string | null;
}

function normalizeDecisionWriteInput(input: DecisionObjectWriteInput): DecisionObjectWriteInput {
  const parsed = DecisionObjectWriteSchema.parse(input);
  assertAllowedDecisionType(parsed.issue_type, parsed.source_service);
  const standardized = standardizeDecisionScores(parsed);

  return {
    ...standardized,
    source_service: standardized.source_service.trim(),
    issue_type: standardized.issue_type.trim(),
    title: standardized.title.trim(),
    description: standardized.description.trim(),
    recommendation: standardized.recommendation.trim(),
    action_type: standardized.action_type.trim(),
  };
}

function selectFields(): string {
  return `
    id,
    company_id,
    report_tier,
    source_service,
    entity_type,
    entity_id,
    issue_type,
    title,
    description,
    evidence,
    impact_traffic,
    impact_conversion,
    impact_revenue,
    priority_score,
    effort_score,
    execution_score,
    confidence_score,
    recommendation,
    action_type,
    action_payload,
    status,
    last_changed_by,
    created_at,
    updated_at,
    resolved_at,
    ignored_at
  `;
}

async function ensureDecisionEventsCreated(rows: PersistedDecisionObject[]): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const decisionIds = rows.map((row) => row.id);
  const { data: existing, error: existingError } = await supabase
    .from('decision_events')
    .select('decision_id, event_type')
    .in('decision_id', decisionIds)
    .eq('event_type', 'created');

  if (existingError) {
    // Keep decision write path non-blocking even when decision_events is unavailable.
    return;
  }

  const existingIds = new Set(
    (existing ?? [])
      .map((row) => String((row as { decision_id?: string }).decision_id ?? '').trim())
      .filter(Boolean)
  );

  const missing = rows.filter((row) => !existingIds.has(row.id));
  if (missing.length === 0) return;

  const withCompanyId = missing.map((row) => ({
    decision_id: row.id,
    company_id: row.company_id,
    event_type: 'created',
    previous_value: null,
    new_value: row,
    changed_by: row.last_changed_by ?? 'system',
  }));

  const { error } = await supabase.from('decision_events').insert(withCompanyId as any);
  if (!error) return;

  // Backward-compatible fallback for environments where decision_events.company_id is not yet present.
  if (!/company_id/i.test(error.message ?? '')) return;

  const withoutCompanyId = missing.map((row) => ({
    decision_id: row.id,
    event_type: 'created',
    previous_value: null,
    new_value: row,
    changed_by: row.last_changed_by ?? 'system',
  }));
  await supabase.from('decision_events').insert(withoutCompanyId as any);
}

async function resolveActiveScopeDecisions(scope: {
  company_id: string;
  report_tier: DecisionReportTier;
  source_service: string;
  entity_type: DecisionObjectWriteInput['entity_type'];
  entity_id?: string | null;
}): Promise<Array<{ id: string; status: 'open' | 'resolved' | 'ignored' }>> {
  let query = supabase
    .from('decision_objects')
    .select('id, status')
    .eq('company_id', scope.company_id)
    .eq('report_tier', scope.report_tier)
    .eq('source_service', scope.source_service)
    .eq('entity_type', scope.entity_type)
    .in('status', ['open', 'ignored']);

  query = scope.entity_id ? query.eq('entity_id', scope.entity_id) : query.is('entity_id', null);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load active decisions for scope: ${error.message}`);
  }

  return (data ?? []) as Array<{ id: string; status: 'open' | 'resolved' | 'ignored' }>;
}

export async function archiveDecisionScope(scope: {
  company_id: string;
  report_tier: DecisionReportTier;
  source_service: string;
  entity_type: DecisionObjectWriteInput['entity_type'];
  entity_id?: string | null;
  changed_by?: 'system' | 'user';
}): Promise<void> {
  const active = await resolveActiveScopeDecisions(scope);
  if (active.length === 0) return;

  const ids = active.map((item) => item.id);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('decision_objects')
    .update({
      status: 'resolved',
      resolved_at: now,
      ignored_at: null,
      last_changed_by: scope.changed_by ?? 'system',
    })
    .eq('company_id', scope.company_id)
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to archive active decision scope: ${error.message}`);
  }
}

export async function archiveDecisionSourceEntityType(scope: {
  company_id: string;
  report_tier: DecisionReportTier;
  source_service: string;
  entity_type: DecisionObjectWriteInput['entity_type'];
  changed_by?: 'system' | 'user';
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('decision_objects')
    .update({
      status: 'resolved',
      resolved_at: now,
      ignored_at: null,
      last_changed_by: scope.changed_by ?? 'system',
    })
    .eq('company_id', scope.company_id)
    .eq('report_tier', scope.report_tier)
    .eq('source_service', scope.source_service)
    .eq('entity_type', scope.entity_type)
    .in('status', ['open', 'ignored']);

  if (error) {
    throw new Error(`Failed to archive decision source ${scope.source_service}/${scope.entity_type}: ${error.message}`);
  }
}

export async function createDecisionObjects(
  inputs: DecisionObjectWriteInput[]
): Promise<PersistedDecisionObject[]> {
  const normalized: DecisionObjectWriteInput[] = [];
  for (const input of inputs) {
    const parsed = normalizeDecisionWriteInput(input);
    await validateActionPayload(parsed.action_type, parsed.action_payload);
    normalized.push(parsed);
  }

  if (normalized.length === 0) return [];

  const { data, error } = await supabase
    .from('decision_objects')
    .insert(normalized)
    .select(selectFields());

  if (error) {
    throw new Error(`Failed to persist decision objects: ${error.message}`);
  }

  const persisted = (data ?? []) as unknown as PersistedDecisionObject[];
  await ensureDecisionEventsCreated(persisted);

  // Keep priority queue fresh immediately after canonical decision writes.
  await recomputePrioritizationForDecisionWrites(
    persisted.map((row) => ({
      company_id: row.company_id,
      report_tier: row.report_tier,
    }))
  );

  return persisted;
}

export async function replaceDecisionObjectsForSource(
  inputs: DecisionObjectWriteInput[]
): Promise<PersistedDecisionObject[]> {
  const normalized = inputs.map(normalizeDecisionWriteInput);
  const scopes = new Map<string, DecisionObjectWriteInput>();

  for (const item of normalized) {
    const key = [
      item.company_id,
      item.report_tier,
      item.source_service,
      item.entity_type,
      item.entity_id ?? 'global',
    ].join(':');
    scopes.set(key, item);
  }

  for (const scope of scopes.values()) {
    await archiveDecisionScope({
      company_id: scope.company_id,
      report_tier: scope.report_tier,
      source_service: scope.source_service,
      entity_type: scope.entity_type,
      entity_id: scope.entity_id ?? null,
      changed_by: scope.last_changed_by,
    });
  }

  return createDecisionObjects(normalized);
}

export async function reopenDecision(
  companyId: string,
  decisionId: string,
  changedBy: 'system' | 'user' = 'user'
): Promise<void> {
  const { error } = await supabase
    .from('decision_objects')
    .update({
      status: 'open',
      resolved_at: null,
      ignored_at: null,
      last_changed_by: changedBy,
    })
    .eq('company_id', companyId)
    .eq('id', decisionId);

  if (error) {
    throw new Error(`Failed to reopen decision ${decisionId}: ${error.message}`);
  }

  const { data: row } = await supabase
    .from('decision_objects')
    .select('company_id, report_tier')
    .eq('id', decisionId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (row?.company_id && row?.report_tier) {
    await recomputePrioritizationForDecisionWrites([
      {
        company_id: row.company_id,
        report_tier: row.report_tier as DecisionReportTier,
      },
    ]);
  }
}

export async function resolveDecision(
  companyId: string,
  decisionId: string,
  changedBy: 'system' | 'user' = 'user'
): Promise<void> {
  const { error } = await supabase
    .from('decision_objects')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      ignored_at: null,
      last_changed_by: changedBy,
    })
    .eq('company_id', companyId)
    .eq('id', decisionId);

  if (error) {
    throw new Error(`Failed to resolve decision ${decisionId}: ${error.message}`);
  }

  const { data: row } = await supabase
    .from('decision_objects')
    .select('company_id, report_tier')
    .eq('id', decisionId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (row?.company_id && row?.report_tier) {
    await recomputePrioritizationForDecisionWrites([
      {
        company_id: row.company_id,
        report_tier: row.report_tier as DecisionReportTier,
      },
    ]);
  }
}

export async function ignoreDecision(
  companyId: string,
  decisionId: string,
  changedBy: 'system' | 'user' = 'user'
): Promise<void> {
  const { error } = await supabase
    .from('decision_objects')
    .update({
      status: 'ignored',
      ignored_at: new Date().toISOString(),
      resolved_at: null,
      last_changed_by: changedBy,
    })
    .eq('company_id', companyId)
    .eq('id', decisionId);

  if (error) {
    throw new Error(`Failed to ignore decision ${decisionId}: ${error.message}`);
  }

  const { data: row } = await supabase
    .from('decision_objects')
    .select('company_id, report_tier')
    .eq('id', decisionId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (row?.company_id && row?.report_tier) {
    await recomputePrioritizationForDecisionWrites([
      {
        company_id: row.company_id,
        report_tier: row.report_tier as DecisionReportTier,
      },
    ]);
  }
}

export async function listDecisionObjects(params: {
  viewName: 'snapshot_view' | 'growth_view' | 'deep_view';
  companyId: string;
  sourceService?: string;
  entityType?: DecisionObjectWriteInput['entity_type'];
  entityId?: string | null;
  status?: Array<'open' | 'resolved' | 'ignored'>;
  limit?: number;
}): Promise<PersistedDecisionObject[]> {
  let query = supabase
    .from(params.viewName)
    .select(selectFields())
    .eq('company_id', params.companyId)
    .order('execution_score', { ascending: false })
    .order('priority_score', { ascending: false })
    .order('impact_revenue', { ascending: false })
    .limit(params.limit ?? 100);

  if (params.sourceService) query = query.eq('source_service', params.sourceService);
  if (params.entityType) query = query.eq('entity_type', params.entityType);
  if (params.entityId !== undefined) {
    query = params.entityId ? query.eq('entity_id', params.entityId) : query.is('entity_id', null);
  }
  if (params.status?.length) query = query.in('status', params.status);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to query decision view ${params.viewName}: ${error.message}`);
  }

  return (data ?? []) as unknown as PersistedDecisionObject[];
}

export async function getLatestDecisionObjectsForSource(params: {
  companyId: string;
  reportTier: DecisionReportTier;
  sourceService: string;
  entityType?: DecisionObjectWriteInput['entity_type'];
  entityId?: string | null;
  ttlMs: number;
}): Promise<PersistedDecisionObject[] | null> {
  const viewName =
    params.reportTier === 'snapshot' ? 'snapshot_view' :
    params.reportTier === 'growth' ? 'growth_view' :
    'deep_view';

  let query = supabase
    .from(viewName)
    .select(selectFields())
    .eq('company_id', params.companyId)
    .eq('source_service', params.sourceService)
    .order('created_at', { ascending: false })
    .limit(100);

  if (params.entityType) query = query.eq('entity_type', params.entityType);
  if (params.entityId !== undefined) {
    query = params.entityId ? query.eq('entity_id', params.entityId) : query.is('entity_id', null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to query latest decision objects: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as PersistedDecisionObject[];
  if (rows.length === 0) return null;

  const newest = new Date(rows[0].created_at).getTime();
  if (!Number.isFinite(newest) || (Date.now() - newest) >= params.ttlMs) {
    return null;
  }

  return rows.filter((row) => Math.abs(new Date(row.created_at).getTime() - newest) <= 60_000);
}
