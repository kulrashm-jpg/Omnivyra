/**
 * billingAmountResolver - RETIRED hidden-billing resolution (owner; e9 C97 1(a), 2026-11-13).
 *
 * The hidden billing catalog is retired and a checkout must never price from it: every well-formed reference refuses
 * with 'disabled_reference', a malformed one with 'malformed_reference'; no database read, no compiled fallback, no
 * amount - including the references the catalog / compiled fallback used to price (the regression these cases replace).
 */

const __dbReads: string[] = [];
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => { __dbReads.push(t); throw new Error(`no database read expected (from ${t})`); } },
}));

import { resolveBillingAmount, HIDDEN_BILLING_RETIRED_REASON } from '../../services/billing/payments/billingAmountResolver';
import * as resolverModule from '../../services/billing/payments/billingAmountResolver';

beforeEach(() => { __dbReads.length = 0; });

describe('billingAmountResolver - retired: every well-formed reference refuses', () => {
  test.each([
    ['topup', 'topup_credits_500'],        // priced by the catalog seed AND the compiled fallback before retirement
    ['subscription', 'plan_pro_monthly'],  // ditto
    ['subscription', 'plan_legacy_v1'],
    ['topup', 'topup_not_in_fallback'],
  ] as const)('%s %p -> disabled_reference, no amount, no DB read', async (intentType, reference) => {
    const r = await resolveBillingAmount({ intentType, reference });
    expect(r).toEqual({ ok: false, code: 'disabled_reference', reason: HIDDEN_BILLING_RETIRED_REASON });
    expect(__dbReads).toEqual([]);
  });

  test('never resolves ok for any intent type', async () => {
    for (const intentType of ['subscription', 'topup'] as const) {
      const r = await resolveBillingAmount({ intentType, reference: 'plan_pro_monthly' });
      expect(r.ok).toBe(false);
    }
  });
});

describe('billingAmountResolver - malformed input is still named', () => {
  test.each(['', '   ', 'x', 'Plan_Pro', 'plan pro', 'plan-pro', '1plan', 'plan!@#'])(
    'malformed reference %p -> malformed_reference (no DB read)',
    async (ref) => {
      const r = await resolveBillingAmount({ intentType: 'subscription', reference: ref });
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.code).toBe('malformed_reference');
      expect(__dbReads).toEqual([]);
    },
  );

  test('a non-string reference is malformed, not a throw', async () => {
    await expect(resolveBillingAmount({ intentType: 'topup', reference: undefined as unknown as string }))
      .resolves.toMatchObject({ ok: false, code: 'malformed_reference' });
  });
});

describe('billingAmountResolver - no pricing surface remains', () => {
  test('module exports no registry/catalog/fallback/price table', () => {
    const exported = Object.keys(resolverModule);
    expect(exported).toContain('resolveBillingAmount');
    for (const name of exported) {
      expect(name.toLowerCase()).not.toMatch(/registry|catalog|fallback|prices|price_table/);
    }
  });

  test('a refusal carries no pricing data', async () => {
    const r = await resolveBillingAmount({ intentType: 'subscription', reference: 'plan_pro_monthly' });
    const serialized = JSON.stringify(r).toLowerCase();
    for (const f of ['amount', 'amount_minor', 'price', 'currency', 'internal_label']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
