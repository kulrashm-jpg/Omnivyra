/**
 * checkoutSessionOrchestrator — foundation orchestration tests.
 *
 * The orchestrator is dependency-injected, so these tests run with NO DB and
 * NO live provider. Covers: provider eligibility enforcement, geography
 * enforcement, disabled/maintenance rejection, normalized response shape,
 * hidden-pricing preservation, idempotent retry, NOT_IMPLEMENTED passthrough.
 */

// Inert supabase mock — the orchestrator transitively imports modules that
// construct a supabase client at load time; injected deps mean it is never
// exercised, but the mock keeps the module graph clean.
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  orchestrateCheckoutSession,
  deriveCheckoutIdempotencyKey,
  type OrchestratorDeps,
  type OrchestrateCheckoutArgs,
} from '../../services/billing/payments/checkoutSessionOrchestrator';

const BASE_ARGS: OrchestrateCheckoutArgs = {
  organizationId: 'org-1',
  initiatedByUserId: 'user-1',
  provider: 'razorpay',
  intentType: 'topup',
  reference: 'topup_credits_500', // real hidden-registry key → amount 500 INR
};

interface FakeOpts {
  country?: string | null;
  currency?: string | null;
  availableProviders?: string[];
  governedMethods?: Record<string, string[]>;
  /** supported_currencies for the governed provider rows (default []=unrestricted). */
  governedCurrencies?: string[];
  gateReason?: string;
  dispatch?: OrchestratorDeps['dispatchCheckout'];
  providerMode?: 'test' | 'live' | 'unknown';
}

function makeDeps(opts: FakeOpts = {}): { deps: Partial<OrchestratorDeps>; dispatchCalls: any[] } {
  const dispatchCalls: any[] = [];
  const country = opts.country === undefined ? 'IN' : opts.country;
  const currency = opts.currency === undefined ? 'INR' : opts.currency;
  const availableProviders = opts.availableProviders ?? ['razorpay'];
  const governedMethods = opts.governedMethods ?? { razorpay: ['card', 'upi'], stripe: ['card'] };

  const deps: Partial<OrchestratorDeps> = {
    resolveOrgBillingContext: async () => ({
      country, currency, region: null,
      source: country ? 'company_billing_profile' : 'none',
    }),
    resolveAvailableProviders: async () => ({
      available: availableProviders.map((p) => ({
        provider: p as any,
        visible_in_checkout: true,
        subscriptions_enabled: false,
        topups_enabled: true,
        supported_payment_methods: governedMethods[p] ?? [],
        supported_countries: [],
        supported_currencies: opts.governedCurrencies ?? [],
        priority: 10,
        sandbox_mode: true,
      })),
      visible: [],
      supported_methods: [],
      recommended: null,
      source: 'db',
    }),
    isProviderAvailableForCheckout: async () =>
      opts.gateReason
        ? { ok: false, reason: opts.gateReason }
        : { ok: true },
    dispatchCheckout: opts.dispatch ?? (async (req) => {
      dispatchCalls.push(req);
      return {
        ok: true, provider: req.provider, amount: req.amount, currency: req.currency,
        sessionId: 'order_test_1', redirectUrl: 'https://rzp.test/checkout/order_test_1',
      };
    }),
    getProviderAdapter: ((p: string) => ({
      describe: () => ({ name: p as any, mode: opts.providerMode ?? 'test', capabilities: [] }),
      createCheckoutSession: async () => ({}) as any,
      handleWebhook: async () => ({}) as any,
    })) as any,
  };
  // Wrap dispatch to also record calls when a custom dispatch is supplied.
  if (opts.dispatch) {
    const inner = opts.dispatch;
    deps.dispatchCheckout = async (req) => { dispatchCalls.push(req); return inner(req); };
  }
  return { deps, dispatchCalls };
}

describe('orchestrator — input validation', () => {
  test('invalid intent_type → rejected', async () => {
    const { deps } = makeDeps();
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, intentType: 'mystery' as any }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_intent_type');
  });
  test('empty reference → rejected', async () => {
    const { deps } = makeDeps();
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, reference: '  ' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_reference');
  });
  test('unknown provider → rejected', async () => {
    const { deps } = makeDeps();
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, provider: 'paypal' as any }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_provider');
  });
});

describe('orchestrator — provider eligibility / governance enforcement', () => {
  test('disabled provider → provider_disabled rejection', async () => {
    const { deps } = makeDeps({ availableProviders: [], gateReason: 'provider_disabled' });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_disabled');
  });

  test('maintenance-mode provider → provider_in_maintenance rejection', async () => {
    const { deps } = makeDeps({ availableProviders: [], gateReason: 'provider_in_maintenance' });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_in_maintenance');
  });

  test('geography-unsupported provider → provider_geography_unsupported rejection', async () => {
    const { deps } = makeDeps({ availableProviders: [], gateReason: 'provider_geography_unsupported' });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_geography_unsupported');
  });

  test('provider absent from governance → not exposed (rejected, not created)', async () => {
    const { deps, dispatchCalls } = makeDeps({ availableProviders: ['stripe'], gateReason: 'provider_disabled' });
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, provider: 'razorpay' }, deps);
    expect(r.ok).toBe(false);
    expect(dispatchCalls).toHaveLength(0); // never reached the adapter
  });
});

describe('orchestrator — geography enforcement', () => {
  test('geography (country) is derived from billing context, NOT the caller', async () => {
    const { deps, dispatchCalls } = makeDeps({ country: 'IN', currency: 'INR' });
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    // country comes from the resolved org billing context.
    expect(dispatchCalls[0].country).toBe('IN');
    // currency comes from the backend amount resolver (the plan's currency),
    // NOT the caller — the hidden registry prices topup_credits_500 in INR.
    expect(dispatchCalls[0].currency).toBe('INR');
  });

  test('unknown geography still resolves — dispatch currency is the resolved plan currency', async () => {
    const { deps, dispatchCalls } = makeDeps({ country: null, currency: null });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    // Currency is authoritative from the amount resolver (plan-priced), not geo.
    expect(dispatchCalls[0].currency).toBe('INR');
  });
});

describe('orchestrator — normalized response shape', () => {
  test('created session has exactly the 7 normalized fields', async () => {
    const { deps } = makeDeps();
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.session).sort()).toEqual([
      'expires_at', 'provider', 'provider_mode', 'provider_reference',
      'redirect_url', 'session_status', 'supported_payment_methods',
    ]);
    expect(r.session.session_status).toBe('created');
    expect(r.session.provider).toBe('razorpay');
    expect(r.session.provider_mode).toBe('test');
    expect(r.session.redirect_url).toBe('https://rzp.test/checkout/order_test_1');
    expect(r.session.provider_reference).toBe('order_test_1');
    expect(r.session.supported_payment_methods).toEqual(['card', 'upi']);
  });
});

describe('orchestrator — NOT_IMPLEMENTED passthrough normalization', () => {
  test('adapter NOT_IMPLEMENTED → ok:true, session_status=not_implemented', async () => {
    const { deps } = makeDeps({
      availableProviders: ['stripe'],
      dispatch: async () => ({
        ok: false, provider: 'stripe', amount: 0, currency: 'USD',
        error: 'Stripe adapter is not yet implemented', code: 'NOT_IMPLEMENTED',
      }),
    });
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, provider: 'stripe' }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.session_status).toBe('not_implemented');
    expect(r.session.redirect_url).toBeNull();
    expect(r.session.provider_reference).toBeNull();
  });

  test('genuine provider error → ok:false provider_error', async () => {
    const { deps } = makeDeps({
      dispatch: async () => ({
        ok: false, provider: 'razorpay', amount: 0, currency: 'INR',
        error: 'gateway down', code: 'PROVIDER_ERROR',
      }),
    });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_error');
  });
});

describe('orchestrator — idempotency', () => {
  test('deterministic key — same inputs → same key', () => {
    const k1 = deriveCheckoutIdempotencyKey(BASE_ARGS);
    const k2 = deriveCheckoutIdempotencyKey({ ...BASE_ARGS });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  test('different reference → different key', () => {
    const k1 = deriveCheckoutIdempotencyKey(BASE_ARGS);
    const k2 = deriveCheckoutIdempotencyKey({ ...BASE_ARGS, reference: 'topup_pack_999' });
    expect(k1).not.toBe(k2);
  });

  test('retry of identical request → same key threaded to the provider', async () => {
    const { deps, dispatchCalls } = makeDeps();
    const r1 = await orchestrateCheckoutSession(BASE_ARGS, deps);
    const r2 = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.idempotency_key).toBe(r2.idempotency_key);
    // The provider received the SAME idempotency key on both attempts.
    expect(dispatchCalls[0].metadata.idempotency_key).toBe(dispatchCalls[1].metadata.idempotency_key);
    // Deterministic response shape.
    expect(r1.session).toEqual(r2.session);
  });
});

describe('orchestrator — hidden-pricing preservation', () => {
  test('normalized session carries NO pricing fields', async () => {
    const { deps } = makeDeps();
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });

  test('dispatches the backend-resolved amount (hidden registry), not 0', async () => {
    const { deps, dispatchCalls } = makeDeps();
    await orchestrateCheckoutSession(BASE_ARGS, deps);
    // topup_credits_500 → ₹500 from the hidden pricing registry.
    expect(dispatchCalls[0].amount).toBe(500);
    expect(dispatchCalls[0].currency).toBe('INR');
  });
});

describe('orchestrator — amount-resolution rejection', () => {
  test('unknown plan/topup reference → unknown_reference rejection (no dispatch)', async () => {
    const { deps, dispatchCalls } = makeDeps();
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, reference: 'topup_does_not_exist' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_reference');
    expect(dispatchCalls).toHaveLength(0);
  });

  test('retired/disabled reference → disabled_reference rejection', async () => {
    const { deps, dispatchCalls } = makeDeps();
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, reference: 'topup_legacy_pack' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('disabled_reference');
    expect(dispatchCalls).toHaveLength(0);
  });

  test('malformed reference → malformed_reference rejection', async () => {
    const { deps, dispatchCalls } = makeDeps();
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, reference: 'Bad Ref!' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('malformed_reference');
    expect(dispatchCalls).toHaveLength(0);
  });

  test('subscription reference resolves for a subscription intent', async () => {
    const { deps, dispatchCalls } = makeDeps();
    const r = await orchestrateCheckoutSession(
      { ...BASE_ARGS, intentType: 'subscription', reference: 'plan_pro_monthly' }, deps);
    expect(r.ok).toBe(true);
    expect(dispatchCalls[0].amount).toBe(1999); // ₹1999 from the hidden catalog
  });
});

describe('orchestrator — provider/currency compatibility enforcement', () => {
  test('plan currency NOT in the provider supported_currencies → provider_currency_incompatible', async () => {
    // topup_credits_500 resolves to INR; the provider only supports USD.
    const { deps, dispatchCalls } = makeDeps({ governedCurrencies: ['USD'] });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_currency_incompatible');
    // Rejected BEFORE dispatchCheckout — no provider session created.
    expect(dispatchCalls).toHaveLength(0);
  });

  test('plan currency IN the provider supported_currencies → accepted', async () => {
    const { deps } = makeDeps({ governedCurrencies: ['INR', 'USD'] });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
  });

  test('empty supported_currencies = unrestricted → accepted', async () => {
    const { deps } = makeDeps({ governedCurrencies: [] });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
  });

  test('currency match is case-insensitive', async () => {
    const { deps } = makeDeps({ governedCurrencies: ['inr'] });
    const r = await orchestrateCheckoutSession(BASE_ARGS, deps);
    expect(r.ok).toBe(true);
  });
});
