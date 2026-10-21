#!/usr/bin/env node
/**
 * PI-VERIFY-001 — backend-test typecheck non-regression gate (G-15 enforcement).
 *
 * WHY THIS SCRIPT EXISTS
 * ----------------------
 * Root `tsconfig.json` sets `"isolatedModules": true`, so ts-jest runs
 * transpile-only and jest NEVER type-checks. `tsconfig.backend-tests.json` is
 * the only project that type-checks `backend/tests/**`, and before PI-VERIFY-001
 * the script that runs it (`npm run typecheck:backend-tests`) was wired to NO
 * workflow. A net-new type error in a backend test therefore failed no gate.
 *
 * It cannot simply be made blocking: the surface carries 260 pre-existing
 * diagnostics, so a raw `tsc` exits 2 on a clean tree. This gate is the
 * established `scripts/*-baseline.json` pattern applied to that surface.
 *
 * WHY A SET AND NOT A COUNT
 * -------------------------
 * `scripts/typecheck-baseline.js` compares a TOTAL COUNT. That is too weak
 * here: fixing one diagnostic while introducing another keeps the count at 260
 * and passes, which is exactly the "net-new = 0" claim PI-VERIFY-001 has to be
 * able to make honestly. So this gate compares the diagnostic SET as a multiset
 * and reports both directions:
 *
 *   net-new  (present now, absent from baseline)  -> FAIL
 *   resolved (absent now, present in baseline)    -> PASS, baseline can tighten
 *   identical                                     -> PASS, at baseline
 *
 * Keys deliberately EXCLUDE line and column. A diagnostic's line number moves
 * whenever anything above it is edited, and an unrelated edit must not be
 * reported as a net-new type error. The key is `<file>|<TScode>|<message>`,
 * counted, so a genuinely new error in an already-dirty file is still caught
 * (its count rises) while a pure line shift is invisible.
 *
 * A RUN MUST BE VALID BEFORE IT IS COMPARED
 * -----------------------------------------
 * A compiler that crashed prints FEWER diagnostics than a complete run, and a
 * missing diagnostic looks exactly like a resolved one. Before this check, a
 * tsc killed by an out-of-memory error printed nothing, every baseline entry
 * read as "resolved", and the gate said PASS. So the compiler result is
 * validated first (`evaluateRun`) and an invalid run is a FAIL whatever the
 * diagnostic arithmetic says:
 *
 *   spawn error / buffer overflow / killed by a signal          -> invalid
 *   crash marker in the output (FATAL ERROR, heap out of memory,
 *     Debug Failure, Maximum call stack size exceeded)           -> invalid
 *   a global `error TSxxxx:` (config/project error, no file)     -> invalid
 *   exit 0 with no diagnostics                                   -> valid
 *   exit 1 or 2 (tsc "diagnostics present") with >= 1 parsed     -> valid
 *   exit 0 WITH diagnostics, exit 1/2 with NONE parsed,
 *     or any other status (3 invalid project, 4 cycle, a crash)  -> invalid
 *
 * `--update-baseline` refuses to write from an invalid run, so a crash can
 * never become the new baseline either.
 *
 * Never fakes green: the full tsc output is streamed through, and the baseline
 * is only rewritten by an explicit `--update-baseline`, never automatically.
 *
 * Usage:
 *   node scripts/backend-tests-typecheck-baseline.js
 *   node scripts/backend-tests-typecheck-baseline.js --update-baseline
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const baselineFile = path.join(__dirname, 'backend-tests-typecheck-baseline.json');

// Same invocation as `npm run typecheck:backend-tests`. `--incremental false`
// matters: a stale .tsbuildinfo makes tsc report nothing and exit 0.
function runCompiler() {
  return spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p', 'tsconfig.backend-tests.json',
      '--noEmit',
      '--incremental', 'false',
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

// A primary diagnostic line starts at column 0; tsc indents continuation
// lines, which must not be counted as separate diagnostics.
const DIAG = /^([^\s(][^(]*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
// A diagnostic with no file (bad tsconfig, missing project, …): the run did
// not check the surface at all.
const GLOBAL_ERROR = /^error TS\d+: /;
const CRASH_MARKERS = [/FATAL ERROR/, /heap out of memory/i, /Debug Failure/, /Maximum call stack size exceeded/];
// tsc ExitStatus: 0 Success, 1 DiagnosticsPresent_OutputsSkipped,
// 2 DiagnosticsPresent_OutputsGenerated. Anything else is not a completed check.
const DIAGNOSTIC_EXIT_STATUSES = new Set([1, 2]);

function collect(text) {
  const counts = new Map();
  let total = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = DIAG.exec(line);
    if (!m) continue;
    total += 1;
    // Normalise the path separator so a Windows run and a Linux CI run
    // produce identical keys.
    const file = m[1].split('\\').join('/');
    const key = `${file}|${m[4]}|${m[5]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { counts, total };
}

/**
 * Was this a complete compiler run whose diagnostics can be trusted?
 * `run` is a `spawnSync` result (or a test double of one).
 * Returns { valid: true, output, counts, total } or { valid: false, reason, output }.
 */
function evaluateRun(run) {
  const r = run || {};
  const output = `${typeof r.stdout === 'string' ? r.stdout : ''}${typeof r.stderr === 'string' ? r.stderr : ''}`;
  const invalid = (reason) => ({ valid: false, reason, output });

  if (r.error) return invalid(`compiler could not run (${r.error.code || r.error.name || 'spawn error'})`);
  if (r.signal) return invalid(`compiler was killed by signal ${r.signal}`);
  if (typeof r.status !== 'number' || !Number.isInteger(r.status)) return invalid('compiler produced no exit status');

  const lines = output.split(/\r?\n/);
  const crash = CRASH_MARKERS.find((re) => lines.some((l) => !DIAG.test(l) && re.test(l)));
  if (crash) return invalid(`compiler crashed (output matches ${crash})`);
  const globalError = lines.find((l) => GLOBAL_ERROR.test(l));
  if (globalError) return invalid(`compiler reported a project-level error: ${globalError.slice(0, 200)}`);

  const { counts, total } = collect(output);
  if (r.status === 0) {
    if (total !== 0) return invalid(`compiler exited 0 but printed ${total} diagnostic(s)`);
    return { valid: true, output, counts, total };
  }
  if (DIAGNOSTIC_EXIT_STATUSES.has(r.status)) {
    if (total === 0) return invalid(`compiler exited ${r.status} (diagnostics present) but no diagnostic could be parsed`);
    return { valid: true, output, counts, total };
  }
  return invalid(`compiler exited with status ${r.status}, which is not a completed type check`);
}

/** Multiset comparison of the actual diagnostics against the baseline's. */
function compare(actual, baselineDiagnostics) {
  const expected = new Map(Object.entries(baselineDiagnostics || {}));
  const netNew = [];
  const resolved = [];
  for (const [key, n] of actual) {
    const was = expected.get(key) || 0;
    if (n > was) netNew.push({ key, extra: n - was });
  }
  for (const [key, n] of expected) {
    const now = actual.get(key) || 0;
    if (now < n) resolved.push({ key, gone: n - now });
  }
  return { netNew, resolved };
}

/**
 * The whole decision, free of I/O: returns { exitCode, text, writeBaseline? }.
 * `baseline` is the parsed baseline file, or null when it does not exist.
 */
function decide(run, baseline, { update = false } = {}) {
  const evaluated = evaluateRun(run);
  if (!evaluated.valid) {
    return {
      exitCode: 1,
      text: `\nRESULT: FAIL — the type check did not complete, so its diagnostics cannot be compared: ${evaluated.reason}.`
        + `${update ? ' The baseline was NOT updated.' : ''}\n`,
    };
  }
  const { counts: actual, total: actualTotal } = evaluated;

  if (update) {
    const sorted = [...actual.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return {
      exitCode: 0,
      writeBaseline: {
        note:
          'PI-VERIFY-001 non-regression baseline for tsconfig.backend-tests.json. '
          + 'Keys are <file>|<TScode>|<message> with line/column deliberately omitted so an '
          + 'unrelated edit that shifts a line is not reported as a net-new error. Lower this '
          + 'set only in a deliberate, reviewed commit. Suppressing errors with any/@ts-ignore '
          + 'to move the number is out of contract.',
        total: actualTotal,
        diagnostics: Object.fromEntries(sorted),
      },
      text: `\nbaseline written: ${actualTotal} diagnostics, ${sorted.length} distinct keys\n`,
    };
  }

  if (!baseline) {
    return { exitCode: 1, text: `\nRESULT: FAIL — no baseline at ${baselineFile}. Generate it with --update-baseline.\n` };
  }

  const { netNew, resolved } = compare(actual, baseline.diagnostics);
  let text = `\n── backend-test typecheck baseline guard ──\n`
    + `baseline total: ${baseline.total}\n`
    + `actual total:   ${actualTotal}\n`
    + `net-new:        ${netNew.reduce((a, d) => a + d.extra, 0)}\n`
    + `resolved:       ${resolved.reduce((a, d) => a + d.gone, 0)}\n`;

  if (netNew.length) {
    text += `\nNET-NEW DIAGNOSTICS (not present in the baseline):\n`;
    for (const d of netNew) text += `  +${d.extra}  ${d.key}\n`;
    text += `\nRESULT: FAIL — ${netNew.reduce((a, d) => a + d.extra, 0)} net-new diagnostic(s) in the backend test surface.\n`;
    return { exitCode: 1, text };
  }

  if (resolved.length) {
    text += `\nRESOLVED (present in the baseline, gone now):\n`;
    for (const d of resolved) text += `  -${d.gone}  ${d.key}\n`;
    text += `\nRESULT: PASS — no net-new diagnostics; debt reduced by ${resolved.reduce((a, d) => a + d.gone, 0)}. `
      + `Re-run with --update-baseline in a dedicated commit to lock the gain.\n`;
    return { exitCode: 0, text };
  }

  return { exitCode: 0, text: `${text}RESULT: PASS — diagnostic set identical to baseline, net-new 0.\n` };
}

function main() {
  const update = process.argv.includes('--update-baseline');
  const run = runCompiler();
  process.stdout.write(`${typeof run.stdout === 'string' ? run.stdout : ''}${typeof run.stderr === 'string' ? run.stderr : ''}`);
  const baseline = !update && fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
  const result = decide(run, baseline, { update });
  if (result.writeBaseline) fs.writeFileSync(baselineFile, `${JSON.stringify(result.writeBaseline, null, 2)}\n`);
  process.stdout.write(result.text);
  process.exit(result.exitCode);
}

module.exports = { DIAG, collect, evaluateRun, compare, decide };
if (require.main === module) main();
