/**
 * Ownership-based color classes for execution_mode.
 * Additive only: returns null when execution_mode is missing so existing color logic is unchanged.
 */

export type ExecutionMode = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

export interface ExecutionModeColorClasses {
  card: string;
  badge: string;
  /** Left border accent for cards that keep stage styling (e.g. ActivityCard). */
  borderLeft: string;
}

/**
 * Returns card + badge Tailwind classes for the given execution_mode, or null.
 * Use only when execution_mode exists; otherwise keep existing (e.g. contentType or stage) colors.
 */
export function getExecutionModeColorClasses(
  execution_mode?: ExecutionMode | string | null
): ExecutionModeColorClasses | null {
  if (!execution_mode || typeof execution_mode !== 'string') return null;
  const mode = execution_mode as ExecutionMode;
  switch (mode) {
    case 'AI_AUTOMATED':
      return {
        card: 'border-indigo-200 bg-indigo-50/60',
        badge: 'bg-indigo-100 text-indigo-700 border-indigo-200',
        borderLeft: 'border-l-indigo-400',
      };
    case 'CREATOR_REQUIRED':
      return {
        card: 'border-orange-200 bg-orange-50/60',
        badge: 'bg-orange-100 text-orange-700 border-orange-200',
        borderLeft: 'border-l-orange-400',
      };
    case 'CONDITIONAL_AI':
      return {
        card: 'border-violet-200 bg-violet-50/60',
        badge: 'bg-violet-100 text-violet-700 border-violet-200',
        borderLeft: 'border-l-violet-400',
      };
    default:
      return null;
  }
}
