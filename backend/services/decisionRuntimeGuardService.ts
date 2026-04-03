import { z } from 'zod';
import type { PersistedDecisionObject } from './decisionObjectService';
import type { DecisionReportView } from './decisionReportService';

const PersistedDecisionObjectSchema = z.object({
  company_id: z.string().uuid(),
  report_tier: z.enum(['snapshot', 'growth', 'deep']),
  source_service: z.string(),
  entity_type: z.enum(['page', 'session', 'campaign', 'lead', 'revenue_event', 'keyword', 'content_cluster', 'global']),
  entity_id: z.string().uuid().nullable().optional(),
  issue_type: z.string(),
  title: z.string(),
  description: z.string(),
  evidence: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]),
  impact_traffic: z.number(),
  impact_conversion: z.number(),
  impact_revenue: z.number(),
  priority_score: z.number(),
  effort_score: z.number(),
  confidence_score: z.number(),
  recommendation: z.string(),
  action_type: z.string(),
  action_payload: z.record(z.string(), z.unknown()),
  status: z.enum(['open', 'resolved', 'ignored']),
  last_changed_by: z.enum(['system', 'user']).optional(),
  id: z.string().uuid(),
  execution_score: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
  ignored_at: z.string().nullable(),
});

const DecisionReportViewSchema = z.object({
  company_id: z.string().uuid(),
  report_tier: z.enum(['snapshot', 'growth', 'deep']),
  entity_scope: z.object({
    entity_type: z.string(),
    entity_id: z.string().nullable(),
  }),
  summary: z.object({
    total: z.number(),
    open: z.number(),
    resolved: z.number(),
    ignored: z.number(),
    avg_confidence: z.number(),
    top_issue_types: z.array(z.object({ issue_type: z.string(), count: z.number() })),
    top_action_types: z.array(z.object({ action_type: z.string(), count: z.number() })),
  }),
  decisions: z.array(PersistedDecisionObjectSchema),
});

export function assertDecisionArray<T extends PersistedDecisionObject[]>(serviceName: string, value: T): T {
  const parsed = z.array(PersistedDecisionObjectSchema).safeParse(value);
  if (!parsed.success) {
    throw new Error(`${serviceName} returned non-decision output.`);
  }
  return value;
}

export function assertDecisionReportView<T extends DecisionReportView>(serviceName: string, value: T): T {
  const parsed = DecisionReportViewSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${serviceName} returned non-decision report output.`);
  }
  return value;
}
