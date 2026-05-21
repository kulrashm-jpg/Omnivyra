/**
 * billingAmountResolver — DB-backed hidden amount-resolution tests.
 *
 * Covers: DB-backed resolution, minor→major conversion, compiled-fallback
 * default-preserving behavior, malformed/unknown/disabled rejection,
 * determinism, never-throws, and hidden-pricing preservation.
 */

// Controlled supabase mock: the resolver awaits
// supabase.from('hidden_billing_catalog').select(..).eq(..).maybeSingle().
let __row: any = null;
let __error: any = null;
let __throw = false;

jest.mock('../../db/supabaseClient', () => {
  const builder: any = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () => {
    if (__throw) return Promise.reject(new Error('relation "hidden_billing_catalog" does not exist'));
    return Promise.resolve({ data: __row, error: __error });
  };
  return { supabase: { from: () => builder } };
});

import { resolveBillingAmount } from '../../services/billing/payments/billingAmountResolver';
import * as resolverModule from '../../services/billing/payments/billingAmountResolver';

function reset() { __row = null; __error = null; __throw = false; }
beforeEach(reset);

describe('billingAmountResolver — DB-backed resolution', () => {
  test('resolves an enabled topup from the catalog row (minor→major)', async () => {
    __row = { kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: true };
    const r = await resolveBillingAmount({ intentType: 'topup', reference: 'topup_credits_500' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toEqual({ amount: 500, currency: 'INR' }); // 50000 paise → ₹500
  });

  test('resolves an enabled subscription from the catalog row', async () => {
    __row = { kind: 'subscription', amount_minor: 199900, currency: 'INR', enabled: true };
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'plan_pro_monthly' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toEqual({ amount: 1999, currency: 'INR' });
  });

  test('zero-decimal currency is not divided (JPY)', async () => {
    __row = { kind: 'topup', amount_minor: 1000, currency: 'JPY', enabled: true };
    const r = await resolveBillingAmount({ intentType: 'topup', reference: 'topup_credits_500' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toEqual({ amount: 1000, currency: 'JPY' });
  });
});

describe('billingAmountResolver — rejection behavior', () => {
  test.each(['', '   ', 'x', 'Plan_Pro', 'plan pro', 'plan-pro', '1plan', 'plan!@#'])(
    'malformed reference %p → malformed_reference (no DB read)',
    async (ref) => {
      const r = await resolveBillingAmount({ intentType: 'subscription', reference: ref });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('malformed_reference');
    },
  );

  test('table exists but no such row → unknown_reference', async () => {
    __row = null; __error = null;
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'plan_does_not_exist' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_reference');
  });

  test('kind mismatch → unknown_reference', async () => {
    __row = { kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: true };
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'topup_credits_500' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_reference');
  });

  test('disabled catalog entry → disabled_reference', async () => {
    __row = { kind: 'subscription', amount_minor: 99900, currency: 'INR', enabled: false };
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'plan_legacy_v1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('disabled_reference');
  });
});

describe('billingAmountResolver — compiled-fallback (default-preserving)', () => {
  test('table absent (query throws) → resolves from COMPILED_FALLBACK', async () => {
    __throw = true;
    const r = await resolveBillingAmount({ intentType: 'topup', reference: 'topup_credits_500' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toEqual({ amount: 500, currency: 'INR' });
  });

  test('DB error → resolves from COMPILED_FALLBACK', async () => {
    __error = { message: 'permission denied' };
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'plan_pro_monthly' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toEqual({ amount: 1999, currency: 'INR' });
  });

  test('fallback preserves disabled rejection (retired entry)', async () => {
    __throw = true;
    const r = await resolveBillingAmount({ intentType: 'topup', reference: 'topup_legacy_pack' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('disabled_reference');
  });

  test('fallback preserves unknown rejection (no fallback entry)', async () => {
    __throw = true;
    const r = await resolveBillingAmount({ intentType: 'topup', reference: 'topup_not_in_fallback' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_reference');
  });

  test('never throws even when the DB read rejects', async () => {
    __throw = true;
    await expect(resolveBillingAmount({ intentType: 'topup', reference: 'topup_credits_500' }))
      .resolves.toBeDefined();
  });
});

describe('billingAmountResolver — determinism', () => {
  test('identical input → identical result (DB row)', async () => {
    __row = { kind: 'topup', amount_minor: 50000, currency: 'INR', enabled: true };
    const a = await resolveBillingAmount({ intentType: 'topup', reference: 'topup_credits_500' });
    const b = await resolveBillingAmount({ intentType: 'topup', reference: 'topup_credits_500' });
    expect(b).toEqual(a);
  });
});

describe('billingAmountResolver — hidden-pricing preservation', () => {
  test('module exports ONLY the resolver — no registry/catalog/price table', () => {
    const exported = Object.keys(resolverModule);
    expect(exported).toContain('resolveBillingAmount');
    for (const name of exported) {
      expect(name.toLowerCase()).not.toMatch(/registry|catalog|fallback|prices|price_table/);
    }
  });

  test('successful result exposes ONLY amount + currency — no catalog leak', async () => {
    __row = { kind: 'subscription', amount_minor: 199900, currency: 'INR', enabled: true };
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'plan_pro_monthly' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.amount).sort()).toEqual(['amount', 'currency']);
    for (const f of ['kind', 'enabled', 'amount_minor', 'internal_label', 'reference_key']) {
      expect(r.amount).not.toHaveProperty(f);
    }
  });

  test('rejection result carries no pricing data', async () => {
    __row = { kind: 'subscription', amount_minor: 99900, currency: 'INR', enabled: false };
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'plan_legacy_v1' });
    expect(r.ok).toBe(false);
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'amount_minor', 'price', 'currency', 'internal_label']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
