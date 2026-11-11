/**
 * SEC-001B/C/D -> e9 (C), 2026-11-11 — the legacy cookie bridge stays GONE.
 *
 * SEC-001B removed raw `=1` comparisons, SEC-001C unified the two bridge entry
 * points, SEC-001D retired bridge-only routes. e9 (C) finished the job: the
 * route-level getter (services/superAdminSession), the bridge principal and
 * its lifecycle (security/legacyCookieSuperAdminBridge), the signed bridge
 * cookie primitive (security/bridgeCookie) and every content-architect cookie
 * reader are DELETED. The suites that pinned their behaviour (bridgeCookie,
 * sec001b, sec001d, superAdminSessionGuardrails) had no subject left; their
 * repository ratchets live on here as a pin that nothing brings the bridge back.
 *
 * Allowed and expected: the login/logout routes CLEAR the legacy cookies with
 * Set-Cookie strings (`super_admin_session=; ... Max-Age=0`). Clearing is a
 * write, never authorization.
 */
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PROD_DIRS = ['pages', 'backend', 'lib', 'components', 'hooks', 'scripts', 'shared'];

function collect(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'tests' || e.name === '__tests__') continue;
        walk(full);
      } else if (/\.(tsx?|jsx?|cjs|mjs)$/.test(e.name)) out.push(full);
    }
  };
  for (const d of dirs) walk(path.join(REPO_ROOT, d));
  return out;
}
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const rel = (f: string) => path.relative(REPO_ROOT, f).replace(/\\/g, '/');

const files = collect(PROD_DIRS);
const code = new Map(files.map((f) => [f, stripComments(fs.readFileSync(f, 'utf8'))]));
const routes = files.filter((f) => rel(f).startsWith('pages/api/'));

describe('the legacy cookie bridge stays gone (e9 (C))', () => {
  it('collected a meaningful set of production files (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(routes.length).toBeGreaterThan(200);
  });

  it('the deleted bridge modules do not exist', () => {
    for (const m of [
      'backend/services/superAdminSession.ts',
      'backend/security/legacyCookieSuperAdminBridge.ts',
      'backend/security/bridgeCookie.ts',
      'backend/services/bridgeUsageMonitor.ts',
      'pages/api/super-admin/bridge-usage.ts',
    ]) {
      expect([m, fs.existsSync(path.join(REPO_ROOT, m))]).toEqual([m, false]);
    }
  });

  it('NO production file imports a deleted bridge module or names its functions', () => {
    const FORBIDDEN =
      /services\/superAdminSession|security\/legacyCookieSuperAdminBridge|security\/bridgeCookie|getLegacySuperAdminSession|resolveLegacyCookieSuperAdminPrincipal|evaluateBridgeCookieLifecycle|mintSignedBridgeCookieValue|parseSignedBridgeCookie|isContentArchitectSession|checkContentArchitectAccess|getContentArchitectCompanyId|legacyCookieSuperAdminCapabilities|logCookieSuperAdminUsage|bridgeUsageMonitor|reportBridgeUsage/;
    const offenders = files.filter((f) => FORBIDDEN.test(code.get(f)!)).map(rel);
    expect(offenders).toEqual([]);
  });

  it('NO production file READS a legacy cookie from req.cookies', () => {
    const offenders = files
      .filter((f) => /cookies\s*\??\.?\s*[.[]\s*['"]?(super_admin_session|content_architect_session|content_architect_company_id)\b/.test(code.get(f)!))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('NO production file PARSES a legacy cookie out of the Cookie header', () => {
    // A regex literal over the raw header that matches a legacy cookie name
    // followed by `=` (a read), e.g. /(?:^|; )super_admin_session=([^;]+)/.
    const offenders = files
      .filter((f) => /\/[^/\n]*\(\?:\^\|; \)[^/\n]*(super_admin_session|content_architect_session|content_architect_company_id)[^/\n]*\//.test(code.get(f)!))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the only production files that still NAME a legacy cookie value in code are the login/logout routes, and they only CLEAR it', () => {
    const naming = files
      .filter((f) => /['"`](super_admin_session|content_architect_session|content_architect_company_id)=/.test(code.get(f)!))
      .map(rel)
      .sort();
    expect(naming).toEqual([
      'pages/api/super-admin/content-architect-login.ts',
      'pages/api/super-admin/login.ts',
      'pages/api/super-admin/logout.ts',
    ]);
    for (const f of naming) {
      const src = code.get(path.join(REPO_ROOT, f))!;
      // Every occurrence is an empty value (a clear), never a minted one.
      const values = [...src.matchAll(/['"`](?:super_admin_session|content_architect_session|content_architect_company_id)=([^'"`;]*)/g)].map((m) => m[1]);
      expect([f, values.length > 0 && values.every((v) => v === '')]).toEqual([f, true]);
    }
  });

  it('render-ops authorizes by capability only - no bridge arm', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'pages/api/internal/render-ops.ts'), 'utf8');
    expect(/getLegacySuperAdminSession/.test(src)).toBe(false);
    expect(/requireCapability\(req, res/.test(src)).toBe(true);
  });
});
