#!/usr/bin/env node
/**
 * Runs every TypeScript project so the FULL type-debt inventory is visible.
 *
 * Why this exists:
 *  - The previous script chained `tsc A && tsc B && tsc C`, so a failure in
 *    project A hid every error in B and C (backend/scripts debt was invisible).
 *  - `incremental` + a stale *.tsbuildinfo could mask compilerOptions changes
 *    (e.g. a target bump appeared to have no effect). We force a clean,
 *    non-incremental check here so results always reflect current config.
 *
 * Behaviour: every project runs; per-project status is printed; the overall
 * exit code is non-zero if ANY project failed.
 */
const { spawnSync } = require('child_process');

const PROJECTS = [
  'tsconfig.json',
  'tsconfig.backend.json',
  'tsconfig.scripts.json',
];

let failed = 0;

for (const project of PROJECTS) {
  process.stdout.write(`\n=== typecheck: ${project} ===\n`);
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '-p', project,
      '--noEmit',
      '--incremental', 'false',
    ],
    { stdio: 'inherit' },
  );
  const code = result.status === null ? 1 : result.status;
  if (code !== 0) {
    failed += 1;
    process.stdout.write(`--- ${project}: FAILED (exit ${code}) ---\n`);
  } else {
    process.stdout.write(`--- ${project}: OK ---\n`);
  }
}

process.stdout.write(
  `\ntypecheck summary: ${PROJECTS.length - failed}/${PROJECTS.length} projects clean\n`,
);
process.exit(failed > 0 ? 1 : 0);
