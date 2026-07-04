/**
 * Provider Failure Governance  (BETA-ENGINE-004, Phase 5)
 *
 * Deterministic, exhaustive failure taxonomy. EVERY provider failure becomes canonical Evidence
 * (maturity UNAVAILABLE) with a reason code and provenance — there are NO silent failures. Reuses the
 * BETA-ARCH-001 Evidence model; no external API, no synthesis.
 */
import { createEvidence, type Evidence } from '../evidenceModel';
import { buildProvenance } from '../provenance';

export const PROVIDER_FAILURE = {
  /** No adapter configured / provider not wired. */
  UNAVAILABLE: 'unavailable',
  /** Missing or invalid credentials. */
  UNAUTHORIZED: 'unauthorized',
  /** Rate limit / quota exhausted. */
  QUOTA_EXCEEDED: 'quota_exceeded',
  /** Request exceeded the time budget. */
  TIMEOUT: 'timeout',
  /** Response returned but incomplete. */
  PARTIAL_RESPONSE: 'partial_response',
  /** Response returned but failed validation. */
  INVALID_DATA: 'invalid_data',
  /** Provider is deprecated and must not be used. */
  DEPRECATED: 'deprecated',
} as const;
export type ProviderFailureState = (typeof PROVIDER_FAILURE)[keyof typeof PROVIDER_FAILURE];

export const ALL_PROVIDER_FAILURES: ProviderFailureState[] = Object.values(PROVIDER_FAILURE);

/** A structured provider failure. */
export interface ProviderFailure {
  providerId: string;
  state: ProviderFailureState;
  /** Human-readable reason (surfaced verbatim). */
  reason: string;
  /** The evidence key this failure pertains to (what the provider would have supplied). */
  evidenceKey: string;
  /** When the failure was observed (ISO). */
  observedAt?: string | null;
  /** Whether any partial evidence accompanies the failure (for PARTIAL_RESPONSE). */
  partial?: boolean;
}

/** Machine reason code for a failure state, e.g. `PROVIDER_UNAUTHORIZED`. */
export function failureReasonCode(state: ProviderFailureState): string {
  return `PROVIDER_${state.toUpperCase()}`;
}

/**
 * Convert a provider failure into canonical Evidence. Deterministic — timestamps are passed in, not
 * generated. The value is always null (no data), maturity UNAVAILABLE, with the reason code + reason
 * captured in metadata + provenance. This is how "no silent failures" is enforced: a failing provider
 * still produces a first-class, explainable evidence record.
 */
export function failureToEvidence(failure: ProviderFailure): Evidence {
  const code = failureReasonCode(failure.state);
  return createEvidence({
    engineId: `provider:${failure.providerId}`,
    key: failure.evidenceKey,
    value: null,
    maturity: 'UNAVAILABLE',
    sourceType: 'external_api',
    observationType: 'event',
    observedAt: failure.observedAt ?? null,
    collectedAt: failure.observedAt ?? null,
    validationStatus: failure.state === 'invalid_data' ? 'failed' : 'not_applicable',
    provenance: buildProvenance({
      origin: `provider:${failure.providerId}`,
      collector: 'evidence_provider_framework',
      engine: `provider:${failure.providerId}`,
      version: '1.0.0',
      timestamp: failure.observedAt ?? null,
    }),
    metadata: {
      failure_state: failure.state,
      reason_code: code,
      reason: failure.reason,
      partial: failure.partial ?? false,
    },
  });
}

/** Build a canonical "unavailable" failure for an unwired provider (the default state). */
export function unavailableFailure(providerId: string, evidenceKey: string, reason: string): ProviderFailure {
  return { providerId, state: PROVIDER_FAILURE.UNAVAILABLE, reason, evidenceKey };
}
