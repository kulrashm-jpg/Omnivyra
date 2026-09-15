/**
 * STEP 3AH-91 (W2F-5) — the wave-2 gate changes are wired into the blocking
 * CI job and the fixture-suite runner:
 *   - new step "Constant-time secret comparison gate" (npm run check:constant-time)
 *   - the strengthened route-auth (W2F-1/W2F-3) and SSRF (W2F-4) gates keep
 *     running in their existing blocking steps;
 *   - every W2F fixture suite is listed in scripts/security/run-gate-tests.js;
 *   - no pre-existing gate step was removed.
 */
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const wf = fs.readFileSync(path.join(REPO, '.github/workflows/typecheck-baseline.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

function step(name: string): string {
  const at = wf.indexOf(`- name: ${name}`);
  if (at < 0) return '';
  const next = wf.indexOf('- name:', at + 1);
  return wf.slice(at, next < 0 ? undefined : next);
}

describe('W2F-5 — CI wiring', () => {
  it('the constant-time gate is a blocking step of the PR/push-to-main job', () => {
    const s = step('Constant-time secret comparison gate');
    expect(s).toContain('run: npm run check:constant-time');
    expect(s).not.toMatch(/continue-on-error:\s*true/);
    expect(pkg.scripts['check:constant-time']).toBe('node scripts/check-constant-time-secrets.js');
    expect(fs.existsSync(path.join(REPO, 'scripts/check-constant-time-secrets.js'))).toBe(true);
  });

  it.each([
    ['Route authentication gate', 'npm run check:route-auth'],
    ['Outbound-SSRF guard', 'npm run check:ssrf'],
    ['Secret-pattern gate', 'npm run check:secrets'],
    ['Security gate fixture tests', 'npm run test:security-gates'],
    ['Migration quality gate', 'node scripts/check-migration-quality.js'],
    ['Tenant-authz guard', 'npm run check:authz'],
    ['withRBAC identifier-binding guard', 'npm run check:rbac-binding'],
    ['withOrgAccess identifier-binding guard', 'npm run check:orgaccess-binding'],
  ])('existing blocking step "%s" is still present and blocking', (name, cmd) => {
    const s = step(name);
    expect(s).toContain(`run: ${cmd}`);
    expect(s).not.toMatch(/continue-on-error:\s*true/);
  });

  it('the fixture-suite runner lists every W2F suite, and each exists', () => {
    const runner = fs.readFileSync(path.join(REPO, 'scripts/security/run-gate-tests.js'), 'utf8');
    const listed = [...runner.matchAll(/'(backend\/tests\/unit\/[^']+\.test\.ts)'/g)].map((m) => m[1]);
    const w2f = fs.readdirSync(path.join(REPO, 'backend/tests/unit')).filter((f) => /^sec91W2F.*\.test\.ts$/.test(f)).map((f) => `backend/tests/unit/${f}`);
    expect(w2f.length).toBeGreaterThanOrEqual(5);
    expect(listed).toEqual(expect.arrayContaining(w2f));
    for (const f of listed) expect(fs.existsSync(path.join(REPO, f))).toBe(true);
  });
});
