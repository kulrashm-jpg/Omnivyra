/**
 * Safety-critical constants for the automation layer. Centralized so
 * the decision engine, the DB CHECK constraints, and the API
 * validation all read from the same source.
 *
 * PRINCIPLE: every value here narrows the blast radius. Widening any
 * of these requires a code review that explicitly names the new risk.
 */

/**
 * Global kill switch. When the environment variable is `true` (any
 * case, also accepts 1/yes/on), the automation decision engine
 * rejects every request regardless of per-org config.
 */
export const GLOBAL_AUTOMATION_DISABLED_ENV = 'GLOBAL_AUTOMATION_DISABLED';

export function isGlobalAutomationDisabled(): boolean {
  const raw = (process.env[GLOBAL_AUTOMATION_DISABLED_ENV] ?? '').toString().trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * Hard allow-list of action types that may ever be automated. Anything
 * outside this set is rejected at the service layer AND at the DB
 * CHECK constraint (automation_config_allowed_actions_check).
 * Extending this list is a design decision, NOT a config toggle.
 */
export const AUTOMATABLE_ACTION_TYPES: ReadonlyArray<'reply' | 'dm'> = ['reply', 'dm'] as const;

export type AutomatableActionType = typeof AUTOMATABLE_ACTION_TYPES[number];

export function isAutomatableActionType(v: string): v is AutomatableActionType {
  return (AUTOMATABLE_ACTION_TYPES as readonly string[]).includes(v);
}

/** Minimum per-leg sample size for a pattern to justify automation. */
export const MIN_PATTERN_SAMPLE_SIZE = 10;

/** Minimum uplift ratio (1.1 = 10% better than baseline) for a pattern to qualify. */
export const MIN_PATTERN_UPLIFT = 1.1;

/** Default per-org daily limit when none is configured. */
export const DEFAULT_DAILY_LIMIT = 20;

/** Valid values for `min_confidence_level` (matches the DB CHECK). */
export const CONFIDENCE_FLOORS: ReadonlyArray<'medium' | 'high'> = ['medium', 'high'] as const;
export type ConfidenceFloor = typeof CONFIDENCE_FLOORS[number];

export function isConfidenceFloor(v: string): v is ConfidenceFloor {
  return (CONFIDENCE_FLOORS as readonly string[]).includes(v);
}

/** Order used when comparing a confidence level against the floor. */
export const CONFIDENCE_RANK: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** Decision reasons — stringly-typed but fixed for parseability. */
export const DECISION_REASONS = {
  GLOBAL_DISABLED:      'global_kill_switch',
  ORG_DISABLED:         'org_config_disabled',
  ACTION_NOT_WHITELISTED:'action_not_in_allowed_actions',
  ACTION_NOT_AUTOMATABLE:'action_type_not_safe_for_automation',
  LOW_CONFIDENCE:       'confidence_below_org_floor',
  NO_RECOMMENDATION:    'no_recommendation_present',
  WEAK_PATTERN:         'pattern_uplift_or_samples_insufficient',
  DAILY_LIMIT:          'daily_limit_reached',
  MISSING_CONFIG:       'org_has_no_automation_config',
  DEFAULT_DENY:         'default_deny',
  ALLOWED:              'allowed',
} as const;
