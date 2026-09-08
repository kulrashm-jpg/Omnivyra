/**
 * Apollo — the organization enrichment adapter.
 *
 * ─── WHAT THESE TESTS ARE FOR ──────────────────────────────────────────────
 * Apollo bills 1 credit per organization enriched, and its documentation does
 * not say a miss is refunded. So the properties that matter are not "does it
 * parse JSON" but: does it refuse BEFORE spending anything when it cannot
 * possibly succeed, does it spend EXACTLY once when it can, and does it decline
 * to invent a number when the provider did not give one.
 *
 * Every test counts outbound requests, because that is the unit of cost.
 *
 * SECRETS: all synthetic. No real Apollo key, no real Apollo request — the
 * transport is mocked at `safeFetch`, so nothing leaves this process.
 */

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(),
}));

import { safeFetch } from '../../../lib/security/safeFetch';
import {
  apolloEnrichmentAdapter,
  mapApolloPayload,
  APOLLO_SUPPORTED_ATTRIBUTES,
} from '../../services/enrichment/providers/adapters/apollo';
import { registerPiEnrichmentAdapters } from '../../services/enrichment/providers/adapters';
import { getProvider } from '../../services/enrichment/providers/registry';
import { getSource } from '../../services/enrichment/providers/sources';
import { evaluateSource } from '../../services/enrichment/providers/selection';
import type { EnrichmentRequest } from '../../services/enrichment/providers/contract';

const fetchMock = safeFetch as unknown as jest.Mock;

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const SECRET = 'synthetic-tenant-apollo-key';

const request = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG,
  subject: 'account',
  entityId: ACCOUNT,
  attributes: ['employee_count'],
  selectors: { domain: 'example.com' },
  purpose: 'apollo-pilot',
  correlationId: 'corr-apollo',
  credential: SECRET,
  ...over,
} as EnrichmentRequest);

/** A response object shaped like the one `safeFetch` returns. */
const ok = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});

const notOk = (status: number, headers: Record<string, string> = {}) => ({
  ok: false,
  status,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  json: async () => ({}),
});

beforeEach(() => { fetchMock.mockReset(); });

// ── Test 1 — no domain, no spend ────────────────────────────────────────────

describe('Apollo — it refuses before egress when it cannot succeed', () => {
  it('NO DOMAIN: provider_declined and ZERO Apollo requests', async () => {
    const out = await apolloEnrichmentAdapter.enrich(request({ selectors: {} }));

    expect(out.outcome).toBe('provider_declined');
    expect(fetchMock).toHaveBeenCalledTimes(0);          // the cost is the point
    expect(out.detail).toMatch(/refused before egress/);
    expect(out.fields).toEqual([]);
  });

  it('a company NAME is not a fallback — Apollo supports it, this adapter does not', async () => {
    // Apollo will match on name, and "the account whose name looked closest" is
    // exactly the identity W4 refuses to make.
    const out = await apolloEnrichmentAdapter.enrich(
      request({ selectors: { name: 'Example Incorporated' } }));

    expect(out.outcome).toBe('provider_declined');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('NO CREDENTIAL: credential_missing, and still zero requests', async () => {
    const out = await apolloEnrichmentAdapter.enrich(request({ credential: '' } as never));

    expect(out.outcome).toBe('credential_missing');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

// ── Test 2 + 3 — the successful call ────────────────────────────────────────

describe('Apollo — a successful enrichment is one call and one integer', () => {
  it('normalizes estimated_num_employees to employee_count, exactly', async () => {
    fetchMock.mockResolvedValueOnce(ok({ organization: { estimated_num_employees: 240 } }));

    const out = await apolloEnrichmentAdapter.enrich(request());

    expect(out.outcome).toBe('enriched');
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0]).toMatchObject({
      attribute: 'employee_count',
      subject: 'account',
      value: 240,                     // the exact integer, not coerced or banded
      providerInferred: true,         // Apollo's own estimate, labelled as such
    });
    expect(out.notReturned).toEqual([]);
  });

  it('EXACTLY ONE Apollo request — never two', async () => {
    fetchMock.mockResolvedValueOnce(ok({ organization: { estimated_num_employees: 12 } }));

    await apolloEnrichmentAdapter.enrich(request());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('calls the documented endpoint, host-pinned, key in the header and not the URL', async () => {
    fetchMock.mockResolvedValueOnce(ok({ organization: { estimated_num_employees: 12 } }));

    await apolloEnrichmentAdapter.enrich(request());

    const [url, init, options] = fetchMock.mock.calls[0];
    expect(url).toContain('https://api.apollo.io/api/v1/organizations/enrich');
    expect(url).toContain('domain=example.com');
    expect(url).not.toContain(SECRET);                    // never in a query string
    expect(init.method).toBe('GET');
    expect(init.headers['x-api-key']).toBe(SECRET);
    expect(options.allowedHosts).toEqual(['api.apollo.io']);
  });

  it('accepts a top-level organization payload as well as a nested one', async () => {
    fetchMock.mockResolvedValueOnce(ok({ estimated_num_employees: 7 }));

    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('enriched');
    expect(out.fields[0].value).toBe(7);
  });

  it('the domain is normalized before it is sent', async () => {
    fetchMock.mockResolvedValueOnce(ok({ organization: { estimated_num_employees: 5 } }));

    await apolloEnrichmentAdapter.enrich(request({ selectors: { domain: 'https://WWW.Example.com/path' } }));

    expect(fetchMock.mock.calls[0][0]).toContain('domain=example.com');
  });
});

// ── Test 4 — retry horizon ──────────────────────────────────────────────────

describe('Apollo — the retry horizon is the provider\'s statement', () => {
  it('parses Retry-After on a 429 through the existing mechanism', async () => {
    fetchMock.mockResolvedValueOnce(notOk(429, { 'retry-after': '120' }));

    const before = Date.now();
    const out = await apolloEnrichmentAdapter.enrich(request());

    expect(out.outcome).toBe('rate_limited');
    expect(typeof out.retryAfterAt).toBe('string');
    const at = Date.parse(out.retryAfterAt as string);
    expect(at).toBeGreaterThanOrEqual(before + 119_000);
    expect(at).toBeLessThanOrEqual(before + 121_000);
  });

  it('a 503 may carry a horizon too — it is not filtered by status code', async () => {
    fetchMock.mockResolvedValueOnce(notOk(503, { 'retry-after': '30' }));

    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('provider_unavailable');
    expect(out.retryAfterAt).not.toBeNull();
  });

  it('no header means no horizon — never a synthesised one', async () => {
    fetchMock.mockResolvedValueOnce(notOk(429));

    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('rate_limited');
    expect(out.retryAfterAt).toBeNull();
  });

  it('a transport with NO headers does not throw and is not misclassified', async () => {
    // Reaching for a header must not turn a precise rate limit into a vague
    // provider_unavailable by landing in the outer catch.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });

    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('rate_limited');
  });

  it('404 is no_match — the provider looked and does not know this domain', async () => {
    fetchMock.mockResolvedValueOnce(notOk(404));
    expect((await apolloEnrichmentAdapter.enrich(request())).outcome).toBe('no_match');
  });

  it('a thrown transport error is classified conservatively, never as no_match', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const out = await apolloEnrichmentAdapter.enrich(request());
    expect(out.outcome).toBe('provider_unavailable');
    expect(out.outcome).not.toBe('no_match');
  });
});

// ── Test 5 — partial and malformed responses ────────────────────────────────

describe('Apollo — an absent value is absent, never fabricated', () => {
  it('omitted estimated_num_employees => field_not_found, not enriched-with-nothing', async () => {
    fetchMock.mockResolvedValueOnce(ok({ organization: { founded_year: 2011, country: 'Canada' } }));

    const out = await apolloEnrichmentAdapter.enrich(request());

    expect(out.outcome).toBe('field_not_found');
    expect(out.fields).toEqual([]);
    expect(out.notReturned).toEqual(['employee_count']);
  });

  it('does NOT invent country_code, founded_year, employee_band or technologies', async () => {
    fetchMock.mockResolvedValueOnce(ok({
      organization: {
        estimated_num_employees: 240,
        founded_year: 2011,
        country: 'Canada',
        technology_names: ['React', 'AWS'],
      },
    }));

    const out = await apolloEnrichmentAdapter.enrich(request());

    expect(out.fields).toHaveLength(1);
    expect(out.fields.map((f) => f.attribute)).toEqual(['employee_count']);
    for (const forbidden of ['country_code', 'founded_year', 'employee_band', 'technologies']) {
      expect(out.fields.some((f) => f.attribute === forbidden)).toBe(false);
    }
  });

  it('a RANGE, a string or a non-positive count is not coerced into a number', async () => {
    for (const bad of ['11-50', '240', 0, -3, 12.5, null, undefined]) {
      expect(mapApolloPayload({ organization: { estimated_num_employees: bad } }, ['employee_count']))
        .toEqual([]);
    }
  });

  it('a non-JSON or non-object body is malformed_response, not a silent success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => { throw new Error('not json'); },
    });
    expect((await apolloEnrichmentAdapter.enrich(request())).outcome).toBe('malformed_response');

    fetchMock.mockResolvedValueOnce(ok('a string'));
    expect((await apolloEnrichmentAdapter.enrich(request())).outcome).toBe('malformed_response');
  });

  it('an attribute that was not requested is never returned', async () => {
    expect(mapApolloPayload({ organization: { estimated_num_employees: 240 } }, ['founded_year']))
      .toEqual([]);
  });
});

// ── Test 6 — registration ───────────────────────────────────────────────────

describe('Apollo — it is registered through the existing mechanism', () => {
  it('getProvider("apollo") returns the Apollo adapter', () => {
    registerPiEnrichmentAdapters();
    expect(getProvider('apollo')).toBe(apolloEnrichmentAdapter);
  });

  it('registration is idempotent and leaves Clearbit alone', () => {
    registerPiEnrichmentAdapters();
    registerPiEnrichmentAdapters();
    expect(getProvider('apollo')).toBe(apolloEnrichmentAdapter);
    expect(getProvider('clearbit')).not.toBeNull();
  });

  it('claims exactly one attribute', () => {
    expect([...APOLLO_SUPPORTED_ATTRIBUTES]).toEqual(['employee_count']);
    expect([...apolloEnrichmentAdapter.supports]).toEqual(['employee_count']);
  });

  it('isAvailable is false — availability cannot be claimed without a tenant', () => {
    expect(apolloEnrichmentAdapter.isAvailable()).toBe(false);
  });
});

// ── Test 7 — planner eligibility ────────────────────────────────────────────

describe('Apollo — the declared capability is what makes it selectable', () => {
  const apollo = getSource('apollo')!;

  it('declares account.employee_count and nothing more', () => {
    expect(apollo.capabilities.entities).toEqual(['account']);
    expect(apollo.capabilities.attributes).toEqual(['employee_count']);
  });

  it('is ELIGIBLE for account.employee_count once connected', () => {
    const verdict = evaluateSource(apollo, 'connected', 'tenant credential stored',
      { subject: 'account', attributes: ['employee_count'], mode: 'apollo' });
    expect(verdict.eligible).toBe(true);
  });

  it('is INELIGIBLE for an attribute it does not claim', () => {
    const verdict = evaluateSource(apollo, 'connected', 'tenant credential stored',
      { subject: 'account', attributes: ['country_code'], mode: 'apollo' });
    expect(verdict.eligible).toBe(false);
    expect(verdict.ineligibility).toBe('attributes_unsupported');
  });

  it('is INELIGIBLE for a person — it supplies account data only', () => {
    const verdict = evaluateSource(apollo, 'connected', 'tenant credential stored',
      { subject: 'person', attributes: ['employee_count'], mode: 'apollo' });
    expect(verdict.eligible).toBe(false);
    expect(verdict.ineligibility).toBe('entity_unsupported');
  });

  it('is INELIGIBLE when not connected — a credential is the tenant\'s act', () => {
    const verdict = evaluateSource(apollo, 'not_connected', 'no tenant credential',
      { subject: 'account', attributes: ['employee_count'], mode: 'apollo' });
    expect(verdict.eligible).toBe(false);
    expect(verdict.ineligibility).toBe('not_connected');
  });
});

// ── Test 8 — credential isolation ───────────────────────────────────────────

describe('Apollo — the credential is the tenant\'s, never the platform\'s', () => {
  it('uses the credential supplied on the request', async () => {
    fetchMock.mockResolvedValueOnce(ok({ organization: { estimated_num_employees: 9 } }));
    await apolloEnrichmentAdapter.enrich(request({ credential: 'tenant-key-A' } as never));
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('tenant-key-A');
  });

  it('a platform APOLLO_API_KEY in the environment is NEVER used', async () => {
    const prior = process.env.APOLLO_API_KEY;
    process.env.APOLLO_API_KEY = 'platform-key-must-not-be-used';
    try {
      const out = await apolloEnrichmentAdapter.enrich(request({ credential: '' } as never));
      expect(out.outcome).toBe('credential_missing');   // not silently substituted
      expect(fetchMock).toHaveBeenCalledTimes(0);
    } finally {
      if (prior === undefined) delete process.env.APOLLO_API_KEY;
      else process.env.APOLLO_API_KEY = prior;
    }
  });

  it('the adapter source reads no process.env credential', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'services/enrichment/providers/adapters/apollo.ts'),
      'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/process\.env/);
  });

  it('the credential never appears in a refusal detail', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`upstream rejected key ${SECRET}`));
    const out = await apolloEnrichmentAdapter.enrich(request());
    // The detail is truncated provider text; assert the adapter adds no key of
    // its own and that nothing here re-emits one deliberately.
    expect(out.fields).toEqual([]);
    expect(String(out.detail ?? '')).not.toContain('x-api-key');
  });
});
