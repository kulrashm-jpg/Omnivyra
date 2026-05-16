/**
 * Phase 1 — Monitoring eligibility evaluator.
 *
 * Pure validators that answer: "given the current capability aggregate for
 * a tenant + platform, can monitoring be started safely?" The answer is
 * advisory: this service NEVER starts anything. It exists so that any
 * future activation path is forced to consult a single deterministic gate
 * rather than re-deriving rules ad hoc.
 *
 * Decision is structured: { eligible, blockers[] }. Empty blockers ⇒
 * eligible. Blockers are stable string codes suitable for UI badges and
 * structured logs. The set of blocker codes is the public contract.
 */

import type {
  CapabilityAggregate,
  PlatformAggregate,
} from './capabilityAggregationService';
import { LISTENING_SCOPE_REQUIREMENTS } from './capabilityAggregationService';

export const ELIGIBILITY_BLOCKER_CODES = [
  'oauth_not_connected',
  'listen_capability_not_enabled',
  'consent_not_active',
  'consent_stale',
  'scope_insufficient',
  'no_ready_source',
  'platform_unknown',
] as const;
export type EligibilityBlockerCode = (typeof ELIGIBILITY_BLOCKER_CODES)[number];

export type EligibilityBlocker = {
  code: EligibilityBlockerCode;
  detail?: string;
};

export type EligibilityDecision = {
  eligible: boolean;
  blockers: EligibilityBlocker[];
};

const CONSENT_FRESHNESS_DAYS = 180;

/**
 * Per-platform eligibility decision against a pre-built aggregate. Pure
 * function — no I/O, no side effects. Returns an EMPTY blockers array iff
 * monitoring can be safely activated for this (org, platform) pair.
 */
export function evaluateMonitoringEligibility(
  aggregate: CapabilityAggregate,
  platform: string,
): EligibilityDecision {
  const normalised = platform.toLowerCase();
  const platformRow = aggregate.platforms.find((p) => p.platform === normalised);

  const blockers: EligibilityBlocker[] = [];

  if (!platformRow) {
    blockers.push({ code: 'platform_unknown', detail: platform });
    return { eligible: false, blockers };
  }

  if (!platformRow.is_connected) {
    blockers.push({ code: 'oauth_not_connected' });
  }

  const listenRow = platformRow.capabilities.find((c) => c.capability === 'listen');
  if (!listenRow || !listenRow.enabled || listenRow.status !== 'active') {
    blockers.push({ code: 'listen_capability_not_enabled' });
  }

  const listenConsentAge = listenRow?.consent_record_age_days ?? null;
  if (listenConsentAge == null) {
    blockers.push({ code: 'consent_not_active' });
  } else if (listenConsentAge > CONSENT_FRESHNESS_DAYS) {
    blockers.push({ code: 'consent_stale', detail: `${listenConsentAge}d` });
  }

  const required = LISTENING_SCOPE_REQUIREMENTS[normalised] ?? [];
  const missing = required.filter((s) => !platformRow.granted_scopes.includes(s));
  if (missing.length > 0) {
    blockers.push({ code: 'scope_insufficient', detail: missing.join(',') });
  }

  const hasReadySource = aggregate.listening_sources.some((s) => {
    return s.status === 'active' || s.status === 'approved';
  });
  // The aggregate doesn't link sources to platforms directly today — Phase 0
  // shipped that linkage via metadata.platform. We re-check that here.
  // If the org has zero ready sources at all, surface as a blocker; once
  // listening_sources gets a proper integration_id, this tightens to a
  // per-platform check.
  if (!hasReadySource && platformRow.is_connected) {
    blockers.push({ code: 'no_ready_source' });
  }

  return { eligible: blockers.length === 0, blockers };
}

/**
 * Cross-tenant batch evaluation for ops consoles. Wraps the per-platform
 * evaluator over every platform in an aggregate.
 */
export function evaluateAllPlatforms(
  aggregate: CapabilityAggregate,
): Record<string, EligibilityDecision> {
  const decisions: Record<string, EligibilityDecision> = {};
  for (const p of aggregate.platforms) {
    decisions[p.platform] = evaluateMonitoringEligibility(aggregate, p.platform);
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// Source state machine
// ---------------------------------------------------------------------------

/**
 * Deterministic listening_sources lifecycle. The aggregator and eligibility
 * evaluator look at `status` directly; this state machine validates
 * transition requests so the field cannot land in an invalid state. Phase 1
 * does not yet apply this in writers — Phase 2 (when activation lands)
 * will gate every `updateListeningSourceStatus` call through this validator.
 */

export const SOURCE_STATES = [
  'inactive',
  'available_for_listening',
  'consent_required',
  'scope_upgrade_required',
  'ready',
  'suspended',
  'revoked',
] as const;
export type SourceLifecycleState = (typeof SOURCE_STATES)[number];

const ALLOWED_TRANSITIONS: Record<SourceLifecycleState, SourceLifecycleState[]> = {
  inactive: ['available_for_listening', 'revoked'],
  available_for_listening: ['consent_required', 'inactive', 'revoked'],
  consent_required: ['scope_upgrade_required', 'ready', 'inactive', 'revoked'],
  scope_upgrade_required: ['consent_required', 'ready', 'inactive', 'revoked'],
  ready: ['suspended', 'revoked'],
  suspended: ['ready', 'revoked'],
  revoked: [],
};

export type TransitionDecision = {
  allowed: boolean;
  reason?: string;
};

export function canTransitionSource(
  from: SourceLifecycleState,
  to: SourceLifecycleState,
): TransitionDecision {
  if (from === to) {
    return { allowed: false, reason: 'no_op_same_state' };
  }
  const allowed = (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `transition_${from}_to_${to}_not_permitted` };
}

/**
 * Derive the canonical lifecycle state from a single platform aggregate
 * without mutating anything. Useful for diagnostics and UI badges.
 */
export function deriveSourceLifecycleState(
  platform: PlatformAggregate,
): SourceLifecycleState {
  if (!platform.is_connected) return 'inactive';
  const listen = platform.capabilities.find((c) => c.capability === 'listen');
  if (!listen) return 'available_for_listening';
  if (listen.status === 'revoked') return 'revoked';
  if (!listen.enabled) return 'consent_required';

  const scopeBlocker = platform.monitoring_blockers.find((b) =>
    b.startsWith('scope_insufficient'),
  );
  if (scopeBlocker) return 'scope_upgrade_required';

  if (platform.monitoring_ready) return 'ready';
  if (platform.monitoring_blockers.includes('consent_stale')) return 'suspended';
  return 'consent_required';
}
