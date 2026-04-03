import { z } from 'zod';

export const ACTION_CATEGORIES = ['content', 'seo', 'conversion', 'distribution', 'trust'] as const;
export const ACTION_OWNERS = ['marketing', 'content', 'growth'] as const;
export const ACTION_EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export const ACTION_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export const ACTION_STATUS_SOURCES = ['system', 'user', 'integration'] as const;
export const CONFIDENCE_LABELS = ['High', 'Medium', 'Low'] as const;

export const KNOWN_INSTRUCTION_CODES = [
  'CTA_FIX',
  'CONTENT_IMPROVEMENT',
  'BUDGET_REALLOCATION',
  'CAMPAIGN_LAUNCH',
  'DISTRIBUTION_REPAIR',
  'LEAD_CAPTURE',
  'TRACKING_IMPROVEMENT',
  'STRATEGY_ADJUSTMENT',
  'LEARNING_APPLICATION',
] as const;

export const InstructionCodeSchema = z.union([
  z.enum(KNOWN_INSTRUCTION_CODES),
  z.string().trim().min(1),
]);

export const ExpectedScoreGainSchema = z.object({
  seo: z.number().optional(),
  aeo: z.number().optional(),
  conversion: z.number().optional(),
  authority: z.number().optional(),
});

export const ActionPayloadSchema = z.object({
  id: z.string().trim().min(1),
  instruction_code: InstructionCodeSchema,
  action_category: z.enum(ACTION_CATEGORIES),
  target_block_id: z.string().trim().min(1).optional(),
  impact: z.number().min(0).max(100),
  impact_explanation: z.string().trim().min(1),
  priority_score: z.number(),
  expected_score_gain: ExpectedScoreGainSchema,
  confidence: z.number().min(0).max(1),
  confidence_label: z.enum(CONFIDENCE_LABELS),
  confidence_per_action: z.number().min(0).max(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  steps: z.array(z.string().trim().min(1)).min(1),
  owner: z.enum(ACTION_OWNERS),
  effort_level: z.enum(ACTION_EFFORT_LEVELS),
  timeline_days: z.number().int().min(1),
  dependencies: z.array(InstructionCodeSchema).optional(),
  action_type: z.string().trim().min(1),
  payload: z.record(z.string(), z.any()),
  status: z.enum(ACTION_STATUSES).optional(),
  status_source: z.enum(ACTION_STATUS_SOURCES),
  explainability: z
    .object({
      source_signals: z.array(z.string().trim().min(1)).default([]),
      reasoning: z.string().trim().min(1),
    })
    .optional(),
});

export const ApiNarrativeSchema = z.object({
  cluster_id: z.string().trim().min(1),
  narrative: z.object({
    cluster_id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    what_is_happening: z.string().trim().min(1),
    why_it_matters: z.string().trim().min(1),
    what_to_do: z.string().trim().min(1),
    expected_outcome: z.string().trim().min(1),
    priority_score: z.number(),
    business_impact_score: z.number(),
  }),
  trust: z.object({
    cluster_id: z.string().trim().min(1),
    confidence_level: z.enum(['low', 'medium', 'high']),
    confidence_score: z.number().min(0).max(1),
    evidence: z.object({
      decision_count: z.number().int().min(0),
      key_signals: z.array(z.string()),
    }),
    data_sources: z.array(z.string()),
    freshness: z.object({
      label: z.enum(['fresh', 'recent', 'stale']),
      last_updated_at: z.string().nullable(),
      age_hours: z.number().nullable(),
    }),
  }),
  action: ActionPayloadSchema,
});

export const ApiReportSchema = z.object({
  company_id: z.string().trim().min(1),
  report_type: z.enum(['snapshot', 'performance', 'growth', 'strategic']),
  generated_at: z.string().trim().min(1),
  diagnosis: z.record(z.string(), z.unknown()),
  narratives: z.array(ApiNarrativeSchema),
});

export const ReportExecuteResponseSchema = z.object({
  api_version: z.literal('v1'),
  company_id: z.string().trim().min(1),
  snapshot_report: ApiReportSchema,
  performance_report: ApiReportSchema,
  growth_report: ApiReportSchema,
  strategic_report: ApiReportSchema,
  top_priorities: z.array(ActionPayloadSchema),
  delta: z.object({
    new_insights: z.array(z.string()),
    resolved_issues: z.array(z.string()),
    priority_shifts: z.array(z.string()),
  }),
});

export type ActionPayload = z.infer<typeof ActionPayloadSchema>;
export type ApiReport = z.infer<typeof ApiReportSchema>;
export type ReportExecuteResponse = z.infer<typeof ReportExecuteResponseSchema>;

export function confidenceLabelFromScore(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 0.8) return 'High';
  if (score >= 0.5) return 'Medium';
  return 'Low';
}
