/**
 * CPG-002 — the pluggable evidence-source contract.
 *
 * MODELLED DELIBERATELY ON THE CERTIFIED PRECEDENT
 * `companyIntelligence/providers/contract.ts` already establishes how this
 * platform treats external sources: a source that cannot answer returns
 * `unavailable` WITH A DISTINGUISHABLE REASON and never synthesises a value.
 * That rule is reproduced here, because the failure it prevents — a fabricated
 * company fact that looks retrieved — is the single worst outcome for a
 * grounding system. An empty profile is honest; an invented one is not.
 *
 * ─── INVARIANTS ────────────────────────────────────────────────────────────
 *  1. NEVER FABRICATE. `retrieved` means a document was actually fetched and
 *     parsed. No credential, no coverage, and failure are each `unavailable`
 *     with a different reason, because the operator remedies differ completely.
 *  2. NEVER INFER. A source emits only what its document states. "The company
 *     has an About page, therefore it is enterprise-focused" is not a claim.
 *  3. EVERY CLAIM CARRIES ITS URL. A claim without a traceable source cannot be
 *     emitted — the CPG-001 contract and the DB CHECK both reject it.
 *  4. FAILURE IS ISOLATED. One source throwing must never abort acquisition.
 *  5. DETERMINISTIC. `asOf` and the fetcher are injected; no clock, no RNG, so
 *     identical documents produce byte-identical claims.
 *
 * This module performs NO I/O itself. Concrete sources receive an injected
 * fetcher, which in production is the `safeFetch` seam (HARDEN-005) and in
 * tests is a fixture — so the entire acquisition path is testable without a
 * single network call.
 */

import type { EvidenceClaim, EntitySignals } from '../types';

/** Why a source could not answer. These are OPERATOR facts and never collapsed. */
export type UnavailableReason =
  | 'no_credential'      // configured but no API key — remedy: add the key
  | 'capability_absent'  // no integration exists at all — remedy: build it
  | 'no_coverage'        // source answered, but does not know this company
  | 'invalid_url'        // the supplied reference is not a usable URL
  | 'retrieval_failed'   // network/HTTP failure
  | 'rate_limited'       // provider throttled us
  | 'not_permitted'      // retrieval would breach terms or policy
  | 'no_extractable_claims'; // fetched, parsed, but the document stated nothing usable

export type AcquisitionResult =
  | { state: 'retrieved'; claims: EvidenceClaim[]; documentsFetched: number }
  | { state: 'unavailable'; reason: UnavailableReason; detail: string };

export function retrieved(claims: EvidenceClaim[], documentsFetched: number): AcquisitionResult {
  return claims.length === 0
    ? { state: 'unavailable', reason: 'no_extractable_claims', detail: 'document(s) fetched but stated no usable claim' }
    : { state: 'retrieved', claims, documentsFetched };
}

export function unavailable(reason: UnavailableReason, detail: string): AcquisitionResult {
  return { state: 'unavailable', reason, detail };
}

/** Minimal fetch surface. Production passes `safeFetch`; tests pass a fixture. */
export type EvidenceFetcher = (
  url: string,
  opts: {
    allowedHosts?: string[];
    /** CPG-010: a larger cap for a known-large document (an annual report is ~2.6 MB). */
    maxBytes?: number;
    /** CPG-010: request headers a source's access policy asks for (SEC: a declared User-Agent). Never a credential. */
    headers?: Record<string, string>;
  },
) => Promise<{ ok: boolean; status: number; url: string; text: string } | null>;

export interface AcquisitionContext {
  companyId: string;
  /** What we already believe identifies this company, for entity resolution. */
  knownEntity: EntitySignals;
  companyDomain: string | null;
  /** Injected clock. Never read from the system. */
  asOf: string;
  fetcher: EvidenceFetcher;
  /** URLs the user explicitly supplied as evidence references. */
  userSuppliedUrls?: readonly string[];
}

export interface EvidenceSource {
  id: string;
  /** Human label used in reports and the capability matrix. */
  label: string;
  /**
   * True when this source could run right now. A source that is implemented but
   * uncredentialed must return false — availability is not implementation.
   */
  isAvailable(): Promise<boolean> | boolean;
  acquire(ctx: AcquisitionContext): Promise<AcquisitionResult>;
}

/** Deterministic claim id — same document + field + value ⇒ same id. */
export function claimId(sourceId: string, url: string | null, field: string, value: string): string {
  const basis = `${sourceId}|${url ?? 'none'}|${field}|${value}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) { h ^= basis.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${sourceId}-${h.toString(16).padStart(8, '0')}`;
}

/** Normalise a value for cross-source comparison. Mirrors CPG-001 folding. */
export function normalizeValue(v: string): string {
  return v.toLowerCase().replace(/\s+/g, ' ').trim();
}
