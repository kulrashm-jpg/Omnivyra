/**
 * Payment-provider governance resolver — additive, default-preserving.
 *
 * Tests ONLY: provider visibility resolution, disabled-provider exclusion,
 * geography filtering, currency filtering, maintenance-mode filtering,
 * backend-authoritative lists, compiled-default fallback, and hidden-pricing
 * preservation (resolver returns NO pricing fields). No ledger/wallet/HOLD.
 */

// Controlled supabase mock: the resolver awaits
// supabase.from('payment_provider_config').select(cols) → { data, error }.
let __rows: any[] | null = null;
let __error: any = null;
let __throw = false;

jest.mock('../../db/supabaseClient', () => {
  const builder: any = {};
  builder.select = () => {
    if (__throw) return Promise.reject(new Error('relation "payment_provider_config" does not exist'));
    return Promise.resolve({ data: __rows, error: __error });
  };
  return { supabase: { from: () => builder } };
});

import {
  resolveProviderGovernance,
  resolveAvailableProviders,
  isProviderAvailableForCheckout,
  COMPILED_DEFAULT_PROVIDERS,
  GOVERNED_PROVIDERS,
} from '../../services/billing/payments/paymentProviderPolicyResolver';

function resetMock() { __rows = null; __error = null; __throw = false; }
beforeEach(resetMock);

/** Build a full governance row with sane defaults; override per test. */
function row(provider: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider,
    enabled: true,
    visible_in_checkout: true,
    subscriptions_enabled: false,
    topups_enabled: true,
    supported_countries: [],
    supported_currencies: [],
    supported_payment_methods: ['card'],
    priority: 100,
    maintenance_mode: false,
    sandbox_mode: true,
    ...over,
  };
}

// ── compiled-default fallback (default-preserving) ──────────────────────────

describe('resolver — default-preserving fallback', () => {
  test('table absent / query throws → compiled defaults, never throws', async () => {
    __throw = true;
    const r = await resolveProviderGovernance();
    expect(r.source).toBe('compiled_default');
    expect(r.rows).toEqual(COMPILED_DEFAULT_PROVIDERS);
  });

  test('empty table → compiled defaults', async () => {
    __rows = [];
    const r = await resolveProviderGovernance();
    expect(r.source).toBe('compiled_default');
  });

  test('db error → compiled defaults', async () => {
    __error = { message: 'permission denied' };
    const r = await resolveProviderGovernance();
    expect(r.source).toBe('compiled_default');
  });

  test('compiled defaults mirror current reality: razorpay available, stripe not', async () => {
    __throw = true;
    const resolved = await resolveAvailableProviders();
    expect(resolved.source).toBe('compiled_default');
    expect(resolved.available.map((p) => p.provider)).toEqual(['razorpay']);
    expect(resolved.visible.map((p) => p.provider)).toEqual(['razorpay']);
  });
});

// ── provider visibility resolution ──────────────────────────────────────────

describe('resolver — visibility resolution', () => {
  test('available vs visible: enabled-but-hidden provider is available, not visible', async () => {
    __rows = [
      row('razorpay', { enabled: true, visible_in_checkout: true,  priority: 10 }),
      row('stripe',   { enabled: true, visible_in_checkout: false, priority: 20 }),
    ];
    const r = await resolveAvailableProviders();
    expect(r.source).toBe('db');
    expect(r.available.map((p) => p.provider)).toEqual(['razorpay', 'stripe']);
    expect(r.visible.map((p) => p.provider)).toEqual(['razorpay']);
  });

  test('ordering is deterministic by priority then name', async () => {
    __rows = [
      row('stripe',   { priority: 5 }),
      row('razorpay', { priority: 50 }),
    ];
    const r = await resolveAvailableProviders();
    expect(r.available.map((p) => p.provider)).toEqual(['stripe', 'razorpay']);
  });
});

// ── disabled-provider exclusion ─────────────────────────────────────────────

describe('resolver — disabled exclusion', () => {
  test('enabled=false provider is excluded from available AND visible', async () => {
    __rows = [
      row('razorpay', { enabled: true }),
      row('stripe',   { enabled: false, visible_in_checkout: true }),
    ];
    const r = await resolveAvailableProviders();
    expect(r.available.map((p) => p.provider)).toEqual(['razorpay']);
    expect(r.visible.map((p) => p.provider)).toEqual(['razorpay']);
  });

  test('isProviderAvailableForCheckout → provider_disabled reason', async () => {
    __rows = [row('stripe', { enabled: false })];
    const gate = await isProviderAvailableForCheckout('stripe');
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('provider_disabled');
  });
});

// ── maintenance-mode filtering ──────────────────────────────────────────────

describe('resolver — maintenance-mode filtering', () => {
  test('maintenance_mode=true provider is excluded even when enabled+visible', async () => {
    __rows = [
      row('razorpay', { enabled: true, visible_in_checkout: true, maintenance_mode: false }),
      row('stripe',   { enabled: true, visible_in_checkout: true, maintenance_mode: true }),
    ];
    const r = await resolveAvailableProviders();
    expect(r.available.map((p) => p.provider)).toEqual(['razorpay']);
    expect(r.visible.map((p) => p.provider)).toEqual(['razorpay']);
  });

  test('isProviderAvailableForCheckout → provider_in_maintenance reason', async () => {
    __rows = [row('razorpay', { enabled: true, maintenance_mode: true })];
    const gate = await isProviderAvailableForCheckout('razorpay');
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('provider_in_maintenance');
  });
});

// ── geography filtering ─────────────────────────────────────────────────────

describe('resolver — geography filtering', () => {
  test('provider restricted to IN is excluded for a US request', async () => {
    __rows = [row('razorpay', { supported_countries: ['IN'] })];
    const inResult = await resolveAvailableProviders({ country: 'IN' });
    expect(inResult.available.map((p) => p.provider)).toEqual(['razorpay']);
    const usResult = await resolveAvailableProviders({ country: 'US' });
    expect(usResult.available).toHaveLength(0);
  });

  test('empty supported_countries = unrestricted (matches any country)', async () => {
    __rows = [row('stripe', { supported_countries: [] })];
    const r = await resolveAvailableProviders({ country: 'JP' });
    expect(r.available.map((p) => p.provider)).toEqual(['stripe']);
  });

  test('country match is case-insensitive', async () => {
    __rows = [row('razorpay', { supported_countries: ['IN'] })];
    const r = await resolveAvailableProviders({ country: 'in' });
    expect(r.available).toHaveLength(1);
  });

  test('isProviderAvailableForCheckout → provider_geography_unsupported reason', async () => {
    __rows = [row('razorpay', { enabled: true, supported_countries: ['IN'] })];
    const gate = await isProviderAvailableForCheckout('razorpay', { country: 'DE' });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('provider_geography_unsupported');
  });
});

// ── currency filtering ──────────────────────────────────────────────────────

describe('resolver — currency filtering', () => {
  test('provider not supporting EUR is excluded for a EUR request', async () => {
    __rows = [row('razorpay', { supported_currencies: ['INR', 'USD'] })];
    const usd = await resolveAvailableProviders({ currency: 'USD' });
    expect(usd.available).toHaveLength(1);
    const eur = await resolveAvailableProviders({ currency: 'EUR' });
    expect(eur.available).toHaveLength(0);
  });

  test('empty supported_currencies = unrestricted', async () => {
    __rows = [row('stripe', { supported_currencies: [] })];
    const r = await resolveAvailableProviders({ currency: 'AUD' });
    expect(r.available).toHaveLength(1);
  });
});

// ── backend-authoritative lists ─────────────────────────────────────────────

describe('resolver — backend-authoritative output shape', () => {
  test('returns available, visible, supported_methods, recommended placeholder, source', async () => {
    __rows = [
      row('razorpay', { supported_payment_methods: ['card', 'upi'] }),
      row('stripe',   { supported_payment_methods: ['card', 'sepa'], visible_in_checkout: true }),
    ];
    const r = await resolveAvailableProviders();
    expect(Array.isArray(r.available)).toBe(true);
    expect(Array.isArray(r.visible)).toBe(true);
    expect(r.supported_methods).toEqual(['card', 'sepa', 'upi']); // de-duped + sorted
    expect(r.recommended).toBeNull(); // routing intelligence NOT implemented
    expect(r.source).toBe('db');
  });

  test('a provider missing from the table falls back to its compiled default row', async () => {
    __rows = [row('razorpay', { enabled: true })]; // stripe row absent
    const { rows } = await resolveProviderGovernance();
    expect(rows.map((r) => r.provider).sort()).toEqual([...GOVERNED_PROVIDERS].sort());
    const stripe = rows.find((r) => r.provider === 'stripe')!;
    expect(stripe.enabled).toBe(false); // compiled default for stripe
  });
});

// ── hidden-pricing preservation ─────────────────────────────────────────────

describe('resolver — hidden-pricing preservation', () => {
  const PRICING_FIELDS = [
    'price', 'amount', 'unit_price', 'plan_price', 'pricing',
    'cost', 'rate', 'subtotal', 'total', 'currency_amount',
  ];

  test('resolved checkout providers carry NO pricing fields', async () => {
    __rows = [row('razorpay'), row('stripe')];
    const r = await resolveAvailableProviders();
    for (const p of [...r.available, ...r.visible]) {
      for (const f of PRICING_FIELDS) {
        expect(p).not.toHaveProperty(f);
      }
    }
  });

  test('governance rows carry NO pricing fields', async () => {
    __rows = [row('razorpay')];
    const { rows } = await resolveProviderGovernance();
    for (const gr of rows) {
      for (const f of PRICING_FIELDS) {
        expect(gr).not.toHaveProperty(f);
      }
    }
  });

  test('the top-level resolved list carries NO pricing fields', async () => {
    __rows = [row('razorpay')];
    const r = await resolveAvailableProviders();
    for (const f of PRICING_FIELDS) {
      expect(r).not.toHaveProperty(f);
    }
  });
});

// ── conservative geography fallback (geographyKnown) ────────────────────────

describe('resolver — geographyKnown conservative fallback', () => {
  test('geographyKnown=false + no country → geography-restricted provider EXCLUDED', async () => {
    __rows = [
      row('razorpay', { supported_countries: ['IN'] }), // restricted
      row('stripe',   { supported_countries: [] }),      // unrestricted
    ];
    const r = await resolveAvailableProviders({ geographyKnown: false });
    // Only the unrestricted provider survives when geography is unknown.
    expect(r.available.map((p) => p.provider)).toEqual(['stripe']);
  });

  test('geographyKnown omitted + no country → default-preserving (all match)', async () => {
    __rows = [
      row('razorpay', { supported_countries: ['IN'] }),
      row('stripe',   { supported_countries: [] }),
    ];
    const r = await resolveAvailableProviders({}); // geographyKnown undefined
    expect(r.available.map((p) => p.provider).sort()).toEqual(['razorpay', 'stripe']);
  });

  test('geographyKnown=false is overridden when an explicit country IS supplied', async () => {
    __rows = [row('razorpay', { supported_countries: ['IN'] })];
    const r = await resolveAvailableProviders({ country: 'IN', geographyKnown: false });
    // Explicit country present → normal geography match, restricted provider passes.
    expect(r.available.map((p) => p.provider)).toEqual(['razorpay']);
  });

  test('isProviderAvailableForCheckout: geographyKnown=false hides a restricted provider', async () => {
    __rows = [row('razorpay', { enabled: true, supported_countries: ['IN'] })];
    const gate = await isProviderAvailableForCheckout('razorpay', { geographyKnown: false });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe('provider_geography_unsupported');
  });
});
