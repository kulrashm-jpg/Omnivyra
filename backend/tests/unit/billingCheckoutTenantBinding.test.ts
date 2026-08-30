/**
 * BILLING-CHECKOUT-SEC-001 — billing/checkout/{create-order,verify} and
 * billing/invoices/[id]/pdf.
 *
 * All three mount `withOrgAccess`, whose default resolver authorizes:
 *
 *     req.query.org_id  ||  body.org_id  ||  body.organization_id  ||  body.companyId
 *
 * QUERY FIRST. `invoices/[id]/pdf` reads `req.query.org_id`, so the wrapper
 * authorizes exactly the value the handler uses and the route is safe.
 *
 * `create-order` and `verify` read the BODY only:
 *
 *     String(body.org_id ?? body.organization_id ?? '')
 *
 * so a request carrying `?org_id=<own org>` with `{"org_id":"<victim>"}` is
 * authorized against the attacker's own org and then executed against the
 * victim's. That is the OPPORTUNITIES-SEC-001 query/body split, on routes that
 * insert purchase rows, call a payment provider, mutate payment state and
 * allocate credits.
 *
 * Neither downstream service re-establishes ownership independently:
 *   - fulfillProviderConfirmedPurchase(purchaseId) takes NO organization at all;
 *   - closePurchaseFromClient compares the row against the caller-supplied org.
 * The handler's own comparison is therefore the entire boundary.
 *
 * The real chain runs here — withOrgAccess -> assertOrgAccess ->
 * requireTenantAccess -> assertTenantAccess. Only the data layer, the principal
 * resolver, the payment sinks and pdfkit are mocked, and the assertions inspect
 * which organization actually reached each sink.
 */

// Module scope, not script scope: without this the file's top-level helpers
// (mockRes, call) collide with identically named globals in sibling test files
// and TypeScript resolves them to the wrong declaration.
export {};

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const STALE_B = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const ORG_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
const ORG_SUSPENDED = 'e0000000-0000-0000-0000-00000000000e';
const ORPHAN_ORG = 'f0000000-0000-0000-0000-00000000000f';

const PKG = 'aaaa1111-0000-0000-0000-00000000pkg1';
const OWN_PURCHASE = '11111111-0000-0000-0000-0000000000p1';
const VICTIM_PURCHASE = '22222222-0000-0000-0000-0000000000p2';
const OWN_INVOICE = '33333333-0000-0000-0000-0000000000i1';
const VICTIM_INVOICE = '44444444-0000-0000-0000-0000000000i2';

const ROLES = [
  { user_id: MEMBER_A, company_id: ORG_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: MEMBER_A, company_id: ORG_SUSPENDED, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: MEMBER_A, company_id: ORPHAN_ORG, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: STALE_B, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: SUPERADMIN, company_id: ORG_A, role: 'SUPER_ADMIN', status: 'active' },
];
const COMPANY_STATUS: Record<string, string | null> = {
  [ORG_A]: 'active',
  [VICTIM]: 'active',
  [ORG_SUSPENDED]: 'suspended',
  [ORPHAN_ORG]: null,
};

let authUser: string | null = MEMBER_A;
let superAdmins: string[] = [SUPERADMIN];

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
/**
 * Business writes only. `capability_audit_log` is the guard's OWN denial audit —
 * a denied request is SUPPOSED to write one, so counting it as a tenant sink
 * would make every deny-path assertion vacuously fail.
 */
const writes: Array<{ table: string; op: string; payload: any }> = [];
const AUDIT_TABLES = ['capability_audit_log'];
const recordWrite = (table: string, op: string, payload: any) => {
  if (!AUDIT_TABLES.includes(table)) writes.push({ table, op, payload });
};
const providerCalls: Array<{ fn: string; args: any }> = [];
const sinkCalls: Array<{ fn: string; args: any }> = [];
let pdfBytes = 0;

/** Anything that costs money, mutates payment state or leaves the system. */
const consequential = () => [
  ...writes.map(w => ({ kind: `write:${w.table}`, org: w.payload?.organization_id })),
  ...providerCalls.map(p => ({ kind: `provider:${p.fn}`, org: p.args?.organization_id })),
  ...sinkCalls.map(s => ({ kind: `sink:${s.fn}`, org: s.args?.organizationId })),
];

jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () =>
    authUser
      ? { ok: true, principal: { userId: authUser, supabaseUid: authUser, legacyCookieSuperAdmin: false } }
      : { ok: false, reason: 'NO_AUTH' }),
}));
jest.mock('../../services/rbacService', () => ({
  isPlatformSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
  isSuperAdmin: jest.fn(async (id: string) => superAdmins.includes(id)),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    let pending: { op: string; payload: any } | null = null;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.order = () => b; b.limit = () => b; b.range = () => b;
    b.insert = (p: any) => { pending = { op: 'insert', payload: p }; recordWrite(table, 'insert', p); return b; };
    b.update = (p: any) => { pending = { op: 'update', payload: p }; recordWrite(table, 'update', p); return b; };
    b.upsert = (p: any) => { pending = { op: 'upsert', payload: p }; recordWrite(table, 'upsert', p); return b; };
    b.delete = () => { recordWrite(table, 'delete', null); return b; };

    const rows = (): any[] => {
      if (pending?.op === 'insert') return [{ id: OWN_PURCHASE, ...pending.payload }];
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') {
        const st = COMPANY_STATUS[String(filters.id)];
        return st == null ? [] : [{ id: filters.id, status: st }];
      }
      if (table === 'credit_packages') {
        return [{ id: PKG, credits: 100, price: 999, sku: 'PK', canonical_usd_price: null, is_active: true }]
          .filter(r => filters.id === undefined || r.id === filters.id);
      }
      if (table === 'credit_purchases') {
        return [
          { id: OWN_PURCHASE, organization_id: ORG_A, status: 'pending', provider: 'razorpay', provider_order_id: 'ord_own' },
          { id: VICTIM_PURCHASE, organization_id: VICTIM, status: 'pending', provider: 'razorpay', provider_order_id: 'ord_victim' },
        ].filter(r => filters.id === undefined || r.id === filters.id);
      }
      if (table === 'invoices') {
        return [
          { id: OWN_INVOICE, organization_id: ORG_A, invoice_number: 'INV-OWN', currency: 'INR',
            subtotal_amount: 10, tax_amount: 1, total_amount: 11, status: 'paid', issued_at: null, metadata: {} },
          { id: VICTIM_INVOICE, organization_id: VICTIM, invoice_number: 'INV-VICTIM-SECRET', currency: 'INR',
            subtotal_amount: 999, tax_amount: 99, total_amount: 1098, status: 'paid', issued_at: null,
            metadata: { provider_reference: 'VICTIM_PROVIDER_REF' } },
        ].filter(r => filters.id === undefined || r.id === filters.id);
      }
      if (table === 'invoice_line_items') {
        return [{ description: 'VICTIM_LINE_ITEM', quantity: 1, unit_price: 999, subtotal: 999, currency: 'INR' }]
          .filter(() => filters.invoice_id !== undefined);
      }
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      const d = rows();
      return { data: d, count: d.length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../services/payments/orchestrator', () => ({
  createOrder: jest.fn(async (args: any) => {
    providerCalls.push({ fn: 'createOrder', args });
    return {
      provider: 'razorpay',
      order: { providerOrderId: 'ord_new', amountSubunits: 99900, clientToken: null },
      attempts: [{ provider: 'razorpay', ok: true }],
    };
  }),
  verifyPayment: jest.fn(async (provider: string, args: any) => {
    providerCalls.push({ fn: 'verifyPayment', args: { provider, ...args } });
    return { verified: false };
  }),
  getProviderCredentials: () => ({ keyId: 'key_test' }),
  getActiveMode: () => 'test',
}));

jest.mock('../../services/billing/purchaseClosureService', () => ({
  closePurchaseFromClient: jest.fn(async (args: any) => {
    sinkCalls.push({ fn: 'closePurchaseFromClient', args });
    return { purchaseId: args.purchaseId, action: 'closed' };
  }),
  fulfillProviderConfirmedPurchase: jest.fn(async (purchaseId: string) => {
    sinkCalls.push({ fn: 'fulfillProviderConfirmedPurchase', args: { purchaseId } });
    return { ok: true, creditsGranted: 100 };
  }),
}));
jest.mock('../../services/billing/topupInvoiceService', () => ({
  generateTopupInvoice: jest.fn(async (purchaseId: string) => {
    sinkCalls.push({ fn: 'generateTopupInvoice', args: { purchaseId } });
    return { invoiceNumber: 'INV-1' };
  }),
}));
jest.mock('../../services/pricingConfigService', () => ({ getFxConfig: jest.fn(async () => ({})) }));

jest.mock('pdfkit', () => {
  return class FakeDoc {
    y = 0;
    pipe() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    strokeColor() { return this; }
    moveDown() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    stroke() { return this; }
    text(t: any) { pdfBytes += String(t).length; return this; }
    end() { return this; }
  };
});

const createOrderRoute = require('../../../pages/api/billing/checkout/create-order').default;
const verifyRoute = require('../../../pages/api/billing/checkout/verify').default;
const pdfRoute = require('../../../pages/api/billing/invoices/[id]/pdf').default;

function mockRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {}, headersSent: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.end = () => res;
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  return res;
}

async function call(route: any, user: string | null, opts: { query?: any; body?: any; method?: string }) {
  authUser = user;
  queries.length = 0; writes.length = 0; providerCalls.length = 0; sinkCalls.length = 0; pdfBytes = 0;
  const res = mockRes();
  await route(
    { method: opts.method ?? 'POST', url: '/x', headers: {}, query: opts.query ?? {}, body: opts.body ?? {} } as never,
    res,
  );
  return res;
}

beforeEach(() => { authUser = MEMBER_A; superAdmins = [SUPERADMIN]; });

/* ────────────────────────────────────────────────────────────────────────────
 * THE DEFECT — the wrapper authorizes the query, the handler executes the body
 * ──────────────────────────────────────────────────────────────────────────── */
describe('BILLING-CHECKOUT-SEC-001 — query/body split on the money routes', () => {
  it('CRITICAL create-order: a body org cannot override the authorized query org', async () => {
    const res = await call(createOrderRoute, MEMBER_A, {
      query: { org_id: ORG_A },
      body: { org_id: VICTIM, package_id: PKG },
    });

    // Nothing may be written to, or ordered for, the victim.
    for (const c of consequential()) expect(c.org).not.toBe(VICTIM);
    const inserted = writes.find(w => w.table === 'credit_purchases' && w.op === 'insert');
    if (inserted) expect(inserted.payload.organization_id).toBe(ORG_A);
    const order = providerCalls.find(p => p.fn === 'createOrder');
    if (order) expect(order.args.organization_id).toBe(ORG_A);
    expect(res.statusCode).not.toBe(500);
  });

  it('CRITICAL verify: a body org cannot override the authorized query org', async () => {
    const res = await call(verifyRoute, MEMBER_A, {
      query: { org_id: ORG_A },
      body: { org_id: VICTIM, purchase_id: VICTIM_PURCHASE },
    });

    // The victim's purchase must not be verified, closed or fulfilled.
    expect(sinkCalls).toEqual([]);
    expect(providerCalls).toEqual([]);
    expect(writes).toEqual([]);
    expect(res.statusCode).toBe(404);
  });

  it('CRITICAL verify: the exploit chain (create then settle a foreign purchase) is closed', async () => {
    // Step 1 — attempt to mint a purchase attributed to the victim.
    await call(createOrderRoute, MEMBER_A, {
      query: { org_id: ORG_A },
      body: { org_id: VICTIM, package_id: PKG },
    });
    const minted = writes.find(w => w.table === 'credit_purchases' && w.op === 'insert');
    expect(minted?.payload.organization_id ?? ORG_A).toBe(ORG_A);

    // Step 2 — attempt to settle the victim's existing purchase.
    await call(verifyRoute, MEMBER_A, {
      query: { org_id: ORG_A },
      body: { org_id: VICTIM, purchase_id: VICTIM_PURCHASE },
    });
    expect(sinkCalls.map(s => s.fn)).not.toContain('fulfillProviderConfirmedPurchase');
    expect(sinkCalls.map(s => s.fn)).not.toContain('closePurchaseFromClient');
  });

  it('the real client contract (body-only, no query) still works end to end', async () => {
    // The fix must close the split WITHOUT breaking the shipped caller, which
    // sends org_id in the body and no query string at all. The resolver falls
    // through to body.org_id, authorizes it, and the handler binds to that same
    // authorized value — so behaviour is identical for a legitimate request.
    const created = await call(createOrderRoute, MEMBER_A, { body: { org_id: ORG_A, package_id: PKG } });
    expect(created.statusCode).toBe(201);
    const inserted = writes.find(w => w.table === 'credit_purchases' && w.op === 'insert');
    expect(inserted?.payload.organization_id).toBe(ORG_A);
    expect(providerCalls.find(p => p.fn === 'createOrder')?.args.organization_id).toBe(ORG_A);

    const verified = await call(verifyRoute, MEMBER_A, { body: { org_id: ORG_A, purchase_id: OWN_PURCHASE } });
    expect(verified.statusCode).not.toBe(404);
    expect(sinkCalls.length).toBeGreaterThan(0);
  });

  it('body-only organization_id (the documented alias) still works', async () => {
    const res = await call(createOrderRoute, MEMBER_A, { body: { organization_id: ORG_A, package_id: PKG } });
    expect(res.statusCode).toBe(201);
    expect(writes.find(w => w.table === 'credit_purchases')?.payload.organization_id).toBe(ORG_A);
  });

  it('snake_case and camelCase org aliases cannot redirect a sink either', async () => {
    for (const alias of ['organization_id', 'companyId', 'organizationId', 'orgId']) {
      const res = await call(createOrderRoute, MEMBER_A, {
        query: { org_id: ORG_A },
        body: { [alias]: VICTIM, package_id: PKG },
      });
      for (const c of consequential()) expect(c.org).not.toBe(VICTIM);
      expect(res.statusCode).not.toBe(500);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Tenant boundary — shared across all three routes
 * ──────────────────────────────────────────────────────────────────────────── */
describe.each([
  ['create-order', () => createOrderRoute, (org: string) => ({ body: { org_id: org, package_id: PKG }, method: 'POST' })],
  ['verify', () => verifyRoute, (org: string) => ({ body: { org_id: org, purchase_id: OWN_PURCHASE }, method: 'POST' })],
  ['invoices/[id]/pdf', () => pdfRoute, (org: string) => ({ query: { id: OWN_INVOICE, org_id: org }, method: 'GET' })],
])('%s — tenant boundary', (_name, route, req) => {
  it('an unauthenticated caller reaches no sink', async () => {
    const res = await call(route(), null, req(ORG_A));
    expect(res.statusCode).toBe(401);
    expect(consequential()).toEqual([]);
  });

  it('a foreign organization is refused and reaches no sink', async () => {
    const res = await call(route(), MEMBER_A, req(VICTIM));
    expect(res.statusCode).toBe(403);
    expect(consequential()).toEqual([]);
  });

  it('a stale (inactive) membership is refused', async () => {
    const res = await call(route(), STALE_B, req(VICTIM));
    expect([401, 403]).toContain(res.statusCode);
    expect(consequential()).toEqual([]);
  });

  it('a suspended organization is refused even with an active role', async () => {
    const res = await call(route(), MEMBER_A, req(ORG_SUSPENDED));
    expect([403, 404]).toContain(res.statusCode);
    expect(consequential()).toEqual([]);
  });

  it('an organization with no company row is unauthorizable', async () => {
    const res = await call(route(), MEMBER_A, req(ORPHAN_ORG));
    expect([403, 404]).toContain(res.statusCode);
    expect(consequential()).toEqual([]);
  });

  it('a missing org_id is rejected before any sink', async () => {
    const res = await call(route(), MEMBER_A, { ...req(ORG_A), body: {}, query: { id: OWN_INVOICE } });
    expect([400, 401, 403]).toContain(res.statusCode);
    expect(consequential()).toEqual([]);
  });

  it('a malformed org_id reaches no sink', async () => {
    const res = await call(route(), MEMBER_A, req("x' OR 1=1--"));
    expect(res.statusCode).not.toBe(200);
    expect(consequential()).toEqual([]);
  });

  it('the authorized organization is the one that reaches every sink', async () => {
    await call(route(), MEMBER_A, req(ORG_A));
    for (const c of consequential()) {
      if (c.org !== undefined) expect(c.org).toBe(ORG_A);
    }
  });

  it('a super admin keeps the platform bypass', async () => {
    const res = await call(route(), SUPERADMIN, req(VICTIM));
    expect([200, 201, 400, 404, 502]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(403);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Resource ownership — invoices/[id]/pdf
 * ──────────────────────────────────────────────────────────────────────────── */
describe('invoices/[id]/pdf — resource ownership', () => {
  it('CRITICAL a foreign invoice renders no PDF and leaks no financial data', async () => {
    const res = await call(pdfRoute, MEMBER_A, {
      query: { id: VICTIM_INVOICE, org_id: ORG_A }, method: 'GET',
    });
    expect(res.statusCode).toBe(404);
    expect(pdfBytes).toBe(0);
    expect(JSON.stringify(res.body ?? '')).not.toContain('VICTIM');
  });

  it('a foreign invoice is indistinguishable from a nonexistent one', async () => {
    const foreign = await call(pdfRoute, MEMBER_A, { query: { id: VICTIM_INVOICE, org_id: ORG_A }, method: 'GET' });
    const missing = await call(pdfRoute, MEMBER_A, { query: { id: OWN_INVOICE.replace(/1$/, '9'), org_id: ORG_A }, method: 'GET' });
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toEqual(missing.body);
  });

  it('the owning invoice renders', async () => {
    const res = await call(pdfRoute, MEMBER_A, { query: { id: OWN_INVOICE, org_id: ORG_A }, method: 'GET' });
    expect(res.statusCode).not.toBe(404);
    expect(pdfBytes).toBeGreaterThan(0);
  });

  it('line items are never fetched for an unauthorized invoice', async () => {
    await call(pdfRoute, MEMBER_A, { query: { id: VICTIM_INVOICE, org_id: ORG_A }, method: 'GET' });
    expect(queries.some(q => q.table === 'invoice_line_items')).toBe(false);
  });

  it('a non-GET verb reaches nothing', async () => {
    const res = await call(pdfRoute, MEMBER_A, { query: { id: OWN_INVOICE, org_id: ORG_A }, method: 'POST' });
    expect(res.statusCode).toBe(405);
    expect(pdfBytes).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Ordering — authorization precedes every consequential sink
 * ──────────────────────────────────────────────────────────────────────────── */
describe('ordering — authorization precedes the consequential sinks', () => {
  it('a denied create-order performs no insert and no provider call', async () => {
    await call(createOrderRoute, MEMBER_A, { body: { org_id: VICTIM, package_id: PKG } });
    expect(writes).toEqual([]);
    expect(providerCalls).toEqual([]);
  });

  it('a denied verify performs no provider call, closure or fulfillment', async () => {
    await call(verifyRoute, MEMBER_A, { body: { org_id: VICTIM, purchase_id: VICTIM_PURCHASE } });
    expect(providerCalls).toEqual([]);
    expect(sinkCalls).toEqual([]);
  });

  it('verify refuses a purchase belonging to another organization', async () => {
    const res = await call(verifyRoute, MEMBER_A, {
      query: { org_id: ORG_A }, body: { org_id: ORG_A, purchase_id: VICTIM_PURCHASE },
    });
    expect(res.statusCode).toBe(404);
    expect(sinkCalls).toEqual([]);
    expect(providerCalls).toEqual([]);
  });

  it('verify accepts its own purchase and settles only that one', async () => {
    await call(verifyRoute, MEMBER_A, {
      query: { org_id: ORG_A }, body: { org_id: ORG_A, purchase_id: OWN_PURCHASE },
    });
    for (const s of sinkCalls) {
      if (s.args.purchaseId) expect(s.args.purchaseId).toBe(OWN_PURCHASE);
      if (s.args.organizationId) expect(s.args.organizationId).toBe(ORG_A);
    }
  });

  it('create-order attributes the purchase and the provider order to one org', async () => {
    await call(createOrderRoute, MEMBER_A, { query: { org_id: ORG_A }, body: { org_id: ORG_A, package_id: PKG } });
    const inserted = writes.find(w => w.table === 'credit_purchases' && w.op === 'insert');
    expect(inserted?.payload.organization_id).toBe(ORG_A);
    const order = providerCalls.find(p => p.fn === 'createOrder');
    expect(order?.args.organization_id).toBe(ORG_A);
  });
});
