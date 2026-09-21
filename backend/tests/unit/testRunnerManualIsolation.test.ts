/**
 * 3AH-165 — the default test runner must never select backend/tests/manual/**.
 *
 * Those suites call a paid provider (SerpAPI) and INSERT rows into `reports`.
 * The boundary is enforced by jest.config.js (`testPathIgnorePatterns`); the
 * only way in is the dedicated project, jest.manual.config.js
 * (`npm run test:manual -- <path>`).
 *
 * Every check here asks REAL Jest what it would select (`--listTests`), so it
 * covers Jest's actual path semantics — including explicit paths and
 * positional + --testPathPattern (which Jest ORs together). `--listTests` only
 * discovers; no suite is executed and nothing touches the network.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const JEST = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
const MANUAL_DIR = path.join(ROOT, 'backend', 'tests', 'manual');
const LIVE_SERP = 'backend/tests/manual/liveSerpValidation.test.ts';
const ORDINARY = 'backend/tests/unit/cronInstanceDeregistration.test.ts';

/** Paths Jest would run for `args`. `--listTests` prints a blank line when none match. */
function listTests(...args: string[]): string[] {
  const out = execFileSync(process.execPath, [JEST, '--listTests', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => path.relative(ROOT, p).split(path.sep).join('/'));
}

const isManual = (p: string) => p.startsWith('backend/tests/manual/');

const manualSuitesOnDisk = fs
  .readdirSync(MANUAL_DIR)
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => `backend/tests/manual/${f}`)
  .sort();

jest.setTimeout(180_000);

describe('3AH-165 — default runner cannot select manual/live suites', () => {
  it('the manual directory is non-empty (otherwise every check below is vacuous)', () => {
    expect(manualSuitesOnDisk).toContain(LIVE_SERP);
  });

  it('`npm test` selection (jest backend/tests) contains ZERO manual suites and still finds ordinary ones', () => {
    const selected = listTests('backend/tests');
    expect(selected.filter(isManual)).toEqual([]);
    expect(selected).toContain(ORDINARY);
    expect(selected.length).toBeGreaterThan(1_000);
  });

  it('an explicit path to a manual suite selects nothing under the default config', () => {
    for (const suite of manualSuitesOnDisk) {
      expect(listTests(suite)).toEqual([]);
    }
  });

  it('positional path + --testPathPattern (ORed by Jest) still cannot reach the manual directory', () => {
    const selected = listTests(ORDINARY, '--testPathPattern', 'manual');
    expect(selected).toContain(ORDINARY);
    expect(selected.filter(isManual)).toEqual([]);
  });

  it('the `test` script uses the default config — no --config override can bypass the boundary', () => {
    const { scripts } = require(path.join(ROOT, 'package.json'));
    expect(scripts.test).toMatch(/^jest backend\/tests\b/);
    expect(scripts.test).not.toMatch(/--config/);
  });
});

describe('3AH-165 — the explicit manual path still works', () => {
  it('`test:manual` is wired to the dedicated project', () => {
    const { scripts } = require(path.join(ROOT, 'package.json'));
    expect(scripts['test:manual']).toMatch(/--config jest\.manual\.config\.js/);
  });

  it('the manual project selects exactly the manual suites — nothing else', () => {
    const selected = listTests('--config', 'jest.manual.config.js').sort();
    expect(selected).toEqual(manualSuitesOnDisk);
  });

  it('the manual project can target one suite deliberately', () => {
    expect(listTests('--config', 'jest.manual.config.js', LIVE_SERP)).toEqual([LIVE_SERP]);
  });

  it('the manual project cannot be used to run ordinary suites', () => {
    expect(listTests('--config', 'jest.manual.config.js', ORDINARY)).toEqual([]);
  });

  it('the manual project differs from the default ONLY by the manual ignore entry', () => {
    const base = require(path.join(ROOT, 'jest.config.js'));
    const manual = require(path.join(ROOT, 'jest.manual.config.js'));
    expect(base.testPathIgnorePatterns).toContain('/backend/tests/manual/');
    expect(manual.testPathIgnorePatterns).toEqual(
      base.testPathIgnorePatterns.filter((p: string) => p !== '/backend/tests/manual/'),
    );
    // Same production tripwire (setupEnv.ts) and transform as ordinary runs.
    expect(manual.setupFiles).toEqual(base.setupFiles);
    expect(manual.transform).toEqual(base.transform);
  });
});
