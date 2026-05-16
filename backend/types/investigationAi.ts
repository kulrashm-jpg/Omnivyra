export const INVESTIGATION_AI_KINDS = [
  'incident_summary',
  'cluster_explanation',
  'timeline_summary',
  'evidence_grouping',
  'retrieval_overlay',
  'escalation_brief',
] as const;
export type InvestigationAiKind = (typeof INVESTIGATION_AI_KINDS)[number];

export const INVESTIGATION_AI_METHODS = [
  'deterministic_summary_v1',
  'retrieval_assist_v1',
] as const;
export type InvestigationAiMethod = (typeof INVESTIGATION_AI_METHODS)[number];

export const INVESTIGATION_AI_DEFAULT_CONTEXT_WINDOW = 4000 as const;
export const INVESTIGATION_AI_MAX_CONTEXT_WINDOW = 12000 as const;

export type EvidenceRef = {
  source_kind: string;
  source_id: string;
  preview?: string;
  weight: number;
};

export type InvestigationAiSummary = {
  id: string;
  organization_id: string;
  investigation_kind: InvestigationAiKind;
  subject_ref: string;
  summary_text: string;
  evidence_refs: EvidenceRef[];
  retrieval_explanation_id: string | null;
  generation_method: InvestigationAiMethod;
  context_tokens_used: number | null;
  bounded_context_window: number;
  requested_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
