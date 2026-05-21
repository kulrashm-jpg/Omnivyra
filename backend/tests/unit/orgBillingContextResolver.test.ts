/**
 * Organization billing-context resolver — geography resolution tests.
 *
 * Covers: lightweight billing_context precedence, full-profile fallback,
 * country/currency/region propagation, no-context fallback, never-throws,
 * hidden-pricing preservation.
 */

// Table-aware supabase mock: the resolver reads billing_context FIRST, then
// company_billing_profiles. Each `.from(table)` returns a builder whose
// .select().eq().maybeSingle() resolves the row registered for that table.
let __billingContextRow: any = null;
let __companyProfileRow: any = null;
let __throwOnTable: string | null = null;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () => {
        if (__throwOnTable === table) {
          return Promise.reject(new Error(`relation "${table}" does not exist`));
        }
        if (table === 'billing_context') return Promise.resolve({ data: __billingContextRow, error: null });
        if (table === 'company_billing_profiles') return Promise.resolve({ data: __companyProfileRow, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      return builder;
    },
  },
}));

import { resolveOrgBillingContext } from '../../services/billing/payments/orgBillingContextResolver';

function reset() { __billingContextRow = null; __companyProfileRow = null; __throwOnTable = null; }
beforeEach(reset);

describe('orgBillingContextResolver — never-throws fallback', () => {
  test('null organizationId → source=none, null fields', async () => {
    await expect(resolveOrgBillingContext(null))
      .resolves.toEqual({ country: null, currency: null, region: null, source: 'none' });
  });

  test('billing_context table absent → falls through to company profile', async () => {
    __throwOnTable = 'billing_context';
    __companyProfileRow = { billing_address: { country: 'US' }, currency_preference: 'USD' };
    // The throw happens inside readLightweightContext; resolveOrgBillingContext
    // wraps the whole chain so a throw → EMPTY (never-throws contract).
    await expect(resolveOrgBillingContext('org-1'))
      .resolves.toEqual({ country: null, currency: null, region: null, source: 'none' });
  });

  test('no rows in either table → source=none', async () => {
    await expect(resolveOrgBillingContext('org-1'))
      .resolves.toEqual({ country: null, currency: null, region: null, source: 'none' });
  });
});

describe('orgBillingContextResolver — lightweight billing_context (precedence #1)', () => {
  test('resolves country/currency/region from billing_context', async () => {
    __billingContextRow = { billing_country: 'IN', billing_currency: 'INR', billing_region: 'Karnataka' };
    const ctx = await resolveOrgBillingContext('org-1');
    expect(ctx).toEqual({ country: 'IN', currency: 'INR', region: 'Karnataka', source: 'billing_context' });
  });

  test('billing_context WINS over company_billing_profiles when both exist', async () => {
    __billingContextRow = { billing_country: 'IN', billing_currency: 'INR', billing_region: null };
    __companyProfileRow = { billing_address: { country: 'US' }, currency_preference: 'USD' };
    const ctx = await resolveOrgBillingContext('org-1');
    expect(ctx.country).toBe('IN');
    expect(ctx.source).toBe('billing_context');
  });

  test('lightweight context works WITHOUT a full company profile (incomplete onboarding)', async () => {
    __billingContextRow = { billing_country: 'IN', billing_currency: 'INR', billing_region: null };
    __companyProfileRow = null; // no full profile at all
    const ctx = await resolveOrgBillingContext('org-1');
    expect(ctx.country).toBe('IN');
    expect(ctx.currency).toBe('INR');
    expect(ctx.source).toBe('billing_context');
  });

  test('lowercase + malformed values normalized', async () => {
    __billingContextRow = { billing_country: 'in', billing_currency: 'inr', billing_region: '  Goa  ' };
    const ctx = await resolveOrgBillingContext('org-1');
    expect(ctx).toEqual({ country: 'IN', currency: 'INR', region: 'Goa', source: 'billing_context' });
  });

  test('billing_context row with all-null usable fields → falls through to company profile', async () => {
    __billingContextRow = { billing_country: 'XX!', billing_currency: '$$$', billing_region: '' };
    __companyProfileRow = { billing_address: { country: 'US' }, currency_preference: 'USD' };
    const ctx = await resolveOrgBillingContext('org-1');
    expect(ctx.country).toBe('US');
    expect(ctx.source).toBe('company_billing_profile');
  });
});

describe('orgBillingContextResolver — company_billing_profiles (precedence #2)', () => {
  test('falls back to company profile when no lightweight context', async () => {
    __billingContextRow = null;
    __companyProfileRow = { billing_address: { country: 'US', state: 'CA' }, currency_preference: 'USD' };
    const ctx = await resolveOrgBillingContext('org-1');
    expect(ctx).toEqual({ country: 'US', currency: 'USD', region: 'CA', source: 'company_billing_profile' });
  });

  test('country_code alias accepted from billing_address', async () => {
    __companyProfileRow = { billing_address: { country_code: 'gb' }, currency_preference: 'GBP' };
    const ctx = await resolveOrgBillingContext('org-1');
    expect(ctx.country).toBe('GB');
  });
});

describe('orgBillingContextResolver — hidden-pricing preservation', () => {
  test('resolved context carries ONLY geography + source — no pricing fields', async () => {
    __billingContextRow = { billing_country: 'IN', billing_currency: 'INR', billing_region: null };
    const ctx = await resolveOrgBillingContext('org-1');
    expect(Object.keys(ctx).sort()).toEqual(['country', 'currency', 'region', 'source']);
    for (const f of ['price', 'amount', 'plan_price', 'pricing', 'cost', 'total', 'subtotal']) {
      expect(ctx).not.toHaveProperty(f);
    }
  });
});
