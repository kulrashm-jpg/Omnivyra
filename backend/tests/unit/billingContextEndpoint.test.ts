/**
 * /api/billing/context — endpoint tests AFTER write-path consolidation.
 *
 * Covers: GET read compatibility (UNCHANGED), PUT consolidated onto the
 * canonical company_billing_profiles path, canonical-write-path enforcement
 * (billing_context table is NEVER written), geography propagation,
 * incomplete-onboarding support, hidden-pricing preservation.
 */

let __authOk = true;
let __activeOrgId: string | null = 'org-1';
let __sessionEmail: string | null = 'user@example.com';
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
      ? { ok: true, principal: { userId: 'u1', activeOrgId: __activeOrgId, email: __sessionEmail, organizations: [] } }
      : { ok: false, reason: 'no_session' },
}));

// Table-aware mock. Tracks EVERY upsert so a test can prove the canonical
// path writes company_billing_profiles and NEVER billing_context.
let __profileRow: any = null;
let __billingContextRow: any = null;
let __upsertCalls: { table: string; payload: any }[] = [];

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
        if (table === 'company_billing_profiles') __profileRow = { ...(__profileRow ?? {}), ...payload };
        return Promise.resolve({ error: null });
      };
      return b;
    },
  },
}));

import handler from '../../../pages/api/billing/context';

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
  __profileRow = null; __billingContextRow = null; __upsertCalls = [];
});

describe('/api/billing/context — auth + method', () => {
  test('disallowed method → 405', async () => {
    const { req, res } = mockReqRes('DELETE');
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

describe('GET /api/billing/context — backward-compatible read', () => {
  test('resolves from company_billing_profiles', async () => {
    __profileRow = { billing_address: { country: 'IN' }, currency_preference: 'INR' };
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({
      organization_id: 'org-1', country: 'IN', currency: 'INR',
      source: 'company_billing_profile', geography_known: true,
    });
  });

  test('still resolves a pre-existing billing_context row (precedence preserved)', async () => {
    // Read path is UNCHANGED — a legacy billing_context row still wins tier #1.
    __billingContextRow = { billing_country: 'SG', billing_currency: 'SGD', billing_region: null };
    __profileRow = { billing_address: { country: 'IN' }, currency_preference: 'INR' };
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect((res._json as any).country).toBe('SG');
    expect((res._json as any).source).toBe('billing_context');
  });

  test('no context anywhere → geography_known=false', async () => {
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect((res._json as any).source).toBe('none');
    expect((res._json as any).geography_known).toBe(false);
  });
});

describe('PUT /api/billing/context — CANONICAL write-path enforcement', () => {
  test('PUT writes company_billing_profiles — and NEVER billing_context', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', billing_currency: 'INR' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__upsertCalls.length).toBeGreaterThan(0);
    // EVERY upsert targets the canonical table; none target billing_context.
    expect(__upsertCalls.every((c) => c.table === 'company_billing_profiles')).toBe(true);
    expect(__upsertCalls.some((c) => c.table === 'billing_context')).toBe(false);
  });

  test('accepts the legacy billing_currency field name (backward compatible)', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', billing_currency: 'INR' });
    await handler(req, res);
    expect(__upsertCalls[0].payload.currency_preference).toBe('INR');
  });

  test('accepts preferred_currency too (canonical field name)', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', preferred_currency: 'INR' });
    await handler(req, res);
    expect(__upsertCalls[0].payload.currency_preference).toBe('INR');
  });

  test('partial + additive: merges into existing billing_address', async () => {
    __profileRow = { billing_email: 'e@co.com', billing_address: { line1: '5 St', city: 'BLR' } };
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    expect(__upsertCalls[0].payload.billing_address).toEqual({ line1: '5 St', city: 'BLR', country: 'IN' });
  });

  test('idempotent: same body twice → same persisted address', async () => {
    const r1 = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(r1.req, r1.res);
    const r2 = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(r2.req, r2.res);
    expect(__upsertCalls[0].payload.billing_address).toEqual(__upsertCalls[1].payload.billing_address);
  });

  test('incomplete onboarding: no prior profile → partial row with session email', async () => {
    __profileRow = null;
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(__upsertCalls[0].payload.billing_email).toBe('user@example.com');
  });

  test('validation: invalid country → 400', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'India' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('invalid_billing_country');
  });

  test('validation: empty body → 400', async () => {
    const { req, res } = mockReqRes('PUT', {});
    await handler(req, res);
    expect(res._status).toBe(400);
    expect((res._json as any).error).toBe('no_billing_fields');
  });
});

describe('PUT /api/billing/context — geography propagation', () => {
  test('captured geography is reflected in the response (resolved from canonical table)', async () => {
    const { req, res } = mockReqRes('PUT', { billing_country: 'IN', preferred_currency: 'INR' });
    await handler(req, res);
    expect(res._json).toMatchObject({
      captured: true, country: 'IN', currency: 'INR',
      source: 'company_billing_profile', geography_known: true,
    });
  });
});

describe('/api/billing/context — hidden-pricing preservation', () => {
  test('GET + PUT responses carry no pricing fields', async () => {
    __profileRow = { billing_address: { country: 'IN' }, currency_preference: 'INR' };
    const g = mockReqRes('GET');
    await handler(g.req, g.res);
    const p = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(p.req, p.res);
    for (const resp of [g.res._json, p.res._json]) {
      const serialized = JSON.stringify(resp).toLowerCase();
      for (const f of ['price', 'amount', 'plan', 'pricing', 'cost', 'total', 'subtotal']) {
        expect(serialized).not.toContain(`"${f}"`);
      }
    }
  });
});

describe('consolidation — no resolver ambiguity', () => {
  test('PUT /api/billing/context and the canonical path write the SAME table', async () => {
    // Two captures via /api/billing/context must both land in
    // company_billing_profiles — there is no second write authority.
    const r1 = mockReqRes('PUT', { billing_country: 'IN' });
    await handler(r1.req, r1.res);
    const r2 = mockReqRes('PUT', { billing_currency: 'INR' });
    await handler(r2.req, r2.res);
    const tables = new Set(__upsertCalls.map((c) => c.table));
    expect([...tables]).toEqual(['company_billing_profiles']); // exactly one target
  });
});
