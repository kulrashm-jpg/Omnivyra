/**
 * A3B — the cost gate.
 *
 * The registry and the reservation are doubled at their own boundaries, so what
 * is proven here is the GATE'S behaviour: that every path which is not a
 * definite authorisation refuses, and that a refusal stops the provider call.
 *
 * The load-bearing assertion is negative and appears in several forms: the
 * provider adapter is never invoked unless credits were actually reserved.
 */

import {
  makeCreditCostPort, creditCostPort, executeEnrichment,
  PROSPECT_ENRICHMENT_ACTION, FORBIDDEN_BORROWED_ACTION,
  type EnrichmentProviderAdapter, type ExecuteEnrichmentPorts,
} from '../../services/enrichment/providers';
import { resolveMonetizationFeature, CREDIT_ACTIONS } from '../../../shared/monetization/featureRegistry';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const OTHER_ORG = '0eda0896-7814-4613-8b49-4a8f408e45f1';
const ENTITY = '11111111-1111-4111-8111-111111111111';

const costInput = {
  organizationId: ORG, providerId: 'fake', attributes: ['job_title'], correlationId: 'corr-1',
};

/** A registry double that recognises exactly one action. */
const registryKnowing = (action: string, pricingKey: string | null = 'prospect_enrichment') =>
  ((input: { action_key?: string | null }) => (
    input.action_key === action
      ? { feature_key: `internal.${action}`, action_key: action, pricing_key: pricingKey }
      : null
  )) as unknown as typeof resolveMonetizationFeature;

function adapterWithCalls(): EnrichmentProviderAdapter & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    id: 'fake', label: 'Fake', supports: ['job_title'], credentialEnvVar: null,
    isAvailable: () => true,
    calls,
    async enrich(req) {
      calls.push(req);
      return {
        outcome: 'enriched', notReturned: [],
        fields: [{ attribute: 'job_title', subject: 'person', value: 'Marketing Manager', observedAt: null, confidence: null, providerInferred: false }],
      };
    },
  } as EnrichmentProviderAdapter & { calls: unknown[] };
}

const portsWith = (
  cost: Pick<ExecuteEnrichmentPorts, 'authorizeCost' | 'releaseCost'>,
): ExecuteEnrichmentPorts => ({
  ...cost,
  // A3M: the tenant credential port. Present so cost remains the thing under
  // test — a null here would end every attempt at `credential_missing` before
  // the cost gate was ever reached.
  resolveCredential: async () => 'tenant-scoped-test-secret',
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => '2026-09-05T00:00:00.000Z',
});

describe('A3B — the prospect enrichment action is not registered', () => {
  it('is genuinely absent from CREDIT_ACTIONS — this is the real blocker', () => {
    expect(CREDIT_ACTIONS as readonly string[]).not.toContain(PROSPECT_ENRICHMENT_ACTION);
  });

  it('the registry does NOT answer null for an unregistered action — it falls back', () => {
    // A live-registry finding, asserted so the gate can never rely on null.
    // The last fallback resolves with no report inputs, so an unknown action
    // silently becomes a different, credit-holding, customer-facing action.
    const resolved = resolveMonetizationFeature({ action_key: PROSPECT_ENRICHMENT_ACTION });
    expect(resolved).not.toBeNull();
    expect(resolved?.action_key).not.toBe(PROSPECT_ENRICHMENT_ACTION);
  });

  it('the default port therefore refuses, naming the action', async () => {
    const d = await creditCostPort.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) {
      expect(d.reason).toContain(PROSPECT_ENRICHMENT_ACTION);
      expect(d.reason).toContain('not registered');
      expect(d.reason).toContain('before any external call');
    }
  });
});

describe('A3B — every non-authorisation refuses', () => {
  it('refuses an unregistered action', async () => {
    const port = makeCreditCostPort({ action: 'not_a_real_action', resolveFeature: registryKnowing('other') });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) expect(d.reason).toContain('is registered');
  });

  it('refuses when the registry resolves the action to a DIFFERENT cost centre', async () => {
    // The live fallback behaviour, isolated: asking for X and being handed Y
    // must never authorise, or a tenant is billed for something else entirely.
    const port = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: (() => ({
        feature_key: 'reports.snapshot', action_key: 'website_audit', pricing_key: 'website_audit',
      })) as unknown as typeof resolveMonetizationFeature,
      reserve: async () => ({ holdId: 'h' }),
    });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) {
      expect(d.reason).toContain('website_audit');
      expect(d.reason).toContain('different');
    }
  });

  it('refuses an action that resolves to no pricing key', async () => {
    const port = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION, null),
      reserve: async () => ({ holdId: 'h' }),
    });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) expect(d.reason).toContain('no pricing key');
  });

  it('refuses to borrow the company-profile action', async () => {
    const port = makeCreditCostPort({
      action: FORBIDDEN_BORROWED_ACTION,
      resolveFeature: registryKnowing(FORBIDDEN_BORROWED_ACTION),
      reserve: async () => ({ holdId: 'h' }),
    });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) {
      expect(d.reason).toContain('holds no credits');
      expect(d.reason).toContain('distinct credit action');
    }
  });

  it('refuses when the action is registered but no reservation is wired', async () => {
    const port = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION),
    });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) expect(d.reason).toContain('no credit reservation is wired');
  });

  it('refuses when pricing is missing — a throw is a refusal, not a fallthrough', async () => {
    const port = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION),
      reserve: async () => {
        // Exactly what pricingService raises for an unpriced action.
        throw new Error("[pricingService] Missing action_pricing_config row for actionKey='prospect_enrichment'");
      },
    });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) expect(d.reason).toContain('Missing action_pricing_config row');
  });

  it('refuses a reservation that produced no hold', async () => {
    const port = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION),
      reserve: async () => ({ holdId: null }),
    });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(false);
    if ('reason' in d) expect(d.reason).toContain('no hold');
  });

  it('authorises ONLY when the action is registered, priced and reserved', async () => {
    const port = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION),
      reserve: async () => ({ holdId: 'hold-1' }),
    });
    const d = await port.authorizeCost(costInput);
    expect(d.authorized).toBe(true);
    if (!('reason' in d)) expect(d.holdId).toBe('hold-1');
  });
});

describe('A3B — a refusal stops the provider call', () => {
  it.each([
    ['unregistered action', makeCreditCostPort({ action: 'nope', resolveFeature: registryKnowing('x') })],
    ['no reservation wired', makeCreditCostPort({ action: PROSPECT_ENRICHMENT_ACTION, resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION) })],
    ['missing price', makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION),
      reserve: async () => { throw new Error('Missing action_pricing_config row'); },
    })],
    ['the live default port', creditCostPort],
  ])('never contacts the provider when cost is denied by %s', async (_label, cost) => {
    const adapter = adapterWithCalls();
    const r = await executeEnrichment({
      organizationId: ORG, subject: 'person', entityId: ENTITY,
      attributes: ['job_title'], selectors: {}, purpose: 'icp', correlationId: 'c',
    }, 'fake', portsWith(cost), { adapter });

    expect(r.outcome).toBe('cost_denied');
    expect(r.providerCalled).toBe(false);
    expect(adapter.calls).toHaveLength(0);      // the decisive assertion
    expect(r.sourceRecordId).toBeNull();
  });

  it('contacts the provider exactly once when cost IS authorised', async () => {
    const adapter = adapterWithCalls();
    const cost = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION),
      reserve: async () => ({ holdId: 'hold-1' }),
    });
    const r = await executeEnrichment({
      organizationId: ORG, subject: 'person', entityId: ENTITY,
      attributes: ['job_title'], selectors: {}, purpose: 'icp', correlationId: 'c',
    }, 'fake', portsWith(cost), { adapter });

    expect(r.outcome).toBe('enriched');
    expect(adapter.calls).toHaveLength(1);
  });
});

describe('A3B — tenant scoping of the reservation', () => {
  it('reserves against the tenant the executor verified, not one from a payload', async () => {
    let reservedOrg = '';
    const cost = makeCreditCostPort({
      action: PROSPECT_ENRICHMENT_ACTION,
      resolveFeature: registryKnowing(PROSPECT_ENRICHMENT_ACTION),
      reserve: async (i) => { reservedOrg = i.organizationId; return { holdId: 'h' }; },
    });
    await executeEnrichment({
      organizationId: ORG, subject: 'person', entityId: ENTITY,
      attributes: ['job_title'], selectors: {}, purpose: 'icp', correlationId: 'c',
    }, 'fake', portsWith(cost), { adapter: adapterWithCalls() });

    expect(reservedOrg).toBe(ORG);
    expect(reservedOrg).not.toBe(OTHER_ORG);
  });
});

describe('A3B — internal.profile_enrichment stays semantically separate', () => {
  it('still resolves on its own, and is not what prospect enrichment uses', () => {
    const profile = resolveMonetizationFeature({ action_key: FORBIDDEN_BORROWED_ACTION });
    expect(profile?.feature_key).toBe('internal.profile_enrichment');
    // Prospect enrichment must not resolve to it, and does not.
    const prospect = resolveMonetizationFeature({ action_key: PROSPECT_ENRICHMENT_ACTION });
    expect(prospect?.feature_key).not.toBe('internal.profile_enrichment');
    expect(PROSPECT_ENRICHMENT_ACTION).not.toBe(FORBIDDEN_BORROWED_ACTION);
  });
});
