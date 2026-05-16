export const COPILOT_INTENTS = [
  'investigation_assist',
  'retrieval_summary',
  'trend_interpret',
  'opportunity_explain',
  'escalation_draft',
  'report_draft',
  'governance_guidance',
] as const;
export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

export const COPILOT_GENERATION_METHODS = [
  'deterministic_copilot_v1',
  'retrieval_grounded_v1',
] as const;
export type CopilotGenerationMethod = (typeof COPILOT_GENERATION_METHODS)[number];

export const COPILOT_DEFAULT_CONTEXT_WINDOW = 4000 as const;
export const COPILOT_MAX_CONTEXT_WINDOW = 12000 as const;
export const COPILOT_MAX_PROMPT_LENGTH = 4000 as const;

export type CopilotEvidenceRef = {
  source_kind: string;
  source_id: string;
  weight: number;
  preview?: string;
};

export type CopilotResponse = {
  id: string;
  organization_id: string;
  copilot_intent: CopilotIntent;
  subject_ref: string;
  prompt_text: string;
  response_text: string;
  evidence_refs: CopilotEvidenceRef[];
  retrieval_explanation_id: string | null;
  reasoning_summary: string | null;
  context_tokens_used: number;
  bounded_context_window: number;
  generation_method: CopilotGenerationMethod;
  requested_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
