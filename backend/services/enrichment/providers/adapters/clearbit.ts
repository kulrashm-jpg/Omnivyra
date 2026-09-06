/**
 * A3U — the PI-side Clearbit adapter.
 *
 * A translation layer, not a second Clearbit client. Everything that is a fact
 * about the VENDOR — the host, the URL, the auth header, the SSRF pinning —
 * comes from the WS-4 spec. Everything that is a fact about PI — where the
 * credential comes from, what the attributes are called, what a failure means —
 * is decided here.
 *
 * ─── WHY NOT JUST CALL THE WS-4 ADAPTER ───────────────────────────────────
 * Because `createVendorAdapter` resolves its credential from `process.env`.
 * That is right for company intelligence, where the key is Omnivyra's own doing
 * Omnivyra's own work, and it is precisely the defect A3M removed from PI,
 * where the key belongs to the tenant. Calling `clearbitProvider.fetch()` would
 * spend one shared key on every tenant's behalf. So this adapter reuses the
 * spec's `buildRequest` — which takes the credential as an ARGUMENT — and
 * supplies the tenant's, injected by the executor as `request.credential`.
 *
 * ─── WHY `mapResponse` IS NOT REUSED ──────────────────────────────────────
 * It is the one part of the spec whose output is WS-4 policy rather than vendor
 * fact. It emits WS-4's field names (`headcount`), WS-4's confidence CONSTANTS
 * (0.85 for headcount — the adapter's own judgement, not something Clearbit
 * said), and `req.asOf`, which is when WE fetched rather than when the fact was
 * observed. PI must not carry any of the three: it needs canonical names, null
 * confidence where the provider states none, and null `observedAt` where the
 * provider supplies none. Re-deriving from the raw payload with the spec's own
 * `pick` helper is both shorter and more honest than undoing that mapping.
 *
 * ─── NORMALISATION IS NOT DONE HERE ───────────────────────────────────────
 * LI-2 already normalises every account attribute through `toAccountAttributes`
 * — `normalizeEmployeeCount`, `isEmployeeBand`, `normalizeCountryCode`,
 * `normalizeFoundedYear`, `normalizeTechnologies`. This adapter therefore emits
 * the provider's value under a canonical name and lets the boundary decide what
 * is representable. The two exceptions below (`employee_band`, `country_code`)
 * are filtered here as well, and deliberately: those normalisers REJECT to null
 * rather than coerce, so passing an unrepresentable value on would record a raw
 * assertion whose normalised form is empty — an assertion that looks like
 * evidence and can never satisfy a criterion.
 */

import { safeFetch } from '../../../../../lib/security/safeFetch';
import { clearbitSpec } from '../../../companyIntelligence/providers/adapters';
import { pick } from '../../../companyIntelligence/providers/adapters/vendorAdapter';
import { isEmployeeBand, normalizeCountryCode } from '../../../prospectIdentity/attributes';
import { normalizeCompanyDomain } from '../../../../../lib/shared/domain/companyDomain';
import {
  refuse,
  classifyEnrichmentError,
  type EnrichmentProviderAdapter,
  type EnrichmentRequest,
  type ProviderField,
  type ProviderResponse,
} from '../contract';

/** Canonical PI account attributes this adapter can answer. Nothing else. */
export const CLEARBIT_SUPPORTED_ATTRIBUTES: readonly string[] = [
  'employee_count',
  'employee_band',
  'founded_year',
  'country_code',
  'technologies',
];

/** WS-4 serves Clearbit firmographics under this capability. */
const FIRMOGRAPHICS = 'firmographics' as const;

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Build one field.
 *
 * `confidence` is ALWAYS null and `observedAt` ALWAYS null: Clearbit's
 * company endpoint returns neither, and the contract is explicit that an
 * absent one is absent rather than invented. `providerInferred` is false
 * because Clearbit asserts these values rather than labelling them as its own
 * inference — a distinction that would have to come from the payload if it ever
 * did.
 */
const accountField = (attribute: string, value: unknown): ProviderField => ({
  attribute,
  subject: 'account',
  value,
  observedAt: null,
  confidence: null,
  providerInferred: false,
});

/**
 * The domain to key on.
 *
 * Only `selectors.domain`, and only after `normalizeCompanyDomain` reduces it
 * to a registrable root. A company NAME is deliberately not accepted as a
 * fallback: Clearbit's name search is a different endpoint with different match
 * semantics, and "the account whose name looked closest" is exactly the kind of
 * identity W4 refuses to make. Obtaining the canonical domain stays the
 * caller's job.
 */
function domainFor(request: EnrichmentRequest): string | null {
  const raw = request.selectors?.domain;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const normalized = normalizeCompanyDomain(raw);
  return normalized || null;
}

/**
 * Translate a Clearbit company payload into canonical PI fields.
 *
 * Exported for tests so the mapping can be exercised without a transport.
 */
export function mapClearbitPayload(
  payload: unknown,
  requested: readonly string[],
): ProviderField[] {
  const wanted = (a: string) => requested.includes(a);
  const out: ProviderField[] = [];

  // Exact headcount. `normalizeEmployeeCount` at the boundary accepts the
  // string form providers routinely send, so the raw value is passed through.
  const employees = pick(payload, 'metrics', 'employees');
  if (wanted('employee_count') && (typeof employees === 'number' || typeof employees === 'string')) {
    out.push(accountField('employee_count', employees));
  }

  const founded = pick(payload, 'foundedYear');
  if (wanted('founded_year') && (typeof founded === 'number' || typeof founded === 'string')) {
    out.push(accountField('founded_year', founded));
  }

  // CLOSED VOCABULARY. `isEmployeeBand` is a guard, not a converter, and no
  // Clearbit-range-to-band mapping exists anywhere in this repository — nobody
  // here has seen a real `employeesRange`. So the value is emitted only when it
  // is ALREADY one of the eight canonical bands. Anything else is dropped
  // rather than guessed into the nearest-looking one.
  const range = pick(payload, 'metrics', 'employeesRange');
  if (wanted('employee_band') && isEmployeeBand(range)) {
    out.push(accountField('employee_band', range));
  }

  // ISO-3166-1 alpha-2 only, for the same reason: `normalizeCountryCode`
  // accepts a two-letter code and nothing else, and the repository states that
  // translating a country NAME needs a reference dataset the provider's own
  // vocabulary would have to be known for. Clearbit's has never been observed.
  const country = pick(payload, 'geo', 'country');
  if (wanted('country_code') && typeof country === 'string') {
    const code = normalizeCountryCode(country);
    if (code) out.push(accountField('country_code', code));
  }

  // The RAW array, never a joined string. `normalizeTechnologies` at the
  // boundary turns an array into the JSON text jsonb requires; WS-4's own
  // mapper joins with '; ', which that normaliser correctly refuses to parse.
  const tech = pick(payload, 'tech');
  if (wanted('technologies') && Array.isArray(tech)) {
    out.push(accountField('technologies', tech));
  }

  return out;
}

/** Classify a transport failure into the PI outcome vocabulary. */
function classifyStatus(status: number): 'no_match' | 'rate_limited' | 'provider_unavailable' {
  if (status === 404) return 'no_match';
  if (status === 429) return 'rate_limited';
  return 'provider_unavailable';
}

export const clearbitEnrichmentAdapter: EnrichmentProviderAdapter = {
  id: clearbitSpec.id,
  label: 'Clearbit',
  supports: CLEARBIT_SUPPORTED_ATTRIBUTES,
  credentialEnvVar: clearbitSpec.credentialEnv,

  /**
   * FALSE, always — and this is the honest answer, not a placeholder.
   *
   * The contract asks whether a real call could be made RIGHT NOW from
   * configuration alone. For a tenant-credential provider that question has no
   * answer without a tenant: the credential lives per-company in
   * `integration_credentials`, and `listProviderStatus` has no tenant to ask
   * about. Returning true made the registry report Clearbit as `operational`
   * with "credential configured" — a claim about Omnivyra's environment
   * masquerading as a claim about a tenant, which is the precise falsehood this
   * whole line of work exists to prevent.
   *
   * Nothing is lost by refusing: A3M removed `isAvailable()` from the
   * executor's credential gate, so this value no longer decides whether a call
   * happens. Only status reads it, and status should not claim availability it
   * cannot verify.
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
      // PI's vocabulary has no `insufficient_input`, and inventing one is not
      // allowed. `provider_declined` is the closest member; the detail says who
      // actually declined so the reason is not misread as Clearbit's.
      return refuse('provider_declined', notReturned,
        'refused before egress: no canonical account domain was supplied');
    }

    const built = clearbitSpec.buildRequest(
      { companyId: request.organizationId, domain, companyName: null, asOf: new Date().toISOString() },
      FIRMOGRAPHICS,
      credential,
    );
    if (!built) {
      return refuse('provider_declined', notReturned,
        'refused before egress: the vendor request could not be built from this input');
    }

    let response: Response;
    try {
      // The SAME egress control WS-4 uses: host pinned to the spec's host, so
      // no caller-supplied value can redirect this anywhere else.
      response = await safeFetch(built.url, built.init, {
        allowedHosts: [clearbitSpec.host],
        timeoutMs: clearbitSpec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (error) {
      // The canonical classifier, not a regex of my own: it already separates
      // timeout, rate limit, quota and auth refusal from a plain unreachable
      // host, and is deliberately conservative — anything unrecognised becomes
      // `provider_unavailable`, never `no_match`.
      const message = error instanceof Error ? error.message : String(error);
      return refuse(classifyEnrichmentError(error), notReturned, message.slice(0, 200));
    }

    if (!response.ok) {
      return refuse(classifyStatus(response.status), notReturned, `HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return refuse('malformed_response', notReturned, 'the response body was not JSON');
    }
    if (payload === null || typeof payload !== 'object') {
      return refuse('malformed_response', notReturned, 'the response body was not a company object');
    }

    const fields = mapClearbitPayload(payload, request.attributes);
    if (!fields.length) {
      // Matched, but held none of what was asked for. NOT `enriched` with an
      // empty list — a failure must never be reported as a successful nothing.
      return refuse('field_not_found', notReturned,
        'the company was found but returned none of the requested attributes in a representable form');
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
