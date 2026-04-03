import { z } from 'zod';

export const DECISION_OBJECT_ENTITY_TYPES = [
  'page',
  'session',
  'campaign',
  'lead',
  'revenue_event',
  'keyword',
  'content_cluster',
  'global',
] as const;
export const DECISION_OBJECT_STATUSES = ['open', 'resolved', 'ignored'] as const;
export const DECISION_OBJECT_REPORT_TIERS = ['snapshot', 'growth', 'deep'] as const;

export const DecisionObjectEntityTypeSchema = z.enum(DECISION_OBJECT_ENTITY_TYPES);
export const DecisionObjectStatusSchema = z.enum(DECISION_OBJECT_STATUSES);
export const DecisionObjectReportTierSchema = z.enum(DECISION_OBJECT_REPORT_TIERS);

const ImpactScoreSchema = z.number().min(0).max(100);
const ConfidenceScoreSchema = z.number().min(0).max(1);
const PriorityScoreSchema = z.number().min(0).max(100);
const EffortScoreSchema = z.number().min(0).max(100);

const EvidenceObjectSchema = z.record(z.string(), z.unknown());
const EvidenceArraySchema = z.array(EvidenceObjectSchema);

export const DecisionObjectEvidenceSchema = z.union([
  EvidenceObjectSchema,
  EvidenceArraySchema,
]);

export const DecisionObjectInputSchema = z.object({
  company_id: z.string().uuid(),
  report_tier: DecisionObjectReportTierSchema,
  source_service: z.string().trim().min(1),
  entity_type: DecisionObjectEntityTypeSchema,
  entity_id: z.string().uuid().nullable().optional(),
  issue_type: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  evidence: DecisionObjectEvidenceSchema,
  impact_traffic: ImpactScoreSchema,
  impact_conversion: ImpactScoreSchema,
  impact_revenue: ImpactScoreSchema,
  priority_score: PriorityScoreSchema,
  effort_score: EffortScoreSchema,
  confidence_score: ConfidenceScoreSchema,
  recommendation: z.string().trim().min(1),
  action_type: z.string().trim().min(1),
  action_payload: z.record(z.string(), z.unknown()),
  status: DecisionObjectStatusSchema.default('open'),
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

  if (Object.keys(value.action_payload ?? {}).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['action_payload'],
      message: 'Decision objects must include action_payload.',
    });
  }
});

export type DecisionObjectEntityType = z.infer<typeof DecisionObjectEntityTypeSchema>;
export type DecisionObjectStatus = z.infer<typeof DecisionObjectStatusSchema>;
export type DecisionObjectReportTier = z.infer<typeof DecisionObjectReportTierSchema>;
export type DecisionObjectInput = z.infer<typeof DecisionObjectInputSchema>;

export const DECISION_OBJECT_CONTRACT_STEPS = [
  'issue',
  'evidence',
  'impact',
  'confidence',
  'recommendation',
  'action',
] as const;

export function assertDecisionObjectContract(input: unknown): DecisionObjectInput {
  return DecisionObjectInputSchema.parse(input);
}

export function normalizeDecisionObject(input: DecisionObjectInput): DecisionObjectInput {
  const parsed = assertDecisionObjectContract(input);

  return {
    ...parsed,
    issue_type: parsed.issue_type.trim(),
    title: parsed.title.trim(),
    description: parsed.description.trim(),
    recommendation: parsed.recommendation.trim(),
    action_type: parsed.action_type.trim(),
  };
}
