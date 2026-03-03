/**
 * Human-readable labels for execution_mode (ownership / interaction hint).
 * Used for small badges and hints only; no layout or flow changes.
 */

export type ExecutionMode = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

export function getExecutionModeLabel(
  execution_mode?: ExecutionMode | string | null
): string | null {
  if (!execution_mode || typeof execution_mode !== 'string') return null;
  switch (execution_mode as ExecutionMode) {
    case 'AI_AUTOMATED':
      return 'AI Ready';
    case 'CREATOR_REQUIRED':
      return 'Creator Required';
    case 'CONDITIONAL_AI':
      return 'AI Possible (Template Needed)';
    default:
      return null;
  }
}

/** One-line explanation for ownership; muted gray text under label. */
export function getExecutionModeExplanation(
  execution_mode?: ExecutionMode | string | null
): string | null {
  if (!execution_mode || typeof execution_mode !== 'string') return null;
  switch (execution_mode as ExecutionMode) {
    case 'AI_AUTOMATED':
      return 'AI can fully generate this content.';
    case 'CREATOR_REQUIRED':
      return 'Needs manual creation by your team.';
    case 'CONDITIONAL_AI':
      return 'AI can assist once template/material exists.';
    default:
      return null;
  }
}
