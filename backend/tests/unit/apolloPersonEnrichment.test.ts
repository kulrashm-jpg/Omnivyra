/**
 * Apollo — the PERSON path (people/match) and the account attributes pending
 * verification.
 *
 * Owner decisions (2026-11-10): P-3 no email/phone in v1; P-6 attributes are
 * claimed only after one live call per subject confirms the response shape.
 * So these tests prove three things: the person path spends at most once and
 * only on the person's own identity; contact data is never requested nor
 * mapped; and nothing outside `APOLLO_SUPPORTED_ATTRIBUTES` is ever returned,
 * however complete the payload.
 *
 * SECRETS: synthetic only. The transport is mocked at `safeFetch`.
 */

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(),
}));

import { safeFetch } from '../../../lib/security/safeFetch';
import {
  apolloEnrichmentAdapter,
  mapApolloPayload,
  mapApolloPersonPayload,
  personMatchBody,
  APOLLO_PENDING_VERIFICATION,
  APOLLO_SUPPORTED_ATTRIBUTES,
} from '../../services/enrichment/providers/adapters/apollo';
import { canonicalSelectors } from '../../services/enrichment/execution';
import type { EnrichmentRequest } from '../../services/enrichment/providers/contract';

const fetchMock = safeFetch as unknown as jest.Mock;
const SECRET = 'synthetic-tenant-apollo-key';

const personRequest = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: '11111111-1111-4111-8111-111111111111',
  subject: 'person',
  entityId: '22222222-2222-4222-8222-222222222222',
  attributes: ['job_title', 'seniority'],
  selectors: { apollo_id: 'ap-person-1', email: 'jane@example.com' },
  purpose: 'apollo-person-pilot',
  correlationId: 'corr-person',
  credential: SECRET,
  ...over,
} as EnrichmentRequest);

const ok = (body: unknown) => ({
  ok: true, status: 200, headers: { get: () => null }, json: async () => body,
});
const notOk = (status: number) => ({
  ok: false, status, headers: { get: () => null }, json: async () => ({}),
});

const PERSON_PAYLOAD = {
  person: {
    id: 'ap-person-1',
    title: 'VP Marketing',
    seniority: 'vp',
    city: 'London',
    state: 'England',
    country: 'United Kingdom',
    departments: ['master_marketing'],
    email: 'jane@example.com',
    phone_numbers: [{ raw_number: '+44 20 0000 0000' }],
    linkedin_url: 'http://www.linkedin.com/in/jane-doe',
    organization: { id: 'ap-org-1', primary_domain: 'example.com', estimated_num_employees: 240 },
  },
};

beforeEach(() => fetchMock.mockReset());

describe('the claim is the gate (P-6)', () => {
  it('claims are unchanged until live verification: employee_count only', () => {
    expect([...APOLLO_SUPPORTED_ATTRIBUTES]).toEqual(['employee_count']);
    expect(APOLLO_PENDING_VERIFICATION).toEqual({
      person: ['job_title', 'seniority', 'city', 'region'],
      account: ['industry', 'founded_year', 'technologies'],
    });
  });

  it('an unclaimed person attribute is never returned, even when Apollo supplies it', async () => {
    fetchMock.mockResolvedValueOnce(ok(PERSON_PAYLOAD));
    const out = await apolloEnrichmentAdapter.enrich(personRequest());
    expect(out.outcome).toBe('field_not_found');
    expect(out.fields).toEqual([]);
  });

  it('an unclaimed account attribute is never returned either', () => {
    const payload = { organization: { estimated_num_employees: 240, industry: 'software', founded_year: 2011, technology_names: ['React'] } };
    expect(mapApolloPayload(payload, ['employee_count', 'industry', 'founded_year', 'technologies']).map((f) => f.attribute))
      .toEqual(['employee_count']);
  });
});

describe('person mapping (as it will behave once claimed)', () => {
  const claimed = [...APOLLO_SUPPORTED_ATTRIBUTES, ...APOLLO_PENDING_VERIFICATION.person];

  it('maps title, seniority, city and state verbatim; nothing else', () => {
    const fields = mapApolloPersonPayload(PERSON_PAYLOAD, ['job_title', 'seniority', 'city', 'region'], claimed);
    expect(fields.map((f) => [f.attribute, f.subject, f.value])).toEqual([
      ['job_title', 'person', 'VP Marketing'],
      ['seniority', 'person', 'vp'],
      ['city', 'person', 'London'],
      ['region', 'person', 'England'],
    ]);
    for (const f of fields) {
      expect(f).toMatchObject({ observedAt: null, confidence: null, providerInferred: false });
    }
    const json = JSON.stringify(fields);
    for (const never of ['jane@example.com', '+44', 'linkedin', 'United Kingdom', 'master_marketing', 'ap-org-1']) {
      expect(json).not.toContain(never);
    }
  });

  it('a seniority label outside the PI vocabulary is absent, never guessed', () => {
    const fields = mapApolloPersonPayload({ person: { seniority: 'senior_vice_overlord' } }, ['seniority'], claimed);
    expect(fields).toEqual([]);
  });

  it('only requested attributes are returned', () => {
    expect(mapApolloPersonPayload(PERSON_PAYLOAD, ['city'], claimed).map((f) => f.attribute)).toEqual(['city']);
  });
});

describe('account mapping (as it will behave once claimed)', () => {
  const claimed = [...APOLLO_SUPPORTED_ATTRIBUTES, ...APOLLO_PENDING_VERIFICATION.account];
  const all = ['employee_count', 'industry', 'founded_year', 'technologies'];

  it('maps industry, founded_year and technology names verbatim', () => {
    const fields = mapApolloPayload({
      organization: { estimated_num_employees: 240, industry: 'computer software', founded_year: 2011, technology_names: ['React', ' AWS ', 'React', ''] },
    }, all, claimed);
    expect(Object.fromEntries(fields.map((f) => [f.attribute, f.value]))).toEqual({
      industry: 'computer software', founded_year: 2011, technologies: ['React', 'AWS'], employee_count: 240,
    });
  });

  it('implausible or mistyped values are absent, never coerced', () => {
    const fields = mapApolloPayload({
      organization: { industry: 42, founded_year: '2011', technology_names: 'React' },
    }, all, claimed);
    expect(fields).toEqual([]);
    expect(mapApolloPayload({ organization: { founded_year: 3011 } }, all, claimed)).toEqual([]);
  });
});

describe('person egress', () => {
  it('ONE POST to people/match, host-pinned, key in the header, matched on the Apollo id, reveals OFF', async () => {
    fetchMock.mockResolvedValueOnce(ok(PERSON_PAYLOAD));
    await apolloEnrichmentAdapter.enrich(personRequest());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.apollo.io/api/v1/people/match');
    expect(url).not.toContain(SECRET);
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe(SECRET);
    expect(opts.allowedHosts).toEqual(['api.apollo.io']);
    // The strongest identity wins and the email is NOT sent alongside it.
    expect(JSON.parse(init.body)).toEqual({ id: 'ap-person-1', reveal_personal_emails: false, reveal_phone_number: false });
  });

  it('falls back to the email when no Apollo id is held', () => {
    expect(personMatchBody(personRequest({ selectors: { email: 'jane@example.com' } })))
      .toEqual({ body: { email: 'jane@example.com', reveal_personal_emails: false, reveal_phone_number: false }, matchedOn: 'email' });
  });

  it('a NAME alone is never a match key: refused before egress, zero requests', async () => {
    const out = await apolloEnrichmentAdapter.enrich(personRequest({ selectors: { name: 'Jane Doe' } }));
    expect(out.outcome).toBe('provider_declined');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no credential: credential_missing, zero requests', async () => {
    const out = await apolloEnrichmentAdapter.enrich(personRequest({ credential: '' }));
    expect(out.outcome).toBe('credential_missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('person: null and 404 are both a miss', async () => {
    fetchMock.mockResolvedValueOnce(ok({ person: null }));
    expect((await apolloEnrichmentAdapter.enrich(personRequest())).outcome).toBe('no_match');
    fetchMock.mockResolvedValueOnce(notOk(404));
    expect((await apolloEnrichmentAdapter.enrich(personRequest())).outcome).toBe('no_match');
  });

  it('a 429 is rate_limited, not a miss; the credential never appears in the detail', async () => {
    fetchMock.mockResolvedValueOnce(notOk(429));
    const out = await apolloEnrichmentAdapter.enrich(personRequest());
    expect(out.outcome).toBe('rate_limited');
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('a non-object person is malformed, not a success', async () => {
    fetchMock.mockResolvedValueOnce(ok({ person: 'x' }));
    expect((await apolloEnrichmentAdapter.enrich(personRequest())).outcome).toBe('malformed_response');
  });

  it('the account path still sends exactly the domain request it always did', async () => {
    fetchMock.mockResolvedValueOnce(ok({ organization: { estimated_num_employees: 12 } }));
    const out = await apolloEnrichmentAdapter.enrich(personRequest({
      subject: 'account', attributes: ['employee_count'], selectors: { domain: 'Example.com' },
    }));
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.apollo.io/api/v1/organizations/enrich?domain=example.com');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(out.outcome).toBe('enriched');
  });
});

describe('person selectors', () => {
  it('the Apollo id is read from the person\'s OWN external_keys; nothing is borrowed', () => {
    expect(canonicalSelectors('person', {
      primary_email: 'a@example.com', full_name: 'A Person',
      external_keys: { apollo: { external_id: 'ap-1' }, linkedin_sales_navigator: { external_id: 'ACwAAA1' } },
      domain_normalized: 'example.com',
    })).toEqual({ email: 'a@example.com', name: 'A Person', apollo_id: 'ap-1' });
  });

  it('a malformed external_keys value yields no Apollo id', () => {
    for (const external_keys of [null, 'x', { apollo: 'ap-1' }, { apollo: { external_id: '  ' } }]) {
      expect(canonicalSelectors('person', { external_keys })).toEqual({});
    }
  });
});
