/**
 * GET /api/billing/payment-providers — endpoint tests.
 *
 * Covers: auth gate, provider filtering (disabled / maintenance / geography /
 * currency), server-side billing-context resolution when query params are
 * absent, conservative no-context fallback, backend-authoritative shape,
 * pricing-blindness.
 */

let __authOk = true;
/*
 * BILLING-ACTIVE-ORG-AUTHZ-SEC-001 — these routes now authorize the active
 * organization before touching tenant data. This suite characterizes BILLING
 * BEHAVIOUR, so the caller is stubbed as an authorized member; the
 * authorization boundary itself is proven separately in
 * billingActiveOrgAuthzSec001.test.ts against the real TenantGuard chain.
 */
jest.mock('../../security/TenantGuard', () => ({
  requireTenantAccess: jest.fn(async (_req: any, _res: any, organizationId: any) => (
    organizationId
      ? { userId: 'u1', supabaseUid: 'sub-1', organizationId, role: 'COMPANY_ADMIN', bypass: false }
      : null
  )),
  assertTenantAccess: jest.fn(async ({ organizationId }: any) => (
    organizationId
      ? { ok: true, access: { userId: 'u1', supabaseUid: 'sub-1', organizationId, role: 'COMPANY_ADMIN', bypass: false } }
      : { ok: false, reason: 'NO_ORG_ID' }
  )),
}));
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: async () =>
    __authOk
      ? { ok: true, principal: { userId: 'u1', activeOrgId: 'org-1', organizations: [] } }
      : { ok: false, reason: 'no_session' },
}));

// Table-aware mock:
//   payment_provider_config        → .select(cols) terminal
//   billing_context / *_profiles   → .select().eq().maybeSingle()
let __rows: any[] | null = null;
let __throw = false;
let __billingContextRow: any = null;
let __companyProfileRow: any = null;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'payment_provider_config') {
        return {
          select: () => __throw
            ? Promise.reject(new Error('relation "payment_provider_config" does not exist'))
            : Promise.resolve({ data: __rows, error: null }),
        };
      }
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () => {
        if (table === 'billing_context') return Promise.resolve({ data: __billingContextRow, error: null });
        if (table === 'company_billing_profiles') return Promise.resolve({ data: __companyProfileRow, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      return b;
    },
  },
}));

import handler from '../../../pages/api/billing/payment-providers/index';

function row(provider: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider, enabled: true, visible_in_checkout: true,
    subscriptions_enabled: false, topups_enabled: true,
    supported_countries: [], supported_currencies: [],
    supported_payment_methods: ['card'], priority: 100,
    maintenance_mode: false, sandbox_mode: true, ...over,
  };
}

function mockReqRes(method: string, query: Record<string, string> = {}) {
  const req: any = { method, query, headers: {} };
  const res: any = {
    _status: 0, _json: null, _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; },
    setHeader(k: string, v: string) { this._headers[k] = v; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  __authOk = true; __rows = null; __throw = false;
  __billingContextRow = null; __companyProfileRow = null;
});

describe('GET /api/billing/payment-providers — auth + method', () => {
  test('non-GET → 405', async () => {
    const { req, res } = mockReqRes('POST');
    await handler(req, res);
    expect(res._status).toBe(405);
  });
  test('unauthenticated → 401', async () => {
    __authOk = false;
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(401);
  });
});

describe('GET /api/billing/payment-providers — explicit query-param filtering', () => {
  test('disabled provider excluded', async () => {
    __rows = [row('razorpay', { enabled: true }), row('stripe', { enabled: false })];
    const { req, res } = mockReqRes('GET', { country: 'IN' });
    await handler(req, res);
    expect((res._json as any).available.map((p: any) => p.provider)).toEqual(['razorpay']);
  });

  test('maintenance-mode provider excluded', async () => {
    __rows = [row('razorpay'), row('stripe', { maintenance_mode: true })];
    const { req, res } = mockReqRes('GET', { country: 'IN' });
    await handler(req, res);
    expect((res._json as any).available.map((p: any) => p.provider)).toEqual(['razorpay']);
  });

  test('?country honored as explicit override', async () => {
    __rows = [row('razorpay', { supported_countries: ['IN'] })];
    {
      const { req, res } = mockReqRes('GET', { country: 'IN' });
      await handler(req, res);
      expect((res._json as any).available).toHaveLength(1);
    }
    {
      const { req, res } = mockReqRes('GET', { country: 'US' });
      await handler(req, res);
      expect((res._json as any).available).toHaveLength(0);
    }
  });

  test('?currency honored', async () => {
    __rows = [row('razorpay', { supported_currencies: ['INR'] })];
    const { req, res } = mockReqRes('GET', { currency: 'EUR' });
    await handler(req, res);
    expect((res._json as any).available).toHaveLength(0);
  });
});

describe('GET /api/billing/payment-providers — server-side billing-context resolution', () => {
  test('no query params → resolves billing_context; geography-matched provider included', async () => {
    __rows = [row('razorpay', { supported_countries: ['IN'] })];
    __billingContextRow = { billing_country: 'IN', billing_currency: 'INR', billing_region: null };
    const { req, res } = mockReqRes('GET'); // no params → server resolves
    await handler(req, res);
    expect((res._json as any).available.map((p: any) => p.provider)).toEqual(['razorpay']);
  });

  test('no query params + billing_context says US → IN-only provider EXCLUDED', async () => {
    __rows = [row('razorpay', { supported_countries: ['IN'] })];
    __billingContextRow = { billing_country: 'US', billing_currency: 'USD', billing_region: null };
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect((res._json as any).available).toHaveLength(0);
  });

  test('CONSERVATIVE fallback: no context anywhere → geography-restricted provider EXCLUDED', async () => {
    __rows = [
      row('razorpay', { supported_countries: ['IN'] }),  // restricted
      row('stripe',   { supported_countries: [] }),       // unrestricted
    ];
    __billingContextRow = null;
    __companyProfileRow = null;
    const { req, res } = mockReqRes('GET'); // no params, no context
    await handler(req, res);
    // razorpay (geography-restricted) is hidden; stripe (unrestricted) shows.
    expect((res._json as any).available.map((p: any) => p.provider)).toEqual(['stripe']);
  });

  test('falls back to company_billing_profiles when no lightweight context', async () => {
    __rows = [row('razorpay', { supported_countries: ['IN'] })];
    __billingContextRow = null;
    __companyProfileRow = { billing_address: { country: 'IN' }, currency_preference: 'INR' };
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect((res._json as any).available.map((p: any) => p.provider)).toEqual(['razorpay']);
  });
});

describe('GET /api/billing/payment-providers — shape + pricing-blindness', () => {
  test('returns available/visible/supported_methods/recommended placeholder', async () => {
    __rows = [row('razorpay', { supported_payment_methods: ['card', 'upi'] })];
    const { req, res } = mockReqRes('GET', { country: 'IN' });
    await handler(req, res);
    const body = res._json as any;
    expect(Array.isArray(body.available)).toBe(true);
    expect(Array.isArray(body.visible)).toBe(true);
    expect(body.supported_methods).toEqual(['card', 'upi']);
    expect(body.recommended).toBeNull();
  });

  test('response carries NO pricing fields', async () => {
    __rows = [row('razorpay'), row('stripe', { enabled: true })];
    const { req, res } = mockReqRes('GET', { country: 'IN' });
    await handler(req, res);
    const serialized = JSON.stringify(res._json).toLowerCase();
    for (const f of ['price', 'amount', 'unit_price', 'plan_price', 'pricing', 'cost', 'subtotal', 'total']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });

  test('provider-config table absent → compiled defaults (default-preserving)', async () => {
    __throw = true;
    const { req, res } = mockReqRes('GET', { country: 'IN' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect((res._json as any).source).toBe('compiled_default');
  });
});
