/**
 * Execution category color mapping for weekly activity cards.
 * Phase 3: AI Assisted = green, Hybrid = orange, Creator Dependent = red.
 */

export type ExecutionCategory = 'AI_ASSISTED' | 'HYBRID' | 'CONDITIONAL_AI' | 'CREATOR_REQUIRED';

const BORDER_COLORS: Record<string, string> = {
  AI_ASSISTED: 'border-l-emerald-500',
  HYBRID: 'border-l-amber-500',
  CONDITIONAL_AI: 'border-l-amber-500',
  CREATOR_REQUIRED: 'border-l-rose-500',
};

const HEADER_STRIPE_COLORS: Record<string, string> = {
  AI_ASSISTED: 'bg-emerald-100',
  HYBRID: 'bg-amber-100',
  CONDITIONAL_AI: 'bg-amber-100',
  CREATOR_REQUIRED: 'bg-rose-100',
};

export function getExecutionCategoryBorder(executionMode?: string): string {
  if (!executionMode || typeof executionMode !== 'string') return 'border-l-gray-300';
  const key = executionMode.toUpperCase().replace(/\s+/g, '_');
  return BORDER_COLORS[key] ?? 'border-l-gray-300';
}

export function getExecutionCategoryStripe(executionMode?: string): string {
  if (!executionMode || typeof executionMode !== 'string') return 'bg-gray-50';
  const key = executionMode.toUpperCase().replace(/\s+/g, '_');
  return HEADER_STRIPE_COLORS[key] ?? 'bg-gray-50';
}
