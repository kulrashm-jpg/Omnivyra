/**
 * P1.9 — auth-readiness decoupling.
 *
 * The decisive assertions are the INVARIANT ones: authUserId is an identity
 * signal for rendering, never authorization. It must never stand in for a
 * company, role, or tenant decision.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const ctx = () => read('components/CompanyContext.tsx');
const core = () => read('hooks/useCommandCenterCore.tsx');

/** Mirrors decodeJwtSub so its contract is asserted behaviourally. */
function decodeJwtSub(token: string | null | undefined): string | null {
  try {
    if (!token) return null;
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch { return null; }
}
const jwt = (payload: unknown) =>
  'h.' + Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_') + '.s';

describe('A. JWT decoder', () => {
  it('returns sub from a valid token', () => {
    expect(decodeJwtSub(jwt({ sub: 'user-123', role: 'admin', company_id: 'c-1' }))).toBe('user-123');
  });
  it('returns null for a malformed token', () => {
    expect(decodeJwtSub('not-a-jwt')).toBeNull();
    expect(decodeJwtSub('a.%%%.c')).toBeNull();
    expect(decodeJwtSub('')).toBeNull();
    expect(decodeJwtSub(null)).toBeNull();
  });
  it('returns null when sub is missing, empty or non-string', () => {
    expect(decodeJwtSub(jwt({ role: 'admin' }))).toBeNull();
    expect(decodeJwtSub(jwt({ sub: '' }))).toBeNull();
    expect(decodeJwtSub(jwt({ sub: 42 }))).toBeNull();
    expect(decodeJwtSub(jwt({ sub: { id: 'x' } }))).toBeNull();
  });
  it('reads ONLY sub — no other claim is consulted', () => {
    const src = ctx();
    const fn = src.slice(src.indexOf('function decodeJwtSub'), src.indexOf('export const CompanyProvider'));
    expect(fn).toMatch(/payload\.sub/);
    expect(fn).not.toMatch(/role|company|org|tenant|aud|scope/i);
  });
});

describe('B. auth lifecycle', () => {
  it('is populated from the token already in hand — no extra request', () => {
    const src = ctx();
    expect(src).toContain('setAuthUserId(hasSession ? decodeJwtSub(sessionToken) : null)');
    const region = src.slice(src.indexOf('let sessionToken'), src.indexOf('setAuthUserId(hasSession'));
    expect(region).not.toMatch(/auth\.getUser\(\)|fetch\(/);
  });
  it('is cleared on sign-out', () => {
    expect(ctx()).toMatch(/setUser\(null\);\s*\n\s*setAuthUserId\(null\)/);
  });
  it('is null when there is no session', () => {
    expect(ctx()).toContain('hasSession ? decodeJwtSub(sessionToken) : null');
  });
});

describe('C. Command Center gating', () => {
  it('the shell gate is auth-only', () => {
    expect(core()).toContain('const _ef1 = !authChecked || !authUserId;');
    expect(core()).not.toContain('const _ef1 = !authChecked || isLoading;');
  });
  it('no longer blocks first render on the company-derived user', () => {
    expect(core()).toContain('if (!authUserId) {');
    expect(core()).not.toMatch(/if \(!user\?\.userId\) \{\s*\n\s*return \{ _ef1: true \}/);
  });
  it('company-dependent effects still require selectedCompanyId', () => {
    expect((core().match(/!selectedCompanyId/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('preferences is auth-only and may use authUserId', () => {
    expect(core()).toMatch(/if \(!authChecked \|\| !authUserId\) return;[\s\S]{0,120}loadPreferences/);
  });
});

describe('D. security invariant', () => {
  it('authUserId is never used as company, org, role or credit key', () => {
    for (const src of [ctx(), core()]) {
      expect(src).not.toMatch(/companyId\s*[:=]\s*authUserId/);
      expect(src).not.toMatch(/organizationId\s*[:=]\s*authUserId/);
      expect(src).not.toMatch(/role\s*[:=]\s*authUserId/);
      expect(src).not.toMatch(/selectedCompanyId\s*[:=]\s*authUserId/);
      expect(src).not.toMatch(/authUserId.*credits/i);
    }
  });
  it('UserContext shape is unchanged — company fields still company-derived', () => {
    const src = ctx();
    expect(src).toContain('defaultCompanyId: companyIds[0]');
    expect(src).toMatch(/role: firstRole === 'SUPER_ADMIN'/);
  });
  it('documents that it is not authorization', () => {
    expect(ctx()).toMatch(/NOT authorization/);
  });
});
