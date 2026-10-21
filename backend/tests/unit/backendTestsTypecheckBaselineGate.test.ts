/**
 * PI-VERIFY-001 gate — `scripts/backend-tests-typecheck-baseline.js` must never
 * read an incomplete compiler run as success.
 *
 * Regression: a tsc killed by an out-of-memory error printed no diagnostics;
 * every baseline entry then looked "resolved" and the gate said PASS with exit
 * 0. These tests drive the gate's decision with `spawnSync`-shaped doubles — no
 * real compiler, no memory exhaustion.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evaluateRun, decide, collect } = require('../../../scripts/backend-tests-typecheck-baseline.js');

const D1 = "backend/tests/unit/a.test.ts(10,5): error TS2339: Property 'x' does not exist on type 'Y'.";
const D2 = "backend/tests/unit/b.test.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.";
const K1 = "backend/tests/unit/a.test.ts|TS2339|Property 'x' does not exist on type 'Y'.";
const K2 = "backend/tests/unit/b.test.ts|TS2322|Type 'string' is not assignable to type 'number'.";
const BASELINE = { total: 2, diagnostics: { [K1]: 1, [K2]: 1 } };

const run = (over: Record<string, unknown>) => ({ status: 2, signal: null, stdout: `${D1}\n${D2}\n`, stderr: '', ...over });
const OOM_STDERR = '\n<--- Last few GCs --->\n\nFATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\n';

describe('backend-tests typecheck gate — a run must be complete before it is compared', () => {
  it('1. exit 0 with no diagnostics is a valid run (all debt resolved → PASS)', () => {
    expect(evaluateRun(run({ status: 0, stdout: '' }))).toMatchObject({ valid: true, total: 0 });
    const r = decide(run({ status: 0, stdout: '' }), BASELINE);
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/RESULT: PASS — no net-new diagnostics; debt reduced by 2/);
  });

  it('valid diagnostics identical to the baseline → PASS (exit 2 is how tsc reports diagnostics)', () => {
    const r = decide(run({}), BASELINE);
    expect(r).toMatchObject({ exitCode: 0 });
    expect(r.text).toMatch(/identical to baseline, net-new 0/);
  });

  it('2. a non-zero exit outside tsc\'s diagnostic statuses FAILS even with favourable counts', () => {
    for (const status of [3, 4, 12, 134, 3221226505]) {
      const r = decide(run({ status, stdout: '' }), BASELINE);
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(new RegExp(`exited with status ${status}`));
      expect(r.text).not.toMatch(/RESULT: PASS/);
    }
  });

  it('3. a compiler killed by a signal FAILS', () => {
    const r = decide(run({ status: null, signal: 'SIGKILL', stdout: '' }), BASELINE);
    expect(r).toMatchObject({ exitCode: 1 });
    expect(r.text).toMatch(/killed by signal SIGKILL/);
  });

  it('4. a compiler that fails to spawn (or overflows its buffer) FAILS', () => {
    expect(decide(run({ status: null, error: Object.assign(new Error('spawn'), { code: 'ENOENT' }), stdout: '' }), BASELINE))
      .toMatchObject({ exitCode: 1, text: expect.stringMatching(/could not run \(ENOENT\)/) });
    expect(decide(run({ status: null, error: Object.assign(new Error('buf'), { code: 'ENOBUFS' }) }), BASELINE))
      .toMatchObject({ exitCode: 1, text: expect.stringMatching(/ENOBUFS/) });
  });

  it('5. empty or malformed output with a diagnostics exit FAILS', () => {
    for (const stdout of ['', 'garbage\nnot a diagnostic\n', '   indented continuation only\n']) {
      const r = decide(run({ status: 2, stdout }), BASELINE);
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/no diagnostic could be parsed/);
    }
    expect(decide(run({ status: undefined, stdout: '' }), BASELINE).text).toMatch(/no exit status/);
    expect(decide(undefined, BASELINE).exitCode).toBe(1);
  });

  it('exit 0 that nevertheless printed diagnostics is inconsistent → FAIL', () => {
    expect(decide(run({ status: 0 }), BASELINE)).toMatchObject({ exitCode: 1, text: expect.stringMatching(/exited 0 but printed 2/) });
  });

  it('a project-level error (no file) means nothing was checked → FAIL', () => {
    const r = decide(run({ status: 1, stdout: "error TS5058: The specified path does not exist: 'tsconfig.backend-tests.json'.\n" }), BASELINE);
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/project-level error/);
  });

  it('6. valid diagnostics: debt changes are computed as before (resolved → PASS, net-new → FAIL)', () => {
    const resolved = decide(run({ stdout: `${D1}\n` }), BASELINE);
    expect(resolved.exitCode).toBe(0);
    expect(resolved.text).toMatch(/resolved:\s+1/);
    expect(resolved.text).toContain(`-1  ${K2}`);

    const D3 = "backend/tests/unit/c.test.ts(1,1): error TS2304: Cannot find name 'z'.";
    const netNew = decide(run({ stdout: `${D1}\n${D2}\n${D3}\n` }), BASELINE);
    expect(netNew.exitCode).toBe(1);
    expect(netNew.text).toMatch(/RESULT: FAIL — 1 net-new diagnostic/);

    // A repeated diagnostic in an already-dirty file is still net-new.
    expect(decide(run({ stdout: `${D1}\n${D1}\n${D2}\n` }), BASELINE).exitCode).toBe(1);
  });

  it('7. an out-of-memory crash FAILS whatever the exit status — the reported regression', () => {
    // As observed: tsc died, printed no diagnostics, exit status non-zero.
    const observed = decide(run({ status: 134, stdout: '', stderr: OOM_STDERR }), BASELINE);
    expect(observed.exitCode).toBe(1);
    expect(observed.text).toMatch(/compiler crashed/);
    expect(observed.text).not.toMatch(/debt reduced/);
    // Even if a wrapper reported a "diagnostics" status, partial output plus a crash is not a result.
    expect(decide(run({ status: 2, stdout: `${D1}\n`, stderr: OOM_STDERR }), BASELINE).exitCode).toBe(1);
    // …and even exit 0.
    expect(decide(run({ status: 0, stdout: '', stderr: OOM_STDERR }), BASELINE).exitCode).toBe(1);
  });

  it('crash markers inside a real diagnostic message do not trip the crash check', () => {
    const D = "backend/tests/unit/x.test.ts(1,1): error TS2345: Argument of type '\"FATAL ERROR\"' is not assignable to parameter of type 'never'.";
    expect(evaluateRun(run({ stdout: `${D}\n` }))).toMatchObject({ valid: true, total: 1 });
  });

  it('--update-baseline refuses to write from an invalid run', () => {
    const r = decide(run({ status: 134, stdout: '', stderr: OOM_STDERR }), null, { update: true });
    expect(r.exitCode).toBe(1);
    expect(r.writeBaseline).toBeUndefined();
    expect(r.text).toMatch(/baseline was NOT updated/);
  });

  it('--update-baseline writes from a valid run (unchanged behaviour)', () => {
    const r = decide(run({}), null, { update: true });
    expect(r.exitCode).toBe(0);
    expect(r.writeBaseline).toMatchObject({ total: 2, diagnostics: { [K1]: 1, [K2]: 1 } });
  });

  it('a missing baseline still FAILS (unchanged behaviour)', () => {
    expect(decide(run({}), null)).toMatchObject({ exitCode: 1, text: expect.stringMatching(/no baseline at/) });
  });

  it('keys ignore line/column and normalise Windows path separators (unchanged behaviour)', () => {
    const { counts } = collect("backend\\tests\\unit\\a.test.ts(99,9): error TS2339: Property 'x' does not exist on type 'Y'.\n");
    expect([...counts.keys()]).toEqual([K1]);
  });
});

describe('backend-tests typecheck gate — the CLI delivers its whole output and the verdict exit code', () => {
  // Regression: `process.stdout.write(big); process.exit(code)` dropped
  // everything past the 64 KiB pipe buffer on Linux CI, RESULT line included.
  // The real script runs as a child with stdout PIPED to this test; a preloaded
  // stub answers only the tsc spawn with a >64 KiB fake result. (On Windows a
  // pipe is synchronous, so there this checks content and exit code; the
  // flush behaviour itself is exercised wherever the suite runs on Linux.)
  /* eslint-disable @typescript-eslint/no-var-requires */
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawnSync } = require('child_process');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const SCRIPT = path.join(__dirname, '../../../scripts/backend-tests-typecheck-baseline.js');
  const FILLER = `${'x'.repeat(99)}\n`.repeat(800); // 80,000 bytes of non-diagnostic output

  function runCli(fakeRun: Record<string, unknown>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-gate-'));
    const runFile = path.join(dir, 'run.json');
    const stub = path.join(dir, 'stub.js');
    fs.writeFileSync(runFile, JSON.stringify(fakeRun));
    fs.writeFileSync(stub, [
      "const cp = require('child_process');",
      'const real = cp.spawnSync;',
      `const fake = JSON.parse(require('fs').readFileSync(${JSON.stringify(runFile)}, 'utf8'));`,
      "cp.spawnSync = (cmd, args, opts) => (Array.isArray(args) && String(args[0]).includes('typescript') ? fake : real(cmd, args, opts));",
    ].join('\n'));
    try {
      return spawnSync(process.execPath, ['-r', stub, SCRIPT], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the script never calls process.exit (it sets process.exitCode and lets stdout flush)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/process\.exit\(/);
    expect(src).toMatch(/process\.exitCode = result\.exitCode;/);
  });

  it('a crashed compiler with >64 KiB of output: exit 1, and the FAIL verdict arrives at the end', () => {
    const child = runCli({ status: 134, signal: null, stdout: FILLER, stderr: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n' });
    expect(child.status).toBe(1);
    expect(child.stdout.length).toBeGreaterThan(80000);
    expect(child.stdout.trimEnd()).toMatch(/RESULT: FAIL — the type check did not complete[^\n]*compiler crashed[^\n]*$/);
  });

  it('a complete run with >64 KiB of output: exit 0, and the PASS verdict arrives at the end', () => {
    const child = runCli({ status: 0, signal: null, stdout: FILLER, stderr: '' });
    expect(child.status).toBe(0);
    expect(child.stdout.length).toBeGreaterThan(80000);
    expect(child.stdout.trimEnd()).toMatch(/RESULT: PASS[^\n]*$/);
  });
});
