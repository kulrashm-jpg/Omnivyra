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
const run = spawnSync(
  process.execPath,
  [
    path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p', 'tsconfig.backend-tests.json',
    '--noEmit',
    '--incremental', 'false',
  ],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

const output = `${run.stdout || ''}${run.stderr || ''}`;
process.stdout.write(output);

// A primary diagnostic line starts at column 0; tsc indents continuation
// lines, which must not be counted as separate diagnostics.
const DIAG = /^([^\s(][^(]*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

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

const { counts: actual, total: actualTotal } = collect(output);

if (process.argv.includes('--update-baseline')) {
  const sorted = [...actual.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  fs.writeFileSync(
    baselineFile,
    `${JSON.stringify(
      {
        note:
          'PI-VERIFY-001 non-regression baseline for tsconfig.backend-tests.json. '
          + 'Keys are <file>|<TScode>|<message> with line/column deliberately omitted so an '
          + 'unrelated edit that shifts a line is not reported as a net-new error. Lower this '
          + 'set only in a deliberate, reviewed commit. Suppressing errors with any/@ts-ignore '
          + 'to move the number is out of contract.',
        total: actualTotal,
        diagnostics: Object.fromEntries(sorted),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`\nbaseline written: ${actualTotal} diagnostics, ${sorted.length} distinct keys\n`);
  process.exit(0);
}

if (!fs.existsSync(baselineFile)) {
  process.stdout.write(`\nRESULT: FAIL — no baseline at ${baselineFile}. Generate it with --update-baseline.\n`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const expected = new Map(Object.entries(baseline.diagnostics || {}));

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

process.stdout.write(
  `\n── backend-test typecheck baseline guard ──\n`
  + `baseline total: ${baseline.total}\n`
  + `actual total:   ${actualTotal}\n`
  + `net-new:        ${netNew.reduce((a, d) => a + d.extra, 0)}\n`
  + `resolved:       ${resolved.reduce((a, d) => a + d.gone, 0)}\n`,
);

if (netNew.length) {
  process.stdout.write(`\nNET-NEW DIAGNOSTICS (not present in the baseline):\n`);
  for (const d of netNew) process.stdout.write(`  +${d.extra}  ${d.key}\n`);
  process.stdout.write(
    `\nRESULT: FAIL — ${netNew.reduce((a, d) => a + d.extra, 0)} net-new diagnostic(s) in the backend test surface.\n`,
  );
  process.exit(1);
}

if (resolved.length) {
  process.stdout.write(`\nRESOLVED (present in the baseline, gone now):\n`);
  for (const d of resolved) process.stdout.write(`  -${d.gone}  ${d.key}\n`);
  process.stdout.write(
    `\nRESULT: PASS — no net-new diagnostics; debt reduced by ${resolved.reduce((a, d) => a + d.gone, 0)}. `
    + `Re-run with --update-baseline in a dedicated commit to lock the gain.\n`,
  );
  process.exit(0);
}

process.stdout.write(`RESULT: PASS — diagnostic set identical to baseline, net-new 0.\n`);
process.exit(0);
