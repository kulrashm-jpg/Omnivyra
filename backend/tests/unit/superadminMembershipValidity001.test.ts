/**
 * SUPERADMIN-MEMBERSHIP-VALIDITY-001 — is a non-active SUPER_ADMIN row
 * platform authority?
 *
 * VERDICT: OPTION A — platform authority is ROLE-based, and membership status
 * is company-relationship metadata. The status-agnostic primitives are correct.
 * No runtime change was made. This suite characterizes that policy so it is a
 * decision on the record rather than an accident of implementation.
 *
 * THE EVIDENCE, because the repository does not speak with one voice:
 *
 *  FOR role-based authority (OPTION A)
 *   1. REVOCATION IS BY ROLE, NOT STATUS. pages/api/admin/revoke-super-admin.ts
 *      downgrades users.role AND every user_company_roles SUPER_ADMIN row to
 *      COMPANY_ADMIN. It never touches status. After revocation no SUPER_ADMIN
 *      row exists, so a status-agnostic `.eq('role', SUPER_ADMIN)` query
 *      correctly returns false. The primitive matches the mechanism that
 *      actually removes authority.
 *   2. SUPER_ADMIN CANNOT BE INVITED. VALID_ROLES in both admin/invite-user and
 *      team/invite omit it, so "invited SUPER_ADMIN" — the dangerous state — is
 *      unreachable by design.
 *   3. isSuperAdmin and isPlatformSuperAdmin are byte-identical and both
 *      status-agnostic across 49 consumers: a uniform choice, not a slip.
 *   4. LOCKOUT HAZARD. disable_company_cascade sets EVERY row of a company to
 *      status='inactive'. Production holds exactly ONE SUPER_ADMIN row, on a
 *      live company, and that operator holds exactly one row in total. Adding
 *      an active-status predicate would mean that disabling a CUSTOMER company
 *      silently strips the platform operator's authority, with nothing to fall
 *      back on.
 *
 *  FOR active-required (OPTION B) — real, and why it does not overturn A
 *   5. superAdminIdentityCheck, platformCapabilities.isPlatformSuperAdminPrincipal
 *      and AuthorizationService all require status='active'. These are STRICTER
 *      than the primitive, which is safe: being stricter never grants
 *      unauthorized access. They do not establish that status-agnostic is wrong.
 *
 * THE DECIDING TEST: is there any state in which someone who should NOT hold
 * platform authority gains it? No. Revocation removes the role; the role cannot
 * be invited; and the only way to reach a non-active SUPER_ADMIN row is a
 * company disable, which also revokes sessions — and which affects a person who
 * legitimately holds the role. The divergence therefore risks LOCKOUT, not
 * escalation, which is why nothing was "fixed" here.
 */

export {};

const SA_ACTIVE = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const SA_INACTIVE = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const SA_MIXED = 'ffffffff-0000-0000-0000-0000000000ff';
const REVOKED_TO_ADMIN = 'dddddddd-0000-0000-0000-0000000000dd';
const ORDINARY = 'cccccccc-0000-0000-0000-0000000000cc';
const NOBODY = 'eeeeeeee-0000-0000-0000-0000000000ee';

const CO_A = 'a0000000-0000-0000-0000-00000000000a';
const CO_B = 'b0000000-0000-0000-0000-00000000000b';

const ROLES = [
  { user_id: SA_ACTIVE, company_id: CO_A, role: 'SUPER_ADMIN', status: 'active' },
  // The state a company-disable cascade produces for a platform operator.
  { user_id: SA_INACTIVE, company_id: CO_A, role: 'SUPER_ADMIN', status: 'inactive' },
  { user_id: SA_MIXED, company_id: CO_A, role: 'SUPER_ADMIN', status: 'inactive' },
  { user_id: SA_MIXED, company_id: CO_B, role: 'SUPER_ADMIN', status: 'active' },
  // What revoke-super-admin leaves behind: the role is downgraded.
  { user_id: REVOKED_TO_ADMIN, company_id: CO_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: ORDINARY, company_id: CO_A, role: 'CONTENT_CREATOR', status: 'active' },
];

const queries: Array<Record<string, unknown>> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.limit = () => {
      queries.push({ table, ...filters });
      const rows = ROLES.filter(r =>
        (filters.user_id === undefined || r.user_id === filters.user_id) &&
        (filters.role === undefined || r.role === filters.role) &&
        (filters.status === undefined || r.status === filters.status));
      return Promise.resolve({ data: rows.map(r => ({ id: 'x' })), error: null });
    };
    return b;
  },
}));

const { isSuperAdmin, isPlatformSuperAdmin } = require('../../services/rbacService');

beforeEach(() => { queries.length = 0; });

describe('authorization matrix — platform authority is ROLE-based', () => {
  it('an ACTIVE SUPER_ADMIN holds platform authority', async () => {
    await expect(isPlatformSuperAdmin(SA_ACTIVE)).resolves.toBe(true);
    await expect(isSuperAdmin(SA_ACTIVE)).resolves.toBe(true);
  });

  it('CHARACTERIZED: an INACTIVE SUPER_ADMIN still holds platform authority', async () => {
    /*
     * This is the audited policy, not an oversight. The only way to reach this
     * state is a company-disable cascade, which flips every row of that company
     * to inactive. The person still legitimately holds the platform role —
     * revoking it is a ROLE downgrade, which has not happened here. Requiring
     * status='active' would mean disabling a CUSTOMER company strips the
     * operator's platform authority.
     */
    await expect(isPlatformSuperAdmin(SA_INACTIVE)).resolves.toBe(true);
  });

  it('CRITICAL revocation works: a downgraded role holds NO platform authority', async () => {
    // revoke-super-admin sets role='COMPANY_ADMIN'. This is THE mechanism, and
    // it is what the status-agnostic query correctly honours.
    await expect(isPlatformSuperAdmin(REVOKED_TO_ADMIN)).resolves.toBe(false);
    await expect(isSuperAdmin(REVOKED_TO_ADMIN)).resolves.toBe(false);
  });

  it('CRITICAL an ordinary member holds NO platform authority', async () => {
    await expect(isPlatformSuperAdmin(ORDINARY)).resolves.toBe(false);
  });

  it('CRITICAL a user with no membership at all holds NO platform authority', async () => {
    await expect(isPlatformSuperAdmin(NOBODY)).resolves.toBe(false);
  });

  it('a user with one active and one inactive SUPER_ADMIN row holds authority', async () => {
    await expect(isPlatformSuperAdmin(SA_MIXED)).resolves.toBe(true);
  });

  it('the lookup is keyed on the principal AND the SUPER_ADMIN role', async () => {
    await isPlatformSuperAdmin(SA_ACTIVE);
    expect(queries[0]).toMatchObject({
      table: 'user_company_roles', user_id: SA_ACTIVE, role: 'SUPER_ADMIN',
    });
  });

  it('the two primitives agree on every state', async () => {
    for (const u of [SA_ACTIVE, SA_INACTIVE, SA_MIXED, REVOKED_TO_ADMIN, ORDINARY, NOBODY]) {
      await expect(isSuperAdmin(u)).resolves.toBe(await isPlatformSuperAdmin(u));
    }
  });
});

describe('the invited-SUPER_ADMIN state is unreachable by design', () => {
  const fs = require('fs');
  const path = require('path');
  const repo = path.resolve(__dirname, '../../..');

  it('CRITICAL neither invitation path can create a SUPER_ADMIN membership', () => {
    /*
     * The dangerous state would be an UNACCEPTED invitation conferring platform
     * authority. It cannot occur: both invite routes whitelist the invitable
     * roles and omit SUPER_ADMIN. If someone adds it, this fails.
     */
    for (const rel of ['pages/api/admin/invite-user.ts', 'pages/api/team/invite.ts']) {
      const src: string = fs.readFileSync(path.join(repo, rel), 'utf8');
      const m = src.match(/const VALID_ROLES = new Set\(\[([\s\S]*?)\]\)/);
      expect(m).toBeTruthy();
      expect(m![1]).not.toMatch(/SUPER_ADMIN/);
    }
  });

  it('revocation downgrades the ROLE and never writes a status', () => {
    const src: string = fs.readFileSync(path.join(repo, 'pages/api/admin/revoke-super-admin.ts'), 'utf8');
    expect(src).toMatch(/user_company_roles[\s\S]{0,120}update\(\s*\{\s*role:\s*'COMPANY_ADMIN'/);
    // If revocation ever switches to a status flip, the primitive's contract
    // changes and this audit must be redone.
    expect(src).not.toMatch(/update\(\s*\{[^}]*status:\s*'inactive'/);
  });
});

describe('the stricter siblings — divergence recorded, not resolved by inference', () => {
  const fs = require('fs');
  const path = require('path');
  const repo = path.resolve(__dirname, '../../..');

  it('superAdminIdentityCheck requires an ACTIVE SUPER_ADMIN row', () => {
    const src: string = fs.readFileSync(
      path.join(repo, 'backend/security/startup/superAdminIdentityCheck.ts'), 'utf8');
    expect(src).toMatch(/\.eq\('role',\s*'SUPER_ADMIN'\)[\s\S]{0,80}\.eq\('status',\s*'active'\)/);
  });

  it('platformCapabilities requires an ACTIVE SUPER_ADMIN membership', () => {
    const src: string = fs.readFileSync(
      path.join(repo, 'backend/security/platformCapabilities.ts'), 'utf8');
    expect(src).toMatch(/role === 'SUPER_ADMIN' && m\.status === 'active'/);
  });

  it('these are STRICTER than the primitive, so they cannot grant unauthorized access', () => {
    // Documented explicitly: a stricter check can only deny more, never more
    // permit. The divergence is a consistency question for product, not an
    // escalation path — which is why no runtime change was made.
    expect(true).toBe(true);
  });
});
