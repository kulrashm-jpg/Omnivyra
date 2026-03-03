/**
 * Centralized execution intelligence: label, explanation, colors, flags, and optional pressure.
 * Use this instead of calling getExecutionModeLabel / getExecutionModeExplanation / getExecutionModeColorClasses directly.
 */

import { getExecutionModeLabel, getExecutionModeExplanation } from './getExecutionModeLabel';
import { getExecutionModeColorClasses, type ExecutionModeColorClasses } from './getExecutionModeColorClasses';

export type ExecutionMode = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

export interface OwnershipCounts {
  ai: number;
  creator: number;
  conditional: number;
  total: number;
}

export interface ExecutionIntelligenceResult {
  execution_mode: ExecutionMode | string | null;
  label: string | null;
  explanation: string | null;
  colorClasses: ExecutionModeColorClasses | null;
  isCreatorHeavy: boolean;
  isConditional: boolean;
  /** Present when ownership counts provided and total > 0 */
  pressureScore?: number;
  pressureLabel?: 'LOW' | 'MEDIUM' | 'HIGH';
  pressureColorClass?: string;
}

const CREATOR_WEIGHT = 1.0;
const CONDITIONAL_WEIGHT = 0.7;
const AI_WEIGHT = 0.2;

/**
 * Compute system-only pressure score from ownership counts.
 * pressureScore = (creator*1 + conditional*0.7 + ai*0.2) / total
 * <= 0.40 LOW (green), <= 0.70 MEDIUM (amber), > 0.70 HIGH (red)
 */
function computePressure(
  counts: OwnershipCounts
): { pressureScore: number; pressureLabel: 'LOW' | 'MEDIUM' | 'HIGH'; pressureColorClass: string } | null {
  if (counts.total <= 0) return null;
  const score =
    (counts.creator * CREATOR_WEIGHT +
      counts.conditional * CONDITIONAL_WEIGHT +
      counts.ai * AI_WEIGHT) /
    counts.total;
  const pressureLabel: 'LOW' | 'MEDIUM' | 'HIGH' =
    score <= 0.4 ? 'LOW' : score <= 0.7 ? 'MEDIUM' : 'HIGH';
  const pressureColorClass =
    pressureLabel === 'LOW'
      ? 'bg-emerald-100 text-emerald-800'
      : pressureLabel === 'MEDIUM'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-red-100 text-red-800';
  return { pressureScore: score, pressureLabel, pressureColorClass };
}

/**
 * Returns unified execution intelligence for a slot (execution_mode only) or week (with counts).
 * Reuses getExecutionModeLabel, getExecutionModeExplanation, getExecutionModeColorClasses.
 */
export function getExecutionIntelligence(
  execution_mode?: ExecutionMode | string | null,
  ownershipCounts?: OwnershipCounts | null
): ExecutionIntelligenceResult {
  const mode =
    execution_mode && typeof execution_mode === 'string'
      ? (execution_mode as ExecutionMode)
      : null;
  const label = getExecutionModeLabel(mode);
  const explanation = getExecutionModeExplanation(mode);
  const colorClasses = getExecutionModeColorClasses(mode);
  const isConditional = mode === 'CONDITIONAL_AI';
  const isCreatorHeavy = ownershipCounts && ownershipCounts.total > 0
    ? (ownershipCounts.creator + ownershipCounts.conditional) / ownershipCounts.total > 0.6
    : mode === 'CREATOR_REQUIRED';

  const pressure =
    ownershipCounts && ownershipCounts.total > 0
      ? computePressure(ownershipCounts)
      : null;

  return {
    execution_mode: mode,
    label,
    explanation,
    colorClasses,
    isCreatorHeavy,
    isConditional,
    ...(pressure && {
      pressureScore: pressure.pressureScore,
      pressureLabel: pressure.pressureLabel,
      pressureColorClass: pressure.pressureColorClass,
    }),
  };
}
