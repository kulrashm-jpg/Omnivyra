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
import { SENIORITY_VALUES } from '../../../prospectIdentity/attributes';
import { normalizeLinkedinUrl } from '../../../../../lib/linkedin/profileUrl';
import { personNamesAgree, personNamesAgreeable } from '../../../../../lib/names/personName';
import {
  refuse,
  parseRetryAfter,
  classifyEnrichmentError,
  type EnrichmentProviderAdapter,
  type EnrichmentRequest,
  type ProviderField,
  type ProviderResponse,
} from '../contract';
// The shared Apollo error vocabulary, the same one the discovery adapter uses. Pure.
import {
  classifyApolloHttpError,
  classifyApolloTransportError,
  parseApolloUsageHeaders,
  readApolloErrorBody,
  type ApolloErrorCode,
} from '../../../providerErrors/apolloErrors';

/** The one attribute this adapter claims. See the header for what is excluded. */
export const APOLLO_SUPPORTED_ATTRIBUTES: readonly string[] = ['employee_count'];

/**
 * Attributes whose mapping is IMPLEMENTED but NOT CLAIMED (owner decision P-6,
 * 2026-11-10). They move into `APOLLO_SUPPORTED_ATTRIBUTES`, and into the
 * `apollo` descriptor in `sources.ts`, only after one owner-approved live call
 * per subject has shown the response shape. Until then the adapter maps NONE
 * of them, even when asked: `supports` is the claim and this list is not.
 */
export const APOLLO_PENDING_VERIFICATION: Readonly<Record<'person' | 'account', readonly string[]>> = Object.freeze({
  person: ['job_title', 'seniority', 'city', 'region'],
  account: ['industry', 'founded_year', 'technologies'],
});

/** Apollo's REST base, per its published API definition. */
const APOLLO_HOST = 'api.apollo.io';
const APOLLO_ENRICH_URL = `https://${APOLLO_HOST}/api/v1/organizations/enrich`;
const APOLLO_TIMEOUT_MS = 10_000;
/** The endpoint name Apollo uses in its own messages. */
export const APOLLO_ENRICH_ENDPOINT = 'api/v1/organizations/enrich';
const APOLLO_PEOPLE_MATCH_URL = `https://${APOLLO_HOST}/api/v1/people/match`;
/** The endpoint name Apollo uses in its own messages, for the person path. */
export const APOLLO_PEOPLE_MATCH_ENDPOINT = 'api/v1/people/match';

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

/**
 * Map Apollo's typed error onto the PI outcome vocabulary.
 *
 * Deliberately coarse, and never `provider_declined`: the attempt ledger treats
 * that outcome as NON-CALLING, while every one of these is a call Apollo
 * actually answered. The precise reason travels separately as `providerError`.
 */
export function enrichmentOutcomeForApollo(code: ApolloErrorCode):
  'rate_limited' | 'quota_exceeded' | 'provider_unavailable' {
  if (code === 'APOLLO_RATE_LIMITED') return 'rate_limited';
  if (code === 'APOLLO_CREDITS_EXHAUSTED') return 'quota_exceeded';
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
  claimed: readonly string[] = APOLLO_SUPPORTED_ATTRIBUTES,
): readonly ProviderField[] {
  if (payload === null || typeof payload !== 'object') return [];
  const want = (a: string) => requested.includes(a) && claimed.includes(a);
  const out: ProviderField[] = [...extraAccountFields(payload as Record<string, unknown>, want)];
  if (!want('employee_count')) return out;

  const value = employeeCountFrom(payload as Record<string, unknown>);
  if (value === null) return out;

  return [...out, {
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

// ── account attributes pending verification ──────────────────────────────────

const orgOf = (payload: Record<string, unknown>): Record<string, unknown> => {
  const org = payload.organization;
  return (org !== null && typeof org === 'object' ? org : payload) as Record<string, unknown>;
};

const plainText = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
};

const stated = (attribute: string, subject: 'person' | 'account', value: unknown): ProviderField => ({
  attribute,
  subject,
  value,
  // Apollo states no per-field observation date or confidence (see mapApolloPayload).
  observedAt: null,
  confidence: null,
  providerInferred: false,
});

/**
 * `industry`, `founded_year`, `technologies`. Each one is read VERBATIM, with
 * no transformation: industry as Apollo's own label, founded year as a
 * plausible integer, and technologies as a list of non-empty names. A value of
 * any other shape is absent, never coerced. The `want` predicate gates every
 * one of them on the CLAIM, so none of this runs before P-6 verification.
 */
function extraAccountFields(
  payload: Record<string, unknown>,
  want: (attribute: string) => boolean,
): ProviderField[] {
  const org = orgOf(payload);
  const out: ProviderField[] = [];
  if (want('industry')) {
    const v = plainText(org.industry);
    if (v) out.push(stated('industry', 'account', v));
  }
  if (want('founded_year')) {
    const v = org.founded_year;
    const thisYear = new Date().getUTCFullYear();
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1600 && v <= thisYear) {
      out.push(stated('founded_year', 'account', v));
    }
  }
  if (want('technologies')) {
    const v = org.technology_names;
    if (Array.isArray(v)) {
      const names = [...new Set(v.map((x) => plainText(x, 100)).filter((x): x is string => !!x))];
      if (names.length) out.push(stated('technologies', 'account', names));
    }
  }
  return out;
}

// ── the person path ─────────────────────────────────────────────────────────

/** Apollo's seniority labels that are ALSO PI's vocabulary, verbatim. No mapping table. */
const PI_SENIORITIES: ReadonlySet<string> = new Set(SENIORITY_VALUES as readonly string[]);

/**
 * Translate an Apollo `people/match` payload into canonical PERSON fields.
 *
 * Mapped, verbatim: `title` → job_title; `seniority` → seniority only when the
 * label is already a PI seniority value; `city` → city; `state` → region.
 *
 * NEVER mapped, by decision:
 *  - email, phone: owner decision P-3 (and the request asks Apollo not to
 *    reveal them in the first place);
 *  - country: a NAME, PI stores a code (same reason as the account path);
 *  - departments: Apollo's taxonomy is not PI's, so mapping it is inference;
 *  - linkedin_url and the Apollo id: identity, which W1 owns, not attributes;
 *  - the nested organization: a different subject, enriched on its own.
 */
export function mapApolloPersonPayload(
  payload: unknown,
  requested: readonly string[],
  claimed: readonly string[] = APOLLO_SUPPORTED_ATTRIBUTES,
): readonly ProviderField[] {
  if (payload === null || typeof payload !== 'object') return [];
  const person = (payload as Record<string, unknown>).person;
  if (person === null || typeof person !== 'object') return [];
  const p = person as Record<string, unknown>;
  const want = (a: string) => requested.includes(a) && claimed.includes(a);
  const out: ProviderField[] = [];
  if (want('job_title')) {
    const v = plainText(p.title, 300);
    if (v) out.push(stated('job_title', 'person', v));
  }
  if (want('seniority')) {
    const v = plainText(p.seniority, 40)?.toLowerCase() ?? null;
    if (v && PI_SENIORITIES.has(v)) out.push(stated('seniority', 'person', v));
  }
  if (want('city')) {
    const v = plainText(p.city);
    if (v) out.push(stated('city', 'person', v));
  }
  if (want('region')) {
    const v = plainText(p.state);
    if (v) out.push(stated('region', 'person', v));
  }
  return out;
}

/**
 * What the person is matched ON. Strongest first, and only the person's OWN
 * identity or locator: Apollo's id (from `external_keys`), then the email, then
 * (D7(i)) the LinkedIn profile URL read from the person's own evidence. A name
 * alone is never sent — "the person whose name looked closest" is exactly the
 * identity W1 refuses to make — and an employer's domain is never borrowed.
 *
 * `matchedOn` says which one was used, because a LOCATOR match must be checked
 * against what comes back (`checkLocatorMatch`) and an identity match need not.
 */
export function personMatchBody(request: EnrichmentRequest):
  { body: Record<string, unknown>; matchedOn: 'apollo_id' | 'email' | 'linkedin_url' } | null {
  const s = request.selectors ?? {};
  const id = plainText(s.apollo_id, 64);
  const email = plainText(s.email, 320);
  const linkedin = plainText(s.linkedin_url, 400);
  const pick = id ? { base: { id }, matchedOn: 'apollo_id' as const }
    : email ? { base: { email }, matchedOn: 'email' as const }
    : linkedin ? { base: { linkedin_url: linkedin }, matchedOn: 'linkedin_url' as const }
    : null;
  if (!pick) return null;
  // P-3: never ask Apollo to reveal contact data. Revealing also costs extra credits.
  return { body: { ...pick.base, reveal_personal_emails: false, reveal_phone_number: false }, matchedOn: pick.matchedOn };
}

// The name rule (PI review F2) lives in lib/names/personName.ts, shared with
// the R3 import duplicate probe. Re-exported for this module's callers.
export { nameTokens, personNamesAgree, personNamesAgreeable } from '../../../../../lib/names/personName';

/**
 * D7(i) guard: after a LOCATOR match, the answer must be about the same profile
 * AND the same-named person, or nothing is accepted. A locator is a correlate,
 * not an identity (vanity slugs are mutable and reusable).
 *
 *  - Apollo's returned `linkedin_url` must normalise to the key we sent. An
 *    ABSENT url refuses: absence of a contradiction is not agreement.
 *  - the returned name must agree with the person's canonical name (`personNamesAgree`).
 */
export function checkLocatorMatch(
  person: Record<string, unknown>,
  sentKey: string,
  canonicalName: string | null,
): { ok: true } | { ok: false; reason: 'url_absent' | 'url_mismatch' | 'name_mismatch' } {
  const returned = normalizeLinkedinUrl(person.linkedin_url, '/in/');
  if (!returned) return { ok: false, reason: 'url_absent' };
  if (returned.toLowerCase() !== sentKey.toLowerCase()) return { ok: false, reason: 'url_mismatch' };
  const apolloName = plainText(person.name, 300)
    ?? [plainText(person.first_name, 150), plainText(person.last_name, 150)].filter(Boolean).join(' ');
  if (!personNamesAgree(apolloName, canonicalName)) return { ok: false, reason: 'name_mismatch' };
  return { ok: true };
}

// ── one call, shared by both subjects ───────────────────────────────────────

type Sent =
  | { refused: ProviderResponse }
  | { payload: Record<string, unknown>; providerUsage: unknown };

/**
 * Exactly one `safeFetch`, and the complete refusal vocabulary, for whichever
 * endpoint the subject needs. Extracted unchanged from the account path so both
 * subjects classify errors, misses and quota identically.
 */
async function send(
  url: string,
  init: RequestInit,
  endpoint: string,
  credential: string,
  notReturned: readonly string[],
): Promise<Sent> {
  let response: Response;
  try {
    // The repository's egress control, host-pinned, so no caller-supplied
    // value can redirect this anywhere else. The key travels in `x-api-key`,
    // as Apollo's documentation specifies, and never in the URL — a query
    // string is logged by proxies in a way a header is not.
    response = await safeFetch(url, init, {
      allowedHosts: [APOLLO_HOST],
      timeoutMs: APOLLO_TIMEOUT_MS,
    });
  } catch (error) {
    // The canonical classifier: anything unrecognised becomes
    // `provider_unavailable`, never `no_match`.
    const view = classifyApolloTransportError({ error, endpoint, apiKey: credential });
    return {
      refused: {
        ...refuse(classifyEnrichmentError(error), notReturned, view.vendorMessage ?? 'transport failure'),
        providerError: view,
      },
    };
  }

  if (!response.ok) {
    // A6A: the only place a retry horizon exists, read from the provider's own
    // header and never synthesised. Optional-chained deliberately: a transport
    // yielding no `headers` must not throw here.
    const retryAfterAt = parseRetryAfter(response.headers?.get?.('retry-after') ?? null, new Date());
    // 404 is Apollo's "no such record": a miss, not an error.
    if (response.status === 404) {
      return { refused: refuse('no_match', notReturned, `HTTP ${response.status}`, retryAfterAt) };
    }
    const view = classifyApolloHttpError({
      status: response.status,
      headers: response.headers,
      body: await readApolloErrorBody(response),
      endpoint,
      apiKey: credential,
    });
    return {
      refused: {
        ...refuse(enrichmentOutcomeForApollo(view.code), notReturned,
          `HTTP ${response.status} ${view.code}${view.vendorMessage ? ` — ${view.vendorMessage}` : ''}`,
          retryAfterAt),
        providerError: view,
      },
    };
  }

  // Request-rate quota Apollo states on a successful answer. Not a credit balance.
  const providerUsage = parseApolloUsageHeaders(response.headers);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { refused: refuse('malformed_response', notReturned, 'the response body was not JSON') };
  }
  if (payload === null || typeof payload !== 'object') {
    return { refused: refuse('malformed_response', notReturned, 'the response body was not an organization object') };
  }
  return { payload: payload as Record<string, unknown>, providerUsage };
}

function answered(
  fields: readonly ProviderField[],
  request: EnrichmentRequest,
  providerUsage: unknown,
  emptyDetail: string,
): ProviderResponse {
  if (!fields.length) {
    // Matched, but held none of what was asked for. NOT `enriched` with an
    // empty list — a failure must never be reported as a successful nothing.
    return {
      ...refuse('field_not_found', request.attributes, emptyDetail),
      ...(providerUsage ? { providerUsage } : {}),
    };
  }
  const returned = fields.map((f) => f.attribute);
  return {
    outcome: 'enriched',
    fields,
    notReturned: request.attributes.filter((a) => !returned.includes(a)),
    detail: null,
    ...(providerUsage ? { providerUsage } : {}),
  };
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

    if (request.subject === 'person') {
      const match = personMatchBody(request);
      if (!match) {
        return refuse('provider_declined', notReturned,
          'refused before egress: no Apollo id, email or LinkedIn locator is held for this person');
      }
      const locatorForm = plainText(request.selectors?.linkedin_url_form, 20) ?? 'unknown';
      const canonicalName = plainText(request.selectors?.name, 300);
      // A locator match is only checkable with a name to check against. Without
      // one, refuse BEFORE spending: the guard could not run afterwards.
      if (match.matchedOn === 'linkedin_url' && !personNamesAgreeable(canonicalName)) {
        return refuse('provider_declined', notReturned,
          'refused before egress: a LinkedIn-locator match needs a verifiable canonical name for the guard');
      }
      const sent = await send(APOLLO_PEOPLE_MATCH_URL, {
        method: 'POST',
        headers: { 'x-api-key': credential, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(match.body),
      }, APOLLO_PEOPLE_MATCH_ENDPOINT, credential, notReturned);
      if ('refused' in sent) return sent.refused;
      const via = match.matchedOn === 'linkedin_url' ? ` [matched on linkedin_url, form=${locatorForm}]` : '';
      // Apollo answers 200 with `person: null` when it knows nobody: a miss.
      const person = sent.payload.person;
      if (person === null || person === undefined) {
        return refuse('no_match', notReturned, `Apollo returned no person${via}`);
      }
      if (typeof person !== 'object') {
        return refuse('malformed_response', notReturned, 'the response body was not a person object');
      }
      if (match.matchedOn === 'linkedin_url') {
        const guard = checkLocatorMatch(person as Record<string, unknown>, String(match.body.linkedin_url), canonicalName);
        // `'reason' in guard`, not `!guard.ok`: the root tsconfig sets strict:false,
        // which disables narrowing on a negated discriminant.
        if ('reason' in guard) {
          // The call was made (and billed), so this is NOT a pre-egress refusal.
          // Nothing is persisted; the reason is explicit, per record.
          return refuse('no_match', notReturned, `locator guard refused the match: ${guard.reason}${via}`);
        }
      }
      return answered(mapApolloPersonPayload(sent.payload, request.attributes), request, sent.providerUsage,
        'the person was found but returned none of the requested attributes');
    }

    const domain = domainFor(request);
    if (!domain) {
      // PI's vocabulary has no `insufficient_input`. `provider_declined` is the
      // closest member; the detail names who declined so it is not misread as
      // Apollo's verdict — Apollo was never contacted.
      return refuse('provider_declined', notReturned,
        'refused before egress: no canonical account domain was supplied');
    }

    const sent = await send(`${APOLLO_ENRICH_URL}?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers: { 'x-api-key': credential, accept: 'application/json' },
    }, APOLLO_ENRICH_ENDPOINT, credential, notReturned);
    if ('refused' in sent) return sent.refused;
    return answered(mapApolloPayload(sent.payload, request.attributes), request, sent.providerUsage,
      'the organization was found but returned no representable employee count');
  },
};
