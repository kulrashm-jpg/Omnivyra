/**
 * A3U — the PI Clearbit adapter translates; it does not activate.
 *
 * Three things are load-bearing here and each is tested on its own:
 *
 *   1. the credential is the TENANT's and never the environment's;
 *   2. a value that cannot be represented is DROPPED, never coerced into the
 *      nearest-looking canonical value;
 *   3. registering an adapter moves the refusal one step later — from
 *      `not_implemented` to `cost_denied` — and never past it.
 *
 * Every provider response below is a synthetic object handed straight to the
 * mapper or to a stubbed `safeFetch`. No network is reachable from this file.
 *
 * SECRETS: all synthetic. No real credential is used or referenced.
 */

const fetchCalls: { url: string; init: unknown; opts: unknown }[] = [];
let nextResponse: () => { status: number; body?: unknown; throws?: Error };

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(async (url: string, init: unknown, opts: unknown) => {
    fetchCalls.push({ url, init, opts });
    const r = nextResponse();
    if (r.throws) throw r.throws;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.body === undefined) throw new Error('not json');
        return r.body;
      },
    } as unknown as Response;
  }),
}));

import {
  clearbitEnrichmentAdapter, mapClearbitPayload, CLEARBIT_SUPPORTED_ATTRIBUTES,
} from '../../services/enrichment/providers/adapters/clearbit';
import { registerPiEnrichmentAdapters } from '../../services/enrichment/providers/adapters';
import { getProvider } from '../../services/enrichment/providers/registry';
import { getSource } from '../../services/enrichment/providers/sources';
import { executeEnrichment, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import { toAttributeBags } from '../../services/enrichment/providers/persistence';
import { toAccountAttributes } from '../../services/prospectIdentity/attributes';
import { creditCostPort } from '../../services/enrichment/providers/cost';
import type { EnrichmentRequest } from '../../services/enrichment/providers/contract';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
/** Synthetic. Not a credential for anything that exists. */
const SECRET_A = 'synthetic-tenant-a-clearbit-key';
const SECRET_B = 'synthetic-tenant-b-clearbit-key';

const ALL = [...CLEARBIT_SUPPORTED_ATTRIBUTES];

const req = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG_A,
  subject: 'account',
  entityId: 'account-1',
  attributes: ALL,
  selectors: { domain: 'example.com' },
  purpose: 'icp',
  correlationId: 'corr-a3u',
  ...over,
});

beforeEach(() => {
  fetchCalls.length = 0;
  nextResponse = () => ({ status: 200, body: {} });
  registerPiEnrichmentAdapters();
});
afterEach(() => { delete process.env.CLEARBIT_API_KEY; });

// ───────────────────────────────────────────────────────────────────────────
describe('A3U — registration', () => {
  it('`clearbit` resolves to the PI adapter through the existing registry', () => {
    const adapter = getProvider('clearbit');
    expect(adapter).not.toBeNull();
    expect(adapter?.id).toBe('clearbit');
    expect(adapter).toBe(clearbitEnrichmentAdapter);
  });

  it('the adapter declares exactly the five canonical attributes', () => {
    expect([...clearbitEnrichmentAdapter.supports].sort()).toEqual(
      ['country_code', 'employee_band', 'employee_count', 'founded_year', 'technologies']);
  });

  it('the A3C descriptor now declares the same capability set — one vocabulary', () => {
    const declared = [...(getSource('clearbit')?.capabilities.attributes ?? [])].sort();
    expect(declared).toEqual([...clearbitEnrichmentAdapter.supports].sort());
    expect(getSource('clearbit')?.capabilities.entities).toEqual(['account']);
  });

  // `isAvailable` answers "could a call be made right now from configuration
  // alone". For a tenant-credential provider that is unanswerable without a
  // tenant, so it refuses — and refuses regardless of the environment, which is
  // what stops the registry reporting Omnivyra's key as a tenant's readiness.
  it('availability refuses, and does not consult the environment', () => {
    delete process.env.CLEARBIT_API_KEY;
    expect(clearbitEnrichmentAdapter.isAvailable()).toBe(false);
    process.env.CLEARBIT_API_KEY = 'synthetic-global-key-that-must-never-be-used';
    expect(clearbitEnrichmentAdapter.isAvailable()).toBe(false);
  });

  it('the registry therefore reports NO callable provider', () => {
    const { listProviderStatus } = require('../../services/enrichment/providers/registry');
    expect(listProviderStatus().filter((s: { callable: boolean }) => s.callable)).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3U — the credential is the tenant’s, never the environment’s', () => {
  const auth = (i: number) =>
    ((fetchCalls[i].init as { headers?: Record<string, string> }).headers ?? {}).Authorization;

  it('Tenant A’s credential is what reaches the vendor request', async () => {
    nextResponse = () => ({ status: 200, body: { metrics: { employees: 240 } } });
    await clearbitEnrichmentAdapter.enrich({ ...req(), credential: SECRET_A } as EnrichmentRequest);
    expect(auth(0)).toContain(SECRET_A);
    expect(auth(0)).not.toContain(SECRET_B);
  });

  it('Tenant B’s credential is what reaches the vendor request', async () => {
    nextResponse = () => ({ status: 200, body: { metrics: { employees: 12 } } });
    await clearbitEnrichmentAdapter.enrich({
      ...req({ organizationId: ORG_B }), credential: SECRET_B,
    } as EnrichmentRequest);
    expect(auth(0)).toContain(SECRET_B);
    expect(auth(0)).not.toContain(SECRET_A);
  });

  it('NO CREDENTIAL + a global CLEARBIT_API_KEY ⇒ credential_missing and zero calls', async () => {
    process.env.CLEARBIT_API_KEY = 'synthetic-global-key-that-must-never-be-used';
    const result = await clearbitEnrichmentAdapter.enrich(req());
    expect(result.outcome).toBe('credential_missing');
    expect(fetchCalls).toHaveLength(0);
  });

  it('a blank credential is not a credential', async () => {
    const result = await clearbitEnrichmentAdapter.enrich({ ...req(), credential: '   ' } as EnrichmentRequest);
    expect(result.outcome).toBe('credential_missing');
    expect(fetchCalls).toHaveLength(0);
  });

  it('the adapter source reads no environment credential at all', () => {
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/enrichment/providers/adapters/clearbit.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('process.env');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3U — the lookup key is the canonical domain', () => {
  it('the account domain is what is sent', async () => {
    nextResponse = () => ({ status: 200, body: { metrics: { employees: 5 } } });
    await clearbitEnrichmentAdapter.enrich({
      ...req({ selectors: { domain: 'https://www.Example.co.uk/pricing' } }), credential: SECRET_A,
    } as EnrichmentRequest);
    // normalised to the registrable root, multi-part TLD preserved
    expect(fetchCalls[0].url).toContain('domain=example.co.uk');
  });

  it('a company NAME alone cannot become the lookup key', async () => {
    const result = await clearbitEnrichmentAdapter.enrich({
      ...req({ selectors: { company_name: 'Example Incorporated' } }), credential: SECRET_A,
    } as EnrichmentRequest);
    expect(result.outcome).toBe('provider_declined');
    expect(result.detail).toMatch(/no canonical account domain/);
    expect(fetchCalls).toHaveLength(0);
  });

  it('a non-host string is refused rather than sent', async () => {
    const result = await clearbitEnrichmentAdapter.enrich({
      ...req({ selectors: { domain: 'not a domain' } }), credential: SECRET_A,
    } as EnrichmentRequest);
    expect(result.outcome).toBe('provider_declined');
    expect(fetchCalls).toHaveLength(0);
  });

  it('egress is pinned to the vendor host', async () => {
    nextResponse = () => ({ status: 200, body: { metrics: { employees: 5 } } });
    await clearbitEnrichmentAdapter.enrich({ ...req(), credential: SECRET_A } as EnrichmentRequest);
    expect((fetchCalls[0].opts as { allowedHosts: string[] }).allowedHosts).toEqual(['company.clearbit.com']);
    expect(fetchCalls[0].url.startsWith('https://company.clearbit.com/')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3U — attribute translation, and what it refuses to translate', () => {
  const map = (payload: unknown) => {
    const out: Record<string, unknown> = {};
    for (const f of mapClearbitPayload(payload, ALL)) out[f.attribute] = f.value;
    return out;
  };

  it('headcount → employee_count', () => {
    expect(map({ metrics: { employees: 240 } }).employee_count).toBe(240);
  });

  it('a provider’s STRING headcount survives — the boundary normaliser takes it', () => {
    expect(map({ metrics: { employees: '240' } }).employee_count).toBe('240');
  });

  it('foundedYear → founded_year', () => {
    expect(map({ foundedYear: 2011 }).founded_year).toBe(2011);
  });

  it('employeesRange → employee_band ONLY when it is already a canonical band', () => {
    expect(map({ metrics: { employeesRange: '51-200' } }).employee_band).toBe('51-200');
  });

  it('an out-of-vocabulary range is DROPPED, not snapped to the nearest band', () => {
    expect(map({ metrics: { employeesRange: '50-250' } })).not.toHaveProperty('employee_band');
    expect(map({ metrics: { employeesRange: 'Mid-Market' } })).not.toHaveProperty('employee_band');
  });

  it('country → country_code only when it is ISO alpha-2', () => {
    expect(map({ geo: { country: 'gb' } }).country_code).toBe('GB');
  });

  it('a country NAME is DROPPED, not guessed into a code', () => {
    expect(map({ geo: { country: 'United Kingdom' } })).not.toHaveProperty('country_code');
    expect(map({ geo: { country: 'GBR' } })).not.toHaveProperty('country_code');
  });

  it('tech is carried as an ARRAY, never a joined string', () => {
    const value = map({ tech: ['react', 'segment'] }).technologies;
    expect(Array.isArray(value)).toBe(true);
    expect(value).toEqual(['react', 'segment']);
  });

  it('only requested attributes are returned', () => {
    const fields = mapClearbitPayload(
      { metrics: { employees: 5 }, foundedYear: 2011 }, ['founded_year']);
    expect(fields.map((f) => f.attribute)).toEqual(['founded_year']);
  });

  it('confidence and observedAt are null — Clearbit states neither', () => {
    const [f] = mapClearbitPayload({ metrics: { employees: 5 } }, ALL);
    expect(f.confidence).toBeNull();
    expect(f.observedAt).toBeNull();
    expect(f.providerInferred).toBe(false);
    expect(f.subject).toBe('account');
  });

  it('an empty payload yields no fields rather than empty-valued ones', () => {
    expect(mapClearbitPayload({}, ALL)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3U — failures are classified, never swallowed', () => {
  const run = async () => clearbitEnrichmentAdapter.enrich({ ...req(), credential: SECRET_A } as EnrichmentRequest);

  it('404 → no_match', async () => {
    nextResponse = () => ({ status: 404 });
    expect((await run()).outcome).toBe('no_match');
  });

  it('429 → rate_limited', async () => {
    nextResponse = () => ({ status: 429 });
    expect((await run()).outcome).toBe('rate_limited');
  });

  it('500 → provider_unavailable', async () => {
    nextResponse = () => ({ status: 500 });
    expect((await run()).outcome).toBe('provider_unavailable');
  });

  it('a timeout is distinguished from an unreachable host', async () => {
    nextResponse = () => ({ status: 0, throws: new Error('The operation timed out') });
    expect((await run()).outcome).toBe('timeout');
    nextResponse = () => ({ status: 0, throws: new Error('ECONNREFUSED') });
    expect((await run()).outcome).toBe('provider_unavailable');
  });

  it('an unparseable body → malformed_response', async () => {
    nextResponse = () => ({ status: 200 });
    expect((await run()).outcome).toBe('malformed_response');
  });

  it('a non-object body → malformed_response', async () => {
    nextResponse = () => ({ status: 200, body: 'a string' });
    expect((await run()).outcome).toBe('malformed_response');
  });

  it('a match holding nothing requested → field_not_found, NOT an empty success', async () => {
    nextResponse = () => ({ status: 200, body: { name: 'Example', geo: { country: 'United Kingdom' } } });
    const result = await run();
    expect(result.outcome).toBe('field_not_found');
    expect(result.fields).toEqual([]);
  });

  it('a partial match reports what was NOT returned', async () => {
    nextResponse = () => ({ status: 200, body: { foundedYear: 2011 } });
    const result = await run();
    expect(result.outcome).toBe('enriched');
    expect(result.fields.map((f) => f.attribute)).toEqual(['founded_year']);
    expect([...result.notReturned].sort()).toEqual(
      ['country_code', 'employee_band', 'employee_count', 'technologies']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3U — the cost gate still refuses, adapter or not', () => {
  const ports = (over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
    authorizeCost: over.authorizeCost ?? creditCostPort.authorizeCost,
    releaseCost: creditCostPort.releaseCost,
    resolveCredential: over.resolveCredential ?? (async () => SECRET_A),
    findRecentObservation: async () => null,
    persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
    now: () => '2026-09-05T00:00:00.000Z',
  });

  it('registered adapter + valid tenant credential + unpriced action ⇒ cost_denied, ZERO calls', async () => {
    const result = await executeEnrichment(req(), 'clearbit', ports());
    expect(result.outcome).toBe('cost_denied');
    expect(result.providerCalled).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it('the refusal names the unregistered action, so the blocker is legible', async () => {
    const result = await executeEnrichment(req(), 'clearbit', ports());
    expect(result.reason).toContain('prospect_enrichment');
  });

  it('no tenant credential still refuses BEFORE cost is consulted', async () => {
    let costAsked = 0;
    const result = await executeEnrichment(req(), 'clearbit', ports({
      resolveCredential: async () => null,
      authorizeCost: async () => { costAsked += 1; return { authorized: false, reason: 'x' }; },
    }));
    expect(result.outcome).toBe('credential_missing');
    expect(costAsked).toBe(0);
    expect(fetchCalls).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3U — output shape at the LI-2 boundary', () => {
  it('fields become account attributes in LI-2’s vocabulary (A3V translation)', () => {
    const fields = mapClearbitPayload(
      { metrics: { employees: 240, employeesRange: '51-200' }, foundedYear: 2011, geo: { country: 'US' }, tech: ['react'] },
      ALL,
    );
    const { personAttributes, accountAttributes } = toAttributeBags(fields);
    expect(personAttributes).toEqual({});
    // The adapter speaks canonical PI names; the bag speaks LI-2's. Values are
    // identical — the translation changes keys only.
    expect(accountAttributes).toEqual({
      employeeCount: 240, employeeBand: '51-200', foundedYear: 2011,
      countryCode: 'US', technologies: ['react'],
    });
  });

  /**
   * The gap A3U found, INVERTED by A3V rather than deleted.
   *
   * `toAttributeBags` used to hand LI-2 the PI spelling (`employee_count`),
   * which `toAccountAttributes` does not read, so a real ingestion of this
   * adapter's output normalised to nulls and recorded nothing. A3V added the
   * explicit translation; this asserts the value now arrives.
   */
  it('the adapter’s output reaches LI-2 and normalises to real values', () => {
    const { accountAttributes } = toAttributeBags(
      mapClearbitPayload({ metrics: { employees: 240 }, foundedYear: 2011 }, ALL));
    const normalized = toAccountAttributes(accountAttributes as never);
    expect(normalized.employeeCount).toBe(240);
    expect(normalized.foundedYear).toBe(2011);
  });
});
