/**
 * PHASE 4 — Apollo prospect discovery.
 *
 * WHAT THESE DEFEND. The capability is now real, which means the risks changed
 * shape: the danger is no longer "nothing happens" but "something happens that
 * nobody authorised, or that is reported untruthfully". So the tests pin the
 * boundaries the adapter must not cross, the identity rule that makes replay
 * safe, the contactability rule that keeps prospects from being discarded, and
 * the one claim that must stay false — operational verification.
 *
 * NO APOLLO CALL IS MADE. `safeFetch` is mocked as a TRIPWIRE for every test
 * that must not reach transport, and asserted on for the ones that exercise
 * request serialisation. No credential is configured and no environment key is
 * read.
 */

const safeFetchMock = jest.fn();
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import {
  apolloDiscoveryAdapter,
  buildApolloSearchBody,
  parseApolloSearchResponse,
  classifyApolloStatus,
  pageFromContinuation,
  ApolloDiscoveryError,
  APOLLO_HOST,
  APOLLO_DISCOVERY_URL,
  APOLLO_MAX_PER_PAGE,
  APOLLO_DISCOVERY_FILTERS,
} from '../../services/prospectDiscovery/adapters/apolloDiscovery';
import {
  apolloLeadSourceAdapter,
  translateApolloPerson,
  APOLLO_SOURCE,
} from '../../services/leadIngestion/adapters/apolloAdapter';
import { registerDiscoveryAdapters } from '../../services/prospectDiscovery/adapters';
import {
  getDiscoveryProvider,
  hasDiscoveryProvider,
  __resetDiscoveryProviderRegistry,
} from '../../services/prospectDiscovery/providerRegistry';
import {
  hasLeadSourceAdapter,
  __resetLeadSourceRegistry,
} from '../../services/leadIngestion/registry';
import {
  getCapability,
  derivePresentationStatus,
  isCapabilityConnectable,
  isOperationallyVerified,
  buildCapabilityCard,
  OPERATIONAL_VERIFICATIONS,
} from '../../services/integrations/providerCapabilityModel';

const ORG_A = '11111111-1111-4111-8111-111111111111';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

/** A realistic Apollo person shape — the fields the adapter actually reads. */
const person = (over: Record<string, unknown> = {}) => ({
  id: 'apollo-person-1',
  first_name: 'Ada',
  last_name: 'Lovelace',
  name: 'Ada Lovelace',
  title: 'Head of Analytics',
  email: 'ada@example.com',
  city: 'London',
  state: 'England',
  organization: {
    id: 'apollo-org-9',
    name: 'Example Ltd',
    primary_domain: 'example.com',
    estimated_num_employees: 250,
  },
  ...over,
});

const pageBody = (people: unknown[], pagination?: Record<string, unknown>) => ({
  people,
  pagination: pagination ?? { page: 1, per_page: 25, total_entries: people.length, total_pages: 1 },
});

beforeEach(() => {
  safeFetchMock.mockReset();
  __resetDiscoveryProviderRegistry();
  __resetLeadSourceRegistry();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — the adapter implements the frozen contract and nothing more', () => {
  it('declares the provider key that matches its translator', () => {
    expect(apolloDiscoveryAdapter.provider).toBe('apollo');
    expect(apolloLeadSourceAdapter.source).toBe('apollo');
    expect(apolloDiscoveryAdapter.provider).toBe(apolloLeadSourceAdapter.source);
    expect(typeof apolloDiscoveryAdapter.discover).toBe('function');
  });

  it('owns no concern outside request/response — asserted on its own source', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(),
        'backend/services/prospectDiscovery/adapters/apolloDiscovery.ts'), 'utf8');
    // No tenant authorization, credential storage, ledger, idempotency, lease,
    // cost, canonical write or identity resolution.
    expect(src).not.toMatch(/ownedDbTable\s*\(|encryptCredential|integration_credentials/);
    expect(src).not.toMatch(/discoveryAttemptStore|claimDiscoveryExecution|completeDiscoveryExecution/);
    expect(src).not.toMatch(/authorizeCost|resolveCredential|enforceCompanyAccess/);
    expect(src).not.toMatch(/resolveUnifiedPerson|ingestLeadBatch|canonical_leads/);
    // And never the environment for a credential.
    expect(src).not.toMatch(/process\.env\s*[.[]/);
  });

  it('uses POST to the one authorized operation, host-pinned', async () => {
    safeFetchMock.mockResolvedValue(ok(pageBody([person()])));
    await apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['Head of Analytics'] },
      continuation: null, remaining: 25, credential: 'tenant-key',
    });
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [url, init, opts] = safeFetchMock.mock.calls[0];
    expect(url).toBe(APOLLO_DISCOVERY_URL);
    // Pinned exactly, not by substring. `api_search` is Apollo's programmatic
    // People Search path; `/mixed_people/search` is the surface its own app
    // uses, and calling that one is the defect this assertion exists to catch.
    expect(url).toBe('https://api.apollo.io/api/v1/mixed_people/api_search');
    expect(url).not.toMatch(/\/mixed_people\/search(\?|$)/);
    expect(init.method).toBe('POST');
    expect(opts.allowedHosts).toEqual([APOLLO_HOST]);
    expect(typeof opts.timeoutMs).toBe('number');
  });

  it('sends the key in a HEADER and never in the URL', async () => {
    safeFetchMock.mockResolvedValue(ok(pageBody([])));
    await apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['CTO'] },
      continuation: null, remaining: 10, credential: 'SECRET-TENANT-KEY',
    });
    const [url, init] = safeFetchMock.mock.calls[0];
    expect(init.headers['x-api-key']).toBe('SECRET-TENANT-KEY');
    expect(String(url)).not.toContain('SECRET-TENANT-KEY');
  });

  it('refuses to call the provider with an empty credential', async () => {
    await expect(apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['CTO'] },
      continuation: null, remaining: 10, credential: '   ',
    })).rejects.toThrow(/apollo_unauthorized/);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — request serialisation is an ALLOWLIST', () => {
  it('maps only the declared canonical filters onto Apollo parameters', () => {
    const body = buildApolloSearchBody({
      filters: { titles: ['CTO'], companyDomains: ['example.com'], nameQuery: 'ada' },
      page: 1, remaining: 25,
    });
    expect(body[APOLLO_DISCOVERY_FILTERS.titles]).toEqual(['CTO']);
    expect(body[APOLLO_DISCOVERY_FILTERS.companyDomains]).toEqual(['example.com']);
    expect(body[APOLLO_DISCOVERY_FILTERS.nameQuery]).toBe('ada');
  });

  it('DROPS an unsupported field rather than forwarding it to Apollo', () => {
    const body = buildApolloSearchBody({
      filters: { titles: ['CTO'], reveal_personal_emails: true, arbitrary: 'x' },
      page: 1, remaining: 25,
    });
    // A caller must not be able to switch on an Apollo behaviour nobody reviewed.
    expect(body).not.toHaveProperty('reveal_personal_emails');
    expect(body).not.toHaveProperty('arbitrary');
    expect(Object.keys(body).sort())
      .toEqual(['include_similar_titles', 'page', 'per_page', 'person_titles']);
  });

  // ─── PI-ICP-DISCOVERY-005 — exact title matching ───────────────────────
  it('sends include_similar_titles as literal FALSE, not absent and not truthy', () => {
    const body = buildApolloSearchBody({ filters: { titles: ['CTO'] }, page: 1, remaining: 25 });
    // Apollo's `person_titles` is fuzzy BY DEFAULT, and the ICP's `one_of` is
    // exact membership. An absent parameter is what produced the broadening, so
    // identity against `false` is the assertion — `toBeFalsy()` would pass on
    // undefined and prove nothing.
    expect(body.include_similar_titles).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'include_similar_titles')).toBe(true);
  });

  it('it is present on EVERY supported filter shape, not only titles', () => {
    for (const filters of [
      { titles: ['CTO'] },
      { seniorities: ['director'] },
      { companyDomains: ['example.com'] },
      { nameQuery: 'ada' },
    ]) {
      expect(buildApolloSearchBody({ filters, page: 1, remaining: 25 }).include_similar_titles).toBe(false);
    }
  });

  it('it does NOT defeat the unbounded-request guard', () => {
    // The guard counts the FILTER keys, so this parameter must be added after
    // it. If it were added first, an unfiltered request would look filtered.
    expect(() => buildApolloSearchBody({ filters: {}, page: 1, remaining: 25 }))
      .toThrow(/apollo_validation_error/);
  });

  it('a caller cannot re-enable fuzzy matching through the filters', () => {
    const body = buildApolloSearchBody({
      filters: { titles: ['CTO'], include_similar_titles: true },
      page: 1, remaining: 25,
    });
    // Not in the six-key allowlist, so the caller's value is dropped and the
    // adapter's own `false` stands.
    expect(body.include_similar_titles).toBe(false);
  });

  it('seniorities serialize to the documented Apollo parameter', () => {
    const body = buildApolloSearchBody({
      filters: { titles: ['CTO'], seniorities: ['director', 'vp'] }, page: 1, remaining: 25,
    });
    expect(body[APOLLO_DISCOVERY_FILTERS.seniorities]).toEqual(['director', 'vp']);
    expect(APOLLO_DISCOVERY_FILTERS.seniorities).toBe('person_seniorities');
  });

  it('the six-key allowlist is unchanged by this batch', () => {
    expect(Object.keys(APOLLO_DISCOVERY_FILTERS).sort()).toEqual([
      'companyDomains', 'companyHeadcount', 'locations', 'nameQuery', 'seniorities', 'titles',
    ]);
  });

  it('refuses a request with no supported filter — that would be unbounded', () => {
    expect(() => buildApolloSearchBody({ filters: { nope: 1 }, page: 1, remaining: 25 }))
      .toThrow(/apollo_validation_error/);
  });

  it('per_page takes the SMALLER of Apollo\'s cap and the remaining budget', () => {
    expect(buildApolloSearchBody({ filters: { titles: ['x'] }, page: 1, remaining: 7 }).per_page).toBe(7);
    expect(buildApolloSearchBody({ filters: { titles: ['x'] }, page: 1, remaining: 10_000 }).per_page)
      .toBe(APOLLO_MAX_PER_PAGE);
  });

  it('a caller cannot enlarge the ask through the filters', async () => {
    safeFetchMock.mockResolvedValue(ok(pageBody([])));
    await apolloDiscoveryAdapter.discover({
      organizationId: ORG_A,
      filters: { titles: ['x'], per_page: 10_000, page: 999 },
      continuation: null, remaining: 5, credential: 'k',
    });
    const sent = JSON.parse(safeFetchMock.mock.calls[0][1].body);
    expect(sent.per_page).toBe(5);     // the execution's budget, not the caller's
    expect(sent.page).toBe(1);         // the continuation, not the caller's
  });

  it('refuses when the execution has no remaining budget', async () => {
    await expect(apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['x'] },
      continuation: null, remaining: 0, credential: 'k',
    })).rejects.toThrow(/apollo_validation_error/);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — response parsing and pagination', () => {
  it('reads the people collection and returns them verbatim', () => {
    const page = parseApolloSearchResponse(pageBody([person()]));
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({ id: 'apollo-person-1' });
  });

  it('an empty page is a valid result, NOT a failure', () => {
    const page = parseApolloSearchResponse(pageBody([]));
    expect(page.records).toEqual([]);
    expect(page.continuation).toBeNull();
  });

  it('continuation is the NEXT page, and only when Apollo says one exists', () => {
    expect(parseApolloSearchResponse(pageBody([person()],
      { page: 1, total_pages: 3 })).continuation).toBe(2);
    expect(parseApolloSearchResponse(pageBody([person()],
      { page: 3, total_pages: 3 })).continuation).toBeNull();
    // No pagination block at all ⇒ no invented next page.
    expect(parseApolloSearchResponse({ people: [person()] }).continuation).toBeNull();
  });

  it('pageFromContinuation is 1-based and refuses nonsense', () => {
    expect(pageFromContinuation(null)).toBe(1);
    expect(pageFromContinuation(4)).toBe(4);
    expect(pageFromContinuation('nope')).toBe(1);
    expect(pageFromContinuation(0)).toBe(1);
  });

  it('a provider request id is passed through only when supplied', () => {
    expect(parseApolloSearchResponse({ ...pageBody([]), request_id: 'req-7' }).providerRequestId)
      .toBe('req-7');
    expect(parseApolloSearchResponse(pageBody([])).providerRequestId).toBeNull();
  });

  it('cost is reported UNKNOWN, never free', () => {
    // D22-B4-A left Apollo's billing unverified; optimising silence into `free`
    // is the fabricated zero-cost claim those gates forbade.
    expect(parseApolloSearchResponse(pageBody([])).cost).toEqual({ state: 'unknown', units: null });
  });

  it('a body with no result collection is malformed', () => {
    expect(() => parseApolloSearchResponse({ pagination: { page: 1, total_pages: 1 } }))
      .toThrow(/apollo_malformed_response/);
    expect(() => parseApolloSearchResponse('nope')).toThrow(/apollo_malformed_response/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — provider failures are normalised, never guessed', () => {
  it('maps each status onto a stable token', () => {
    expect(classifyApolloStatus(401)).toBe('apollo_unauthorized');
    expect(classifyApolloStatus(403)).toBe('apollo_forbidden');
    expect(classifyApolloStatus(429)).toBe('apollo_rate_limited');
    expect(classifyApolloStatus(422)).toBe('apollo_validation_error');
    expect(classifyApolloStatus(400)).toBe('apollo_validation_error');
    expect(classifyApolloStatus(500)).toBe('apollo_unavailable');
    expect(classifyApolloStatus(503)).toBe('apollo_unavailable');
    // An unrecognised status is never rounded towards success.
    expect(classifyApolloStatus(418)).toBe('apollo_unavailable');
  });

  it('a non-ok response throws the classified failure', async () => {
    for (const [status, token] of [[401, 'apollo_unauthorized'], [429, 'apollo_rate_limited'],
      [500, 'apollo_unavailable'], [422, 'apollo_validation_error']] as const) {
      safeFetchMock.mockReset();
      safeFetchMock.mockResolvedValue(fail(status as number));
      await expect(apolloDiscoveryAdapter.discover({
        organizationId: ORG_A, filters: { titles: ['x'] },
        continuation: null, remaining: 5, credential: 'k',
      })).rejects.toThrow(new RegExp(token));
    }
  });

  it('a timeout is distinguished from an unavailable host', async () => {
    safeFetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    await expect(apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['x'] },
      continuation: null, remaining: 5, credential: 'k',
    })).rejects.toThrow(/apollo_timeout/);

    safeFetchMock.mockReset();
    safeFetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['x'] },
      continuation: null, remaining: 5, credential: 'k',
    })).rejects.toThrow(/apollo_unavailable/);
  });

  it('a non-JSON body is malformed, not an empty success', async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('nope'); } });
    await expect(apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['x'] },
      continuation: null, remaining: 5, credential: 'k',
    })).rejects.toThrow(/apollo_malformed_response/);
  });

  it('the adapter NEVER retries — one call per discover()', async () => {
    safeFetchMock.mockResolvedValue(fail(429));
    await expect(apolloDiscoveryAdapter.discover({
      organizationId: ORG_A, filters: { titles: ['x'] },
      continuation: null, remaining: 5, credential: 'k',
    })).rejects.toThrow();
    // Retry, backoff and the call ceiling belong to the executor, which can see
    // the bill. A retry here would multiply a paid call invisibly.
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it('the thrown error is an ApolloDiscoveryError carrying its classification', async () => {
    safeFetchMock.mockResolvedValue(fail(403));
    try {
      await apolloDiscoveryAdapter.discover({
        organizationId: ORG_A, filters: { titles: ['x'] },
        continuation: null, remaining: 5, credential: 'k',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApolloDiscoveryError);
      expect((e as ApolloDiscoveryError).failure).toBe('apollo_forbidden');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — Apollo person ID is the SOURCE IDENTITY', () => {
  it('externalId is Apollo\'s id, and it lands in external_keys too', () => {
    const { normalized } = translateApolloPerson(person(), ORG_A);
    expect(normalized.externalId).toBe('apollo-person-1');
    expect(normalized.person!.externalKeys).toEqual({ apollo: { external_id: 'apollo-person-1' } });
    expect(normalized.source).toBe(APOLLO_SOURCE);
    expect(normalized.entityType).toBe('person');
    expect(normalized.organizationId).toBe(ORG_A);
  });

  it('a record with NO id is refused — replay would otherwise duplicate people', () => {
    expect(() => translateApolloPerson(person({ id: undefined }), ORG_A))
      .toThrow(/Apollo person id is the source identity/);
  });

  it('email is NEVER the source identity', () => {
    const { normalized } = translateApolloPerson(person({ id: 'apollo-x' }), ORG_A);
    expect(normalized.externalId).toBe('apollo-x');
    expect(normalized.externalId).not.toBe('ada@example.com');
    expect(normalized.person!.externalKeys).toEqual({ apollo: { external_id: 'apollo-x' } });
  });

  it('name and phone are NEVER the source identity', () => {
    const { normalized } = translateApolloPerson(
      person({ id: 'apollo-y', email: null, sanitized_phone: '+44 20 7123 4567' }), ORG_A);
    expect(normalized.externalId).toBe('apollo-y');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — a person without contact details is STILL a prospect', () => {
  it('no email: the record is translated, not dropped', () => {
    const { normalized } = translateApolloPerson(person({ email: null }), ORG_A);
    expect(normalized.externalId).toBe('apollo-person-1');
    expect(normalized.person!.email).toBeNull();
    expect(normalized.person!.externalKeys).toBeTruthy();
  });

  it('no email AND no phone: still translated', () => {
    const { normalized } = translateApolloPerson(
      person({ email: null, phone_number: null, sanitized_phone: null }), ORG_A);
    expect(normalized.externalId).toBe('apollo-person-1');
    expect(normalized.person!.email).toBeNull();
    expect(normalized.person!.phone).toBeNull();
  });

  it('an obfuscated last name does not prevent translation', () => {
    const { normalized } = translateApolloPerson(
      person({ last_name: null, name: 'Ada' }), ORG_A);
    expect(normalized.externalId).toBe('apollo-person-1');
    expect(normalized.person!.lastName).toBeNull();
  });

  it('nothing is invented for an absent field', () => {
    const { normalized } = translateApolloPerson({ id: 'apollo-min' }, ORG_A);
    expect(normalized.person!.email).toBeNull();
    expect(normalized.person!.jobTitle).toBeNull();
    expect(normalized.account).toBeNull();
    // Apollo states no observation date and no confidence; neither is fabricated.
    expect(normalized.observedAt).toBeNull();
    expect(normalized.confidence).toBeNull();
    // Apollo returns a country NAME; PI stores a code, so it is left absent
    // rather than guessed at.
    expect(normalized.person!.countryCode).toBeNull();
  });

  it('the employer is carried only when Apollo described one', () => {
    const { normalized } = translateApolloPerson(person(), ORG_A);
    expect(normalized.account).toMatchObject({
      externalId: 'apollo-org-9', name: 'Example Ltd', domain: 'example.com', employeeCount: 250,
    });
  });

  it('the raw record is passed VERBATIM for provenance', () => {
    const raw = person({ extra_apollo_field: { nested: [1, 2] } });
    const result = translateApolloPerson(raw, ORG_A);
    expect(result.raw).toBe(raw);
  });

  it('the translator is pure — no I/O anywhere in its module', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(),
        'backend/services/leadIngestion/adapters/apolloAdapter.ts'), 'utf8');
    expect(src).not.toMatch(/safeFetch|fetch\(|axios/);
    expect(src).not.toMatch(/ownedDbTable\s*\(|from '[^']*supabase/);
    // TABLE ACCESS, not the words. The header names `source_records`,
    // `source_assertions` and `unified_persons` precisely to record that this
    // module does not write them, and that prose must not satisfy the assertion.
    for (const table of ['canonical_leads', 'unified_persons', 'source_records', 'source_assertions']) {
      expect(src).not.toContain(`ownedDbTable('${table}')`);
      expect(src).not.toContain(`from('${table}')`);
    }
    expect(src).not.toMatch(/process\.env\s*[.[]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — registration pairs both halves', () => {
  it('registers the discovery provider AND its translator', () => {
    expect(hasDiscoveryProvider('apollo')).toBe(false);
    expect(hasLeadSourceAdapter('apollo')).toBe(false);
    registerDiscoveryAdapters();
    expect(hasDiscoveryProvider('apollo')).toBe(true);
    expect(hasLeadSourceAdapter('apollo')).toBe(true);
    expect(getDiscoveryProvider('apollo')).toBe(apolloDiscoveryAdapter);
  });

  it('is idempotent — a second call does not throw', () => {
    registerDiscoveryAdapters();
    expect(() => registerDiscoveryAdapters()).not.toThrow();
  });

  it('registration alone contacts nobody', () => {
    registerDiscoveryAdapters();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Phase 4 — capability state: implemented and executable, NOT verified', () => {
  it('Apollo discovery is now implemented and executable', () => {
    const d = getCapability('apollo', 'discovery')!;
    expect(d.implemented).toBe(true);
    expect(d.executable).toBe(true);
  });

  it('Apollo discovery is NOT operationally verified', () => {
    // The whole point. A passing mock is not Layer D evidence.
    expect(isOperationallyVerified('apollo', 'discovery')).toBe(false);
    expect(derivePresentationStatus('apollo', 'discovery')).toBe('not_operational');
    expect(OPERATIONAL_VERIFICATIONS.map((v) => v.providerId)).not.toContain('apollo');
  });

  it('the UI must not be able to read "Operational"', () => {
    expect(derivePresentationStatus('apollo', 'discovery')).not.toBe('operational');
    expect(buildCapabilityCard('apollo', 'discovery')!.status).toBe('not_operational');
  });

  it('discovery is now tenant configurable and connectable', () => {
    expect(isCapabilityConnectable('apollo', 'discovery')).toBe(true);
    expect(buildCapabilityCard('apollo', 'discovery')!.action).toBe('configure');
  });

  it('a stored credential STILL cannot make discovery operational', () => {
    const withKey = buildCapabilityCard('apollo', 'discovery', { credentialed: true })!;
    expect(withKey.credentialState).toBe('configured');
    expect(withKey.status).toBe('not_operational');
    expect(isOperationallyVerified('apollo', 'discovery')).toBe(false);
  });

  it('Apollo enrichment is untouched, and remains a SEPARATE capability', () => {
    const e = getCapability('apollo', 'enrichment')!;
    expect(e.implemented).toBe(true);
    expect(e.executable).toBe(true);
    expect(derivePresentationStatus('apollo', 'enrichment')).toBe('not_operational');
    // One provider identity, two capabilities — never two providers.
    expect(getCapability('apollo_enrichment', 'enrichment')).toBeNull();
  });
});
