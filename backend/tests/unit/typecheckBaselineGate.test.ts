/**
 * Typecheck baseline gate — `scripts/typecheck-baseline.js` (npm run
 * typecheck:ci, the required "typecheck-baseline" check) must never read an
 * incomplete compiler run as success.
 *
 * Regression: the guard counted `error TS` lines and ignored whether each tsc
 * run finished. A project killed by an out-of-memory error printed nothing,
 * its errors vanished from the total, and the drop read as "debt reduced" —
 * PASS with exit 0. These tests drive the decision with `spawnSync`-shaped
 * doubles of typecheck-all.js output — no real compiler.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evaluateRun, decide } = require('../../../scripts/typecheck-baseline.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

const D1 = "pages/a.tsx(10,5): error TS2339: Property 'x' does not exist on type 'Y'.";
const D2 = "backend/b.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.";
const D3 = "scripts/c.ts(7,2): error TS7006: Parameter 'p' implicitly has an 'any' type.";
const OOM_STDERR = '\n<--- Last few GCs --->\n\nFATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\n';

type Section = { project: string; diagnostics?: string[]; result: string };

/** Builds stdout in the exact shape typecheck-all.js prints. */
function runnerOutput(sections: Section[], summary?: string): string {
  const body = sections
    .map((s) => `\n=== typecheck: ${s.project} ===\n${(s.diagnostics || []).map((d) => `${d}\n`).join('')}--- ${s.project}: ${s.result} ---\n`)
    .join('');
  const clean = sections.filter((s) => s.result === 'OK').length;
  return `${body}\ntypecheck summary: ${summary ?? `${clean}/${sections.length}`} projects clean\n`;
}

const debtSections: Section[] = [
  { project: 'tsconfig.json', diagnostics: [D1], result: 'FAILED (exit 2)' },
  { project: 'tsconfig.backend.json', diagnostics: [D2], result: 'FAILED (exit 2)' },
  { project: 'tsconfig.scripts.json', diagnostics: [D3], result: 'FAILED (exit 2)' },
];
const run = (over: Record<string, unknown>) => ({ status: 1, signal: null, stdout: runnerOutput(debtSections), stderr: '', ...over });

describe('typecheck baseline gate — every project run must complete before the total is compared', () => {
  it('a clean run (exit 0, every project OK, no diagnostics) passes', () => {
    const stdout = runnerOutput([
      { project: 'tsconfig.json', result: 'OK' },
      { project: 'tsconfig.backend.json', result: 'OK' },
    ]);
    expect(evaluateRun(run({ status: 0, stdout }))).toMatchObject({ valid: true, total: 0 });
    expect(decide(run({ status: 0, stdout }), 0)).toMatchObject({ exitCode: 0 });
  });

  it('ordinary debt at baseline passes even though the runner exits 1', () => {
    const r = decide(run({}), 3);
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/RESULT: PASS — at baseline, no regression/);
  });

  it('errors above baseline fail, as before', () => {
    const r = decide(run({}), 2);
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/RESULT: FAIL — 1 new TypeScript error\(s\) above baseline/);
  });

  it('debt below baseline still passes and asks for the baseline to be lowered, as before', () => {
    const r = decide(run({}), 5);
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/debt reduced by 2/);
  });

  it('THE REGRESSION: a project that crashed with no output cannot make the total look reduced', () => {
    const stdout = runnerOutput([
      { project: 'tsconfig.json', result: 'FAILED (exit 134)' },
      { project: 'tsconfig.backend.json', diagnostics: [D2], result: 'FAILED (exit 2)' },
      { project: 'tsconfig.scripts.json', diagnostics: [D3], result: 'FAILED (exit 2)' },
    ]);
    const r = decide(run({ stdout }), 3);
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/tsconfig\.json exited with status 134, which is not a completed type check/);
  });

  it('a compiler killed by a signal fails, whatever the counts', () => {
    for (const result of ['FAILED (signal SIGKILL)', 'FAILED (signal SIGABRT)', 'FAILED (error ENOENT)']) {
      const stdout = runnerOutput([
        { project: 'tsconfig.json', result },
        { project: 'tsconfig.backend.json', diagnostics: [D2], result: 'FAILED (exit 2)' },
      ]);
      const r = decide(run({ stdout }), 10);
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/did not finish/);
    }
  });

  it('a project that reports diagnostics-present but printed none fails', () => {
    const stdout = runnerOutput([
      { project: 'tsconfig.json', result: 'FAILED (exit 1)' },
      { project: 'tsconfig.backend.json', diagnostics: [D2], result: 'FAILED (exit 2)' },
    ]);
    const r = decide(run({ stdout }), 10);
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/exited 1 \(diagnostics present\) but no diagnostic could be parsed/);
  });

  it('a project that exited 0 but printed diagnostics fails', () => {
    const stdout = runnerOutput([{ project: 'tsconfig.json', diagnostics: [D1], result: 'OK' }]);
    expect(decide(run({ status: 0, stdout }), 10).exitCode).toBe(1);
  });

  it('an out-of-memory marker anywhere in the output fails', () => {
    const r = decide(run({ stderr: OOM_STDERR }), 10);
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/compiler crashed/);
  });

  it('truncated output (a section with no result line, or no summary) fails', () => {
    const full = runnerOutput(debtSections);
    const cut = full.slice(0, full.indexOf('--- tsconfig.backend.json'));
    expect(decide(run({ stdout: cut }), 10).exitCode).toBe(1);
    const noSummary = full.slice(0, full.indexOf('\ntypecheck summary'));
    expect(decide(run({ stdout: noSummary }), 10).text).toMatch(/no summary line/);
  });

  it('a summary that disagrees with the project results fails', () => {
    const stdout = runnerOutput(debtSections, '3/3');
    expect(decide(run({ stdout }), 10).text).toMatch(/disagrees/);
  });

  it('spawn errors, output overflow, signals and unexpected runner statuses fail', () => {
    expect(decide(run({ error: Object.assign(new Error('x'), { code: 'ENOBUFS' }) }), 10).text).toMatch(/ENOBUFS/);
    expect(decide(run({ signal: 'SIGTERM', status: null }), 10).text).toMatch(/killed by signal SIGTERM/);
    expect(decide(run({ status: null }), 10).text).toMatch(/no exit status/);
    expect(decide(run({ status: 134 }), 10).text).toMatch(/runner exited with status 134/);
    expect(decide(run({ status: 0 }), 10).text).toMatch(/disagrees with the project results/);
  });

  it('the CLI sets process.exitCode instead of calling process.exit, so piped output is not cut short', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../scripts/typecheck-baseline.js'), 'utf8');
    expect(src).not.toMatch(/process\.exit\(/);
    expect(src).toContain('process.exitCode = result.exitCode');
  });

  it('typecheck-all.js still prints the lines this gate parses', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../scripts/typecheck-all.js'), 'utf8');
    expect(src).toContain('`\\n=== typecheck: ${project} ===\\n`');
    expect(src).toContain('`--- ${project}: FAILED (exit ${result.status}) ---\\n`');
    expect(src).toContain('`--- ${project}: FAILED (${why}) ---\\n`');
    expect(src).toContain('`--- ${project}: OK ---\\n`');
    expect(src).toContain('typecheck summary: ${PROJECTS.length - failed}/${PROJECTS.length} projects clean');
  });
});

// Module scope: without an import/export this file shares the global script
// scope with backendTestsTypecheckBaselineGate.test.ts (TS2451 redeclarations).
export {};
