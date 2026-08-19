/**
 * P1.10 — Command Center readiness-wave identity gate.
 *
 * Every request in the readiness wave is keyed on selectedCompanyId; none
 * consumes a user id. The gate only needs to know an authenticated principal
 * exists, so it accepts either identity:
 *
 *   authUserId   — JWT sub, ready at shell-ready time (bearer principals)
 *   user.userId  — DB-backed, lands only after /api/company-profile?mode
 *                  (and is the ONLY identity cookie principals ever get)
 *
 * Requiring user.userId held the wave ~7.3s past shell-usable in production.
 * Requiring authUserId alone would strand cookie principals forever.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Mirrors the gate at hooks/useCommandCenterCore.tsx (loadReadiness). */
const releases = (authChecked: boolean, authUserId: string | null, userId: string | null, companyId: string | null) =>
  !(!authChecked || (!authUserId && !userId) || !companyId);

/** The pre-change gate, kept to prove the bearer case really was blocked. */
const releasesOld = (authChecked: boolean, _authUserId: string | null, userId: string | null, companyId: string | null) =>
  !(!authChecked || !userId || !companyId);

const COMPANY = 'company-1';

describe('readiness wave identity gate', () => {
  it('A — bearer principal releases on authUserId alone', () => {
    expect(releases(true, 'jwt-sub', null, COMPANY)).toBe(true);
  });

  it('A(mutation) — the old gate blocked exactly that case', () => {
    expect(releasesOld(true, 'jwt-sub', null, COMPANY)).toBe(false);
  });

  it('B — cookie/legacy principal still releases on user.userId', () => {
    expect(releases(true, null, 'legacy_super_admin', COMPANY)).toBe(true);
    expect(releases(true, null, 'content_architect', COMPANY)).toBe(true);
  });

  it('C — neither identity: wave does not start', () => {
    expect(releases(true, null, null, COMPANY)).toBe(false);
  });

  it('D — no company: wave does not start, whichever identity exists', () => {
    expect(releases(true, 'jwt-sub', 'db-user', null)).toBe(false);
    expect(releases(true, 'jwt-sub', 'db-user', '')).toBe(false);
  });

  it('E — auth not checked: wave does not start', () => {
    expect(releases(false, 'jwt-sub', 'db-user', COMPANY)).toBe(false);
  });

  it('both identities present still releases', () => {
    expect(releases(true, 'jwt-sub', 'db-user', COMPANY)).toBe(true);
  });
});

describe('source invariants', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../hooks/useCommandCenterCore.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the deployed gate matches the tested predicate', () => {
    expect(code).toContain('if (!authChecked || (!authUserId && !user?.userId) || !selectedCompanyId) return;');
  });

  it('the readiness effect can react to authUserId', () => {
    expect(code).toContain('}, [authChecked, authUserId, selectedCompanyId, user?.userId]);');
  });

  it('company guard is retained', () => {
    expect(code).toContain('!selectedCompanyId');
  });

  it('analytics identity still uses DB-backed user.userId, not authUserId', () => {
    expect(code).toContain('logCommandCenterViewed(user.userId');
    expect(code).toContain('logCardClicked(user.userId');
    expect(code).toContain('logCommandCenterDismissed(user.userId');
    expect(code).not.toContain('logCommandCenterViewed(authUserId');
    expect(code).not.toContain('logCardClicked(authUserId');
  });

  it('loadUserTier keeps the original DB-backed gate', () => {
    expect(code).toContain('if (!authChecked || !user?.userId || !selectedCompanyId) return;');
  });

  it('authUserId is never used as a company, org or role value', () => {
    expect(code).not.toMatch(/compan(y|yId)\s*[:=]\s*authUserId/i);
    expect(code).not.toMatch(/org(anization)?_?[iI]d\s*[:=]\s*authUserId/i);
    expect(code).not.toMatch(/role\s*[:=]\s*authUserId/i);
    expect(code).not.toMatch(/authUserId\s*\}\s*\)/); // not passed as a lone arg object
  });
});
