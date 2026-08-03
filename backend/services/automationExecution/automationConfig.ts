/**
 * INT-001 Phase 5 — deterministic automation tuning. Pure data.
 */

/** Delay ladder (hours after the previous outreach step) — Day 0/2/3/3/4 → cumulative 0,2,5,8,12 days. */
export const STEP_DELAY_LADDER_HOURS = [0, 48, 72, 72, 96, 120] as const;

/** Gaps at or above this insert an explicit Wait task into the chain. */
export const WAIT_TASK_THRESHOLD_HOURS = 48;

/** Confidence floors for readiness. */
export const READINESS_THRESHOLDS = {
  /** Below this the intelligence is too thin to automate at all. */
  insufficientConfidence: 0.25,
  /** Below this a human must review before automation runs. */
  reviewConfidence: 0.45,
} as const;

/** Channels kept in the sequence (below this confidence they are dropped). */
export const CHANNEL_SEQUENCE_MIN_CONFIDENCE = 0.2;

/** Maximum tasks in one automation plan (explanation-preserving cap). */
export const MAX_TASKS = 20;

/** Regions with outbound-automation restrictions (manual review, not block). */
export const RESTRICTED_REGIONS = new Set(['DE', 'FR', 'CH', 'AT']);

/** Supporting actions injected as parallel tasks when present in Phase 3 output. */
export const PARALLEL_ACTION_ALLOWLIST = new Set([
  'Send comparison guide',
  'Security documentation',
  'API documentation',
]);
