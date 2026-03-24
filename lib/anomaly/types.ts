/**
 * Anomaly detection type registry.
 *
 * Each entry defines:
 *   severity      — alert urgency (CRITICAL | WARNING | INFO)
 *   entityType    — what the anomaly is about (user | company | system)
 *   multiplier    — current_rate must exceed baseline * multiplier to trigger
 *   minThreshold  — absolute floor; active when baseline is zero (new system).
 *                   For CRITICAL events like redis_fallback_mode set to 1 so
 *                   the very first occurrence triggers regardless of baseline.
 *   dbEventType   — corresponding auth_audit_logs.event value for cross-instance
 *                   DB aggregation. null for infra events that have no audit entry.
 */

export type AnomalySeverity  = 'CRITICAL' | 'WARNING' | 'INFO';
export type AnomalyEntityType = 'user' | 'company' | 'system';

export interface AnomalyConfig {
  type:         string;
  severity:     AnomalySeverity;
  entityType:   AnomalyEntityType;
  multiplier:   number;
  minThreshold: number;
  description:  string;
  /**
   * The event name as it appears in auth_audit_logs.
   * Used by the sweep detector and DB-count smoother to get the global
   * cross-instance count from the DB.  null = no auth_audit_logs source.
   */
  dbEventType:  string | null;
}

/**
 * Central registry. Add new anomaly types here; the engine picks them up
 * automatically without code changes elsewhere.
 */
export const ANOMALY_CONFIGS: Record<string, AnomalyConfig> = {
  // ── CRITICAL ──────────────────────────────────────────────────────────────

  redis_fallback_mode: {
    type:         'redis_fallback_mode',
    severity:     'CRITICAL',
    entityType:   'system',
    multiplier:   1,
    minThreshold: 1,   // any Redis failure triggers immediately
    description:  'Rate limiter fell back to in-memory mode — Redis unavailable',
    dbEventType:  null,
  },

  ghost_session_detected: {
    type:         'ghost_session_detected',
    severity:     'CRITICAL',
    entityType:   'user',
    multiplier:   3,
    minThreshold: 5,
    description:  'Valid Firebase token with no matching active DB user row',
    dbEventType:  'ghost_session_detected',  // matches auth_audit_logs.event
  },

  account_deleted_response: {
    type:         'account_deleted_response',
    severity:     'CRITICAL',
    entityType:   'user',
    multiplier:   3,
    minThreshold: 10,
    description:  'Spike in ACCOUNT_DELETED (AUTH_001) responses — possible replay attack',
    dbEventType:  null,
  },

  unauthorized_access: {
    type:         'unauthorized_access',
    severity:     'CRITICAL',
    entityType:   'company',
    multiplier:   3,
    minThreshold: 3,
    description:  'Requests rejected by RBAC / company-access guard',
    dbEventType:  'unauthorized_access_attempt',
  },

  role_escalation_attempt: {
    type:         'role_escalation_attempt',
    severity:     'CRITICAL',
    entityType:   'user',
    multiplier:   2,
    minThreshold: 2,
    description:  "Attempt to assign a role above the caller's own privilege level",
    dbEventType:  null,
  },

  // ── WARNING ───────────────────────────────────────────────────────────────

  rate_limit_triggered: {
    type:         'rate_limit_triggered',
    severity:     'WARNING',
    entityType:   'system',
    multiplier:   3,
    minThreshold: 20,
    description:  'Rate limit hit count exceeded baseline — possible brute-force or abuse',
    dbEventType:  null,
  },

  domain_validation_failed: {
    type:         'domain_validation_failed',
    severity:     'WARNING',
    entityType:   'company',
    multiplier:   3,
    minThreshold: 5,
    description:  'COMPANY_ADMIN invite rejected due to email domain mismatch',
    dbEventType:  'domain_validation_failed',
  },

  reinvite_deleted_user: {
    type:         'reinvite_deleted_user',
    severity:     'WARNING',
    entityType:   'user',
    multiplier:   2,
    minThreshold: 3,
    description:  'Repeated invite attempts on a soft-deleted account',
    dbEventType:  null,
  },

  onboarding_failure: {
    type:         'onboarding_failure',
    severity:     'WARNING',
    entityType:   'user',
    multiplier:   4,
    minThreshold: 10,
    description:  'Onboarding completion failure rate above baseline',
    dbEventType:  null,
  },
};

/** All anomaly types that have a DB source (for the sweep detector). */
export const SWEEP_EVENT_MAP: Record<string, string> = Object.fromEntries(
  Object.values(ANOMALY_CONFIGS)
    .filter(c => c.dbEventType !== null)
    .map(c => [c.dbEventType as string, c.type]),
);
