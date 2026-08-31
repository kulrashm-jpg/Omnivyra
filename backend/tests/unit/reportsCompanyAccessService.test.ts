/**
 * REPORTS-BINDER-PARITY-001 — the extracted reports binder.
 *
 * Ten byte-equivalent copies of this function were consolidated into one
 * module. These tests pin the contract that was extracted, INCLUDING the two
 * things it deliberately does not do (no company-lifecycle check, no
 * super-admin bypass), so a later "improvement" to either has to change a test
 * that says why it exists.
 */

export {};

const queries: Array<{ table: string; filters: Record<string, unknown>; limited: boolean }> = [];

const MEMBER = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const STALE = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const NOBODY = 'eeeeeeee-0000-0000-0000-0000000000ee';
const MULTI = 'ffffffff-0000-0000-0000-0000000000ff';

const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const COMPANY_B = 'b0000000-0000-0000-0000-00000000000b';
const VICTIM = 'c0000000-0000-0000-0000-00000000000c';
const SUSPENDED_CO = 'd0000000-0000-0000-0000-00000000000d';

/** status here is the MEMBERSHIP status; company lifecycle is intentionally unmodelled. */
const ROLES = [
  { user_id: MEMBER, company_id: COMPANY_A, status: 'active' },
  { user_id: MEMBER, company_id: SUSPENDED_CO, status: 'active' },
  { user_id: STALE, company_id: VICTIM, status: 'inactive' },
  { user_id: MULTI, company_id: COMPANY_A, status: 'active' },
  { user_id: MULTI, company_id: COMPANY_B, status: 'active' },
  // A platform super admin with NO membership row anywhere.
];

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    let limited = false;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.limit = () => { limited = true; return b; };
    b.maybeSingle = () => {
      queries.push({ table, filters: { ...filters }, limited });
      const rows = ROLES.filter(r =>
        (filters.user_id === undefined || r.user_id === filters.user_id) &&
        (filters.company_id === undefined || r.company_id === filters.company_id) &&
        (filters.status === undefined || r.status === filters.status));
      // maybeSingle() with >1 row is an error in PostgREST unless limited.
      if (rows.length > 1 && !limited) return Promise.resolve({ data: null, error: { message: 'multiple rows' } });
      return Promise.resolve({ data: rows[0] ? { company_id: rows[0].company_id } : null, error: null });
    };
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

const { resolveCompanyId } = require('../../services/reportsCompanyAccessService');

beforeEach(() => { queries.length = 0; });

describe('resolveCompanyId — requested company', () => {
  it('returns the company when the caller holds an ACTIVE membership', async () => {
    await expect(resolveCompanyId(MEMBER, COMPANY_A)).resolves.toBe(COMPANY_A);
  });

  it('CRITICAL a foreign company resolves to null', async () => {
    await expect(resolveCompanyId(MEMBER, VICTIM)).resolves.toBeNull();
  });

  it('CRITICAL a stale (inactive) membership resolves to null', async () => {
    await expect(resolveCompanyId(STALE, VICTIM)).resolves.toBeNull();
  });

  it('the membership query is scoped by user, company AND active status', async () => {
    await resolveCompanyId(MEMBER, COMPANY_A);
    expect(queries[0]).toMatchObject({
      table: 'user_company_roles',
      filters: { user_id: MEMBER, company_id: COMPANY_A, status: 'active' },
    });
  });

  it('returns the ROW column, never the caller-supplied value', async () => {
    // The mock returns the stored company_id; a route therefore cannot receive
    // back a value the database did not confirm.
    const out = await resolveCompanyId(MEMBER, COMPANY_A);
    expect(out).toBe(COMPANY_A);
    expect(queries[0].filters.company_id).toBe(COMPANY_A);
  });

  it('a malformed company resolves to null without throwing', async () => {
    await expect(resolveCompanyId(MEMBER, "x' OR 1=1--")).resolves.toBeNull();
  });

  it('a caller with no memberships resolves to null', async () => {
    await expect(resolveCompanyId(NOBODY, COMPANY_A)).resolves.toBeNull();
  });
});

describe('resolveCompanyId — omitted company (fallback)', () => {
  it('falls back to the caller own first active membership', async () => {
    await expect(resolveCompanyId(MEMBER)).resolves.toBe(COMPANY_A);
  });

  it('an empty string is treated as omitted, not as a company', async () => {
    await expect(resolveCompanyId(MEMBER, '')).resolves.toBe(COMPANY_A);
    expect(queries[0].filters.company_id).toBeUndefined();
    expect(queries[0].limited).toBe(true);
  });

  it('the fallback query is limited and never company-scoped', async () => {
    await resolveCompanyId(MEMBER);
    expect(queries[0]).toMatchObject({ filters: { user_id: MEMBER, status: 'active' }, limited: true });
    expect(queries[0].filters.company_id).toBeUndefined();
  });

  it('a caller with NO active membership resolves to null', async () => {
    await expect(resolveCompanyId(NOBODY)).resolves.toBeNull();
    await expect(resolveCompanyId(STALE)).resolves.toBeNull();
  });

  it('a multi-company caller resolves to one of their own companies', async () => {
    const out = await resolveCompanyId(MULTI);
    expect([COMPANY_A, COMPANY_B]).toContain(out);
  });
});

describe('resolveCompanyId — the contract limits, pinned deliberately', () => {
  it('does NOT consult company lifecycle: an active member of a suspended company still resolves', async () => {
    /*
     * This is the shipped behaviour of all ten reports routes and the reason the
     * helper must NOT be swapped for requireCompanyAccess/assertTenantAccess as
     * a refactor — those reject a suspended org, which would be a silent
     * authorization change. Changing this needs its own audited work item.
     */
    await expect(resolveCompanyId(MEMBER, SUSPENDED_CO)).resolves.toBe(SUSPENDED_CO);
    expect(queries.some(q => q.table === 'companies')).toBe(false);
  });

  it('has NO super-admin bypass: a platform super admin without membership resolves to null', async () => {
    await expect(resolveCompanyId(SUPERADMIN, COMPANY_A)).resolves.toBeNull();
    await expect(resolveCompanyId(SUPERADMIN)).resolves.toBeNull();
  });

  it('reads only user_company_roles — one table, no other tenant surface', async () => {
    await resolveCompanyId(MEMBER, COMPANY_A);
    await resolveCompanyId(MEMBER);
    expect([...new Set(queries.map(q => q.table))]).toEqual(['user_company_roles']);
  });
});
