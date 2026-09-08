/**
 * Apollo — the organization enrichment adapter.
 *
 * ─── WHY IT EXISTS, AND WHY IT IS THIS SMALL ──────────────────────────────
 * The registry's own header states the rule this file obeys: an adapter lands
 * when someone can run it against the real provider, because "writing an
 * adapter against a response shape nobody here has ever received would produce
 * normalization code that compiles, passes its own fixtures, and is wrong — and
 * the first evidence of that would be fabricated attributes on real people".
 *
 * So this claims exactly ONE attribute. Apollo's organization payload also
 * carries `founded_year`, `country` and `technology_names`, and every one of
 * them is deliberately left unmapped:
 *
 *   country          a country NAME, not an ISO code. PI stores a code, so a
 *                    mapping table would be needed, and guessing one produces
 *                    a plausible wrong country rather than an absent one.
 *   employee_band    Apollo does not return a band. Deriving it from the count
 *                    is INFERENCE, not observation, and PI records what a
 *                    provider observed.
 *   founded_year /   representable, but unproven against a real response. They
 *   technology_names land when someone has seen them come back.
 *
 * `estimated_num_employees` is claimed because it is a plain integer that maps
 * to `employee_count` with no transformation at all.
 *
 * ─── ONE CALL, AND ONLY ONE ───────────────────────────────────────────────
 * `GET /organizations/enrich` enriches a single organization per request and
 * Apollo bills 1 credit for it. The contract forbids internal retry — retry,
 * backoff and cost belong to the executor, so a paid call is never multiplied
 * by a layer that cannot see the bill. There is exactly one `safeFetch` below,
 * and every refusal before it costs nothing.
 *
 * Apollo's documentation does NOT say a credit is refunded on a miss, so a
 * `no_match` must be assumed billable. That is why the attempt ledger counts
 * `called` and `unknown` rather than only successful outcomes — nothing here
 * needs to compensate for it, but nothing here may hide it either.
 *
 * ─── THE TENANT'S KEY, NEVER OMNIVYRA'S ───────────────────────────────────
 * The credential arrives on the request, injected by the executor immediately
 * before the call from `integration_credentials(provider_key='apollo',
 * credential_key='api_key')`. This file must never read `process.env` for a
 * credential — the same prohibition `credentials.ts` states for itself.
 */

import { safeFetch } from '../../../../../lib/security/safeFetch';
import { normalizeCompanyDomain } from '../../../../../lib/shared/domain/companyDomain';
import {
  refuse,
  parseRetryAfter,
  classifyEnrichmentError,
  type EnrichmentProviderAdapter,
  type EnrichmentRequest,
  type ProviderField,
  type ProviderResponse,
} from '../contract';

/** The one attribute this adapter claims. See the header for what is excluded. */
export const APOLLO_SUPPORTED_ATTRIBUTES: readonly string[] = ['employee_count'];

/** Apollo's REST base, per its published API definition. */
const APOLLO_HOST = 'api.apollo.io';
const APOLLO_ENRICH_URL = `https://${APOLLO_HOST}/api/v1/organizations/enrich`;
const APOLLO_TIMEOUT_MS = 10_000;

/**
 * The domain, and nothing else.
 *
 * Apollo will also identify a company by name, LinkedIn URL or website. None of
 * them is accepted here: each is a different match semantic, and "the account
 * whose name looked closest" is exactly the identity W4 refuses to make.
 * Obtaining the canonical domain stays the caller's job — the same position the
 * Clearbit adapter takes, for the same reason.
 */
function domainFor(request: EnrichmentRequest): string | null {
  const raw = request.selectors?.domain;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return normalizeCompanyDomain(raw) || null;
}

/** Classify a transport failure into the PI outcome vocabulary. */
function classifyStatus(status: number): 'no_match' | 'rate_limited' | 'provider_unavailable' {
  if (status === 404) return 'no_match';
  if (status === 429) return 'rate_limited';
  return 'provider_unavailable';
}

/**
 * Read `estimated_num_employees` as a count, or null.
 *
 * Integers only. A string, a float, a range like `"11-50"` and a zero-or-negative
 * value all yield null rather than a coerced number: an employee count that was
 * guessed at parse time is indistinguishable downstream from one the provider
 * actually stated, and `source_assertions` is meant to hold the latter.
 */
function employeeCountFrom(payload: Record<string, unknown>): number | null {
  const org = payload.organization;
  const source = (org !== null && typeof org === 'object' ? org : payload) as Record<string, unknown>;
  const raw = source.estimated_num_employees;
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * Translate an Apollo organization payload into canonical PI fields.
 *
 * Exported so the mapping can be exercised without a transport. Returns an
 * empty list when the field is absent — the caller turns that into
 * `field_not_found`, never into an `enriched` result carrying nothing.
 */
export function mapApolloPayload(
  payload: unknown,
  requested: readonly string[],
): readonly ProviderField[] {
  if (payload === null || typeof payload !== 'object') return [];
  if (!requested.includes('employee_count')) return [];

  const value = employeeCountFrom(payload as Record<string, unknown>);
  if (value === null) return [];

  return [{
    attribute: 'employee_count',
    subject: 'account',
    value,
    // Apollo's organization payload carries no per-field observation date, and
    // inventing one — `now`, say — would assert a freshness nobody stated. The
    // executor records when WE fetched; that is a different fact and it already
    // has a home.
    observedAt: null,
    confidence: null,
    // `estimated_num_employees` is Apollo's own estimate, and the field name
    // says so. Recording it as the provider's inference keeps a modelled number
    // distinguishable from a filed one.
    providerInferred: true,
  }];
}

export const apolloEnrichmentAdapter: EnrichmentProviderAdapter = {
  id: 'apollo',
  label: 'Apollo',
  supports: APOLLO_SUPPORTED_ATTRIBUTES,
  credentialEnvVar: 'APOLLO_API_KEY',

  /**
   * FALSE, always — the same honest answer the Clearbit adapter gives.
   *
   * The contract asks whether a real call could be made RIGHT NOW from
   * configuration alone. For a tenant-credential provider that question has no
   * answer without a tenant: the credential lives per-company in
   * `integration_credentials`. Returning true would report Apollo as
   * `operational` on the strength of Omnivyra's environment — a claim about the
   * platform masquerading as a claim about a tenant. A3M removed this from the
   * executor's credential gate, so nothing is lost by refusing.
   */
  isAvailable(): boolean {
    return false;
  },

  async enrich(request: EnrichmentRequest): Promise<ProviderResponse> {
    const notReturned = request.attributes;

    // TENANT credential, injected by the executor. Never process.env.
    const credential = typeof request.credential === 'string' ? request.credential.trim() : '';
    if (!credential) {
      return refuse('credential_missing', notReturned,
        'no tenant credential was supplied to the adapter');
    }

    const domain = domainFor(request);
    if (!domain) {
      // PI's vocabulary has no `insufficient_input`. `provider_declined` is the
      // closest member; the detail names who declined so it is not misread as
      // Apollo's verdict — Apollo was never contacted.
      return refuse('provider_declined', notReturned,
        'refused before egress: no canonical account domain was supplied');
    }

    const url = `${APOLLO_ENRICH_URL}?domain=${encodeURIComponent(domain)}`;

    let response: Response;
    try {
      // The repository's egress control, host-pinned, so no caller-supplied
      // value can redirect this anywhere else. The key travels in `x-api-key`,
      // as Apollo's documentation specifies, and never in the URL — a query
      // string is logged by proxies in a way a header is not.
      response = await safeFetch(url, {
        method: 'GET',
        headers: { 'x-api-key': credential, accept: 'application/json' },
      }, {
        allowedHosts: [APOLLO_HOST],
        timeoutMs: APOLLO_TIMEOUT_MS,
      });
    } catch (error) {
      // The canonical classifier, not a regex of my own: it already separates
      // timeout, rate limit, quota and auth refusal from an unreachable host,
      // and is conservative — anything unrecognised becomes
      // `provider_unavailable`, never `no_match`.
      const message = error instanceof Error ? error.message : String(error);
      return refuse(classifyEnrichmentError(error), notReturned, message.slice(0, 200));
    }

    if (!response.ok) {
      // A6A: the only place a retry horizon exists, read from the provider's own
      // header and never synthesised. Passed on every refusal, not just 429 — a
      // 503 may carry one too, and the header's presence is Apollo's statement.
      // Optional-chained deliberately: a transport yielding no `headers` must
      // not throw here, because that would land in the outer catch and
      // reclassify a precise rate limit as a vague `provider_unavailable`.
      const retryAfterAt = parseRetryAfter(response.headers?.get?.('retry-after') ?? null, new Date());
      return refuse(classifyStatus(response.status), notReturned, `HTTP ${response.status}`, retryAfterAt);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return refuse('malformed_response', notReturned, 'the response body was not JSON');
    }
    if (payload === null || typeof payload !== 'object') {
      return refuse('malformed_response', notReturned,
        'the response body was not an organization object');
    }

    const fields = mapApolloPayload(payload, request.attributes);
    if (!fields.length) {
      // Matched, but held none of what was asked for. NOT `enriched` with an
      // empty list — a failure must never be reported as a successful nothing.
      return refuse('field_not_found', notReturned,
        'the organization was found but returned no representable employee count');
    }

    const returned = fields.map((f) => f.attribute);
    return {
      outcome: 'enriched',
      fields,
      notReturned: request.attributes.filter((a) => !returned.includes(a)),
      detail: null,
    };
  },
};
