/**
 * COMPANY-BILLING-BATCH-SEC-001 — company/billing/{ledger,summary}.
 *
 * Both routes are SAFE. This suite is characterization: they expose the most
 * sensitive read surface left uncertified (credit balances, transaction
 * amounts, invoice projections, contract terms) and had no regression coverage.
 *
 * Why they are safe:
 *
 *   companyId comes from the QUERY ONLY — there is no body, so the query/body
 *   split that produced OPPORTUNITIES-SEC-001 and RECOMMENDATIONS-SEC-001 is
 *   structurally impossible here.
 *
 *   assertOrgAccess -> requireTenantAccess -> assertTenantAccess is the
 *   canonical TenantGuard path: it proves an ACTIVE membership, rejects
 *   soft-deleted/suspended orgs (ORG_NOT_FOUND / ORG_INACTIVE), rejects legacy
 *   bridge principals, and keeps the platform-super-admin bypass. It runs
 *   BEFORE every financial sink and writes its own 401/403/404.
 *
 *   Every sink then receives that same validated companyId — the ledger's
 *   `.eq('organization_id', …)`, and all nine of summary's services and views.
 *
 * Pattern F (organization_id vs company_id) is not assumed from naming: the
 * guard validates the value against `companies.id` and `user_company_roles
 * .company_id`, and the financial tables filter on that same value, so an id
 * with no company row is unauthorizable and its rows unreachable.
 *
 * The real guard chain runs here — only the data layer, the principal resolver
 * and the billing services are mocked — and the assertions inspect which
 * organization actually reached each financial sink.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const STALE_B = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';
/** A suspended org: the caller has an ACTIVE role, but the org itself is not. */
const COMPANY_SUSPENDED = 'e0000000-0000-0000-0000-00000000000e';
/** An id with no companies row — the shape of the 4 orphan orgs in production. */
const ORPHAN_ORG = 'f0000000-0000-0000-0000-00000000000f';

const ROLES = [
  { user_id: MEMBER_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: MEMBER_A, company_id: COMPANY_SUSPENDED, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: MEMBER_A, company_id: ORPHAN_ORG, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: STALE_B, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
];
const COMPANY_STATUS: Record<string, string | null> = {
  [COMPANY_A]: 'active',
  [VICTIM]: 'active',
  [COMPANY_SUSPENDED]: 'suspended',
  [ORPHAN_ORG]: null,           // no companies row at all
};

let authUser: string | null = MEMBER_A;
let superAdmins: string[] = [SUPERADMIN];

const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
const writes: Array<{ table: string; payload: unknown }> = [];
/** Every financial service call, with the organization it received. */
const financialSinks: Array<{ name: string; org: unknown }> = [];

/** Financial tables/views touched, excluding the guard's own lookups. */
const financialQueries = () =>
  queries.filter(q => !['user_company_roles', 'companies'].includes(q.table));

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
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c + '__in'] = v; return b; };
    b.gte = (c: string, v: unknown) => { filters[c + '__gte'] = v; return b; };
    b.lte = (c: string, v: unknown) => { filters[c + '__lte'] = v; return b; };
    b.order = () => b; b.limit = () => b; b.range = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.upsert = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.delete = () => { writes.push({ table, payload: 'delete' }); return b; };
    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status));
      }
      if (table === 'companies') {
        const st = COMPANY_STATUS[String(filters.id)];
        return st === null || st === undefined ? [] : [{ id: filters.id, status: st }];
      }
      if (table === 'credit_transactions') {
        // Financial rows exist for BOTH tenants; the victim's are the canary.
        return [
          { id: 'tx-a', organization_id: COMPANY_A, credits_delta: -5, balance_after: 95,
            usd_equivalent: 0.5, reference_type: 'own_module', execution_phase: 'confirm',
            note: 'own note', created_at: '2026-01-01' },
          { id: 'tx-v', organization_id: VICTIM, credits_delta: -999, balance_after: 12345,
            usd_equivalent: 99.9, reference_type: 'VICTIM_MODULE', execution_phase: 'confirm',
            note: 'VICTIM_SECRET_NOTE', created_at: '2026-01-01' },
        ].filter(r => filters.organization_id === undefined || r.organization_id === filters.organization_id);
      }
      if (table === 'v_reservation_health') {
        return [{ organization_id: filters.organization_id, open_holds: 1, total_reserved: 10, holds_older_24h: 0 }]
          .filter(r => filters.organization_id === undefined || r.organization_id === filters.organization_id);
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
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

/* the nine financial services summary composes */
const fin = (name: string, ret: any = {}) => jest.fn(async (a: any) => {
  financialSinks.push({ name, org: typeof a === 'string' ? a : a?.organizationId ?? a?.orgId });
  return ret;
});
jest.mock('../../services/billing/payments/billingWalletService', () => ({ getBillingWalletSnapshot: fin('wallet', { balance: 0 }) }));
jest.mock('../../services/billing/contracts/usageForecastingService', () => ({ forecastUsage: fin('forecast') }));
jest.mock('../../services/billing/contracts/invoiceProjectionEngine', () => ({ projectInvoice: fin('invoiceProjection') }));
jest.mock('../../services/billing/contracts/enterpriseContractResolver', () => ({ resolveActiveContract: fin('contract', null) }));
jest.mock('../../services/billing/payments/subscriptionProjectionService', () => ({ projectOrgSubscriptions: fin('subscriptions', []) }));
jest.mock('../../services/billing/billingFeatureFlags', () => ({ evaluateAllBillingFlags: fin('flags', {}) }));
jest.mock('../../services/billing/orgFinancialControlService', () => ({
  checkFinancialControls: fin('financialControls', { allowed: true, emergencyFreeze: false, billingLock: false }),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import ledgerHandler from '../../../pages/api/company/billing/ledger';
import summaryHandler from '../../../pages/api/company/billing/summary';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(h: any, as: string | null, query: Record<string, unknown>, method = 'GET') {
  authUser = as;
  const res = mockRes();
  await h({ method, url: '/api/company/billing/x', query, body: {}, headers: {} } as never, res);
  return res;
}

/** No victim financial data was read, returned, or handed to a sink. */
function noVictimFinancialLeak(body?: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain('VICTIM_SECRET_NOTE');
  expect(blob).not.toContain('VICTIM_MODULE');
  expect(blob).not.toContain('12345');   // the victim's balance
  expect(blob).not.toContain(VICTIM);
  expect(financialSinks.filter(s => s.org === VICTIM)).toEqual([]);
  expect(financialQueries().filter(q => q.filters.organization_id === VICTIM)).toEqual([]);
}

beforeEach(() => {
  authUser = MEMBER_A;
  superAdmins = [SUPERADMIN];
  queries.length = 0; writes.length = 0; financialSinks.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

const ROUTES: Array<[string, () => any]> = [
  ['company/billing/ledger', () => ledgerHandler],
  ['company/billing/summary', () => summaryHandler],
];

/* ── shared contract across both routes ───────────────────────────────── */

describe.each(ROUTES)('%s', (_name, getHandler) => {
  it('unauthenticated → 401 and no financial data is touched', async () => {
    const res = await call(getHandler(), null, { companyId: VICTIM });
    expect(res.statusCode).toBe(401);
    expect(financialQueries()).toEqual([]);
    expect(financialSinks).toEqual([]);
    noVictimFinancialLeak(res.body);
  });

  it('CRITICAL: a foreign company is refused and no financial row is read', async () => {
    const res = await call(getHandler(), MEMBER_A, { companyId: VICTIM });
    expect([403, 404]).toContain(res.statusCode);
    expect(financialQueries()).toEqual([]);
    expect(financialSinks).toEqual([]);
    noVictimFinancialLeak(res.body);
  });

  it('a legitimate member reads their OWN organization', async () => {
    const res = await call(getHandler(), MEMBER_A, { companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(res.body.organizationId).toBe(COMPANY_A);
  });

  it('CRITICAL: every financial predicate/sink carries the AUTHORIZED organization', async () => {
    await call(getHandler(), MEMBER_A, { companyId: COMPANY_A });
    for (const q of financialQueries()) expect(q.filters.organization_id).toBe(COMPANY_A);
    for (const s of financialSinks) expect(s.org).toBe(COMPANY_A);
  });

  it('a stale (inactive) membership is refused', async () => {
    const res = await call(getHandler(), STALE_B, { companyId: VICTIM });
    expect([403, 404]).toContain(res.statusCode);
    expect(financialQueries()).toEqual([]);
    noVictimFinancialLeak(res.body);
  });

  it('a SUSPENDED organization is refused even for an active member', async () => {
    // TenantGuard answers ORG_INACTIVE; a bare membership lookup would not.
    const res = await call(getHandler(), MEMBER_A, { companyId: COMPANY_SUSPENDED });
    expect([403, 404]).toContain(res.statusCode);
    expect(financialQueries()).toEqual([]);
  });

  it('CRITICAL: an org id with no company row is unauthorizable (the orphan shape)', async () => {
    // Production holds 4 credit_transactions.organization_id values with no
    // companies row. TenantGuard answers ORG_NOT_FOUND, so their rows cannot be
    // reached through these routes even by a user holding a role on that id.
    const res = await call(getHandler(), MEMBER_A, { companyId: ORPHAN_ORG });
    expect([403, 404]).toContain(res.statusCode);
    expect(financialQueries()).toEqual([]);
  });

  it('a super admin keeps the platform bypass', async () => {
    const res = await call(getHandler(), SUPERADMIN, { companyId: VICTIM });
    expect(res.statusCode).toBe(200);
    expect(res.body.organizationId).toBe(VICTIM);
  });

  it('a missing companyId is rejected, and the GUARD would refuse it anyway', async () => {
    // The route's own 400 is convenience, not the boundary. Deleting it is an
    // EQUIVALENT mutation, not an undetected one: assertTenantAccess answers
    // NO_ORG_ID for an empty organization before touching anything, and
    // TenantGuard maps NO_ORG_ID to 400 itself (TenantGuard.ts statusFor), so
    // the observable outcome — 400 with zero queries — is unchanged. Both the
    // route's contract and the guard's independent refusal are pinned, so the
    // suite depends on the real protection rather than the convenience check.
    const res = await call(getHandler(), MEMBER_A, {});
    expect(res.statusCode).toBe(400);
    expect(queries).toEqual([]);

    const { assertTenantAccess } = require('../../security/TenantGuard');
    const verdict = await assertTenantAccess({ userId: MEMBER_A, organizationId: '' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('NO_ORG_ID');
  });

  it('a malformed companyId cannot reach financial data', async () => {
    const res = await call(getHandler(), MEMBER_A, { companyId: "x' OR 1=1--" });
    expect(res.statusCode).not.toBe(200);
    expect(financialQueries()).toEqual([]);
  });

  it('CRITICAL: a body company cannot override the query company', async () => {
    // Both routes read the QUERY only. There is no body-derived company, so the
    // split that broke opportunities/recommendations cannot occur here.
    authUser = MEMBER_A;
    const res = mockRes();
    await getHandler()({ method: 'GET', url: '/x',
      query: { companyId: COMPANY_A }, body: { companyId: VICTIM }, headers: {} } as never, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.organizationId).toBe(COMPANY_A);
    noVictimFinancialLeak(res.body);
  });

  it('CRITICAL: no alternative request field can redirect a financial sink', async () => {
    // Generic override probe. Every plausible aliasing name is set to the
    // victim; the authorized company is the only thing the request legitimately
    // carries. If any sink or predicate ever prefers one of these, this fails —
    // regardless of which name a future edit reaches for.
    authUser = MEMBER_A;
    const res = mockRes();
    await getHandler()({
      method: 'GET', url: '/x', headers: {},
      query: {
        companyId: COMPANY_A,
        orgId: VICTIM, organizationId: VICTIM, organization_id: VICTIM,
        company_id: VICTIM, viewAs: VICTIM, tenantId: VICTIM, impersonate: VICTIM,
      },
      body: { companyId: VICTIM, organizationId: VICTIM },
    } as never, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.organizationId).toBe(COMPANY_A);
    noVictimFinancialLeak(res.body);

    // The value that actually reached each sink, not merely the response shape.
    for (const q of financialQueries()) {
      expect(q.filters.organization_id ?? COMPANY_A).toBe(COMPANY_A);
    }
    for (const s of financialSinks) {
      expect(s.org).toBe(COMPANY_A);
    }
    expect(financialSinks.every(s => s.org !== VICTIM)).toBe(true);
  });

  it('the route writes nothing', async () => {
    await call(getHandler(), MEMBER_A, { companyId: COMPANY_A });
    expect(writes).toEqual([]);
  });

  it('a non-GET verb reaches nothing', async () => {
    const res = await call(getHandler(), MEMBER_A, { companyId: COMPANY_A }, 'POST');
    expect(res.statusCode).toBe(405);
    expect(queries).toEqual([]);
  });
});

/* ── ledger-specific ──────────────────────────────────────────────────── */

describe('ledger — transaction disclosure', () => {
  it('CRITICAL: only the authorized org’s transactions are returned', async () => {
    const res = await call(ledgerHandler, MEMBER_A, { companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].id).toBe('tx-a');
    noVictimFinancialLeak(res.body);
  });

  it('filters cannot widen the organization predicate', async () => {
    await call(ledgerHandler, MEMBER_A, {
      companyId: COMPANY_A, executionPhase: 'confirm', referenceType: 'x',
      since: '2000-01-01', until: '2100-01-01', limit: '500', offset: '0',
    });
    for (const q of financialQueries()) expect(q.filters.organization_id).toBe(COMPANY_A);
  });

  it('pagination is clamped', async () => {
    const res = await call(ledgerHandler, MEMBER_A, { companyId: COMPANY_A, limit: '99999', offset: '-5' });
    expect(res.body.pagination.limit).toBe(500);
    expect(res.body.pagination.offset).toBe(0);
  });
});

/* ── summary-specific ─────────────────────────────────────────────────── */

describe('summary — composite financial read', () => {
  it('CRITICAL: all nine financial services receive the authorized org', async () => {
    await call(summaryHandler, MEMBER_A, { companyId: COMPANY_A });
    const names = financialSinks.map(s => s.name).sort();
    expect(names).toEqual(['contract', 'financialControls', 'flags', 'forecast',
                           'invoiceProjection', 'subscriptions', 'wallet'].sort());
    for (const s of financialSinks) expect(s.org).toBe(COMPANY_A);
  });

  it('CRITICAL: no financial service is invoked for a denied caller', async () => {
    await call(summaryHandler, MEMBER_A, { companyId: VICTIM });
    expect(financialSinks).toEqual([]);
  });

  it('the composite read performs no billing mutation', async () => {
    await call(summaryHandler, MEMBER_A, { companyId: COMPANY_A });
    expect(writes).toEqual([]);
  });
});
