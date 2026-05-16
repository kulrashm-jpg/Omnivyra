export const ANALYST_MACRO_KINDS = [
  'investigation_macro',
  'workflow_template',
  'evidence_bundle',
  'report_preset',
  'saved_semantic_search',
  'escalation_template',
] as const;
export type AnalystMacroKind = (typeof ANALYST_MACRO_KINDS)[number];

export const MACRO_EXECUTION_STATUSES = ['complete', 'partial', 'failed', 'cancelled'] as const;
export type MacroExecutionStatus = (typeof MACRO_EXECUTION_STATUSES)[number];

export const MACRO_MAX_STEPS = 25 as const;
export const MACRO_MAX_STEP_DURATION_MS = 30_000 as const;

export type AnalystMacroStep = {
  step_index: number;
  step_kind: string;
  inputs: Record<string, unknown>;
};

export type AnalystMacroStepResult = {
  step_index: number;
  step_kind: string;
  status: 'complete' | 'failed' | 'skipped';
  output: Record<string, unknown> | null;
  duration_ms: number;
  detail: string | null;
};

export type AnalystMacroDefinition = {
  id: string;
  organization_id: string;
  macro_kind: AnalystMacroKind;
  name: string;
  description: string | null;
  steps: AnalystMacroStep[];
  owner_user_id: string | null;
  shared: boolean;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AnalystMacroExecution = {
  id: string;
  organization_id: string;
  macro_id: string;
  status: MacroExecutionStatus;
  step_results: AnalystMacroStepResult[];
  executed_by: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
