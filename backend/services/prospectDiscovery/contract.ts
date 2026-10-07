/**
 * B4-A1 — the provider-neutral DISCOVERY contract.
 *
 * ─── THE THREE THINGS THIS KEEPS APART ────────────────────────────────────
 *   ENRICHMENT  operate on a canonical entity that already exists.
 *   DISCOVERY   execute a search that may create the FIRST evidence of a person
 *               or account Omnivyra does not yet hold.
 *   INGESTION   normalise provider-originated records into the canonical spine.
 *
 * This file is the second of those and nothing else. It names no provider, holds
 * no credential, performs no I/O and knows nothing about Apollo: an Apollo field
 * name appearing here would make the generic contract provider-specific, which
 * is the leak the gate's stop conditions name explicitly.
 *
 * ─── WHY THE TRANSPORT VOCABULARY IS IMPORTED, NOT RESTATED ───────────────
 * `provider_call_state` is re-exported from the enrichment ledger rather than
 * declared again. "Did transport happen?" has the same three answers for a
 * search as for an enrichment call, and two spellings of one three-valued truth
 * would eventually disagree about the only question that stops a tenant being
 * billed twice. A test pins that these remain the same values.
 *
 * Nothing else is shared: the enrichment ledger's subject, attribute set and
 * canonicaliser are all wrong for a search, which is why B4-A1 has its own table.
 */

import { createHash } from 'crypto';
import { PROVIDER_CALL_STATES, type ProviderCallState } from '../enrichment/attempts';

export { PROVIDER_CALL_STATES };
export type { ProviderCallState };

/** Bumped when the discovery execution contract changes, so a row traces to its writer. */
export const DISCOVERY_EXECUTOR_VERSION = 'b4a1.1';

/**
 * How a discovery EXECUTION stands, as distinct from what the provider said.
 *
 * `pending` is the insert-time value. B4-A1 creates the record and stops: a
 * provider call is a separately gated step, so an execution that never leaves
 * `pending` is the normal and correct outcome of this gate.
 *
 * `abandoned` is registered so the vocabulary and the database CHECK are
 * complete, and is deliberately never written — the same position
 * `prospect_enrichment_attempts` takes. An expired lease is reclaimed on the
 * same row so `continuation_state` survives and a half-paginated search resumes
 * instead of restarting and paying twice.
 *
 * There is deliberately no `ambiguous`. "We cannot prove what the provider did"
 * is already expressible, and more precisely, as a CLOSED execution whose
 * `providerCallState` is `unknown`; a separate status would be a second
 * representation of one fact, and the two would drift.
 *
 * `refused_pre_call` is carried for the reason A4T established on the enrichment
 * ledger: "WE declined before transport" and "it failed" have OPPOSITE retry
 * safety, and nothing in the other two columns separates them — a refusal and a
 * provider error can both be `not_called` with an outcome recorded. Adopting the
 * distinction is not blind copying; it is taking a lesson that was paid for.
 */
export const DISCOVERY_EXECUTION_STATUSES = [
  'pending',
  'claimed',
  'provider_running',
  'refused_pre_call',
  'completed',
  'failed',
  'cancelled',
  'abandoned',
] as const;
export type DiscoveryExecutionStatus = typeof DISCOVERY_EXECUTION_STATUSES[number];

/** The statuses under which an execution still occupies the live slot. */
export const OPEN_DISCOVERY_STATUSES: readonly DiscoveryExecutionStatus[] = [
  'pending', 'claimed', 'provider_running',
];

export const isOpenDiscoveryStatus = (s: DiscoveryExecutionStatus): boolean =>
  OPEN_DISCOVERY_STATUSES.includes(s);

/**
 * Why an execution produced no provider result.
 *
 * Every member names something OMNIVYRA or the TENANT'S configuration decided,
 * or something a provider stated. None of them is a guess: there is no
 * `probably_failed`, and an outcome nobody can establish stays null with
 * `providerCallState: 'unknown'`.
 */
export const DISCOVERY_REFUSALS = [
  /** The tenant has stored no credential for this provider. Fails closed. */
  'credential_missing',
  /** No discovery adapter is registered for this provider. */
  'provider_not_registered',
  /** Cost governance declined before any transport. */
  'cost_denied',
  /** The caller's search could not be canonicalised. Nothing was written. */
  'malformed_search',
  /** A different execution of this same search is already live. */
  'already_live',
  /** The bounds were already exhausted, so there was nothing left to ask for. */
  'bounds_exhausted',
  /** An operator cancelled it. */
  'cancelled',
  /** The ingestion capability is switched off for this tenant. */
  'ingestion_disabled',
] as const;
export type DiscoveryRefusal = typeof DISCOVERY_REFUSALS[number];

/** Raised when a caller's search cannot be canonicalised. Nothing is persisted. */
export class MalformedSearchError extends Error {
  readonly refusal: DiscoveryRefusal = 'malformed_search';
  constructor(message: string) {
    super(message);
    this.name = 'MalformedSearchError';
  }
}

/**
 * The bounds every execution carries (D-4).
 *
 * All three are REQUIRED. An optional bound is a bound the first caller omits,
 * and an unbounded provider search is the one thing a tenant-funded integration
 * must never be able to start by accident. The ceilings are also CHECKs on the
 * table, so the database refuses an overrun rather than trusting this layer.
 */
export interface DiscoveryBounds {
  readonly maxPages: number;
  readonly maxResults: number;
  /**
   * The cost ceiling, denominated in PROVIDER CALLS.
   *
   * Not in credits, deliberately. D22-B4-A left the provider's billing
   * behaviour UNVERIFIED, so a credit-denominated ceiling would require a
   * number nobody has observed. A call count bounds spend under every reading of
   * the pricing and needs no invented figure.
   */
  readonly maxProviderCalls: number;
}

/** Hard caps, so a caller cannot ask for an unbounded search through a large number. */
export const DISCOVERY_BOUND_LIMITS = {
  maxPages: 20,
  maxResults: 500,
  maxProviderCalls: 20,
} as const;

/**
 * What a caller asks for.
 *
 * `filters` is provider-neutral and opaque to everything above the provider
 * adapter: this contract does not model a single filter name, because naming one
 * would be choosing a provider's vocabulary for every future provider. The
 * adapter translates these into its own query, and that is the only place a
 * provider's field names may appear.
 */
export interface DiscoverySearchRequest {
  /** TENANT. Always the VERIFIED one — never a value read from a request body. */
  readonly organizationId: string;
  readonly provider: string;
  readonly filters: Readonly<Record<string, unknown>>;
  readonly bounds: DiscoveryBounds;
  /** Correlates the execution across logs and the ledger. */
  readonly correlationId: string;
}

const MAX_FILTER_DEPTH = 6;
const MAX_FILTER_KEYS = 64;
const MAX_FILTER_JSON_BYTES = 8_192;

/**
 * Canonicalise a search so that two spellings of one search are one search.
 *
 * ─── WHY NOT JSON.stringify ON WHAT THE CALLER SENT ───────────────────────
 * Object key order in JavaScript follows insertion, so `{a:1,b:2}` and
 * `{b:2,a:1}` stringify differently and would hash to two different searches.
 * The digest would then be a hash of the caller's typing habits rather than of
 * the search, and the live-execution index would stop preventing duplicate
 * provider calls — which is the one thing it exists to do.
 *
 * The rules, each with a reason:
 *   object keys     sorted by UTF-8 bytes, so order of authorship is irrelevant.
 *   scalar arrays   sorted and de-duplicated. A set of permitted values has no
 *                   meaningful order, and the canonical order is what the
 *                   adapter issues, so request and digest cannot disagree.
 *   object arrays   order PRESERVED. Order may carry meaning in a structured
 *                   filter, and silently reordering one would change the search
 *                   rather than normalise it.
 *   null/undefined  dropped. An absent filter and a null filter are the same
 *                   request, so they must be the same digest.
 *   strings         trimmed; empty after trimming is dropped, for the same reason.
 *   numbers         non-finite is REFUSED, not coerced — NaN is not a filter.
 *
 * Depth, key-count and size limits refuse rather than truncate: a truncated
 * search would execute against criteria the caller never asked for.
 */
export function canonicalizeSearchCriteria(
  filters: unknown,
): Record<string, unknown> {
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new MalformedSearchError('search filters must be an object');
  }

  let keyCount = 0;

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > MAX_FILTER_DEPTH) {
      throw new MalformedSearchError(`search filters nest deeper than ${MAX_FILTER_DEPTH}`);
    }
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new MalformedSearchError('a search filter holds a non-finite number');
      }
      return value;
    }
    if (typeof value === 'boolean') return value;
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new MalformedSearchError(`a search filter holds an unsupported type (${typeof value})`);
    }

    if (Array.isArray(value)) {
      const items = value.map((v) => walk(v, depth + 1)).filter((v) => v !== undefined);
      if (!items.length) return undefined;
      const allScalar = items.every(
        (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
      );
      if (!allScalar) return items;
      // Sort by the serialised form so mixed scalar types order deterministically
      // rather than by JavaScript's default string coercion of `<`.
      const seen = new Set<string>();
      const unique: unknown[] = [];
      for (const v of items.slice().sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))) {
        const k = JSON.stringify(v);
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(v);
      }
      return unique;
    }

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const trimmedKey = key.trim();
      if (!trimmedKey) throw new MalformedSearchError('a search filter has a blank key');
      const walked = walk((value as Record<string, unknown>)[key], depth + 1);
      if (walked === undefined) continue;
      if (++keyCount > MAX_FILTER_KEYS) {
        throw new MalformedSearchError(`search filters hold more than ${MAX_FILTER_KEYS} values`);
      }
      out[trimmedKey] = walked;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const canonical = (walk(filters, 0) ?? {}) as Record<string, unknown>;

  // An empty search is refused. A provider search with no criteria is a request
  // for "everything", which is unbounded by intent even when the page ceiling
  // bounds it by accident, and no tenant means to ask for it.
  if (!Object.keys(canonical).length) {
    throw new MalformedSearchError('a discovery search must carry at least one filter');
  }

  const serialised = JSON.stringify(canonical);
  if (Buffer.byteLength(serialised, 'utf8') > MAX_FILTER_JSON_BYTES) {
    throw new MalformedSearchError(`canonical search exceeds ${MAX_FILTER_JSON_BYTES} bytes`);
  }

  return canonical;
}

/** Validate the bounds a caller asked for, or refuse. */
export function validateBounds(bounds: unknown): DiscoveryBounds {
  const b = (bounds ?? {}) as Record<string, unknown>;
  const read = (name: keyof typeof DISCOVERY_BOUND_LIMITS): number => {
    const raw = b[name];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
      throw new MalformedSearchError(`${name} must be a positive integer`);
    }
    if (raw > DISCOVERY_BOUND_LIMITS[name]) {
      throw new MalformedSearchError(
        `${name} exceeds the platform limit of ${DISCOVERY_BOUND_LIMITS[name]}`,
      );
    }
    return raw;
  };
  return {
    maxPages: read('maxPages'),
    maxResults: read('maxResults'),
    maxProviderCalls: read('maxProviderCalls'),
  };
}

/**
 * The work-item identity of a search: sha256 of the canonical search, the
 * provider and the bounds, in lowercase hex.
 *
 * The BOUNDS are part of identity because they change the provider request: the
 * same filters asked for over 1 page and over 10 pages are two different
 * executions with two different costs, and treating them as one would let the
 * live index block the larger search because the smaller one is running.
 *
 * The TENANT is deliberately NOT in the digest. It is a column, it leads every
 * index, and keeping it out means one search has one identity across tenants —
 * which is what makes the digest useful in a cross-tenant isolation test rather
 * than something that silently differs for an unrelated reason.
 */
export function computeSearchDigest(input: {
  readonly provider: string;
  readonly canonicalFilters: Record<string, unknown>;
  readonly bounds: DiscoveryBounds;
}): string {
  const provider = String(input.provider ?? '').trim().toLowerCase();
  if (!provider) throw new MalformedSearchError('provider is required to identify a search');
  const material = JSON.stringify({
    provider,
    filters: input.canonicalFilters,
    maxPages: input.bounds.maxPages,
    maxResults: input.bounds.maxResults,
    maxProviderCalls: input.bounds.maxProviderCalls,
  });
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * One page of provider results.
 *
 * `continuation` is opaque: the executor stores it and hands it back, and never
 * interprets it. An adapter that paginates by cursor, by page number or by
 * offset all look identical from here, which is what keeps the ledger
 * provider-neutral.
 */
export interface DiscoveryPage {
  /** VERBATIM provider records. The pure translation boundary redacts and hashes them. */
  readonly records: readonly Record<string, unknown>[];
  /** Opaque continuation, or null when the provider says there is no more. */
  readonly continuation: unknown | null;
  /** The provider's OWN request identifier, when it supplies one. Never synthesised. */
  readonly providerRequestId?: string | null;
  /**
   * What the provider said this cost. `unknown` is the correct answer whenever
   * the provider does not state it, and must not be optimised into `free`.
   */
  readonly cost?: {
    readonly state: 'unknown' | 'free' | 'billed';
    readonly units?: number | null;
  };
}

/**
 * A provider's discovery capability — the ONLY place provider I/O happens.
 *
 * ─── WHY THIS IS NOT PART OF `LeadSourceAdapter` ──────────────────────────
 * `LeadSourceAdapter.translate` is PURE BY CONTRACT, and its own header says
 * why: "fetching from a provider is a separate concern that must pass through
 * the existing cost governor and SSRF seam, and is not part of this contract."
 * Adding network I/O to it would put an un-governed egress inside the
 * translation step that every source — including file uploads — runs.
 *
 * So discovery is TWO interfaces, and the split is the architecture:
 *
 *   discover(request, credential) -> raw provider records   (I/O, governed)
 *   translate(raw, organizationId) -> AdapterResult         (pure, existing)
 *
 * An implementation of `discover` MUST perform its egress through the
 * repository's `safeFetch` with an explicit host allowlist, and MUST use the
 * credential it is handed rather than reading the environment. Nothing in this
 * module can enforce that at the type level, so a test asserts that this module
 * and the executor import no HTTP client at all, and the registry below ships
 * empty so no un-reviewed adapter can be reached.
 */
export interface DiscoveryProviderAdapter {
  /** Stable provider key. MUST match a registered `LeadSourceAdapter.source`. */
  readonly provider: string;
  readonly label: string;
  /**
   * Fetch ONE page.
   *
   * `credential` is the TENANT's, injected by the executor immediately before
   * the call. An adapter must never read `process.env` for one.
   */
  discover(input: {
    readonly organizationId: string;
    readonly filters: Readonly<Record<string, unknown>>;
    /** Null on the first page; otherwise whatever this adapter last returned. */
    readonly continuation: unknown | null;
    /** How many more records this bounded execution may still accept. */
    readonly remaining: number;
    readonly credential: string;
  }): Promise<DiscoveryPage>;
}
