/**
 * Provider Evidence Adapter Contract  (BETA-ENGINE-004, Phase 3)
 *
 * Every provider MUST convert its provider-specific response into the canonical Evidence model through
 * an adapter implementing this contract. No engine may consume a provider-specific payload directly —
 * the adapter is the only bridge. Architecture only: no concrete adapter ships this phase.
 */
import type { Evidence } from '../evidenceModel';
import type { ProviderFailure } from './providerFailure';
import { failureToEvidence } from './providerFailure';

/**
 * Converts a raw provider response (`TRaw`) into canonical `Evidence[]`. Implementations must be
 * deterministic and must map provider failures through `failureToEvidence` (never throw, never
 * fabricate). `TRaw` is provider-specific and never leaks past the adapter boundary.
 */
export interface ProviderEvidenceAdapter<TRaw = unknown> {
  readonly providerId: string;
  /** The canonical evidence keys this adapter emits. */
  readonly supportedEvidence: string[];
  /** Map a successful raw response to canonical evidence. */
  toEvidence(raw: TRaw, context: AdapterContext): Evidence[];
  /** Map a failure to canonical evidence (default provided by `baseAdapterFailure`). */
  onFailure(failure: ProviderFailure): Evidence[];
}

/** Context passed to adapters — deterministic inputs only (no clock access inside adapters). */
export interface AdapterContext {
  /** When the underlying observation happened (ISO), for provenance/freshness. */
  observedAt?: string | null;
  /** The company/entity the evidence pertains to. */
  subjectId?: string | null;
}

/** Default failure mapping every adapter can reuse — one failure → one canonical Evidence. */
export function baseAdapterFailure(failure: ProviderFailure): Evidence[] {
  return [failureToEvidence(failure)];
}
