/**
 * WS-4 Phase-2 — Company Enrichment Provider contract.
 *
 * WHY THIS EXISTS. Every CI-C3xx engine is implemented, deterministic and
 * evidence-carrying — and every one abstains on missing input:
 * `runTechnology`, `runFinancial`, `runGrowth` and `runEnrichment` all open with
 * `if (!x) return emptyOutput(ENGINE)`. They are not incomplete; they are
 * starved. `EvidenceSources.firmographics` has no producer anywhere in the
 * repository. This contract is that producer's shape.
 *
 * MODELLED ON THE CERTIFIED PRECEDENT. `backend/services/intelligence/
 * providerInterfaces.ts` already establishes how this platform treats external
 * providers: a provider that cannot answer returns `unavailable` with a reason
 * and NEVER synthesises a number. That rule is reproduced here verbatim in
 * spirit, because the failure it prevents — a fabricated firmographic that
 * looks measured — is worse than an empty profile. An empty profile is honest.
 *
 * ─── THE THREE INVARIANTS ──────────────────────────────────────────────────
 *  1. NEVER FABRICATE. `state: 'measured'` means a provider actually answered.
 *     Absent credentials, absent coverage and provider failure are all
 *     `unavailable`, each with a distinguishable reason — an operator must be
 *     able to tell "not configured" from "configured but this company is not in
 *     their dataset", because the remedies are completely different.
 *  2. NEVER GUESS CONFIDENCE. Confidence is what the provider asserts, or the
 *     adapter's documented constant for that field. It is never derived from
 *     how much we would like the value to be true.
 *  3. DETERMINISTIC. `asOf` is injected; no adapter reads a clock, and no
 *     adapter uses randomness. Identical inputs and identical provider
 *     responses produce a byte-identical aggregate — which is what makes the
 *     result cacheable and the pipeline replayable.
 */

/** What a provider can answer. Deliberately coarse: routing keys, not schema. */
export type EnrichmentCapability =
  | 'firmographics'  // headcount, revenue band, founded year, HQ, size, country
  | 'technology'     // detected stack
  | 'funding'        // stage, total raised, valuation
  | 'hiring'         // open roles and hiring-velocity signals
  | 'identity';      // canonical domain, LinkedIn handle, legal name

export const ENRICHMENT_CAPABILITIES: readonly EnrichmentCapability[] = [
  'firmographics', 'technology', 'funding', 'hiring', 'identity',
] as const;

/**
 * Why a provider produced nothing. These are NOT interchangeable:
 * `no_credential` is an operator task, `no_coverage` is a data-set fact,
 * `provider_error` is an incident, and `not_capable` is a routing mistake.
 * Collapsing them would make "we have no data" unactionable.
 */
export type UnavailableReason =
  | 'no_credential'
  | 'no_coverage'
  | 'provider_error'
  | 'rate_limited'
  | 'not_capable'
  | 'insufficient_input';

export type ProviderState = 'measured' | 'unavailable';

/** One enriched field. `value` is always a string: the canonical evidence value type. */
export interface EnrichmentField {
  /** Stable key the aggregator resolves conflicts on, e.g. `headcount`. */
  key: string;
  value: string;
  /** 0..1, asserted by the provider or the adapter's documented constant. */
  confidence: number;
  /** When the underlying fact was observed — NOT when we fetched it. */
  observedAt: string;
}

export interface ProviderResult {
  provider: string;
  capability: EnrichmentCapability;
  state: ProviderState;
  fields: EnrichmentField[];
  reasonUnavailable: UnavailableReason | null;
  /** Human-readable detail behind `reasonUnavailable`. Never a stack trace. */
  detail: string | null;
  /**
   * Metered calls cost money. Recording units per result is what makes "never
   * enrich twice" auditable rather than aspirational.
   */
  costUnits: number;
}

export interface EnrichmentRequest {
  companyId: string;
  /** The strongest identity signal most vendors key on. */
  domain: string | null;
  companyName: string | null;
  /** Injected instant. No adapter may read a clock. */
  asOf: string;
}

export interface CompanyEnrichmentProvider {
  readonly id: string;
  readonly capabilities: readonly EnrichmentCapability[];
  /**
   * Conflict precedence, LOWER WINS, and only as a TIE-BREAK after confidence.
   * It encodes "whose data do we trust when both are equally confident", which
   * is a standing judgement about the vendor rather than about this request —
   * so it belongs on the provider, not in the call.
   */
  readonly precedence: number;
  /** True when a credential exists. Must not perform I/O. */
  isConfigured(): boolean;
  /**
   * Answer one capability. MUST NOT throw: an adapter that throws would take
   * down an aggregate that other providers could still have served. Failure is
   * a returned `unavailable`, not an exception.
   */
  fetch(request: EnrichmentRequest, capability: EnrichmentCapability): Promise<ProviderResult>;
}

/** Convenience constructor for the overwhelmingly common "nothing to report" case. */
export function unavailable(
  provider: string,
  capability: EnrichmentCapability,
  reason: UnavailableReason,
  detail: string | null = null,
): ProviderResult {
  return { provider, capability, state: 'unavailable', fields: [], reasonUnavailable: reason, detail, costUnits: 0 };
}

export function measured(
  provider: string,
  capability: EnrichmentCapability,
  fields: EnrichmentField[],
  costUnits = 1,
): ProviderResult {
  // A "measured" result with no fields is a contract violation waiting to be a
  // silent data loss, so it degrades to the honest state instead.
  if (fields.length === 0) return unavailable(provider, capability, 'no_coverage', 'provider answered with no fields');
  return { provider, capability, state: 'measured', fields, reasonUnavailable: null, detail: null, costUnits };
}
