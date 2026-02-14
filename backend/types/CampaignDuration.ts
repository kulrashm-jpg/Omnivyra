/**
 * Modular Campaign Duration Constraint Framework — types.
 * Constraint evaluators return ConstraintResult.
 * HorizonConstraintEvaluator produces DurationEvaluationResult.
 */

export type ConstraintStatus = 'PASS' | 'LIMITING' | 'BLOCKING';

export interface ConstraintResult {
  name: string;
  status: ConstraintStatus;
  max_weeks_allowed: number;
  /** When set, indicates minimum viable duration (e.g. lead-heavy campaigns) */
  min_weeks_required?: number;
  reasoning: string;
}

export type TradeOffOption =
  | {
      type: 'EXTEND_DURATION';
      newDurationWeeks?: number;
      reasoning: string;
    }
  | {
      type: 'REDUCE_FREQUENCY';
      newPostsPerWeek?: number;
      newDurationWeeks?: number;
      reasoning: string;
    }
  | {
      type: 'INCREASE_CAPACITY';
      requiredAdditionalCapacity?: number;
      reasoning: string;
    }
  | {
      type: 'SHIFT_START_DATE';
      newStartDate: string;
      reasoning: string;
    }
  | {
      type: 'PREEMPT_LOWER_PRIORITY_CAMPAIGN';
      conflictingCampaignId: string;
      reasoning: string;
    };

export interface DurationEvaluationResult {
  requested_weeks: number;
  max_weeks_allowed: number;
  /** When NEGOTIATE due to minimum, the required minimum weeks */
  min_weeks_required?: number;
  limiting_constraints: ConstraintResult[];
  blocking_constraints: ConstraintResult[];
  status: 'APPROVED' | 'NEGOTIATE' | 'REJECTED';
  /** Strategic alternatives when status === NEGOTIATE */
  tradeOffOptions?: TradeOffOption[];
}

export type BlueprintStatus = 'ACTIVE' | 'INVALIDATED' | 'REGENERATING';
