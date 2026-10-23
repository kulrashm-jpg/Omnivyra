/**
 * PHASE 4 — the Apollo discovery provider adapter.
 *
 * ─── WHAT THIS OWNS, AND NOTHING ELSE ─────────────────────────────────────
 * Apollo's HTTP request, its authentication header, request serialisation, the
 * timeout, response parsing, pagination interpretation and provider error
 * normalisation. That is the whole list.
 *
 * It does NOT own tenant authorization, credential persistence, idempotency,
 * attempt claiming, leasing, cost authorization, canonical prospect creation,
 * identity resolution, source arbitration, lifecycle or outreach. Every one of
 * those lives outside, in the frozen B4-A1 architecture, and this file cannot
 * reach any of them: it imports exactly two things — the egress primitive and
 * the frozen contract's types.
 *
 * ─── THE ONE CALL, AND ONLY ONE ───────────────────────────────────────────
 * `POST https://api.apollo.io/api/v1/mixed_people/api_search`, which is the only
 * Apollo operation that satisfies discovery: it accepts filters and returns
 * person candidates WITHOUT requiring a prospect Omnivyra already holds.
 *
 * The path is `api_search`, not `search`. Apollo serves the programmatic People
 * Search under the `api_search` path; `search` is the surface its own app uses.
 * The distinction is invisible until a key is actually presented, which is why
 * it was found by endpoint conformance review rather than by a test.
 *
 * There is exactly one `safeFetch` below, host-pinned to `api.apollo.io`, and
 * every refusal before it costs nothing. The adapter performs NO retry: retry,
 * backoff, the call ceiling and the cost ceiling all belong to the executor, so
 * a billable call is never multiplied by a layer that cannot see the bill.
 *
 * ─── THE TENANT'S KEY, NEVER OMNIVYRA'S ───────────────────────────────────
 * The credential arrives on the request, injected by the executor immediately
 * before the call. This file must never read `process.env` for one — the same
 * prohibition `credentials.ts` states for itself, and the enrichment adapter
 * repeats. A test asserts no environment read exists here.
 *
 * ─── WHAT IS DELIBERATELY NOT CLAIMED ─────────────────────────────────────
 * Cost is reported as `unknown`, always. D22-B4-A established that Apollo's own
 * reference documents People Search at 0 credits while independent analyses say
 * the free plan has no API at all, and that nobody here has ever seen Apollo's
 * response to this operation. Reporting `free` would be the fabricated
 * zero-cost declaration those gates forbade; `unknown` is the honest value and
 * the ledger's default. A real response may later state a cost, and the frozen
 * `DiscoveryPage.cost` carries it when it does.
 *
 * Likewise `providerRequestId` is passed through only when Apollo supplies one.
 * A synthesised id would be indistinguishable from a provider-stated one.
 */

import { safeFetch } from '../../../../lib/security/safeFetch';
import type { DiscoveryPage, DiscoveryProviderAdapter } from '../contract';

/** Apollo's REST host and the one discovery operation. Host-pinned below. */
export const APOLLO_HOST = 'api.apollo.io';
export const APOLLO_DISCOVERY_URL = `https://${APOLLO_HOST}/api/v1/mixed_people/api_search`;
export const APOLLO_DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Apollo's own page-size cap for this operation.
 *
 * Used as a ceiling on what we ASK for, never as a licence to exceed the
 * execution's remaining budget — the request takes the smaller of the two.
 */
export const APOLLO_MAX_PER_PAGE = 100;

/**
 * The search fields this adapter accepts, and the Apollo parameter each maps to.
 *
 * An ALLOWLIST, not a passthrough. Arbitrary client JSON must never reach a
 * provider: an unrecognised key could enable an Apollo behaviour nobody here
 * reviewed, and a caller-chosen parameter is a caller-chosen cost. Anything not
 * named here is refused by the executor's canonicaliser long before this point,
 * and ignored here as a second line.
 *
 * Each entry is a field Apollo's documented People Search contract accepts. No
 * field is invented, and none is added because it "might" work.
 */
export const APOLLO_DISCOVERY_FILTERS: Readonly<Record<string, string>> = Object.freeze({
  /** Job titles, e.g. ['Head of Marketing']. */
  titles: 'person_titles',
  /** Seniority bands Apollo recognises, e.g. ['director']. */
  seniorities: 'person_seniorities',
  /** Employer domains, e.g. ['example.com']. */
  companyDomains: 'q_organization_domains',
  /** Person locations, e.g. ['London, United Kingdom']. */
  locations: 'person_locations',
  /** Employer headcount bands, e.g. ['11,50']. */
  companyHeadcount: 'organization_num_employees_ranges',
  /** Free-text name fragment. */
  nameQuery: 'q_person_name',
});

/** A provider failure, classified. The executor records the message verbatim. */
export const APOLLO_DISCOVERY_FAILURES = [
  'apollo_unauthorized',
  'apollo_forbidden',
  'apollo_rate_limited',
  'apollo_validation_error',
  'apollo_unavailable',
  'apollo_timeout',
  'apollo_malformed_response',
] as const;
export type ApolloDiscoveryFailure = typeof APOLLO_DISCOVERY_FAILURES[number];

/**
 * Thrown for every provider failure.
 *
 * The executor catches any throw, closes the attempt `failed` with
 * `provider_call_state = 'unknown'` — because transport was entered and may have
 * been billed — and records this message through `safeDetail`. Leading with a
 * stable token therefore makes the normalised outcome auditable in the ledger
 * itself rather than only in a log.
 */
export class ApolloDiscoveryError extends Error {
  constructor(readonly failure: ApolloDiscoveryFailure, detail: string) {
    super(`${failure}: ${detail}`);
    this.name = 'ApolloDiscoveryError';
  }
}

/** Map an HTTP status onto the normalised failure vocabulary. Conservative. */
export function classifyApolloStatus(status: number): ApolloDiscoveryFailure {
  if (status === 401) return 'apollo_unauthorized';
  if (status === 403) return 'apollo_forbidden';
  if (status === 429) return 'apollo_rate_limited';
  // 422 is Apollo's validation refusal; 400 is the same class of caller error.
  if (status === 400 || status === 422) return 'apollo_validation_error';
  // Anything else — including every 5xx and any status not listed — is reported
  // as unavailable rather than guessed at. An unrecognised status must never be
  // rounded towards success.
  return 'apollo_unavailable';
}

/**
 * Build the Apollo request body from the canonical filters and the budget.
 *
 * Exported so serialisation can be exercised without a transport. Unknown keys
 * are DROPPED rather than forwarded; an empty result would mean an unbounded
 * "everything" search, which the canonicaliser already refuses upstream, so this
 * refuses it too rather than relying on that.
 */
export function buildApolloSearchBody(input: {
  readonly filters: Readonly<Record<string, unknown>>;
  readonly page: number;
  readonly remaining: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  for (const [canonical, apolloParam] of Object.entries(APOLLO_DISCOVERY_FILTERS)) {
    const value = input.filters?.[canonical];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) body[apolloParam] = value;
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      body[apolloParam] = value.trim();
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      body[apolloParam] = value;
    }
  }

  if (!Object.keys(body).length) {
    throw new ApolloDiscoveryError(
      'apollo_validation_error',
      'no supported Apollo search filter was supplied, so the request would be unbounded',
    );
  }

  // ── EXACT TITLE MATCHING ────────────────────────────────────────────────
  // Apollo's `person_titles` is FUZZY BY DEFAULT: its People Search reference
  // states results can include similar titles unless `include_similar_titles`
  // is false (docs.apollo.io/reference/people-api-search, accessed 2026-10-16).
  //
  // The ICP's `one_of` is EXACT membership (`prospectIcp/evaluate.ts`), so
  // leaving the default in place made an ICP-derived title search return people
  // the tenant's own criterion would not have counted as satisfied — a
  // broadening of their target, paid for out of their provider budget. Sent
  // explicitly, and as a literal `false` rather than an omission, because an
  // absent parameter is what produced the broadening.
  //
  // DELIBERATELY AFTER the "no supported filter" guard above: that guard counts
  // the keys on `body`, so setting this earlier would make an unbounded request
  // look filtered and defeat it.
  body.include_similar_titles = false;

  // The SMALLER of Apollo's cap and what this execution may still accept. The
  // executor's remaining budget is authoritative and can only shrink the ask.
  const perPage = Math.max(1, Math.min(APOLLO_MAX_PER_PAGE, Math.floor(input.remaining)));
  body.page = input.page;
  body.per_page = perPage;
  return body;
}

/** Apollo pages are 1-based. `null` continuation means the first page. */
export function pageFromContinuation(continuation: unknown | null): number {
  if (continuation === null || continuation === undefined) return 1;
  const n = typeof continuation === 'number' ? continuation : Number(continuation);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Parse Apollo's response into the frozen `DiscoveryPage`.
 *
 * ─── PAGINATION IS READ, NEVER ASSUMED ────────────────────────────────────
 * Apollo reports `pagination: { page, per_page, total_entries, total_pages }`.
 * The continuation is the NEXT page number, and only when Apollo itself says
 * one exists — `page < total_pages`. When the shape is absent or the current
 * page is the last, the continuation is `null` and the executor stops. Inventing
 * a next page would make the loop pay for a page Apollo never offered.
 *
 * `people` is the documented result array; `contacts` is accepted too because
 * the mixed endpoint can return either collection, and taking both is reading
 * the response rather than assuming one shape. Nothing else is harvested.
 */
export function parseApolloSearchResponse(payload: unknown): DiscoveryPage {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApolloDiscoveryError('apollo_malformed_response', 'the response body was not an object');
  }
  const body = payload as Record<string, unknown>;

  const collected: Record<string, unknown>[] = [];
  for (const key of ['people', 'contacts']) {
    const value = body[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
        collected.push(entry as Record<string, unknown>);
      }
    }
  }

  // An absent AND malformed result set are different: Apollo legitimately
  // returns an empty page, and that is `records: []`, not a failure. Only a body
  // carrying neither collection in any form is malformed.
  if (!Array.isArray(body.people) && !Array.isArray(body.contacts)) {
    throw new ApolloDiscoveryError(
      'apollo_malformed_response',
      'the response carried no `people` or `contacts` collection',
    );
  }

  let continuation: number | null = null;
  const pagination = body.pagination;
  if (pagination !== null && typeof pagination === 'object' && !Array.isArray(pagination)) {
    const p = pagination as Record<string, unknown>;
    const page = Number(p.page);
    const totalPages = Number(p.total_pages);
    if (Number.isInteger(page) && Number.isInteger(totalPages) && page < totalPages) {
      continuation = page + 1;
    }
  }

  const requestId = typeof body.request_id === 'string' && body.request_id.trim()
    ? body.request_id.trim()
    : null;

  return {
    records: collected,
    continuation,
    providerRequestId: requestId,
    // See the header: never `free`, never a number nobody has observed.
    cost: { state: 'unknown', units: null },
  };
}

export const apolloDiscoveryAdapter: DiscoveryProviderAdapter = {
  // MUST match the registered `LeadSourceAdapter.source` — one provider identity.
  provider: 'apollo',
  label: 'Apollo',

  async discover({ filters, continuation, remaining, credential }) {
    const key = typeof credential === 'string' ? credential.trim() : '';
    if (!key) {
      // Defensive only. The executor refuses `credential_missing` before any
      // adapter is reached, so this cannot normally fire — but an adapter that
      // would call a provider with an empty key is one refactor away from doing
      // it, so it refuses for itself too.
      throw new ApolloDiscoveryError('apollo_unauthorized', 'no tenant credential was supplied to the adapter');
    }
    if (!Number.isFinite(remaining) || remaining <= 0) {
      throw new ApolloDiscoveryError(
        'apollo_validation_error',
        'the execution has no remaining result budget, so no request was made',
      );
    }

    const body = buildApolloSearchBody({
      filters,
      page: pageFromContinuation(continuation),
      remaining,
    });

    let response: Response;
    try {
      response = await safeFetch(APOLLO_DISCOVERY_URL, {
        method: 'POST',
        headers: {
          // Apollo's documented header. The key travels in a HEADER and never in
          // the URL — a query string is logged by proxies in a way a header is not.
          'x-api-key': key,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      }, {
        // The repository's egress control, host-pinned, so no caller-supplied
        // value can redirect this anywhere else.
        allowedHosts: [APOLLO_HOST],
        timeoutMs: APOLLO_DISCOVERY_TIMEOUT_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure: ApolloDiscoveryFailure = /abort|timeout|timed out/i.test(message)
        ? 'apollo_timeout'
        : 'apollo_unavailable';
      throw new ApolloDiscoveryError(failure, message.slice(0, 200));
    }

    if (!response.ok) {
      throw new ApolloDiscoveryError(
        classifyApolloStatus(response.status),
        `HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApolloDiscoveryError('apollo_malformed_response', 'the response body was not JSON');
    }

    return parseApolloSearchResponse(payload);
  },
};
