/**
 * Modular Campaign Duration Constraint Framework — types.
 * Constraint evaluators return ConstraintResult.
 * HorizonConstraintEvaluator produces DurationEvaluationResult.
 */

export type ConstraintStatus = 'PASS' | 'LIMITING' | 'BLOCKING';

export type ConstraintType =
  | 'inventory'
  | 'content_type_capacity'
  | 'content_collision'
  | 'production_capacity'
  | 'budget'
  | 'baseline_intensity'
  | 'campaign_type_intensity'
  | 'portfolio';

export interface ConstraintResult {
  name: string;
  status: ConstraintStatus;
  max_weeks_allowed: number;
  /** When set, indicates minimum viable duration (e.g. lead-heavy campaigns) */
  min_weeks_required?: number;
  reasoning: string;
  /** Content-type capacity: which type is short (e.g. video, blog) */
  missing_type?: string;
  /** Content collision: campaigns sharing planned assets */
  collidingCampaignIds?: string[];
  /** Content collision: asset IDs involved in overlap */
  collidingAssetIds?: string[];
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
    }
  | {
      type: 'ADJUST_CONTENT_MIX';
      reasoning: string;
    }
  | {
      type: 'ADJUST_CONTENT_SELECTION';
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

/** Stage 12: Context for duration negotiation flow (no production logic changes). */
export interface DurationNegotiationContext {
  campaignId: string;
  lastEvaluation: DurationEvaluationResult;
  conversationHistory?: string[];
}
