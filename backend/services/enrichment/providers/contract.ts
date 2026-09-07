/**
 * A3 — the provider-neutral enrichment contract.
 *
 * The seam where a provider's own shapes STOP. Everything above this file
 * speaks canonical attributes; everything below is one adapter's problem.
 *
 * ─── WHY THE OUTCOME IS A UNION, NOT A NULLABLE RESULT ────────────────────
 * "We asked and the provider had nothing" and "we never asked because there is
 * no credential" are different facts about a prospect, and collapsing both into
 * an absent value is how a record becomes permanently, invisibly incomplete.
 * PI's standing invariant is that absence is never intelligence, so every way
 * an enrichment can fail to produce a value is named here and survives to the
 * caller.
 *
 * This module is PURE: types, vocabularies and one classifier. No network, no
 * database, no clock, no credential.
 */

import type { SourceCost } from '../planner';

/** Canonical entity an enrichment is about. */
export type EnrichmentSubject = 'person' | 'account';

/**
 * Why an enrichment produced no value. Each one implies a different next
 * action, which is the entire reason they are not one `null`.
 */
export const ENRICHMENT_OUTCOMES = [
  'enriched',              // the provider returned at least one usable field
  'no_match',              // the provider looked and does not know this entity
  'field_not_found',       // matched, but did not hold the requested field
  'provider_declined',     // the provider refused this request
  'provider_unavailable',  // reachable-but-erroring, or not reachable at all
  'credential_missing',    // never asked: no credential is configured
  'not_implemented',       // never asked: the adapter does not exist
  'quota_exceeded',        // the provider's own limit
  'cost_denied',           // OUR limit — refused before any external call
  'rate_limited',
  'timeout',
  'malformed_response',
  'duplicate_suppressed',  // an equivalent request is already fresh enough
] as const;
export type EnrichmentOutcome = typeof ENRICHMENT_OUTCOMES[number];

/** Outcomes that mean no external call was made. Never billable. */
export const NON_CALLING_OUTCOMES: readonly EnrichmentOutcome[] = [
  'credential_missing', 'not_implemented', 'cost_denied', 'duplicate_suppressed',
];

/** A provider's declared operational state. Mirrors `dataSourceCatalogue`. */
export const PROVIDER_STATES = [
  'declared',        // named by the architecture; no adapter exists
  'implemented',     // adapter exists; no credential configured
  'operational',     // adapter + credential; can be called
] as const;
export type ProviderState = typeof PROVIDER_STATES[number];

/** What the caller asks for. The tenant is always the VERIFIED one. */
export interface EnrichmentRequest {
  readonly organizationId: string;
  readonly subject: EnrichmentSubject;
  /** Canonical entity id — `unified_persons.id` or `prospect_accounts.id`. */
  readonly entityId: string;
  /** Canonical attribute names. Provider-specific names never appear here. */
  readonly attributes: readonly string[];
  /**
   * Identity the provider can actually search on, e.g. an email domain or a
   * company name. Supplied by the caller from canonical data — never invented
   * by the adapter, and never a value the client supplied unverified.
   */
  readonly selectors: Readonly<Record<string, string>>;
  /** Why this enrichment is being requested. Recorded, never sent onward. */
  readonly purpose: string;
  /** Correlates the attempt across logs, cost and provenance. */
  readonly correlationId: string;
  /**
   * A3M — the TENANT's provider credential, resolved and injected by the
   * executor immediately before the call.
   *
   * An adapter must use this and must NOT read `process.env` for a credential.
   * Reading the environment would resolve one shared Omnivyra key for every
   * tenant, which is the defect A3M exists to remove: the caller would believe
   * it authorised Tenant A while the bill and the rate limit belong to
   * whoever's key happens to be configured.
   *
   * Optional only because the executor is what populates it; by the time an
   * adapter sees the request it is always present, because a null credential
   * ends the attempt at `credential_missing` before any adapter is reached.
   * Never logged, never persisted, never returned in a result.
   */
  readonly credential?: string;
}

/**
 * One field a provider actually returned.
 *
 * `observedAt` is the provider's own timestamp when it supplies one — never
 * our clock dressed up as theirs. `confidence` is passed through ONLY when the
 * provider states it; we never manufacture a number to fill the column.
 */
export interface ProviderField {
  readonly attribute: string;
  readonly subject: EnrichmentSubject;
  readonly value: unknown;
  readonly observedAt: string | null;
  readonly confidence: number | null;
  /** True only when the provider labelled the value as its own inference. */
  readonly providerInferred: boolean;
}

export interface ProviderResponse {
  readonly outcome: EnrichmentOutcome;
  readonly fields: readonly ProviderField[];
  /** Attributes asked for that the provider did not return. */
  readonly notReturned: readonly string[];
  /** Provider's own cost signal, when it reports one. */
  readonly cost?: SourceCost;
  /** Diagnostic only. Must never contain a credential or a full payload. */
  readonly detail?: string;
  /**
   * A stable hash of the provider's raw payload, for `source_records.payload_hash`.
   * The adapter computes it; the raw payload itself never leaves the adapter
   * except through the persistence port.
   */
  readonly payloadHash?: string | null;
  /**
   * A6A — when the provider says it may be asked again, as an ISO-8601 instant.
   *
   * Present ONLY when the provider actually supplied a usable horizon. It is
   * never synthesised: no backoff, no fixed duration, nothing derived from the
   * attempt number. Absent means the provider said nothing usable, which a
   * future consumer must treat as "no opinion" rather than "retry now".
   */
  readonly retryAfterAt?: string | null;
  /** The raw payload, for `source_records.raw_payload`. Adapter-shaped. */
  readonly rawPayload?: unknown;
}

/**
 * One provider adapter. The ONLY place a provider's own request and response
 * shapes are allowed to exist.
 */
export interface EnrichmentProviderAdapter {
  readonly id: string;
  readonly label: string;
  /** Canonical attributes this provider can answer. Declared, not guessed. */
  readonly supports: readonly string[];
  /** Env var holding the credential, or null when the provider needs none. */
  readonly credentialEnvVar: string | null;
  /**
   * Whether a real call could be made right now. Checks configuration only —
   * it never contacts the provider, so it is free and safe to call.
   */
  isAvailable(): boolean;
  /**
   * Perform the enrichment. Implementations MUST route outbound traffic through
   * `lib/security/safeFetch` and MUST NOT retry internally — retry, backoff and
   * cost are the executor's, so a paid call is never multiplied by a layer that
   * cannot see the bill.
   */
  enrich(request: EnrichmentRequest): Promise<ProviderResponse>;
}

/** A refusal that costs nothing and calls nobody. */
export const refuse = (
  outcome: EnrichmentOutcome, notReturned: readonly string[], detail?: string,
  retryAfterAt?: string | null,
): ProviderResponse => ({ outcome, fields: [], notReturned, detail, retryAfterAt: retryAfterAt ?? null });

/**
 * A6A — read a provider's `Retry-After` as an ABSOLUTE instant.
 *
 * ─── WHY THIS IS PARSED AND NOT INVENTED ──────────────────────────────────
 * A6 found this the one piece of information the pipeline actually DESTROYS.
 * A rate-limited attempt records THAT it was limited and nothing about when the
 * limit lifts, so a future consumer could only guess — and guessing at a
 * vendor's reset is how a tenant's account gets hammered. Everything else a
 * scheduler needs is derivable from what is already stored; this is not,
 * because it exists only in a response header that is currently dropped.
 *
 * ─── ABSOLUTE, NOT RELATIVE ───────────────────────────────────────────────
 * RFC 9110 allows two forms, and only one of them survives storage. A
 * delta-seconds value is meaningless once written to a row — "120 seconds" from
 * WHEN? — so it is resolved against `now` at the moment of reading and stored as
 * an instant. `now` is a parameter rather than a call to the clock so the
 * conversion is deterministic and testable.
 *
 * ─── MALFORMED MEANS ABSENT, NEVER A GUESS ────────────────────────────────
 * Anything unusable returns null: a non-numeric non-date, a negative or
 * fractional delta, an unparseable date, or a date already in the past. Absent
 * is a truthful "the provider said nothing usable"; a fabricated timestamp
 * would be indistinguishable from a real one and would licence a retry the
 * provider never authorised. This mirrors the conservatism of
 * `classifyEnrichmentError`, which turns anything unrecognised into
 * `provider_unavailable` rather than a confident verdict.
 *
 * Returns an ISO-8601 instant, matching every other timestamp in this
 * programme (`startedAt`, `completedAt`, `observedAt`).
 */
export function parseRetryAfter(header: string | null | undefined, now: Date): string | null {
  if (typeof header !== 'string') return null;
  const raw = header.trim();
  if (!raw) return null;

  // delta-seconds: a non-negative INTEGER count. `Number()` alone would accept
  // '1e3', '0x10' and ' 12 ', so the shape is asserted before it is trusted.
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds)) return null;
    return new Date(now.getTime() + seconds * 1000).toISOString();
  }

  // HTTP-date. A horizon already in the past authorises nothing, so it is
  // treated as absent rather than as "retry immediately" — the provider may
  // have meant a clock we do not share.
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  if (at <= now.getTime()) return null;
  return new Date(at).toISOString();
}

/**
 * Map a transport/provider error onto the outcome vocabulary.
 *
 * Deliberately conservative: anything unrecognised becomes
 * `provider_unavailable`, never `no_match`. Reading an unknown error as "the
 * provider does not know this person" would write a negative fact out of our
 * own failure.
 */
export function classifyEnrichmentError(err: unknown): EnrichmentOutcome {
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  const status = (err as { status?: number; statusCode?: number } | null)?.status
    ?? (err as { statusCode?: number } | null)?.statusCode;

  if (status === 429 || /rate.?limit|too many requests/.test(message)) return 'rate_limited';
  if (status === 402 || /quota|insufficient credit|payment required/.test(message)) return 'quota_exceeded';
  if (status === 401 || status === 403 || /unauthor|forbidden|invalid api key/.test(message)) return 'provider_declined';
  if (status === 404 || /\bnot found\b/.test(message)) return 'no_match';
  if (/timeout|timed out|etimedout|abort/.test(message)) return 'timeout';
  if (/json|parse|unexpected token|malformed/.test(message)) return 'malformed_response';
  return 'provider_unavailable';
}
