/**
 * BILLING-ACTIVE-ORG-AUTHZ-SEC-001 — active_company_id is not a credential.
 *
 * All four billing routes took their organization from `principal.activeOrgId`,
 * which `IdentityResolver.fetchActiveCompanyId` reads verbatim out of
 * `users.active_company_id` — no membership join, no company-status check. That
 * proved WHO was calling and never that they may act for that organization.
 *
 * It was reachable, not theoretical: in production 24 of 33 pointers name a
 * company where the user's membership is `inactive`, and 21 of those users can
 * still authenticate. The DB trigger that would have prevented it
 * (20260510) is NOT APPLIED in production, so there was no backstop at either
 * write time or read time.
 *
 * checkout-session was the sharp end. Its idempotency key is a hash over
 * (organizationId, intentType, reference, provider), so an unauthorized caller
 * REPLAYS the victim organization's persisted checkout session — redirect_url
 * included — then resolves a real amount, dispatches to the payment provider
 * and inserts a billing_checkout_sessions row against them.
 *
 * The authorization chain here is REAL: requireTenantAccess / assertTenantAccess
 * -> TenantGuard -> membership + company-lifecycle queries. Only the identity
 * provider, the database and the billing services are faked, so a regression in
 * the guard fails these tests. Every case asserts BOTH the response AND whether
 * the billing sink was ever invoked — a 403 that already charged is not a fix.
 */

export {};

/* ── companies ────────────────────────────────────────────────────────────── */
const CO_A = 'co-a-0000-0000-0000-00000000000a';
const CO_B = 'co-b-0000-0000-0000-00000000000b';
const CO_DISABLED = 'co-dis-00-0000-0000-00000000000d';
const CO_MISSING = 'co-gone-0-0000-0000-00000000000g';

/* ── the §8 caller matrix ─────────────────────────────────────────────────── */
const USER_ACTIVE = 'u-active-0000-0000-00000000000a';   // active in A, pointer A
const USER_INACTIVE = 'u-inactv-0000-0000-00000000000b'; // inactive in A, pointer A
const USER_INVITED = 'u-invite-0000-0000-00000000000c';  // invited to A, pointer A
const USER_NOMEMBER = 'u-nomemb-0000-0000-00000000000d'; // no membership, pointer A
const USER_ELSEWHERE = 'u-elsewh-0000-0000-00000000000e';// active in B, stale pointer A
const USER_MULTI = 'u-multi--0000-0000-00000000000f';    // active in A AND B, pointer A
const USER_DISABLED_CO = 'u-disabl-0000-0000-00000000000h'; // active in a DISABLED company
const USER_MISSING_CO = 'u-missng-0000-0000-00000000000i';  // pointer at a nonexistent company

const COMPANIES = [
  { id: CO_A, status: 'active', deleted_at: null },
  { id: CO_B, status: 'active', deleted_at: null },
  { id: CO_DISABLED, status: 'inactive', deleted_at: null },
];

const ROLES = [
  { user_id: USER_ACTIVE, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: USER_INACTIVE, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: USER_INVITED, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'invited' },
  { user_id: USER_ELSEWHERE, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: USER_ELSEWHERE, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: USER_MULTI, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: USER_MULTI, company_id: CO_B, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: USER_DISABLED_CO, company_id: CO_DISABLED, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: USER_MISSING_CO, company_id: CO_MISSING, role: 'COMPANY_ADMIN', status: 'active' },
];

const POINTER: Record<string, string> = {
  [USER_ACTIVE]: CO_A,
  [USER_INACTIVE]: CO_A,
  [USER_INVITED]: CO_A,
  [USER_NOMEMBER]: CO_A,
  [USER_ELSEWHERE]: CO_A,
  [USER_MULTI]: CO_A,
  [USER_DISABLED_CO]: CO_DISABLED,
  [USER_MISSING_CO]: CO_MISSING,
};

/* ── observable state ─────────────────────────────────────────────────────── */
let calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
let currentUser: string | null = USER_ACTIVE;

function rowsFor(table: string): any[] {
  if (table === 'user_company_roles') return ROLES;
  if (table === 'companies') return COMPANIES;
  return [];
}

function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  const b: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'neq', 'is']) b[m] = () => b;
  b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
  const resolve = () => {
    calls.push({ table, filters: { ...filters } });
    return {
      data: rowsFor(table).filter((r) =>
        Object.entries(filters).every(([k, v]) => (r as any)[k] === v)),
      error: null,
    };
  };
  b.maybeSingle = async () => ({ data: resolve().data[0] ?? null, error: null });
  b.single = async () => ({ data: resolve().data[0] ?? null, error: null });
  b.then = (ok: any, err: any) => Promise.resolve(resolve()).then(ok, err);
  return b;
}

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => makeBuilder(t) }));

/** The identity provider is faked; TenantGuard above it runs for real. */
jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () => (
    currentUser
      ? {
          ok: true,
          principal: {
            userId: currentUser,
            supabaseUid: `sub-${currentUser}`,
            email: 'caller@example.com',
            activeOrgId: POINTER[currentUser] ?? null,
            organizations: [],
          },
        }
      : { ok: false, reason: 'no_session' }
  )),
}));

/* ── the billing sinks: observed, never executed ──────────────────────────── */
jest.mock('../../services/billing/payments/billingProfileCaptureService', () => ({
  normalizeBillingGeographyInput: jest.fn((b: any) => ({
    ok: true, value: { country: b?.billing_country ?? 'IN', currency: null, region: null },
  })),
  captureBillingProfileGeography: jest.fn(async ({ organizationId }: any) => ({
    ok: true, context: { country: 'IN', currency: 'INR', region: null, source: 'company_billing_profile', organizationId },
  })),
}));
jest.mock('../../services/billing/payments/orgBillingContextResolver', () => ({
  resolveOrgBillingContext: jest.fn(async (orgId: any) => (
    orgId ? { country: 'IN', currency: 'INR', region: null, source: 'billing_context' }
          : { country: null, currency: null, region: null, source: 'none' }
  )),
}));
jest.mock('../../services/billing/payments/checkoutSessionOrchestrator', () => ({
  orchestrateCheckoutSession: jest.fn(async () => ({
    ok: true, session: { provider: 'razorpay', redirect_url: 'https://pay.example/VICTIM' },
    idempotency_key: 'idem-1', replayed: false,
  })),
}));
jest.mock('../../services/billing/payments/paymentProviderPolicyResolver', () => ({
  resolveAvailableProviders: jest.fn(async () => ({
    source: 'compiled_default', available: [], visible: [], supported_methods: [], recommended: null,
  })),
}));

import profileHandler from '../../../pages/api/billing/profile';
import contextHandler from '../../../pages/api/billing/context';
import checkoutHandler from '../../../pages/api/billing/checkout-session';
import providersHandler from '../../../pages/api/billing/payment-providers/index';
import { captureBillingProfileGeography } from '../../services/billing/payments/billingProfileCaptureService';
import { orchestrateCheckoutSession } from '../../services/billing/payments/checkoutSessionOrchestrator';
import { resolveOrgBillingContext } from '../../services/billing/payments/orgBillingContextResolver';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  res.setHeader = () => res;
  return res;
}
const call = async (h: any, req: Record<string, unknown>) => {
  const res = mockRes();
  await h({ query: {}, headers: {}, body: {}, ...req } as any, res);
  return res;
};

const capture = () => captureBillingProfileGeography as jest.Mock;
const orchestrate = () => orchestrateCheckoutSession as jest.Mock;
const ctxResolver = () => resolveOrgBillingContext as jest.Mock;

beforeEach(() => {
  calls = [];
  currentUser = USER_ACTIVE;
  capture().mockClear(); orchestrate().mockClear(); ctxResolver().mockClear();
});

/* ════════════════════════════════════════════════════════════════════════════
 * The §8 matrix, applied to every route that operates on a tenant.
 * ════════════════════════════════════════════════════════════════════════════ */
const TENANT_ROUTES: Array<{ name: string; run: () => Promise<any>; sink: () => jest.Mock }> = [
  {
    name: 'billing/profile (PUT — upserts company_billing_profiles)',
    run: () => call(profileHandler, { method: 'PUT', body: { billing_country: 'IN' } }),
    sink: capture,
  },
  {
    name: 'billing/context (PUT — same canonical upsert)',
    run: () => call(contextHandler, { method: 'PUT', body: { billing_country: 'IN' } }),
    sink: capture,
  },
  {
    name: 'billing/context (GET — discloses org geography)',
    run: () => call(contextHandler, { method: 'GET' }),
    sink: ctxResolver,
  },
  {
    name: 'billing/checkout-session (POST — money adjacent)',
    run: () => call(checkoutHandler, {
      method: 'POST',
      body: { provider: 'razorpay', intent_type: 'topup', topup_reference: 'topup_small' },
    }),
    sink: orchestrate,
  },
];

for (const route of TENANT_ROUTES) {
  describe(route.name, () => {
    it('ALLOW — active member whose pointer matches', async () => {
      currentUser = USER_ACTIVE;
      const res = await route.run();
      expect(res.statusCode).toBe(200);
      expect(route.sink()).toHaveBeenCalled();
    });

    it('CRITICAL DENY — membership is inactive (the live production shape)', async () => {
      currentUser = USER_INACTIVE;
      const res = await route.run();
      expect(res.statusCode).toBe(403);
      expect(route.sink()).not.toHaveBeenCalled();
    });

    it('CRITICAL DENY — membership is only invited', async () => {
      currentUser = USER_INVITED;
      const res = await route.run();
      expect(res.statusCode).toBe(403);
      expect(route.sink()).not.toHaveBeenCalled();
    });

    it('CRITICAL DENY — no membership at all', async () => {
      currentUser = USER_NOMEMBER;
      const res = await route.run();
      expect(res.statusCode).toBe(403);
      expect(route.sink()).not.toHaveBeenCalled();
    });

    it('CRITICAL DENY — active in another company, stale pointer at this one', async () => {
      // The escalation shape. Production has none of these today, but nothing
      // prevents one: removing a membership never clears the pointer.
      currentUser = USER_ELSEWHERE;
      const res = await route.run();
      expect(res.statusCode).toBe(403);
      expect(route.sink()).not.toHaveBeenCalled();
    });

    it('CRITICAL DENY — the company itself is disabled', async () => {
      // The half no resolver change could have covered: the pointer is a valid
      // active membership, but the organization is suspended.
      currentUser = USER_DISABLED_CO;
      const res = await route.run();
      expect(res.statusCode).toBe(403);
      expect(route.sink()).not.toHaveBeenCalled();
    });

    it('DENY — the pointer names a company that does not exist', async () => {
      currentUser = USER_MISSING_CO;
      const res = await route.run();
      expect(res.statusCode).toBe(404);
      expect(route.sink()).not.toHaveBeenCalled();
    });

    it('401 — unauthenticated, and nothing is queried', async () => {
      currentUser = null;
      const res = await route.run();
      expect(res.statusCode).toBe(401);
      expect(route.sink()).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it('ALLOW — member of two companies, pointer at one of them', async () => {
      // §9: whichever company the pointer selects must be independently
      // authorized. It is A here, and the caller is genuinely active in A.
      currentUser = USER_MULTI;
      const res = await route.run();
      expect(res.statusCode).toBe(200);
      expect(route.sink()).toHaveBeenCalled();
    });

    it('CRITICAL the authorized company is what reaches the sink', async () => {
      currentUser = USER_ACTIVE;
      await route.run();
      const arg = route.sink().mock.calls[0][0];
      const org = typeof arg === 'string' ? arg : arg?.organizationId;
      expect(org).toBe(CO_A);
    });

    it('CRITICAL the membership was actually checked against the DB', async () => {
      // Guards against a stub that returns success without asking anything.
      currentUser = USER_ACTIVE;
      await route.run();
      expect(calls.some((c) => c.table === 'user_company_roles'
        && c.filters.company_id === CO_A && c.filters.user_id === USER_ACTIVE)).toBe(true);
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════════
 * §10 — no caller-supplied value may select the tenant.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('request-supplied tenant aliases are inert', () => {
  const ALIASES = {
    companyId: CO_B, company_id: CO_B, organizationId: CO_B,
    organization_id: CO_B, org_id: CO_B, orgId: CO_B, tenantId: CO_B,
    viewAs: CO_B, impersonate: CO_B,
  };

  it('CRITICAL profile: body aliases cannot redirect the upsert', async () => {
    currentUser = USER_ACTIVE;
    const res = await call(profileHandler, { method: 'PUT', body: { billing_country: 'IN', ...ALIASES } });
    expect(res.statusCode).toBe(200);
    expect(capture().mock.calls[0][0].organizationId).toBe(CO_A);
  });

  it('CRITICAL checkout-session: body aliases cannot redirect the order', async () => {
    currentUser = USER_ACTIVE;
    await call(checkoutHandler, {
      method: 'POST',
      body: { provider: 'razorpay', intent_type: 'topup', topup_reference: 'topup_small', ...ALIASES },
    });
    expect(orchestrate().mock.calls[0][0].organizationId).toBe(CO_A);
  });

  it('CRITICAL query aliases cannot redirect either', async () => {
    currentUser = USER_ACTIVE;
    await call(contextHandler, { method: 'GET', query: { ...ALIASES } });
    expect(ctxResolver().mock.calls[0][0]).toBe(CO_A);
  });

  it('CRITICAL a denied caller cannot rescue access with an alias', async () => {
    currentUser = USER_INACTIVE;
    const res = await call(profileHandler, { method: 'PUT', body: { billing_country: 'IN', ...ALIASES } });
    expect(res.statusCode).toBe(403);
    expect(capture()).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * payment-providers — deliberately different: the provider list is not org
 * data, so an unauthorized org degrades to "geography unknown" rather than 403.
 * What must NOT happen is reading that organization's billing context.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('billing/payment-providers', () => {
  it('an active member gets their organization geography', async () => {
    currentUser = USER_ACTIVE;
    const res = await call(providersHandler, { method: 'GET' });
    expect(res.statusCode).toBe(200);
    expect(ctxResolver()).toHaveBeenCalledWith(CO_A);
  });

  it('CRITICAL a stale pointer never reaches the billing-context read', async () => {
    currentUser = USER_INACTIVE;
    const res = await call(providersHandler, { method: 'GET' });
    expect(res.statusCode).toBe(200);          // still serves the provider list
    expect(ctxResolver()).toHaveBeenCalledWith(null); // but with NO organization
  });

  it('CRITICAL a disabled company never reaches the billing-context read', async () => {
    currentUser = USER_DISABLED_CO;
    await call(providersHandler, { method: 'GET' });
    expect(ctxResolver()).toHaveBeenCalledWith(null);
  });

  it('an unauthorized org degrades exactly like having no org at all', async () => {
    currentUser = USER_NOMEMBER;
    const denied = await call(providersHandler, { method: 'GET' });
    const deniedArg = ctxResolver().mock.calls[0][0];
    expect(denied.statusCode).toBe(200);
    expect(deniedArg).toBeNull();
  });

  it('401 — unauthenticated', async () => {
    currentUser = null;
    const res = await call(providersHandler, { method: 'GET' });
    expect(res.statusCode).toBe(401);
    expect(ctxResolver()).not.toHaveBeenCalled();
  });

  it('an explicit geography query still bypasses the org read entirely', async () => {
    // Pre-existing documented behaviour, preserved: ?country= skips the org
    // lookup, so there is nothing to authorize on that path.
    currentUser = USER_INACTIVE;
    const res = await call(providersHandler, { method: 'GET', query: { country: 'IN' } });
    expect(res.statusCode).toBe(200);
    expect(ctxResolver()).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * The pointer contract itself.
 * ════════════════════════════════════════════════════════════════════════════ */
describe('active_company_id is context, never a credential', () => {
  it('409 is still returned when there is no pointer at all', async () => {
    // Preserved product semantics: "you have not selected an organization".
    currentUser = USER_ACTIVE;
    (POINTER as any)[USER_ACTIVE] = null;
    const res = await call(profileHandler, { method: 'PUT', body: { billing_country: 'IN' } });
    (POINTER as any)[USER_ACTIVE] = CO_A;
    expect(res.statusCode).toBe(409);
    expect(capture()).not.toHaveBeenCalled();
  });

  it('CRITICAL no billing route trusts the pointer without a membership query', async () => {
    /*
     * Static pin across all four routes. If any of them goes back to using
     * activeOrgId directly for a sink, this fails even if a mocked guard would
     * have let the behavioural suites pass.
     */
    const fs = require('fs');
    const path = require('path');
    const repo = path.resolve(__dirname, '../../..');
    for (const rel of [
      'pages/api/billing/profile.ts',
      'pages/api/billing/context.ts',
      'pages/api/billing/checkout-session.ts',
      'pages/api/billing/payment-providers/index.ts',
    ]) {
      const src: string = fs.readFileSync(path.join(repo, rel), 'utf8');
      const code = src.split('\n')
        .filter((l: string) => { const t = l.trim(); return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')); })
        .join('\n');
      expect(code).toMatch(/requireTenantAccess|assertTenantAccess/);
    }
  });
});
