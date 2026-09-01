/**
 * MEMBERSHIP-DERIVATION-SWEEP-001 — principal-derived tenant authorization.
 *
 * The class swept for: a company derived from the AUTHENTICATED principal via
 * user_company_roles, where the membership's own validity is never checked.
 * Derivation is not authorization. SETTINGS-EXECUTION-CONFIG-SEC-001 proved the
 * class is exploitable and invisible to all four detectors, because such routes
 * take no tenant id from the request at all.
 *
 * user_company_roles carries non-active rows by design: inviting writes
 * status='invited' with no acceptance and NO session revocation; deactivation
 * writes status='inactive'; IdentityResolver additionally models 'deactivated'.
 *
 * This suite covers the one defect the sweep confirmed, and pins the shared
 * resolver that the rest of the platform depends on.
 *
 *   DEFECT  pages/api/credits/claim-action.ts — the org that RECEIVES a credit
 *           grant was derived with no status filter, so a user holding only a
 *           revoked or never-accepted membership had credits written into that
 *           organisation's ledger.
 *
 *   SAFE    backend/services/userContextService.ts — filters status in code
 *           rather than in SQL (`roleRows.filter(r => r.status === 'active')`),
 *           and both companyIds and defaultCompanyId derive from that filtered
 *           set. Pinned here because ~10 engagement routes fall back to
 *           user.defaultCompanyId, so its correctness is load-bearing.
 */

export {};

const ACTIVE_USER = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const INVITED_USER = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const REVOKED_USER = 'dddddddd-0000-0000-0000-0000000000dd';
const DEACTIVATED_USER = '99999999-0000-0000-0000-000000000099';
const NOBODY = 'eeeeeeee-0000-0000-0000-0000000000ee';
/** Holds a stale row for VICTIM listed FIRST, plus an active row for OWN. */
const MIXED_USER = 'ffffffff-0000-0000-0000-0000000000ff';

const OWN = 'a0000000-0000-0000-0000-00000000000a';
const VICTIM = 'b0000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: ACTIVE_USER, company_id: OWN, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: INVITED_USER, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'invited' },
  { user_id: REVOKED_USER, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: DEACTIVATED_USER, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'deactivated' },
  { user_id: MIXED_USER, company_id: VICTIM, role: 'COMPANY_ADMIN', status: 'inactive' },
  { user_id: MIXED_USER, company_id: OWN, role: 'COMPANY_ADMIN', status: 'active' },
];

let authUser: string | null = ACTIVE_USER;

const roleQueries: Array<Record<string, unknown>> = [];
const creditCalls: Array<{ orgId: string; amount: number; performedBy: string }> = [];
const claimWrites: Array<{ table: string; payload: any }> = [];

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser ? { user: { id: authUser, email: 'u@example.com' }, error: null } : { user: null, error: 'NO_AUTH' }),
}));

/** Shared PostgREST-ish builder over ROLES plus a permissive claim table. */
function makeClient() {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.limit = () => b;
    b.order = () => b;
    b.insert = (p: any) => { claimWrites.push({ table, payload: p }); return b; };
    b.update = (p: any) => { claimWrites.push({ table, payload: p }); return b; };
    const rows = () => {
      if (table === 'user_company_roles') {
        roleQueries.push({ table, ...filters });
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.status === undefined || r.status === filters.status) &&
          (filters.role === undefined || r.role === filters.role));
      }
      return [];
    };
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    b.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    b.then = (fn: any) => { const r = rows(); return Promise.resolve({ data: r, error: null }).then(fn); };
    return b;
  };
  return { from: (t: string) => build(t) };
}

jest.mock('../../db/supabaseClient', () => ({ supabase: makeClient() }));

/* ────────────────────────────────────────────────────────────────────────────
 * SAFE — the shared principal resolver. Pinned, not modified.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('userContextService — principal-derived companies are active-filtered', () => {
  const { resolveUserContext } = require('../../services/userContextService');
  const req = () => ({ headers: {}, query: {}, body: {} } as never);

  beforeEach(() => { roleQueries.length = 0; });

  it('an active member yields their company', async () => {
    authUser = ACTIVE_USER;
    const ctx = await resolveUserContext(req());
    expect(ctx.authenticated).toBe(true);
    expect(ctx.companyIds).toEqual([OWN]);
    expect(ctx.defaultCompanyId).toBe(OWN);
  });

  it('CRITICAL an invited-only member yields NO company', async () => {
    authUser = INVITED_USER;
    const ctx = await resolveUserContext(req());
    expect(ctx.companyIds).toEqual([]);
    expect(ctx.defaultCompanyId).toBe('');
  });

  it('CRITICAL a revoked member yields NO company', async () => {
    authUser = REVOKED_USER;
    const ctx = await resolveUserContext(req());
    expect(ctx.companyIds).toEqual([]);
    expect(ctx.defaultCompanyId).toBe('');
  });

  it('CRITICAL a deactivated member yields NO company', async () => {
    authUser = DEACTIVATED_USER;
    const ctx = await resolveUserContext(req());
    expect(ctx.companyIds).toEqual([]);
  });

  it('CRITICAL a stale row never becomes the default company', async () => {
    authUser = MIXED_USER;
    const ctx = await resolveUserContext(req());
    expect(ctx.companyIds).toEqual([OWN]);
    expect(ctx.defaultCompanyId).toBe(OWN);
    expect(ctx.companyIds).not.toContain(VICTIM);
  });

  /*
   * The unauthenticated branch is deliberately NOT covered here. It routes
   * through devIdentityOptIn() -> resolveFromLib(), which loads the full config
   * schema (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...) and therefore needs a
   * real environment. That path is not this sweep's subject either: the class
   * under audit is membership VALIDITY for an already-authenticated principal.
   * Unauthenticated behaviour is already pinned by authCtx002WhoamiDisclosure
   * and the per-route suites.
   */
});

/* ────────────────────────────────────────────────────────────────────────────
 * DEFECT — credits/claim-action derived the CREDITED organisation with no
 * status filter, so a non-member's claim wrote into that org's ledger.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('credits/claim-action — the credited organisation', () => {
  /** Re-implements the route's derivation against the same fixtures. */
  async function deriveCreditedOrg(userId: string): Promise<string | null> {
    const { supabase } = require('../../db/supabaseClient');
    const { data } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    return (data as any)?.company_id ?? null;
  }

  beforeEach(() => { roleQueries.length = 0; creditCalls.length = 0; });

  it('the route source requires an ACTIVE membership before crediting', () => {
    /*
     * Static pin. The credited org is chosen by a membership lookup inside the
     * route; this asserts the predicate is present in the code that runs, so
     * removing it fails here even though the grant itself is mocked elsewhere.
     */
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(
      path.resolve(__dirname, '../../../pages/api/credits/claim-action.ts'), 'utf8');
    const code = src.split('\n')
      .filter((l: string) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
      .join('\n');

    const at = code.indexOf("from('user_company_roles')");
    expect(at).toBeGreaterThan(-1);
    const query = code.slice(at, at + 400);
    /*
     * Both halves of the contract, and both are load-bearing:
     *   provenance — the membership must be keyed on the AUTHENTICATED
     *   principal, not on anything the caller can supply. Mutation testing
     *   found this gap: swapping user.id for `req.query.user_id || user.id`
     *   survived while the assertion only required "a user_id predicate".
     *   validity  — that membership must currently be active.
     */
    expect(query).toMatch(/\.eq\(\s*'user_id',\s*user\.id\s*\)/);
    expect(query).toMatch(/\.eq\(\s*'status',\s*'active'\)/);
  });

  it('an active member credits their own organisation', async () => {
    await expect(deriveCreditedOrg(ACTIVE_USER)).resolves.toBe(OWN);
  });

  it('CRITICAL an INVITED (never accepted) user credits NO organisation', async () => {
    await expect(deriveCreditedOrg(INVITED_USER)).resolves.toBeNull();
  });

  it('CRITICAL a REVOKED member credits NO organisation', async () => {
    await expect(deriveCreditedOrg(REVOKED_USER)).resolves.toBeNull();
  });

  it('CRITICAL a DEACTIVATED member credits NO organisation', async () => {
    await expect(deriveCreditedOrg(DEACTIVATED_USER)).resolves.toBeNull();
  });

  it('CRITICAL a stale row never becomes the credited organisation', async () => {
    await expect(deriveCreditedOrg(MIXED_USER)).resolves.toBe(OWN);
  });

  it('a user with no membership at all credits nothing', async () => {
    await expect(deriveCreditedOrg(NOBODY)).resolves.toBeNull();
  });

  it('the membership lookup is keyed on the principal AND active status', async () => {
    await deriveCreditedOrg(ACTIVE_USER);
    expect(roleQueries[0]).toMatchObject({
      table: 'user_company_roles', user_id: ACTIVE_USER, status: 'active',
    });
  });
});
