/**
 * AUTHZ-SERVICE-LAYER-DETECTOR-001 — fixtures for check-membership-validity.
 *
 * A detector is only worth its output if both halves are pinned: it must catch
 * the class it exists for, and it must stay quiet on the many legitimate reasons
 * to read a non-active membership row. A guard that fires on every membership
 * query without a status filter would be worse than none — it would be trained
 * away within a week, because invitation, onboarding, revocation, lifecycle
 * repair, notification and attribution all read non-active rows on purpose.
 *
 * MUST-DETECT fixtures are the two confirmed production defects in their
 * PRE-FIX form, plus the shapes a reasonable engineer would write next.
 * MUST-NOT-DETECT fixtures are taken from real code in this repository.
 */

export {};

const { classifyQuery, scanSource, scanRepo } = require('../../../scripts/check-membership-validity.js');

/** Classify a single snippet the way the guard's scanner would. */
function classify(src: string): { cls: string; reason: string } {
  const found = scanSource(src);
  expect(found.length).toBe(1);
  return found[0];
}

/* ────────────────────────────────────────────────────────────────────────────
 * MUST DETECT — a company derived from the principal with no validity check.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('MUST DETECT — principal-derived company with no membership validity', () => {
  it('CRITICAL settings/execution-config, in its pre-fix form', () => {
    /*
     * SETTINGS-EXECUTION-CONFIG-SEC-001. This exact query authorized reads and
     * writes of an organisation's execution configuration. A user holding only
     * an invited or revoked membership operated on that organisation.
     */
    const src = `
      const { data } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      return data?.company_id ?? null;
    `;
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('CRITICAL credits/claim-action, in its pre-fix form', () => {
    // MEMBERSHIP-DERIVATION-SWEEP-001 — chose which ledger received a grant.
    const src = `
      const { data: membership } = await serviceSb
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      const orgId = membership?.company_id ?? null;
    `;
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('detects it through ownedDbTable as well as .from', () => {
    // Both data-layer entrypoints reach the same table; covering only one would
    // leave a rename as a silent bypass.
    const src = `
      const { data } = await ownedDbTable('user_company_roles')
        .select('company_id, role')
        .eq('user_id', principal.userId)
        .limit(1);
    `;
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('detects a multi-column select that still derives the company', () => {
    const src = `
      const { data } = await supabase
        .from('user_company_roles')
        .select('id, company_id, created_at')
        .eq('user_id', userId)
        .order('created_at')
        .limit(1);
    `;
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('CRITICAL a status filter for a DIFFERENT table does not clear the query', () => {
    /*
     * The trap this pins: an unrelated `status === 'active'` in the surrounding
     * function must not launder the membership derivation. Here the status
     * belongs to a campaign, not to the membership.
     */
    const src = `
      const { data } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      const campaigns = rows.filter((c) => c.state === 'active');
    `;
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('CRITICAL a DISTANT status check elsewhere in the file does not launder it', () => {
    /*
     * The in-code-filter allowance is bounded to the enclosing region for a
     * reason. If it were widened to the whole file, any large route that
     * happens to contain an unrelated `status === 'active'` anywhere would be
     * silently certified. Mutation testing found this unpinned: widening the
     * window to the entire source survived every other test.
     */
    const src = `
      const { data } = await supabase
        .from('user_company_roles')
        .select('company_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      ${'// unrelated code far below the derivation\n'.repeat(60)}
      const visible = campaigns.filter((c) => c.status === 'active');
    `;
    expect(classify(src).cls).toBe('SUSPICIOUS');
  });

  it('names the risk in the reason, so the failure is actionable', () => {
    const src = `
      await supabase.from('user_company_roles').select('company_id').eq('user_id', uid).limit(1);
    `;
    expect(classify(src).reason).toMatch(/invited or revoked/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * MUST NOT DETECT — every legitimate reason to read a membership row.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('MUST NOT DETECT — legitimate non-active membership reads', () => {
  it('validity established in SQL (the fixed execution-config)', () => {
    const src = `
      await supabase.from('user_company_roles').select('company_id')
        .eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('CRITICAL onboarding legitimately looks for an INVITED membership', () => {
    /*
     * pages/api/onboarding/complete.ts. Requiring status='active' here would be
     * wrong — the whole point is to find the unaccepted invitation. This is why
     * the rule is "is the query status-aware", not "does it say active".
     */
    const src = `
      const { data: invite } = await supabase.from('user_company_roles')
        .select('id, company_id, role').eq('user_id', userId)
        .eq('status', 'invited').limit(1).maybeSingle();
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('a status set (active + invited) is status-aware', () => {
    // rbacPrimitives.getCompanyRoleIncludingInvited — deliberately admits both.
    const src = `
      await ownedDbTable('user_company_roles').select('role, company_id')
        .eq('user_id', userId).in('status', ['active', 'invited']).limit(1);
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('CRITICAL a SUPER_ADMIN lookup is not flagged for lacking a status filter', () => {
    /*
     * SUPERADMIN-MEMBERSHIP-VALIDITY-001 decided this: platform authority is
     * ROLE-based. Revocation downgrades the role rather than flipping status, so
     * a status-agnostic role query is correct by design. Flagging it would push
     * an engineer toward a change that risks LOCKING OUT the sole platform
     * operator when an unrelated customer company is disabled.
     */
    const src = `
      await ownedDbTable('user_company_roles').select('id, company_id')
        .eq('user_id', userId).eq('role', Role.SUPER_ADMIN).limit(1);
    `;
    expect(classify(src).cls).toBe('SAFE');
    expect(classify(src).reason).toMatch(/role-scoped/i);
  });

  it('validity established in code rather than in SQL', () => {
    // userContextService — filters after the fetch. Different style, same effect.
    const src = `
      const { data: roleRows } = await supabase.from('user_company_roles')
        .select('company_id, role').eq('user_id', user.id);
      const activeRoles = (roleRows || []).filter((row) => row.status === 'active');
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('selecting status hands the decision to the caller', () => {
    // IdentityResolver.fetchOrgMemberships reports memberships; consumers filter.
    const src = `
      const { data } = await supabase.from('user_company_roles')
        .select('company_id, role, status').eq('user_id', userId);
      return (data ?? []).map((r) => ({ organizationId: r.company_id, status: r.status }));
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('a query already scoped to a known company validates within it', () => {
    // assertTenantAccess / getUserRole — the company came from the guard, not
    // from this query, so nothing is being derived.
    const src = `
      await ownedDbTable('user_company_roles').select('role, status, company_id')
        .eq('user_id', userId).eq('company_id', organizationId).limit(1);
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('membership management writes are not derivations', () => {
    const src = `
      await supabase.from('user_company_roles')
        .update({ role: 'COMPANY_ADMIN' }).eq('user_id', targetUserId)
        .select('company_id');
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('a company-keyed read (members of an org) is not principal-keyed', () => {
    // Notification recipients, member counts, assignee lists.
    const src = `
      await supabase.from('user_company_roles').select('user_id, company_id')
        .eq('company_id', orgId).eq('role', 'COMPANY_ADMIN');
    `;
    expect(classify(src).cls).toBe('SAFE');
  });

  it('CRITICAL a batch lookup over many users is not a principal derivation', () => {
    /*
     * Reaches the principal-keyed branch specifically. Mutation testing found
     * that disabling that check changed nothing, because every other
     * not-principal-keyed fixture exited earlier on the company or role
     * predicate. A bulk read keyed on a LIST of users derives no single
     * caller's company, so it is out of scope — and if the principal check is
     * ever weakened, this is what fails.
     */
    const src = `
      const { data } = await supabase.from('user_company_roles')
        .select('user_id, company_id').in('user_id', memberIds);
    `;
    expect(classify(src).cls).toBe('SAFE');
    expect(classify(src).reason).toMatch(/not keyed on a principal/i);
  });

  it('a query that derives no company is out of scope', () => {
    // getUserRole's third query — picks an error code, returns role: null.
    const src = `
      await ownedDbTable('user_company_roles').select('role').eq('user_id', userId).limit(1);
    `;
    expect(classify(src).cls).toBe('SAFE');
    expect(classify(src).reason).toMatch(/no company derived/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The real repository.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('repository scan', () => {
  const rows = scanRepo();

  it('CRITICAL every principal-derived company is either valid or recorded', () => {
    const fs = require('fs');
    const path = require('path');
    const ledger = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../../scripts/membership-validity-baseline.json'), 'utf8'));
    const recorded = new Set(ledger.accepted.map((a: any) => a.site));
    const unrecorded = rows
      .filter((r: any) => r.cls !== 'SAFE')
      .filter((r: any) => !recorded.has(`${r.file}:${r.line}`));
    expect(unrecorded).toEqual([]);
  });

  it('CRITICAL the two fixed routes stay fixed', () => {
    /*
     * The regression that matters most: if either status predicate is ever
     * removed, this fails. These are the defects the guard was built from.
     */
    for (const f of ['pages/api/settings/execution-config.ts', 'pages/api/credits/claim-action.ts']) {
      const site = rows.filter((r: any) => r.file === f);
      expect(site.length).toBeGreaterThan(0);
      expect(site.every((r: any) => r.cls === 'SAFE')).toBe(true);
    }
  });

  it('every ledger entry still matches a real finding', () => {
    // Stale entries are how a reviewed finding decays into blanket cover.
    const fs = require('fs');
    const path = require('path');
    const ledger = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../../scripts/membership-validity-baseline.json'), 'utf8'));
    const flagged = new Set(rows.filter((r: any) => r.cls !== 'SAFE').map((r: any) => `${r.file}:${r.line}`));
    for (const entry of ledger.accepted) expect(flagged.has(entry.site)).toBe(true);
  });

  it('every ledger entry carries a reason and an owner', () => {
    const fs = require('fs');
    const path = require('path');
    const ledger = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../../scripts/membership-validity-baseline.json'), 'utf8'));
    for (const entry of ledger.accepted) {
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(entry.owner).toBeTruthy();
      expect(entry.would_become_a_defect_if).toBeTruthy();
    }
  });

  it('CRITICAL the guard FAILS CLOSED on an unrecorded finding', () => {
    /*
     * Runs the real CLI against an empty ledger, so the finding that is
     * normally recorded becomes unrecorded. It must exit non-zero.
     *
     * Mutation testing found this path completely untested: flipping the
     * failure exit from 1 to 0 — turning the guard into decoration that always
     * reports success — passed every other test in this file. A guard nobody
     * has watched fail is a guard nobody knows works.
     */
    const { execFileSync } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const emptyLedger = path.join(os.tmpdir(), `mv-empty-ledger-${process.pid}.json`);
    fs.writeFileSync(emptyLedger, JSON.stringify({ accepted: [] }));
    let exitCode = 0;
    try {
      execFileSync('node', ['scripts/check-membership-validity.js'], {
        cwd: path.resolve(__dirname, '../../..'),
        env: { ...process.env, MEMBERSHIP_VALIDITY_LEDGER: emptyLedger },
        stdio: 'pipe',
      });
    } catch (err: any) {
      exitCode = err.status;
    } finally {
      fs.unlinkSync(emptyLedger);
    }
    expect(exitCode).toBe(1);
  });

  it('the guard exits 0 when every finding is recorded', () => {
    // The other half: it must not fail closed on everything, or it is noise.
    const { execFileSync } = require('child_process');
    const path = require('path');
    expect(() => execFileSync('node', ['scripts/check-membership-validity.js'], {
      cwd: path.resolve(__dirname, '../../..'), stdio: 'pipe',
    })).not.toThrow();
  });

  it('the guard actually reaches the code it claims to cover', () => {
    // A scanner that silently walks nothing passes every other test here.
    expect(rows.length).toBeGreaterThan(100);
    for (const dir of ['backend/services/', 'backend/security/', 'pages/api/']) {
      expect(rows.some((r: any) => r.file.startsWith(dir))).toBe(true);
    }
  });
});
