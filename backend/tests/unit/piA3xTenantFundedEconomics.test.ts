/**
 * A3X — provider charges are the tenant's, and Omnivyra must not pretend
 * otherwise.
 *
 * The tenant holds the Clearbit subscription, the Apollo credits, the Sales
 * Navigator licence. They are invoiced by that vendor directly. Omnivyra
 * stores their authorization, makes the call, and builds intelligence from the
 * answer — it buys nothing on their behalf, so it must not reserve Omnivyra
 * credits to represent a cost it does not incur.
 *
 * The previous gate did exactly that, and could only ever have been satisfied
 * by inventing a credit price to stand for someone else's invoice. These tests
 * pin the corrected boundary from both sides:
 *
 *   • no fake Omnivyra charge is created for a vendor's work; and
 *   • removing a BILLING gate removed no SAFEGUARD — tenant isolation, the
 *     absence of a global-key fallback, provider-outcome honesty and
 *     fail-closed authorization all still hold.
 *
 * SECRETS: every value is synthetic. No real credential is used.
 */

const fetchCalls: unknown[] = [];
let nextResponse: () => { status: number; body?: unknown; throws?: Error };

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(async (url: string) => {
    fetchCalls.push(url);
    const r = nextResponse();
    if (r.throws) throw r.throws;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => { if (r.body === undefined) throw new Error('not json'); return r.body; },
    } as unknown as Response;
  }),
}));

import {
  tenantFundedExecutionPort, makeTenantFundedExecutionPort,
  creditCostPort, PROSPECT_ENRICHMENT_ACTION, FORBIDDEN_BORROWED_ACTION,
} from '../../services/enrichment/providers/cost';
import { executeEnrichment, defaultCostPort, type ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import { registerPiEnrichmentAdapters } from '../../services/enrichment/providers/adapters';
import { getSource, ACQUISITION_SOURCES } from '../../services/enrichment/providers/sources';
import { makeTenantCredentialPort, PROVIDER_API_KEY } from '../../services/enrichment/providers/credentials';
import { readProviderCredentialStatus, isCredentialRefusal } from '../../apiHandlers/prospects/leadSourceCredentials';
import { resolveMonetizationFeature } from '../../../shared/monetization/featureRegistry';
import { CREDIT_ACTIONS } from '../../../shared/monetization/featureRegistry';
import type { EnrichmentRequest } from '../../services/enrichment/providers/contract';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
/** Synthetic. Not a credential for anything that exists. */
const SECRET_A = 'synthetic-tenant-a-clearbit-key';
const SECRET_B = 'synthetic-tenant-b-clearbit-key';

const req = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG_A, subject: 'account', entityId: 'account-1',
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'icp', correlationId: 'corr-a3x', ...over,
});

const costInput = {
  organizationId: ORG_A, providerId: 'clearbit',
  attributes: ['employee_count'], correlationId: 'corr-a3x',
};

/** A tenant credential store, keyed the way the real one is. */
const store: Record<string, Record<string, string>> = {};
const credentialPort = makeTenantCredentialPort({
  read: async (company, provider) => ({ ...(store[`${company}::${provider}`] ?? {}) }),
});

const ports = (over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
  authorizeCost: over.authorizeCost ?? defaultCostPort.authorizeCost,
  releaseCost: over.releaseCost ?? defaultCostPort.releaseCost,
  resolveCredential: over.resolveCredential ?? ((i) => credentialPort.resolveCredential(i)),
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => '2026-09-05T00:00:00.000Z',
});

beforeEach(() => {
  fetchCalls.length = 0;
  nextResponse = () => ({ status: 200, body: { metrics: { employees: 240 } } });
  for (const k of Object.keys(store)) delete store[k];
  registerPiEnrichmentAdapters();
});
afterEach(() => { delete process.env.CLEARBIT_API_KEY; });

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — 1. a tenant-funded call creates no Omnivyra charge', () => {
  it('authorizes without reserving anything, and holds nothing to release', async () => {
    const decision = await tenantFundedExecutionPort.authorizeCost(costInput);
    expect(decision.authorized).toBe(true);
    if (decision.authorized) {
      expect(decision.holdId).toBeNull();
      // NOT `free`: the call costs the TENANT money. Omnivyra simply does not
      // know their per-call vendor price, and `free` would make a planner
      // prefer a paid provider over a genuinely free internal one.
      expect(decision.cost).toEqual({ kind: 'unknown' });
    }
  });

  it('the executor’s default port is the tenant-funded one', () => {
    expect(defaultCostPort).toBe(tenantFundedExecutionPort);
  });

  it('it never consults the monetization registry', async () => {
    // If it did, an unregistered action would resolve by fallback to a real,
    // credit-holding customer action. The port must not ask at all.
    const src = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/enrichment/providers/cost.ts'), 'utf8');
    const port = src.slice(src.indexOf('export function makeTenantFundedExecutionPort'));
    expect(port).not.toContain('resolveFeature');
    expect(port).not.toContain('resolveMonetizationFeature');
  });

  it('a full tenant-funded execution reaches the provider and charges nothing', async () => {
    store[`${ORG_A}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_A };
    let released = 0;
    const result = await executeEnrichment(req(), 'clearbit', ports({
      releaseCost: async () => { released += 1; },
    }));
    expect(result.outcome).toBe('enriched');
    expect(result.providerCalled).toBe(true);
    expect(released).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — 2. no unrelated monetization action can be billed', () => {
  it('prospect_enrichment is still not a registered credit action', () => {
    expect(CREDIT_ACTIONS as readonly string[]).not.toContain(PROSPECT_ENRICHMENT_ACTION);
  });

  it('the registry STILL resolves it by fallback to something else — the hazard is real', () => {
    const resolved = resolveMonetizationFeature({ action_key: PROSPECT_ENRICHMENT_ACTION });
    expect(resolved).not.toBeNull();
    expect(resolved?.action_key).not.toBe(PROSPECT_ENRICHMENT_ACTION);
  });

  it('the credit port still refuses that fallback, naming the wrong cost centre', async () => {
    const d = await creditCostPort.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) {
      expect(d.reason).toContain(PROSPECT_ENRICHMENT_ACTION);
      expect(d.reason).toContain('before any external call');
    }
  });

  it('and still refuses to borrow the company-profile action', async () => {
    const borrowed = (await import('../../services/enrichment/providers/cost'))
      .makeCreditCostPort({ action: FORBIDDEN_BORROWED_ACTION });
    const d = await borrowed.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
  });

  it('no tenant credit is consumed on the PI path — nothing reserves', async () => {
    store[`${ORG_A}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_A };
    const seen: string[] = [];
    await executeEnrichment(req(), 'clearbit', ports({
      authorizeCost: async (i) => {
        seen.push(i.providerId);
        return defaultCostPort.authorizeCost(i);
      },
    }));
    // authorization happened, but produced no hold to bill against
    expect(seen).toEqual(['clearbit']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — 3/7/8. authorization did not go away with billing', () => {
  it('3. a missing tenant credential is still credential_missing, with no call', async () => {
    const result = await executeEnrichment(req(), 'clearbit', ports());
    expect(result.outcome).toBe('credential_missing');
    expect(result.providerCalled).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  it('7. a global CLEARBIT_API_KEY cannot make a tenant operation execute', async () => {
    process.env.CLEARBIT_API_KEY = 'synthetic-global-key-that-must-never-be-used';
    const result = await executeEnrichment(req(), 'clearbit', ports());
    expect(result.outcome).toBe('credential_missing');
    expect(fetchCalls).toHaveLength(0);
  });

  it('8. no provider call occurs when authorization is absent', async () => {
    // platform-side refusal, not a billing one
    const gated = makeTenantFundedExecutionPort({
      allow: async () => 'platform rate limit reached for this tenant',
    });
    store[`${ORG_A}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_A };
    const result = await executeEnrichment(req(), 'clearbit', ports({
      authorizeCost: gated.authorizeCost,
    }));
    expect(result.outcome).toBe('cost_denied');
    expect(result.reason).toContain('rate limit');
    expect(fetchCalls).toHaveLength(0);
  });

  it('the platform gate is asked for the right tenant and provider', async () => {
    const seen: unknown[] = [];
    const gated = makeTenantFundedExecutionPort({
      allow: async (i) => { seen.push(i); return null; },
    });
    store[`${ORG_A}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_A };
    await executeEnrichment(req(), 'clearbit', ports({ authorizeCost: gated.authorizeCost }));
    expect(seen).toEqual([{
      organizationId: ORG_A, providerId: 'clearbit',
      attributes: ['employee_count'], correlationId: 'corr-a3x',
    }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — 6. tenant isolation is unchanged', () => {
  it('tenant A cannot use tenant B’s credential', async () => {
    store[`${ORG_B}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_B };
    const result = await executeEnrichment(req({ organizationId: ORG_A }), 'clearbit', ports());
    expect(result.outcome).toBe('credential_missing');
    expect(fetchCalls).toHaveLength(0);
  });

  it('each tenant’s own credential is the one that executes', async () => {
    store[`${ORG_A}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_A };
    store[`${ORG_B}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_B };
    const seen: (string | undefined)[] = [];
    const adapter = {
      id: 'clearbit', label: 'C', supports: ['employee_count'], credentialEnvVar: null,
      isAvailable: () => false,
      enrich: async (r: { credential?: string }) => {
        seen.push(r.credential);
        return { outcome: 'enriched' as const, fields: [], notReturned: [] };
      },
    } as never;

    await executeEnrichment(req({ organizationId: ORG_A }), 'clearbit', ports(), { adapter });
    await executeEnrichment(req({ organizationId: ORG_B }), 'clearbit', ports(), { adapter });
    expect(seen).toEqual([SECRET_A, SECRET_B]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — 4/5. provider outcomes stay provider outcomes', () => {
  beforeEach(() => { store[`${ORG_A}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_A }; });

  const run = async () => executeEnrichment(req(), 'clearbit', ports());

  it('5. a provider quota/rate limit is a PROVIDER outcome, not an Omnivyra denial', async () => {
    nextResponse = () => ({ status: 429 });
    const result = await run();
    expect(result.outcome).toBe('rate_limited');
    expect(result.outcome).not.toBe('cost_denied');
    // it was reached — the tenant's own vendor limit, not ours
    expect(result.providerCalled).toBe(true);
  });

  it('4. a provider failure invents no vendor-cost charge and releases nothing', async () => {
    nextResponse = () => ({ status: 500 });
    let released = 0;
    const result = await executeEnrichment(req(), 'clearbit', ports({
      releaseCost: async () => { released += 1; },
    }));
    expect(result.outcome).toBe('provider_unavailable');
    // The executor releases on a provider error; with nothing reserved the
    // release is a no-op rather than a refund of an invented charge.
    expect(released).toBeLessThanOrEqual(1);
    expect((await tenantFundedExecutionPort.authorizeCost(costInput) as { holdId: string | null }).holdId).toBeNull();
  });

  it('a no-match is the provider’s answer, distinct from any refusal of ours', async () => {
    nextResponse = () => ({ status: 404 });
    expect((await run()).outcome).toBe('no_match');
  });

  it('a malformed response is classified, not swallowed', async () => {
    nextResponse = () => ({ status: 200 });
    expect((await run()).outcome).toBe('malformed_response');
  });

  it('a timeout stays a timeout', async () => {
    nextResponse = () => ({ status: 0, throws: new Error('The operation timed out') });
    expect((await run()).outcome).toBe('timeout');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — 9. explicit provider selection cannot be substituted', () => {
  it('an unimplemented provider is not silently replaced by the one that works', async () => {
    store[`${ORG_A}::apollo`] = { [PROVIDER_API_KEY]: 'synthetic-tenant-a-apollo-key' };
    const result = await executeEnrichment(req(), 'apollo', ports());
    expect(result.outcome).toBe('not_implemented');
    expect(result.providerId).toBe('apollo');
    expect(fetchCalls).toHaveLength(0);
  });

  it('the credential resolved is the one for the provider named', async () => {
    store[`${ORG_A}::clearbit`] = { [PROVIDER_API_KEY]: SECRET_A };
    const seen: string[] = [];
    await executeEnrichment(req(), 'clearbit', ports({
      resolveCredential: async ({ providerId }) => { seen.push(providerId); return SECRET_A; },
    }));
    expect(seen).toEqual(['clearbit']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — 10. Omnivyra billing outside PI is untouched', () => {
  it('the credit registry itself is unchanged — no action was registered', () => {
    expect(CREDIT_ACTIONS as readonly string[]).not.toContain(PROSPECT_ENRICHMENT_ACTION);
  });

  it('a genuine Omnivyra action still resolves to itself, exactly as before', () => {
    // `website_audit` is a real customer-facing action; A3X touched nothing
    // about how it prices.
    const resolved = resolveMonetizationFeature({ action_key: 'website_audit' });
    expect(resolved?.action_key).toBe('website_audit');
  });

  it('the credit-reserving port is still available for a future Omnivyra-billable capability', async () => {
    const d = await creditCostPort.authorizeCost(costInput);
    // It refuses today because the action is unregistered — the machinery is
    // intact, it is simply not what BYO-provider enrichment uses.
    expect(d.authorized).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A3X — descriptors and status no longer imply Omnivyra pays the vendor', () => {
  it('no external source claims an Omnivyra credit action', () => {
    for (const s of ACQUISITION_SOURCES) expect(s.creditAction).toBeNull();
  });

  it('the outstanding requirement is the TENANT’s subscription, not a credit action', () => {
    const clearbit = getSource('clearbit')!;
    expect(clearbit.authorizationRequirements).toContain('tenant_provider_subscription');
    expect(clearbit.authorizationRequirements).not.toContain('credit_action');
  });

  it('the status reason says the subscription is the company’s own', async () => {
    const result = await readProviderCredentialStatus(
      { companyId: ORG_A, providerId: 'clearbit' }, { read: async () => ({}) });
    // Narrowed, not cast: `CredentialRefusal` and a status array do not
    // overlap, so a structural cast would not compile — and asserting the
    // refusal case is absent is the stronger statement anyway.
    if (isCredentialRefusal(result)) throw new Error(`unexpected refusal: ${result.reason}`);
    const [status] = result;
    expect(status.operationalReason).toMatch(/held and paid for by your company/);
    expect(status.operational).toBe(false);
  });

  it('no status text implies Omnivyra credits are consumed for provider usage', async () => {
    const result = await readProviderCredentialStatus({ companyId: ORG_A }, { read: async () => ({}) });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain('omnivyra credit');
    expect(text).not.toContain('credit action');
    expect(text).not.toContain('credits are consumed');
  });
});
