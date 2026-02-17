/**
 * Governance Contract Definition.
 * Frozen behavioral contract — invariant guards only.
 * No logic. Defines evaluation order, status semantics, and trade-off priority.
 */

export const GOVERNANCE_EVALUATION_ORDER = [
  "INVENTORY",
  "CONTENT_TYPE_CAPACITY",
  "CONTENT_COLLISION",
  "PRODUCTION_CAPACITY",
  "BUDGET",
  "BASELINE",
  "CAMPAIGN_TYPE_MINIMUM",
  "PORTFOLIO",
  "TRADE_OFF_GENERATION",
  "FINAL_STATUS"
] as const;

export const GOVERNANCE_STATUS_RULES = {
  REJECTED: "Blocking constraint OR max_weeks_allowed <= 0",
  NEGOTIATE: "Requested violates limiting constraint",
  APPROVED: "No blocking and no limiting violations"
} as const;

export const TRADE_OFF_PRIORITY_ORDER = {
  NORMAL: [
    "SHIFT_START_DATE",
    "PREEMPT_LOWER_PRIORITY_CAMPAIGN",
    "REDUCE_FREQUENCY",
    "EXTEND_DURATION",
    "INCREASE_CAPACITY"
  ],
  HIGH_OR_CRITICAL: [
    "PREEMPT_LOWER_PRIORITY_CAMPAIGN",
    "SHIFT_START_DATE",
    "REDUCE_FREQUENCY",
    "EXTEND_DURATION",
    "INCREASE_CAPACITY"
  ]
} as const;
