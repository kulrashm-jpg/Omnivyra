/**
 * STEP 3AH-91 (SEC-F) — F5 + F7.
 *
 * F5: check-tenant-authz.js is RETAINED but its coverage is superseded by the
 *     route-auth gate. These fixtures pin the relationship: shapes the older
 *     guard lets through are rejected by check-route-auth.js.
 * F7: every strengthened / new gate is wired into the blocking CI job
 *     (.github/workflows/typecheck-baseline.yml) and package.json, and no
 *     pre-existing gate step was removed.
 */
import fs from 'fs';
import path from 'path';

/* eslint-disable @typescript-eslint/no-var-requires */
const tenantAuthz = require('../../../scripts/check-tenant-authz.js');
const routeAuth = require('../../../scripts/check-route-auth.js');

const REPO = path.resolve(__dirname, '../../..');
const DB = "import { supabase } from '../../../backend/db/supabaseClient';";
const REL = 'pages/api/fixture/route.ts';
const routeRules = (src: string, rel = REL): string[] => routeAuth.analyzeRoute(rel, src, {}, {}).violations.map((v: { rule: string }) => v.rule);

describe('F5 — the route-auth gate supersedes check-tenant-authz coverage', () => {
  it('a call written in a COMMENT satisfies check-tenant-authz but not check-route-auth', () => {
    const src = `${DB}
// enforceCompanyAccess( is called upstream
export default async function handler(req, res) {
  const { companyId } = req.query;
  const { data } = await supabase.from('t').select('*').eq('company_id', companyId);
  res.json(data);
}`;
    expect(tenantAuthz.scanSource(src).violation).toBe(false);
    expect(routeRules(src)).toContain('R1');
  });

  it('a campaignId-keyed unauthenticated read is invisible to check-tenant-authz, R1 in check-route-auth', () => {
    const src = `${DB}
export default async function handler(req, res) {
  const { campaignId } = req.query;
  const { data } = await supabase.from('campaign_performance').select('*').eq('campaign_id', campaignId);
  res.json(data);
}`;
    expect(tenantAuthz.scanSource(src)).toEqual(expect.objectContaining({ violation: false, reason: 'no_request_tenant_id' }));
    expect(routeRules(src)).toContain('R1');
  });

  it('a method branch without authorization passes check-tenant-authz (file-level) but is R1-METHOD', () => {
    const src = `import { enforceCompanyAccess } from '../../../backend/services/userContextService';
${DB}
export default async function handler(req, res) {
  const { companyId } = req.query;
  if (req.method === 'GET') { if (!(await enforceCompanyAccess({ req, res, companyId }))) return; return res.json({}); }
  if (req.method === 'DELETE') { await supabase.from('t').delete().eq('company_id', companyId); return res.end(); }
}`;
    expect(tenantAuthz.scanSource(src).violation).toBe(false);
    expect(routeRules(src)).toContain('R1-METHOD');
  });

  it('the older guard is kept and documents the relationship', () => {
    const header = fs.readFileSync(path.join(REPO, 'scripts/check-tenant-authz.js'), 'utf8').slice(0, 6000);
    expect(header).toContain('RELATIONSHIP TO THE ROUTE-AUTH GATE');
    expect(header).toContain('RETAINED');
  });
});

describe('F7 — gates are wired into the blocking CI job', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github/workflows/typecheck-baseline.yml'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

  it('the job runs on every PR and on push to main', () => {
    expect(wf).toMatch(/on:\s*\n\s*pull_request:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
  });

  it.each([
    ['Migration quality gate', 'node scripts/check-migration-quality.js'],
    ['Outbound-SSRF guard', 'npm run check:ssrf'],
    ['Tenant-authz guard', 'npm run check:authz'],
    ['Route authentication gate', 'npm run check:route-auth'],
    ['withRBAC identifier-binding guard', 'npm run check:rbac-binding'],
    ['withOrgAccess identifier-binding guard', 'npm run check:orgaccess-binding'],
    ['Secret-pattern gate', 'npm run check:secrets'],
    ['Security gate fixture tests', 'npm run test:security-gates'],
  ])('step "%s" runs `%s` and is blocking', (name, cmd) => {
    const at = wf.indexOf(`- name: ${name}`);
    expect(at).toBeGreaterThan(-1);
    const next = wf.indexOf('- name:', at + 1);
    const step = wf.slice(at, next < 0 ? undefined : next);
    expect(step).toContain(`run: ${cmd}`);
    expect(step).not.toMatch(/continue-on-error:\s*true/);
  });

  it('package.json scripts point at the gate scripts', () => {
    expect(pkg.scripts['check:secrets']).toBe('node scripts/check-secrets.js');
    expect(pkg.scripts['test:security-gates']).toBe('node scripts/security/run-gate-tests.js');
    expect(pkg.scripts['check:route-auth']).toBe('node scripts/check-route-auth.js');
    expect(pkg.scripts['check:ssrf']).toBe('node scripts/check-outbound-ssrf.js');
    expect(pkg.scripts['check:migrations']).toBe('node scripts/check-migration-quality.js');
  });

  it('the fixture-suite runner lists every gate suite and each exists', () => {
    const runner = fs.readFileSync(path.join(REPO, 'scripts/security/run-gate-tests.js'), 'utf8');
    const listed = [...runner.matchAll(/'(backend\/tests\/unit\/[^']+\.test\.ts)'/g)].map((m) => m[1]);
    expect(listed).toEqual(expect.arrayContaining([
      'backend/tests/unit/routeAuth001Scanner.test.ts',
      'backend/tests/unit/migrationQualitySecurityRules.test.ts',
      'backend/tests/unit/ssrfCiGuard.test.ts',
      'backend/tests/unit/sec91FRouteAuthMethod.test.ts',
      'backend/tests/unit/sec91FMigrationQuality.test.ts',
      'backend/tests/unit/sec91FSsrfScanner.test.ts',
      'backend/tests/unit/sec91FSecretsGate.test.ts',
      'backend/tests/unit/sec91FDormantRoutes.test.ts',
      'backend/tests/unit/sec91FGateHardening.test.ts',
    ]));
    for (const f of listed) expect(fs.existsSync(path.join(REPO, f))).toBe(true);
  });
});
