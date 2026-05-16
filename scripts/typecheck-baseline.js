#!/usr/bin/env node
/**
 * Non-regression TypeScript baseline guard.
 *
 * Runs the honest multi-project runner (scripts/typecheck-all.js — all 3
 * projects, non-incremental, full output) and compares the TOTAL error count
 * against the committed baseline in scripts/typecheck-baseline.json.
 *
 *   actual >  baseline  -> FAIL (regression — new type errors introduced)
 *   actual == baseline  -> PASS
 *   actual <  baseline  -> PASS, and report that the baseline can be lowered
 *                          (intentionally NOT auto-edited — must be a
 *                           deliberate, reviewed commit)
 *
 * This never fakes a green status: the complete typecheck-all output is
 * streamed through, and the baseline can only be tightened, never relaxed
 * automatically. Blanket `any`/`@ts-ignore`/suppressions to game the count
 * are out of contract (see baseline json note).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const baselineFile = path.join(__dirname, 'typecheck-baseline.json');
const { baseline } = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));

const run = spawnSync(
  process.execPath,
  [path.join(__dirname, 'typecheck-all.js')],
  { cwd: ROOT, encoding: 'utf8' },
);

const output = `${run.stdout || ''}${run.stderr || ''}`;
process.stdout.write(output);

const actual = (output.match(/error TS\d+/g) || []).length;

process.stdout.write(
  `\n── typecheck baseline guard ──\n` +
  `baseline: ${baseline}\n` +
  `actual:   ${actual}\n`,
);

if (actual > baseline) {
  process.stdout.write(
    `RESULT: FAIL — ${actual - baseline} new TypeScript error(s) above baseline. ` +
    `Fix them or, if intentional and reviewed, justify before adjusting the baseline.\n`,
  );
  process.exit(1);
}

if (actual < baseline) {
  process.stdout.write(
    `RESULT: PASS — debt reduced by ${baseline - actual}. ` +
    `Lower "baseline" in scripts/typecheck-baseline.json to ${actual} in a dedicated commit to lock the gain.\n`,
  );
  process.exit(0);
}

process.stdout.write(`RESULT: PASS — at baseline, no regression.\n`);
process.exit(0);
