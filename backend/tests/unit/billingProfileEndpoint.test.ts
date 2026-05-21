/**
 * PUT /api/billing/profile — lightweight billing-profile capture tests.
 *
 * Covers: partial persistence (geography only), additive merge preserving
 * existing profile data, repeated-update idempotency, incomplete-onboarding
 * support (no prior profile), billing_email handling, validation, geography
 * propagation into the resolver, hidden-pricing preservation.
 */

let __authOk = true;
let __activeOrgId: string | null = 'org-1';
let __sessionEmail: string | null = 'user@example.com';
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: async () =>
    __authOk
      ? { ok: true, principal: { userId: 'u1', activeOrgId: __activeOrgId, email: __sessionEmail, organizations: [] } }
      : { ok: false, reason: 'no_session' },
}));

// Table-aware mock with a tiny in-memory store for company_billing_profiles
// so an upsert is visible to the subsequent resolver read.
let __profileRow: any = null;
let __billingContextRow: any = null;
let __upsertCalls: any[] = [];
let __upsertError: any = null;

jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () => {
        if (table === 'billing_context') return Promise.resolve({ data: __billingContextRow, error: null });
        if (table === 'company_billing_profiles') return Promise.resolve({ data: __profileRow, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      b.upsert = (payload: any) => {
        __upsertCalls.push({ table, payload });
        if (__upsertError) return Promise.resolve({ error: __upsertError });
        if (table === 'company_billing_profiles') {
          // Simulate INSERT-or-UPDATE: payload columns overwrite, others kept.
          __profileRow = { ...(__profileRow ?? {}), ...payload };
        }
        return Promise.resolve({ error: null });
      };
      return b;
    },
  },
}));

import handler from '../../../pages/api/billing/profile';

function mockReqRes(method: string, body?: unknown) {
  const req: any = { method, query: {}, headers: {}, body };
  const res: any = {
    _status: 0, _json: null, _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(b: unknown) { this._json = b; return this; },
    setHeader(k: string, v: string) { this._headers[k] = v; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  __authOk = true; __activeOrgId = 'org-1'; __sessionEmail = 'user@example.com';
  __profileRow = null; __billingContextRow = null; __upsertCalls = []; __upsertError = null;
});

describe('PUT /api/billing/profile — auth + method', () => {
  test('non-PUT → 405', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(405);
  });
  test('unauthenticated → 401', async () => {
    __authOk = false;
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    expect(res._status).toBe(401);
  });
  test('no active organization → 409', async () => {
    __activeOrgId = null;
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    expect(res._status).toBe(409);
  });
});

describe('PUT /api/billing/profile — partial persistence', () => {
  test('writes ONLY geography + email — no name/tax/business columns', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', preferred_currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__upsertCalls).toHaveLength(1);
    const payload = __upsertCalls[0].payload;
    expect(__upsertCalls[0].table).toBe('company_billing_profiles');
    expect(payload.billing_address).toEqual({ country: 'IN' });
    expect(payload.currency_preference).toBe('INR');
    expect(payload.billing_email).toBe('user@example.com');
    // No full-onboarding columns written.
    for (const c of ['billing_name', 'tax_id', 'tax_id_type', 'is_business', 'default_payment_provider']) {
      expect(payload).not.toHaveProperty(c);
    }
  });

  test('merge preserves existing billing_address keys (additive)', async () => {
    __profileRow = {
      billing_email: 'existing@co.com',
      billing_address: { line1: '5 MG Road', city: 'Bengaluru' },
      currency_preference: 'USD',
    };
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', billing_region: 'Karnataka' });
    await handler(req, res);
    const payload = __upsertCalls[0].payload;
    // Existing line1/city preserved; country/region merged in.
    expect(payload.billing_address).toEqual({
      line1: '5 MG Road', city: 'Bengaluru', country: 'IN', region: 'Karnataka',
    });
  });

  test('existing billing_email is preserved (not overwritten with session email)', async () => {
    __profileRow = { billing_email: 'existing@co.com', billing_address: {} };
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    expect(__upsertCalls[0].payload.billing_email).toBe('existing@co.com');
  });

  test('currency_preference omitted from payload when not supplied (keeps existing/default)', async () => {
    __profileRow = { billing_email: 'e@co.com', billing_address: {}, currency_preference: 'EUR' };
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    expect(__upsertCalls[0].payload).not.toHaveProperty('currency_preference');
  });
});

describe('PUT /api/billing/profile — incomplete onboarding', () => {
  test('no prior profile → creates partial row with billing_email from session', async () => {
    __profileRow = null; // org never completed onboarding / has no profile
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', preferred_currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__upsertCalls[0].payload.billing_email).toBe('user@example.com');
    expect((res._json as any).geography_known).toBe(true);
  });

  test('no prior profile AND no session email → 409 billing_email_unavailable', async () => {
    __profileRow = null;
    __sessionEmail = null;
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    expect(res._status).toBe(409);
    expect((res._json as any).error).toBe('billing_email_unavailable');
  });
});

describe('PUT /api/billing/profile — repeated-update idempotency', () => {
  test('same body twice → same resulting address, no error', async () => {
    const body = { billing_country: 'IN', preferred_currency: 'INR' };
    const r1 = mockReqRes('PUT', body);
    await handler(r1.req, r1.res);
    const r2 = mockReqRes('PUT', { ...body });
    await handler(r2.req, r2.res);
    expect(r1.res._status).toBe(200);
    expect(r2.res._status).toBe(200);
    // Both upserts produced the same geography; the stored row converged.
    expect(__upsertCalls[0].payload.billing_address).toEqual(__upsertCalls[1].payload.billing_address);
    expect(__upsertCalls[1].payload.billing_address).toEqual({ country: 'IN' });
  });
});

describe('PUT /api/billing/profile — validation', () => {
  test('rejects invalid country', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'India' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_billing_country');
  });
  test('rejects invalid currency', async () => {
    const { req, res } = mockReqRes('PUT', { preferred_currency: 'Rupees' });
    await handler(req, res);
    expect(res._status).toBe(400);
    // Consolidated canonical service uses one generic currency error code.
    expect((res._json as any).error).toBe('invalid_billing_currency');
  });
  test('rejects empty body', async () => {
    const { req, res } = mockReqRes('PUT', {});
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('no_billing_fields');
  });
  test('normalizes lowercase country/currency', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'in', preferred_currency: 'inr' });
    await handler(req, res);
    expect(__upsertCalls[0].payload.billing_address.country).toBe('IN');
    expect(__upsertCalls[0].payload.currency_preference).toBe('INR');
  });
});

describe('PUT /api/billing/profile — geography propagation + pricing-blindness', () => {
  test('captured geography propagates into the resolved context', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', preferred_currency: 'INR' });
    await handler(req, res);
    // The endpoint re-resolves after capture; the mock applied the upsert to
    // the stored row, so resolveOrgBillingContext sees it.
    expect(res._json).toMatchObject({
      captured: true, country: 'IN', currency: 'INR',
      source: 'company_billing_profile', geography_known: true,
    });
  });

  test('response carries NO pricing fields', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    const serialized = JSON.stringify(res._json).toLowerCase();
    for (const f of ['price', 'amount', 'plan', 'pricing', 'cost', 'total', 'subtotal']) {
      expect(serialized).not.toContain(`"${f}"`);
    }
  });
});
