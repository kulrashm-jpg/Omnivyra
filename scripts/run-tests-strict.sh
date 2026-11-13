#!/usr/bin/env bash
# Strict jest runner: "the apparatus ran" is a CHECKED property, not something a reader infers from a count.
#
# Usage: scripts/run-tests-strict.sh <jest args / test paths...>      (run from the repo root)
#
# FAILS (exit 1) when ANY of these holds, and says which:
#   - jest exited non-zero;
#   - any suite failed, or failed to RUN (a load / compile error contributes 0 tests while "Tests:" can look green);
#   - any suite ran ZERO tests (a suite that loads but runs nothing proves nothing);
#   - fewer suites ran than `jest --listTests` expects for the same arguments.
# Always prints jest's own "Test Suites:" and "Tests:" lines VERBATIM, plus the expected-vs-ran suite count.
# The full jest output is kept (path printed) so the evidence can be read, not just summarised.
#
# Why (e9, 2026-11-13): three times in one week the apparatus did not run and the report looked like success -
# a suite that failed to compile, a mutant that never applied, and suites that failed to LOAD under a dependency
# mismatch (zod 3 vs main's zod 4: 38 suites, 0 tests, summary "20 failed / 2 tests failed").
set -u
JEST="node node_modules/jest/bin/jest.js"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/strict-jest.XXXXXX")"
JSON="$WORK/result.json"
LOG="$WORK/output.txt"

EXPECTED=$($JEST --listTests "$@" 2>/dev/null | grep -c '\.test\.')
$JEST --json --outputFile="$JSON" "$@" > "$LOG" 2>&1
RC=$?

echo "---- jest (verbatim) ----"
grep -aE '^(Test Suites|Tests):' "$LOG" || echo "(no summary lines - jest did not complete)"
echo "---- strict checks ----"
if [ ! -s "$JSON" ]; then
  echo "STRICT FAIL: jest wrote no JSON result (rc=$RC). Full output: $LOG"
  exit 1
fi
node - "$JSON" "$EXPECTED" "$RC" "$LOG" <<'NODE'
const fs = require('fs');
const [, , jsonPath, expectedRaw, rcRaw, logPath] = process.argv;
const r = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const expected = Number(expectedRaw);
const problems = [];
if (Number(rcRaw) !== 0) problems.push(`jest exited ${rcRaw}`);
if (r.numFailedTestSuites > 0) problems.push(`${r.numFailedTestSuites} suite(s) failed`);
if (r.numRuntimeErrorTestSuites > 0) problems.push(`${r.numRuntimeErrorTestSuites} suite(s) failed to RUN (load / compile error)`);
const zero = (r.testResults || []).filter((t) => (t.assertionResults || []).length === 0);
if (zero.length > 0) problems.push(`${zero.length} suite(s) ran ZERO tests: ${zero.map((t) => t.name).slice(0, 10).join(', ')}`);
if (r.numTotalTestSuites < expected) problems.push(`only ${r.numTotalTestSuites} suite(s) ran, ${expected} expected (jest --listTests)`);
if (r.numTotalTests === 0) problems.push('0 tests in total');
console.log(`suites expected ${expected}, ran ${r.numTotalTestSuites}, passed ${r.numPassedTestSuites}; tests ${r.numPassedTests}/${r.numTotalTests} passed`);
if (problems.length) {
  for (const p of problems) console.log(`STRICT FAIL: ${p}`);
  console.log(`full output: ${logPath}`);
  process.exit(1);
}
console.log('STRICT PASS: every expected suite ran, each ran at least one test, none failed');
NODE
