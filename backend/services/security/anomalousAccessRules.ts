/**
 * Anomalous-access detector — RULES (design: 6f DESIGN-anomalous-access Rev 1-5, 05 reviewed, e9 APPROVED 2026-11-13).
 *
 * Two kinds of rule, kept in SEPARATE constant groups on purpose (e9: write the distinction down so nobody
 * "harmonises" them later):
 *   - RATE rules (R1a, R1b, R2, R3, R5): one actor doing N of something in a 10-minute window. Each threshold sits just
 *     above the largest plausible LEGITIMATE batch for that action class (05) - it is PROVISIONAL and carries its basis
 *     and its re-measure trigger. Re-baseline when ANY of: (1) logAuditEvent rows start landing (PL-12 fix: the
 *     dataset stops being partial); (2) six weeks of post-launch traffic; (3) a rule fires 3 times in a week with no
 *     true positive (the heartbeat carries per-rule 7-day fire counts so (3) is observable).
 *   - IDENTITY rules (R4, R7): ONE event is the signal by definition. Their threshold is 1 and is never raised.
 *
 * RULE (05): when PL-12 lands (logAuditEvent rows start landing), RE-DERIVE EVERYTHING DERIVED FROM HISTORICAL AUDIT
 * VOLUME - not a list to remember, a class. Today's instances: (a) the RATE thresholds below; (b) the worst-window
 * negative control in anomalousAccessDetector.test.ts; (c) SOURCE_ROW_LIMIT in jobs/anomalousAccessScanJob.ts (sized
 * against today's non-AI volume; if wrong it fails LOUDLY - every run reports the source truncated). Any new value
 * derived from audit volume joins this class without an edit here.
 * A test fails any rate threshold whose basis lacks a date + re-measure trigger, and any identity threshold != 1.
 */

export const WINDOW_MINUTES = 10;
export const SCAN_INTERVAL_MINUTES = 5;
/** Cooldown per rule + actor: a storm alerts once per hour, not on every 5-minute run. */
export const COOLDOWN_SECONDS = 3600;

export type RateRuleId = 'R1a_bulk_membership_growth' | 'R1b_sensitive_privileged' | 'R2_denial_burst'
  | 'R3_stepup_failure_burst' | 'R5_target_fanout';
export type IdentityRuleId = 'R4_privileged_actor_not_allowlisted' | 'R7_system_unexpected_action';
export type SyntheticRuleId = 'synthetic_trip';
export type RuleId = RateRuleId | IdentityRuleId | SyntheticRuleId;

export interface ThresholdSpec {
  threshold: number;
  /** Basis + re-measure trigger. Format enforced by a test: must contain a YYYY-MM-DD date and "re-measure". */
  basis: string;
  /** The date the basis was set - drives oldest_threshold_basis_age_days on the heartbeat. */
  basisDate: string;
}

const REMEASURE = 're-measure when logAuditEvent rows land, after 6 weeks of prod traffic, or after 3 fires/week with no true positive';

export const RATE_THRESHOLDS: Record<RateRuleId, ThresholdSpec> = {
  R1a_bulk_membership_growth: {
    threshold: 12,
    basis: `>=12: provisional, largest plausible legitimate batch = a team onboarding of ~10 invites (05, 2026-11-13); C87 observed max 1 on a near-empty, partial history; ${REMEASURE}`,
    basisDate: '2026-11-13',
  },
  R1b_sensitive_privileged: {
    threshold: 4,
    basis: `>=4: provisional, sensitive actions are rare at 9 companies; UPDATE_USER_ROLE kept here deliberately (role elevation) (05, 2026-11-13); C87 observed max 1; ${REMEASURE}`,
    basisDate: '2026-11-13',
  },
  R2_denial_burst: {
    threshold: 5,
    basis: `>=5: provisional, a human clicking into forbidden screens makes 2-3 denials, a probe many (05, 2026-11-13); C87 observed max 2; ${REMEASURE}`,
    basisDate: '2026-11-13',
  },
  R3_stepup_failure_burst: {
    threshold: 5,
    basis: `>=5: provisional, a TOTP + recovery-code fumble reaches 3-4, limiters lock near 5 (05, 2026-11-13); C87 observed max 2 supports it; ${REMEASURE}`,
    basisDate: '2026-11-13',
  },
  R5_target_fanout: {
    threshold: 15,
    basis: `>=15: provisional, distinct target users; benign onboarding touches ~10 (05, 2026-11-13); C87 observed max 1; ${REMEASURE}`,
    basisDate: '2026-11-13',
  },
};

export const IDENTITY_THRESHOLDS: Record<IdentityRuleId, ThresholdSpec> = {
  R4_privileged_actor_not_allowlisted: {
    threshold: 1,
    basis: 'IDENTITY rule: one privileged action by an actor outside the config allowlist IS the signal (e9 approved 2026-11-13); never raised; re-measure not applicable',
    basisDate: '2026-11-13',
  },
  R7_system_unexpected_action: {
    threshold: 1,
    basis: 'IDENTITY rule: SYSTEM_USER_ID performing a privileged action outside its expected set IS the signal; C87 M2 = 0 historical rows (2026-11-13); never raised; re-measure not applicable',
    basisDate: '2026-11-13',
  },
};

// ── action sets ─────────────────────────────────────────────────────────────────────────────────────────────────

/** R1a - bulk membership growth (benign in bulk during onboarding). */
export const R1A_ACTIONS: ReadonlySet<string> = new Set(['INVITE_USER', 'COMPANY_ADMIN_INVITE_CREATE']);

/**
 * R1b - sensitive privileged actions (exact names). SUPER_ADMIN_* and ADMIN_* (super_admin_audit_logs: credits,
 * pricing, cron / queue / rate-limit config, org controls - all platform-wide privileged operations) are matched by
 * PREFIX in isSensitivePrivileged, so a new one is covered without an edit.
 */
export const R1B_ACTIONS: ReadonlySet<string> = new Set([
  'DEACTIVATE_USER', 'REMOVE_USER', 'UPDATE_USER_ROLE',
  'DOMAIN_REASSIGNED', 'DOMAIN_TOKEN_REGENERATED',
  'UPDATE_COMMUNITY_AI_PLATFORM_POLICY', 'EXTERNAL_API_GLOBAL_PRESET_ENABLED',
  // super_admin_audit_logs credit actions
  'ADMIN_CREDITS_GRANT', 'ADMIN_CREDITS_ADJUST', 'ADMIN_CREDITS_SET_RATE', 'SUPER_ADMIN_CREDITS_GRANT',
]);

/** R2 - denials. SUPER_ADMIN_INVITE_REJECTED is a denial, never a privileged action. */
export const R2_ACTIONS: ReadonlySet<string> = new Set([
  'PERMISSION_DENIED', 'PRIVILEGED_MEMBERSHIP_MUTATION_DENIED', 'PRIVILEGED_MEMBERSHIP_DELETE_DENIED',
  'SUPER_ADMIN_INVITE_REJECTED',
]);

/** R3 - capability_audit_log FAILURE decisions. Prompts (step_up_required / stepup_required / ...) are normal flow. */
export const R3_DECISIONS: ReadonlySet<string> = new Set([
  'totp_verification_failed', 'passkey_auth_failed', 'stepup_session_rejected',
]);

/** Actions that are neither privileged nor denials (pinned so a NEW action string must be classified, see tests). */
export const NOT_MONITORED_ACTIONS: Readonly<Record<string, string>> = {
  AI_GATEWAY_CALL: 'AI usage; actor is always NULL (known limitation F-a) - per-company rule R6 is post-launch',
  INVITATION_ACCEPTED: 'the invitee accepting, not an admin acting',
  INVITE_FAILED: 'an error outcome of INVITE_USER (already counted on success)',
  TRACKING_LINK_CLICK: 'public tracking event',
  STRATEGY_REAPPROVAL_REQUIRED: 'workflow signal, system-written',
  COMMUNITY_AI_PLATFORM_POLICY_BLOCK: 'policy block with a NULL actor',
  // literals the classification pin sees near writers that are NOT action values (role names / metadata.action /
  // error codes) - listed so the pin stays exhaustive
  SUPER_ADMIN: 'role name, not an action',
  COMPANY_ADMIN: 'role name, not an action',
  ASSIGN_ROLE: 'metadata.action inside a PERMISSION_DENIED row (the row itself is R2)',
  CREATE_USER: 'metadata.action inside a PERMISSION_DENIED row (the row itself is R2)',
  IDEMPOTENCY_RECOVERY: 'idempotency bookkeeping on an admin action, not an action of its own',
  IDEMPOTENCY_SAFE_RETRY: 'idempotency bookkeeping on an admin action, not an action of its own',
};

/** Workflow / product actions (tenant users doing their normal work) - not access anomalies. */
export const NOT_MONITORED_PREFIXES: readonly string[] = [
  'RECOMMENDATION', 'CAMPAIGN_STRATEGY', 'PLATFORM_FREQUENCY_REBALANCE', 'PREVIEW_', 'REGION_', 'TREND_',
  'MARKETING_', 'REVISE_STRATEGY', 'STRATEGY_',
];

/** The marker a deliberate SYNTHETIC TRIP writes (05 Gap A): proves log line -> Loki -> Grafana -> inbox. */
export const SYNTHETIC_TRIP_ACTION = 'ANOMALOUS_ACCESS_SYNTHETIC_TRIP';

export function isSensitivePrivileged(action: string): boolean {
  if (R2_ACTIONS.has(action)) return false;
  if (action === SYNTHETIC_TRIP_ACTION) return false;
  return R1B_ACTIONS.has(action) || action.startsWith('SUPER_ADMIN_') || action.startsWith('ADMIN_');
}

export function isPrivileged(action: string): boolean {
  return R1A_ACTIONS.has(action) || isSensitivePrivileged(action);
}

/**
 * R7 expected-action set for SYSTEM_USER_ID - CONFIG with a written reason per entry (05): adding one is a recorded,
 * reviewed act, never an edit made under alert pressure. EMPTY at launch: C87 M2 found 0 SYSTEM privileged rows.
 */
export const SYSTEM_EXPECTED_PRIVILEGED_ACTIONS: Readonly<Record<string, string>> = {};
