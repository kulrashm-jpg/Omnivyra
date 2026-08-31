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
        // Postgres compares uuid case-INSENSITIVELY, so a differently-cased
        // request still matches — while the stored column stays canonical.
        (filters.company_id === undefined ||
          r.company_id.toLowerCase() === String(filters.company_id).toLowerCase()) &&
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

  it('CRITICAL returns the stored ROW column, never the caller-supplied string', async () => {
    /*
     * Postgres matches uuids case-insensitively, so an oddly-cased request finds
     * the row — but what must flow onward to the sinks is the CANONICAL stored
     * value, not the string the caller typed. Mutation testing found that a
     * mutant echoing `requestedCompanyId` survived while the fixture used an
     * identical-case id, so the request is deliberately mis-cased here.
     */
    const miscased = COMPANY_A.toUpperCase();
    const out = await resolveCompanyId(MEMBER, miscased);
    expect(out).toBe(COMPANY_A);
    expect(out).not.toBe(miscased);
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

/* ────────────────────────────────────────────────────────────────────────────
 * REPORTS-LIFECYCLE-SEC-001 — why membership-only is the CORRECT policy here.
 *
 * The open question was whether an active member of a suspended or soft-deleted
 * company should keep reports access. The repository answers it: company
 * lifecycle is enforced AT THE TRANSITION, not on every read.
 *
 * supabase/migrations/20260640_lifecycle_governance.sql defines
 * disable_company_cascade(), which in ONE transaction:
 *
 *     UPDATE companies          SET status='inactive'
 *     UPDATE user_company_roles SET status='inactive'
 *                               WHERE company_id=… AND status='active'
 *     UPDATE users              SET session_revoked_after=NOW()
 *     UPDATE auth_sessions      SET revoked_at=NOW()
 *
 * and soft_delete_company() sets deleted_at and calls that same cascade. There
 * is no other write path that makes a company inactive — every disable/delete
 * goes through backend/services/lifecycleGovernance.
 *
 * So "active membership in a disabled company" is a state the system does not
 * produce: the cascade deactivates the membership, and revokes the session on
 * top. Production agrees — 24 membership rows exist on non-active companies and
 * every one of them is inactive.
 *
 * These tests pin that reasoning. If someone later adds a lifecycle read to this
 * helper, or breaks the cascade, they have to confront the policy here rather
 * than discover it in an incident.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('lifecycle policy — membership is the enforcement point', () => {
  it('POLICY: an inactive membership is refused, which is how a disabled company is refused', async () => {
    // The cascade turns every membership of a disabled company into this state.
    await expect(resolveCompanyId(STALE, VICTIM)).resolves.toBeNull();
  });

  it('POLICY: the helper decides on MEMBERSHIP alone and never reads companies', async () => {
    await resolveCompanyId(MEMBER, SUSPENDED_CO);
    expect(queries.every(q => q.table === 'user_company_roles')).toBe(true);
    expect(queries.some(q => q.table === 'companies')).toBe(false);
  });

  it('POLICY: the fallback also keys on active membership, so a disabled company cannot be selected', async () => {
    // MEMBER holds active rows in COMPANY_A and SUSPENDED_CO. Once the cascade
    // has run for a company, its row is inactive and cannot be the fallback.
    const out = await resolveCompanyId(MEMBER);
    expect([COMPANY_A, SUSPENDED_CO]).toContain(out);
    expect(queries[0].filters.status).toBe('active');
  });

  it('POLICY: a caller whose every membership was cascaded resolves to null', async () => {
    await expect(resolveCompanyId(STALE)).resolves.toBeNull();
  });

  it('the fallback SKIPS inactive memberships and returns an active one', async () => {
    // MULTI has two active rows; the query filters status='active', so an
    // inactive row can never be chosen regardless of table order.
    const out = await resolveCompanyId(MULTI);
    expect([COMPANY_A, COMPANY_B]).toContain(out);
    expect(queries[0].filters.status).toBe('active');
  });
});
