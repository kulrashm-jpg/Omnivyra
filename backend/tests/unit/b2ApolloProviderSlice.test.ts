/**
 * B2 — the one-provider vertical slice, composed.
 *
 * ─── WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT REPEAT ─────────────
 * `apolloEnrichmentAdapter.test.ts` already covers the ADAPTER in isolation:
 * cost discipline, outcome classification, payload mapping, egress counting.
 * None of that is repeated here.
 *
 * What nothing covered before B2 is the COMPOSED path — provider response →
 * source assertion → B1b arbitration → canonical + decision log — because B1b's
 * arbitration did not exist when the adapter landed. That composition is this
 * file's whole subject, and the assertions are about the SEAM rather than about
 * either side of it:
 *
 *   does the executor hand LI-2 a canonical attribute name, or a provider one?
 *   does a confidence appear that no provider stated?
 *   does an observation time appear that no provider stated?
 *   does a failed call reach the write path at all?
 *   is the TENANT on every hop?
 *
 * SECRETS: all synthetic. The transport is mocked at `safeFetch`, exactly as the
 * adapter's own suite does it, so no Apollo key exists here and nothing leaves
 * this process. No production credential, no provider call.
 */

jest.mock('../../../lib/security/safeFetch', () => ({ safeFetch: jest.fn() }));

import { safeFetch } from '../../../lib/security/safeFetch';
import { apolloEnrichmentAdapter, APOLLO_SUPPORTED_ATTRIBUTES } from '../../services/enrichment/providers/adapters/apollo';
import { executeEnrichment, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type { EnrichmentRequest, ProviderField } from '../../services/enrichment/providers/contract';
import { toAttributeBags } from '../../services/enrichment/providers/persistence';
import { ACCOUNT_ATTRIBUTE_COLUMNS } from '../../services/prospectIdentity/attributes';
import { decideCanonicalUpdates } from '../../services/prospectIdentity/ingestionBoundary';

const fetchMock = safeFetch as unknown as jest.Mock;

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const SECRET = 'synthetic-tenant-apollo-key';
const NOW = '2026-10-06T12:00:00.000Z';

const ok = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true, status: 200,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
});
const notOk = (status: number, headers: Record<string, string> = {}) => ({
  ok: false, status,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  json: async () => ({}),
});

interface Captured {
  organizationId: string;
  providerId: string;
  subject: 'person' | 'account';
  entityId: string;
  fields: readonly ProviderField[];
  observedAt: string | null;
  correlationId: string;
  payloadHash: string | null;
}

/** Ports that record what the write path was asked to do, and write nothing. */
function makePorts(over: Partial<ExecuteEnrichmentPorts> = {}) {
  const persisted: Captured[] = [];
  const costCalls: Array<{ organizationId: string; providerId: string }> = [];
  const released: Array<{ holdId: string | null; reason: string }> = [];
  const credentialCalls: Array<{ organizationId: string; providerId: string }> = [];

  const ports: ExecuteEnrichmentPorts = {
    async authorizeCost(input) {
      costCalls.push({ organizationId: input.organizationId, providerId: input.providerId });
      return { authorized: true, holdId: 'hold-1', cost: { currency: 'USD', amount: 0 } as never };
    },
    async releaseCost(holdId, reason) { released.push({ holdId, reason }); },
    async resolveCredential(input) {
      credentialCalls.push({ organizationId: input.organizationId, providerId: input.providerId });
      return SECRET;
    },
    async findRecentObservation() { return null; },      // suppression off
    async persistObservation(input) {
      persisted.push(input as Captured);
      return { sourceRecordId: 'src-1', canonicalWithheld: [] };
    },
    now() { return NOW; },
    ...over,
  };
  return { ports, persisted, costCalls, released, credentialCalls };
}

const request = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG_A,
  subject: 'account',
  entityId: ACCOUNT,
  attributes: ['employee_count'],
  selectors: { domain: 'example.com' },
  purpose: 'b2-slice',
  correlationId: 'corr-b2',
  ...over,
} as EnrichmentRequest);

const run = (ports: ExecuteEnrichmentPorts, over: Partial<EnrichmentRequest> = {}) =>
  executeEnrichment(request(over), 'apollo', ports, { adapter: apolloEnrichmentAdapter });

beforeEach(() => { fetchMock.mockReset(); });

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — the provider writes through the assertion path, never around it', () => {
  it('hands LI-2 the CANONICAL attribute name and the provider value', async () => {
    fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
    const { ports, persisted } = makePorts();

    const result = await run(ports);

    expect(result.outcome).toBe('enriched');
    expect(result.providerCalled).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].fields.map((f) => f.attribute)).toEqual(['employee_count']);
    expect(persisted[0].fields[0].value).toBe(4200);
    expect(persisted[0].fields[0].subject).toBe('account');

    // The provider's own field name never reaches PI.
    expect(JSON.stringify(persisted[0].fields)).not.toContain('estimated_num_employees');
  });

  it('maps onto an attribute that is ALREADY on the writable surface', async () => {
    // B2 must not widen what is writable. Every attribute this adapter claims
    // must already be in LI-1's account surface.
    for (const attribute of APOLLO_SUPPORTED_ATTRIBUTES) {
      expect(ACCOUNT_ATTRIBUTE_COLUMNS).toContain(attribute);
    }
    const { personAttributes, accountAttributes, unmapped } =
      toAttributeBags([{
        attribute: 'employee_count', subject: 'account', value: 4200,
        observedAt: null, confidence: null, providerInferred: true,
      }]);
    expect(unmapped).toEqual([]);                      // nothing silently dropped
    expect(personAttributes).toEqual({});
    expect(accountAttributes).toEqual({ employeeCount: 4200 });
  });

  it('invents NO confidence — Apollo states none, so none is persisted', async () => {
    fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
    const { ports, persisted } = makePorts();
    await run(ports);
    expect(persisted[0].fields[0].confidence).toBeNull();
  });

  it('invents NO observation time — the ratified fallback supplies recency instead', async () => {
    fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
    const { ports, persisted } = makePorts();
    await run(ports);
    // Apollo's organization payload carries no per-field date. The executor must
    // not substitute its own clock: under D-1 an absent `observed_at` falls back
    // to `recorded_at`, which is a different and honest fact.
    expect(persisted[0].fields[0].observedAt).toBeNull();
    expect(persisted[0].observedAt).toBeNull();
    expect(persisted[0].observedAt).not.toBe(NOW);
  });

  it('is tenant-scoped on every hop — cost, credential and write', async () => {
    fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
    const { ports, persisted, costCalls, credentialCalls } = makePorts();
    await run(ports, { organizationId: ORG_B });
    expect(costCalls.every((c) => c.organizationId === ORG_B)).toBe(true);
    expect(credentialCalls.every((c) => c.organizationId === ORG_B)).toBe(true);
    expect(persisted[0].organizationId).toBe(ORG_B);
    expect(JSON.stringify(persisted)).not.toContain(ORG_A);
  });

  it('refuses a tenant-less enrichment before anything else happens', async () => {
    const { ports, persisted, costCalls } = makePorts();
    const result = await executeEnrichment(
      request({ organizationId: '  ' }), 'apollo', ports, { adapter: apolloEnrichmentAdapter });
    expect(result.outcome).toBe('provider_declined');
    expect(result.providerCalled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(costCalls).toHaveLength(0);
    expect(persisted).toHaveLength(0);
  });

  it('never persists the credential, in any field of the write payload', async () => {
    fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
    const { ports, persisted } = makePorts();
    await run(ports);
    expect(JSON.stringify(persisted)).not.toContain(SECRET);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — every required outcome, and only a success may write', () => {
  const cases: Array<[string, () => void, string]> = [
    ['success', () => fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 10 } })), 'enriched'],
    ['no_match', () => fetchMock.mockResolvedValue(notOk(404)), 'no_match'],
    ['provider_error', () => fetchMock.mockResolvedValue(notOk(500)), 'provider_unavailable'],
    ['rate_limited', () => fetchMock.mockResolvedValue(notOk(429)), 'rate_limited'],
    ['timeout', () => fetchMock.mockRejectedValue(new Error('request timed out')), 'timeout'],
    ['malformed_response', () => fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => { throw new Error('Unexpected token'); },
    }), 'malformed_response'],
  ];

  for (const [label, arrange, expected] of cases) {
    it(`${label} -> ${expected}`, async () => {
      arrange();
      const { ports, persisted } = makePorts();
      const result = await run(ports);
      expect(result.outcome).toBe(expected);
      // Only a success may reach the write path. A failure that wrote evidence
      // would turn OUR error into a fact about the account.
      if (expected === 'enriched') expect(persisted).toHaveLength(1);
      else expect(persisted).toHaveLength(0);
    });
  }

  it('credential_missing -> never calls the provider and never writes', async () => {
    const { ports, persisted, costCalls } = makePorts({
      async resolveCredential() { return null; },
    });
    const result = await run(ports);
    expect(result.outcome).toBe('credential_missing');
    expect(result.providerCalled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
    // Not billable: no reservation may be held for a call never made.
    expect(costCalls).toHaveLength(0);
  });

  it('a matched organization holding no usable count is field_not_found, not an empty success', async () => {
    fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: '11-50' } }));
    const { ports, persisted } = makePorts();
    const result = await run(ports);
    expect(result.outcome).toBe('field_not_found');
    expect(persisted).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — cost is reserved before egress and released when nothing is billable', () => {
  it('authorises BEFORE the provider is contacted', async () => {
    const order: string[] = [];
    fetchMock.mockImplementation(async () => {
      order.push('fetch');
      return ok({ organization: { estimated_num_employees: 10 } });
    });
    const { ports } = makePorts({
      async authorizeCost() {
        order.push('authorize');
        return { authorized: true, holdId: 'h', cost: { currency: 'USD', amount: 0 } as never };
      },
    });
    await run(ports);
    expect(order).toEqual(['authorize', 'fetch']);
  });

  it('a refused authorisation stops the slice with cost_denied and no egress', async () => {
    const { ports, persisted } = makePorts({
      async authorizeCost() { return { authorized: false, reason: 'ceiling reached' }; },
    });
    const result = await run(ports);
    expect(result.outcome).toBe('cost_denied');
    expect(result.providerCalled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });

  it('duplicate suppression short-circuits without contacting the provider', async () => {
    const { ports, persisted } = makePorts({
      async findRecentObservation() { return { observedAt: NOW }; },
    });
    const result = await run(ports);
    expect(result.outcome).toBe('duplicate_suppressed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — the provider evidence arbitrates under B1b, with no special case', () => {
  /** The assertion row LI-2 would hold for this provider observation. */
  const assertion = (value: string, over: Record<string, unknown> = {}) => ({
    id: `a-${value}`, attribute: 'employee_count', normalized_value: value,
    provider: 'apollo', observed_at: null, recorded_at: '2026-10-06T12:00:00.000Z',
    confidence: null, superseded_at: null, ...over,
  });

  it('Case A — an empty canonical attribute is populated by the provider', () => {
    const d = decideCanonicalUpdates({ employee_count: null }, [assertion('4200')], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([{
      attribute: 'employee_count', value: '4200', assertionId: 'a-4200',
      reason: 'single_uncontested_assertion',
    }]);
  });

  it('Case B — the provider LOSES to newer evidence from another source', () => {
    const d = decideCanonicalUpdates({ employee_count: 4200 }, [
      assertion('4200', { recorded_at: '2026-10-01T00:00:00.000Z' }),
      assertion('5100', { id: 'a-crm', provider: 'crm', observed_at: '2026-10-05T00:00:00.000Z' }),
    ], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([{
      attribute: 'employee_count', value: '5100', assertionId: 'a-crm', reason: 'newest_observation',
    }]);
  });

  it('Case C — the provider CORRECTS a stale but attested canonical value', () => {
    const d = decideCanonicalUpdates({ employee_count: 900 }, [
      assertion('900', { id: 'a-old', provider: 'csv', observed_at: '2026-01-01T00:00:00.000Z' }),
      assertion('4200', { observed_at: '2026-10-06T00:00:00.000Z' }),
    ], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([{
      attribute: 'employee_count', value: '4200', assertionId: 'a-4200', reason: 'newest_observation',
    }]);
  });

  it('Case D — a genuinely unattested incumbent is NOT overwritten by the provider', () => {
    const d = decideCanonicalUpdates({ employee_count: 777 }, [assertion('4200')], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'employee_count', reason: 'unattested_incumbent' }]);
  });

  it('Case E — identical provider evidence decides nothing new', () => {
    const rows = [assertion('4200')];
    const first = decideCanonicalUpdates({ employee_count: null }, rows, ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(first.apply).toHaveLength(1);
    // Once in force, a repeat writes nothing at all.
    const second = decideCanonicalUpdates({ employee_count: 4200 }, rows, ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(second.apply).toEqual([]);
    expect(second.withhold).toEqual([]);
  });

  it('no authority is declared for the provider — O-1 and O-7 stay deferred', () => {
    // Apollo must win or lose on recency alone. If a declaration had been seeded
    // for it, this older provider value would beat the newer CRM one.
    const d = decideCanonicalUpdates({ employee_count: null }, [
      assertion('4200', { recorded_at: '2026-01-01T00:00:00.000Z' }),
      assertion('5100', { id: 'a-crm', provider: 'crm', observed_at: '2026-10-05T00:00:00.000Z' }),
    ], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply[0]).toMatchObject({ value: '5100', reason: 'newest_observation' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — recorded mapping gaps', () => {
  it('providerInferred does NOT survive into the assertion payload', async () => {
    // Apollo's `estimated_num_employees` is its own estimate and the adapter says
    // so with `providerInferred: true`. `toAttributeBags` carries only the key and
    // the value, so that distinction is lost at the LI-2 boundary: a modelled
    // number becomes indistinguishable from a filed one.
    //
    // Recorded, NOT fixed. Carrying it would need a new assertion column, which
    // is a schema change outside B2's scope.
    fetchMock.mockResolvedValue(ok({ organization: { estimated_num_employees: 4200 } }));
    const { ports, persisted } = makePorts();
    await run(ports);
    expect(persisted[0].fields[0].providerInferred).toBe(true);     // the adapter states it
    const bags = toAttributeBags(persisted[0].fields);
    expect(JSON.stringify(bags)).not.toContain('providerInferred'); // and it stops here
  });

  it('the attributes Apollo could answer but does not claim stay unmapped', () => {
    // country (a NAME, not a code), employee_band (would be inference),
    // founded_year and technology_names (unproven against a real response).
    expect(APOLLO_SUPPORTED_ATTRIBUTES).toEqual(['employee_count']);
    for (const unclaimed of ['country_code', 'employee_band', 'founded_year', 'technologies']) {
      expect(APOLLO_SUPPORTED_ATTRIBUTES).not.toContain(unclaimed);
    }
  });

  it('none of the six structurally unwritable attributes is touched', () => {
    for (const blocked of ['authority', 'influence', 'buying_role', 'market', 'business_model', 'growth_stage']) {
      expect(APOLLO_SUPPORTED_ATTRIBUTES).not.toContain(blocked);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('B2 — the canonical write path carries the tenant, including where no test can reach', () => {
  // Probe 2 of B2's mutation set removed the tenant predicate from LI-2's
  // canonical READ and every suite still passed. That is not a hole in the
  // guarantee: `source_records_account_tenant_fk` refuses a cross-tenant account
  // on the EVIDENCE insert, which happens first, so the canonical read can never
  // be reached with a mismatched tenant. The predicate is defence in depth, and
  // being unreachable it was also unprotected — so it is pinned here by source,
  // which is what this repository already does for invariants a runtime test
  // cannot stage.
  const boundary = () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(
      path.join(__dirname, '../..', 'services/prospectIdentity/ingestionBoundary.ts'), 'utf8');
  };

  it('the canonical READ is filtered by tenant as well as by id', () => {
    expect(boundary()).toMatch(
      /\.select\('\*'\)\.eq\('id', targetId\)\.eq\(tenantColumn, input\.organizationId\)/);
  });

  it('the canonical WRITE is filtered by tenant as well as by id', () => {
    // CA (canonical write atomicity) moved the UPDATE into the plpgsql function
    // `pi_apply_canonical_decisions`, so the pin follows it: the boundary hands
    // the function the verified tenant and the target together, and the
    // function's UPDATE (and its row lock) filter on both.
    expect(boundary()).toMatch(
      /ownedDbRpc\('pi_apply_canonical_decisions', \{\s*p_organization_id: input\.organizationId,[\s\S]{0,120}?p_target_id: targetId,/);
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../../..',
      'supabase/migrations/20261128000000_pi_canonical_write_atomicity.sql'), 'utf8');
    expect(sql).toMatch(/UPDATE public\.%I t SET[\s\S]{0,160}?WHERE t\.id = \$2 AND t\.%I = \$3/);
    expect(sql).toMatch(/SELECT id FROM public\.%I WHERE id = \$1 AND %I = \$2 FOR UPDATE/);
  });

  it('every assertion READ and UPDATE in the boundary is filtered by organization_id', () => {
    // A tenant-less read of `source_assertions` would let one tenant's evidence
    // arbitrate another's canonical value, and no foreign key would catch it.
    //
    // Scoped to reads and updates on purpose: on an INSERT the tenant travels in
    // the ROW, not in a filter, so demanding it in the chain would flag correct
    // code. The insert is pinned by the separate assertion below.
    const statements = boundary()
      .split("ownedDbTable('source_assertions')").slice(1)
      .map((tail) => tail.split(';')[0])
      .filter((s) => s.includes('.select(') || s.includes('.update('))
      .filter((s) => !s.trimStart().startsWith('.insert('));
    expect(statements.length).toBeGreaterThan(0);     // the match set is never empty
    for (const statement of statements) {
      expect(statement).toContain('organization_id');
    }
  });

  it('the assertion INSERT carries the tenant in its row', () => {
    // The other half of the invariant above: an assertion row without a tenant
    // would be rejected by a NOT NULL column, but naming the WRONG tenant would
    // not be, so the source of that value is pinned.
    expect(boundary()).toMatch(/organization_id: input\.organizationId,/);
  });
});
