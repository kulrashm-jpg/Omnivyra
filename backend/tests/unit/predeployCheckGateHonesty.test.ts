/**
 * predeploy-check.js — a gate that did not run is never reported as a pass.
 *
 * On 2026-10-29 the schema-parity gate could not even resolve the database host
 * (exit 2), printed "SKIPPED (env unavailable)", and the script still ended with
 * "RESULT: OK — … worker typecheck + env OK". Two defects:
 *   1. the exit-2 branch told operators to "Set PREDEPLOY_STRICT_SCHEMA=1 to
 *      require this gate" but never read the strict flag, so strict mode could
 *      not make an unreachable database block a deploy;
 *   2. the final verdict was an unconditional literal, identical for a run that
 *      compared every column and one that compared none.
 *
 * Source-level guards (same idiom as schemaParityVerifierContract.test.ts):
 * running the real script needs a clean tree at origin/main and a worker tsc.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'predeploy-check.js');
const source = fs.readFileSync(SCRIPT, 'utf8');
/** Comments stripped, so prose describing a defect can never satisfy a guard. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

/** The `if (code === 2) { … }` branch of the schema-parity handler. */
function exit2Branch(): string {
  const start = code.indexOf('if (code === 2)');
  const end = code.indexOf('} else if (code === 1)', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe('predeploy-check — skipped gates are never a pass', () => {
  it('strict schema mode blocks when the database check cannot run (exit 2)', () => {
    const branch = exit2Branch();
    expect(branch).toMatch(/if\s*\(\s*strictSchema\s*\)/);
    expect(branch).toMatch(/RESULT: BLOCKED/);
    expect(branch).toMatch(/process\.exit\(1\)/);
  });

  it('a non-strict skip is recorded as unverified, not silently continued', () => {
    expect(exit2Branch()).toMatch(/unverified\.push\(/);
  });

  it('every SKIPPED gate message is paired with an unverified entry', () => {
    const skippedMessages = (code.match(/: SKIPPED \(/g) ?? []).length;
    const skippedEntries = (code.match(/unverified\.push\([^)]*SKIPPED/g) ?? []).length;
    expect(skippedMessages).toBeGreaterThan(0);
    expect(skippedEntries).toBe(skippedMessages);
  });

  it('a WARN from the schema verifier is recorded too', () => {
    expect(code).toMatch(/unverified\.push\('schema parity WARN/);
  });

  it('the final verdict is derived from the unverified list, not an unconditional literal', () => {
    expect(code).not.toMatch(/RESULT: OK — clean tree at/);
    expect(code).toMatch(/unverified\.length === 0/);
    expect(code).toMatch(/RESULT: PASS/);
    expect(code).toMatch(/UNVERIFIED GATE\(S\) — NOT a full pass/);
  });

  it('keeps exit 0 by default so `npm run deploy:prod` behaviour is unchanged', () => {
    const tail = code.slice(code.lastIndexOf('const verdict'));
    expect(tail).toMatch(/process\.exit\(0\);\s*$/);
  });
});
