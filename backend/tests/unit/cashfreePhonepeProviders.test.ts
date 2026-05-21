/**
 * Cashfree + PhonePe — provider-foundation integration tests.
 *
 * Covers: provider registration (type/registry/governance), sandbox adapter
 * normalization, checkout-orchestrator compatibility, disabled-provider
 * rejection, maintenance-mode rejection, geography filtering, hidden-pricing
 * preservation. Sandbox-only — no live settlement, no network.
 */

// Inert supabase mock — the orchestrator transitively imports modules that
// build a supabase client at load time; injected deps mean it is never used.
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));

import {
  getProviderAdapter,
  type CheckoutSessionRequest,
} from '../../services/billing/payments/paymentProviderAdapter';
import {
  GOVERNED_PROVIDERS,
  COMPILED_DEFAULT_PROVIDERS,
} from '../../services/billing/payments/paymentProviderPolicyResolver';
import {
  orchestrateCheckoutSession,
  type OrchestratorDeps,
  type OrchestrateCheckoutArgs,
} from '../../services/billing/payments/checkoutSessionOrchestrator';

const NEW_PROVIDERS = ['cashfree', 'phonepe'] as const;

// ── 1. provider registration ────────────────────────────────────────────────

describe('cashfree + phonepe — provider registration', () => {
  test.each(NEW_PROVIDERS)('%s is in GOVERNED_PROVIDERS', (p) => {
    expect(GOVERNED_PROVIDERS).toContain(p);
  });

  test.each(NEW_PROVIDERS)('%s has a compiled-default governance row', (p) => {
    const row = COMPILED_DEFAULT_PROVIDERS.find((r) => r.provider === p);
    expect(row).toBeDefined();
    // Registered HIDDEN + DISABLED + sandbox — inert until operator-enabled.
    expect(row!.enabled).toBe(false);
    expect(row!.visible_in_checkout).toBe(false);
    expect(row!.sandbox_mode).toBe(true);
  });

  test.each(NEW_PROVIDERS)('%s has a registered adapter', (p) => {
    const adapter = getProviderAdapter(p);
    expect(adapter).not.toBeNull();
    expect(adapter!.describe().name).toBe(p);
    expect(adapter!.describe().mode).toBe('test'); // sandbox/test-mode only
  });

  test('cashfree governance metadata: India / INR / card+upi+netbanking', () => {
    const row = COMPILED_DEFAULT_PROVIDERS.find((r) => r.provider === 'cashfree')!;
    expect(row.supported_countries).toEqual(['IN']);
    expect(row.supported_currencies).toEqual(['INR']);
    expect(row.supported_payment_methods).toEqual(['card', 'upi', 'netbanking']);
  });

  test('phonepe governance metadata: India / INR / upi+card', () => {
    const row = COMPILED_DEFAULT_PROVIDERS.find((r) => r.provider === 'phonepe')!;
    expect(row.supported_countries).toEqual(['IN']);
    expect(row.supported_currencies).toEqual(['INR']);
    expect(row.supported_payment_methods).toEqual(['upi', 'card']);
  });
});

// ── 2. sandbox adapter normalization ────────────────────────────────────────

function sampleRequest(provider: 'cashfree' | 'phonepe'): CheckoutSessionRequest {
  return {
    provider, organizationId: 'org-1', amount: 0, currency: 'INR',
    creditPackageId: 'topup_500', initiatedByUserId: 'user-1',
  };
}

describe('cashfree + phonepe — sandbox adapter normalization', () => {
  test.each(NEW_PROVIDERS)('%s createCheckoutSession returns a normalized sandbox session', async (p) => {
    const result = await getProviderAdapter(p)!.createCheckoutSession(sampleRequest(p));
    expect(result.ok).toBe(true);
    expect(result.provider).toBe(p);
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId).toMatch(new RegExp(`^${p}_sbx_[0-9a-f]{24}$`));
    expect(result.redirectUrl).toContain(`sandbox.${p}`);
  });

  test.each(NEW_PROVIDERS)('%s sandbox session is deterministic (idempotent ref)', async (p) => {
    const a = await getProviderAdapter(p)!.createCheckoutSession(sampleRequest(p));
    const b = await getProviderAdapter(p)!.createCheckoutSession(sampleRequest(p));
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.redirectUrl).toBe(b.redirectUrl);
  });

  test.each(NEW_PROVIDERS)('%s webhook handler is inert — settlement NOT activated', async (p) => {
    const r = await getProviderAdapter(p)!.handleWebhook({
      provider: p, providerEventId: 'evt_x', eventType: 'test', payload: {},
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('ignored');
  });

  test.each(NEW_PROVIDERS)('%s adapter result carries NO pricing fields', async (p) => {
    const result = await getProviderAdapter(p)!.createCheckoutSession(sampleRequest(p));
    const serialized = JSON.stringify(result).toLowerCase();
    for (const f of ['price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});

// ── 3. checkout-orchestration compatibility ─────────────────────────────────

function makeDeps(opts: {
  provider: 'cashfree' | 'phonepe';
  available?: boolean;
  gateReason?: string;
  country?: string | null;
}): Partial<OrchestratorDeps> {
  const country = opts.country === undefined ? 'IN' : opts.country;
  const available = opts.available ?? true;
  const methods = opts.provider === 'cashfree' ? ['card', 'upi', 'netbanking'] : ['upi', 'card'];
  return {
    resolveOrgBillingContext: async () => ({
      country, currency: country ? 'INR' : null, region: null,
      source: country ? 'company_billing_profile' : 'none',
    }),
    resolveAvailableProviders: async () => ({
      available: available
        ? [{
            provider: opts.provider as any, visible_in_checkout: true,
            subscriptions_enabled: false, topups_enabled: true,
            supported_payment_methods: methods, supported_countries: ['IN'],
            supported_currencies: ['INR'], priority: 30, sandbox_mode: true,
          }]
        : [],
      visible: [], supported_methods: [], recommended: null, source: 'db',
    }),
    isProviderAvailableForCheckout: async () =>
      opts.gateReason ? { ok: false, reason: opts.gateReason } : { ok: true },
    // Delegate to the REAL registered sandbox adapter so this exercises the
    // adapter + the orchestrator's normalization together.
    dispatchCheckout: async (req) => getProviderAdapter(req.provider)!.createCheckoutSession(req),
    getProviderAdapter,
  };
}

const BASE_ARGS: OrchestrateCheckoutArgs = {
  organizationId: 'org-1', initiatedByUserId: 'user-1',
  provider: 'cashfree', intentType: 'topup', reference: 'topup_credits_500',
};

describe('cashfree + phonepe — checkout-orchestration compatibility', () => {
  test.each(NEW_PROVIDERS)('orchestrator accepts %s and creates a normalized session', async (p) => {
    const r = await orchestrateCheckoutSession(
      { ...BASE_ARGS, provider: p },
      makeDeps({ provider: p }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.provider).toBe(p);
    expect(r.session.session_status).toBe('created');
    expect(r.session.provider_mode).toBe('test');
    expect(r.session.redirect_url).toContain(`sandbox.${p}`);
    expect(r.idempotency_key).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each(NEW_PROVIDERS)('%s idempotency unchanged — retry yields the same key', async (p) => {
    const deps = makeDeps({ provider: p });
    const r1 = await orchestrateCheckoutSession({ ...BASE_ARGS, provider: p }, deps);
    const r2 = await orchestrateCheckoutSession({ ...BASE_ARGS, provider: p }, deps);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.idempotency_key).toBe(r2.idempotency_key);
    expect(r1.session).toEqual(r2.session);
  });
});

// ── 4. governance enforcement compatibility ─────────────────────────────────

describe('cashfree + phonepe — governance enforcement', () => {
  test.each(NEW_PROVIDERS)('disabled %s → provider_disabled rejection', async (p) => {
    const r = await orchestrateCheckoutSession(
      { ...BASE_ARGS, provider: p },
      makeDeps({ provider: p, available: false, gateReason: 'provider_disabled' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_disabled');
  });

  test.each(NEW_PROVIDERS)('maintenance-mode %s → provider_in_maintenance rejection', async (p) => {
    const r = await orchestrateCheckoutSession(
      { ...BASE_ARGS, provider: p },
      makeDeps({ provider: p, available: false, gateReason: 'provider_in_maintenance' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_in_maintenance');
  });

  test.each(NEW_PROVIDERS)('geography-unsupported %s → provider_geography_unsupported rejection', async (p) => {
    const r = await orchestrateCheckoutSession(
      { ...BASE_ARGS, provider: p },
      makeDeps({ provider: p, available: false, gateReason: 'provider_geography_unsupported', country: 'US' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_geography_unsupported');
  });
});

// ── 5. hidden-pricing preservation ──────────────────────────────────────────

describe('cashfree + phonepe — hidden-pricing preservation', () => {
  test.each(NEW_PROVIDERS)('orchestrated %s session carries NO pricing fields', async (p) => {
    const r = await orchestrateCheckoutSession({ ...BASE_ARGS, provider: p }, makeDeps({ provider: p }));
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'price', 'plan_price', 'pricing', 'subtotal', 'total', 'invoice']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
