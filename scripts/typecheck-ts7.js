#!/usr/bin/env node
/**
 * TypeScript 7 ADVISORY readiness gate.
 *
 * WHAT THIS IS
 * ------------
 * A forward-compatibility probe, NOT the operational compiler. TypeScript 6.0.3
 * remains authoritative for everything that ships: typecheck:ci, the worker
 * typecheck, typecheck:certification, ts-jest, ESLint, ts-node and Next.js all
 * continue to use it. This script answers one question and nothing else:
 *
 *     "If TypeScript 7 were the compiler today, would our source still check?"
 *
 * WHY TS7 IS NOT SIMPLY INSTALLED
 * -------------------------------
 * TypeScript 7 is the native (Go) compiler and does not expose the JavaScript
 * compiler API. ts-jest and @typescript-eslint both consume that API and both
 * fail hard against it, and neither has a published release whose peer range
 * admits 7.x (ts-jest tops out at 29.4.12 "<7"; typescript-eslint at "<6.1.0").
 * So TS7 cannot replace the root `typescript` yet.
 *
 * It is also not installed into the root tree under an npm alias. That was
 * measured, not assumed: `typescript7@npm:typescript@7.0.2` CLAIMS
 * node_modules/.bin/tsc — after which bare `tsc` reports 7.0.2. That would
 * silently swap the compiler behind `typecheck:backend-tests`, the pre-commit
 * worker typecheck and the CI worker gate. Hence tools/ts7: a separate package
 * tree with its own lockfile, whose bin never reaches the root .bin.
 *
 * FAIL-CLOSED
 * -----------
 * If the isolated compiler is missing, or resolves to anything other than a 7.x
 * build, this exits non-zero with an actionable message. It NEVER falls back to
 * TypeScript 6 — a silent fallback would report "TS7 ready" while proving
 * nothing at all.
 *
 * GATE vs DEBT
 * ------------
 * The five production projects are the gate: any TS7 diagnostic there fails.
 * tsconfig.backend-tests.json is reported INFORMATIONALLY only. That surface
 * carries pre-existing, separately governed debt (scripts/typecheck-
 * certification-baseline.json, enforced under TS6 by typecheck:certification).
 * Failing on it here would duplicate that gate and invite someone to "fix" the
 * number in the wrong place. This script never reads, writes or ratchets any
 * baseline file.
 *
 * Usage:
 *   npm run typecheck:ts7            # gate
 *   npm run typecheck:ts7 -- --full  # include per-diagnostic detail
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const TS7_DIR = path.join(ROOT, 'tools', 'ts7');
const TS7_TSC = path.join(TS7_DIR, 'node_modules', 'typescript', 'bin', 'tsc');

/** Projects whose TS7 cleanliness is the gate. */
const GATE_PROJECTS = [
  'tsconfig.json',
  'tsconfig.backend.json',
  'tsconfig.scripts.json',
  'tsconfig.build.json',
  'tsconfig.worker.json',
];

/** Reported, never gated — governed by typecheck:certification under TS6. */
const DEBT_PROJECTS = ['tsconfig.backend-tests.json'];

const showFull = process.argv.includes('--full');

function die(message) {
  process.stdout.write(`\n[typecheck:ts7] BLOCKED — ${message}\n`);
  process.exit(2);
}

if (!fs.existsSync(TS7_TSC)) {
  die(
    'the isolated TypeScript 7 compiler is not installed.\n' +
    '  Install it once (it does NOT touch the root dependency tree):\n' +
    '      npm --prefix tools/ts7 install\n' +
    '  Root TypeScript stays 6.0.3; tools/ts7 keeps its own lockfile.',
  );
}

// Guard against ever grading the repo with the wrong compiler.
const probe = spawnSync(process.execPath, [TS7_TSC, '--version'], { encoding: 'utf8' });
const versionLine = `${probe.stdout || ''}${probe.stderr || ''}`.trim();
const version = (versionLine.match(/\d+\.\d+\.\d+[^\s]*/) || [])[0] || 'unknown';
if (!/^7\./.test(version)) {
  die(`tools/ts7 resolved to TypeScript ${version}, not a 7.x build. Refusing to report TS7 readiness from a non-TS7 compiler.`);
}

process.stdout.write(
  `\n── TypeScript 7 advisory readiness gate ──\n` +
  `compiler : TypeScript ${version}  (isolated: tools/ts7)\n` +
  `root     : TypeScript ${require(path.join(ROOT, 'node_modules', 'typescript', 'package.json')).version}  (authoritative — unchanged)\n\n`,
);

function check(project) {
  const res = spawnSync(
    process.execPath,
    [TS7_TSC, '-p', project, '--noEmit', '--incremental', 'false'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      // The full front-end project needs headroom; matches typecheck-all.js.
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=8192`.trim() },
    },
  );
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  const errors = (output.match(/error TS\d+/g) || []).length;
  const byCode = {};
  for (const m of output.match(/error TS\d+/g) || []) byCode[m] = (byCode[m] || 0) + 1;
  return { errors, byCode, output };
}

let gateFailures = 0;

for (const project of GATE_PROJECTS) {
  const { errors, byCode, output } = check(project);
  const verdict = errors === 0 ? 'OK' : 'TS7 DIAGNOSTICS';
  process.stdout.write(`  ${project.padEnd(32)} ${String(errors).padStart(4)}  ${verdict}\n`);
  if (errors > 0) {
    gateFailures += errors;
    const top = Object.entries(byCode).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [code, n] of top) process.stdout.write(`      ${String(n).padStart(4)} ${code}\n`);
    if (showFull) process.stdout.write(output.split('\n').filter((l) => l.includes('error TS')).map((l) => `      ${l}`).join('\n') + '\n');
  }
}

process.stdout.write('\n  ── informational: pre-existing certification debt (NOT gated here) ──\n');
for (const project of DEBT_PROJECTS) {
  const { errors } = check(project);
  process.stdout.write(
    `  ${project.padEnd(32)} ${String(errors).padStart(4)}  governed by typecheck:certification under TS6\n`,
  );
}

if (gateFailures > 0) {
  process.stdout.write(
    `\nRESULT: NOT TS7-READY — ${gateFailures} diagnostic(s) on production projects.\n` +
    `TypeScript 6.0.3 remains authoritative; this gate is advisory and does not block shipping.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\nRESULT: TS7-READY — 0 diagnostics across ${GATE_PROJECTS.length} production projects.\n` +
  `Source and configuration would compile under TypeScript ${version} today. Full migration remains\n` +
  `blocked on ts-jest / @typescript-eslint publishing TS7-capable releases, not on this repository.\n`,
);
process.exit(0);
