#!/usr/bin/env node
/**
 * PB-009 / PB-011 — Backend TypeScript Certification guard.
 *
 * WHAT THIS PROVES
 * ----------------
 *  1. COVERAGE (PB-009): every backend production file is inside the
 *     `tsconfig.backend.json` program, and every backend TEST file is inside
 *     the `tsconfig.backend-tests.json` program. Files are enumerated from
 *     DISK and matched against `tsc --listFiles`, so quietly excluding a file
 *     that fails to compile is a hard FAIL — it can never be used to lower the
 *     error count.
 *  2. NON-REGRESSION, SCALAR (PB-009): the per-project error count is compared
 *     against the committed baseline in
 *     scripts/typecheck-certification-baseline.json.
 *     actual >  baseline -> FAIL
 *     actual == baseline -> PASS
 *     actual <  baseline -> PASS + instruction to lower the baseline
 *  3. NON-REGRESSION, PER-ERROR IDENTITY (PB-011): every individual diagnostic
 *     is fingerprinted as (file, TS code, normalized message) with a count per
 *     bucket, and compared against
 *     scripts/typecheck-certification-fingerprints.json.
 *     Any fingerprint that is new — or exceeds its baselined bucket count — is
 *     NET-NEW DEBT and FAILS, and is attributed to the changed files of the
 *     current change where possible.
 *
 * WHY (3) EXISTS — THE HOLE (2) LEAVES
 * ------------------------------------
 * A scalar total is trivially defeated: fix one baselined error and introduce
 * a different one. The total is unchanged, gate (2) goes GREEN, and brand new
 * type debt has entered the repository unnoticed. That is precisely how
 * PB-005/PB-008 landed 4 type errors inside the baseline with nobody
 * attributed. Gate (3) fails that scenario by name.
 *
 * Line and column are deliberately NOT part of a fingerprint: any unrelated
 * edit above an error shifts them, which would produce constant false
 * "new error" reports and force the baseline to be regenerated until it meant
 * nothing. See scripts/lib/typecheckFingerprint.js for the full rationale.
 *
 * EXISTING DEBT IS INFORMATIONAL. It never fails a build. Reductions are never
 * punished — they PASS and print a re-baseline instruction.
 *
 * WHY IT IS SEPARATE FROM `npm run typecheck:ci`
 * ----------------------------------------------
 * `typecheck:ci` (scripts/typecheck-baseline.js) guards the aggregate app /
 * backend / scripts baseline and is a REQUIRED status check. PB-009 adds a
 * previously unchecked surface with a large pre-existing baseline; folding it
 * into the existing aggregate would have meant RAISING that baseline, which
 * its own contract forbids. This script therefore stands alongside it and
 * leaves the existing gate byte-for-byte unchanged.
 *
 * WHY JEST IS NOT THE ANSWER
 * --------------------------
 * Root tsconfig.json sets `"isolatedModules": true`, so ts-jest transpiles
 * without type-checking. Turning that off would turn the pre-existing type
 * errors into TEST FAILURES and slow every run — a build regression. Type
 * safety belongs in a `tsc` project; jest stays a behaviour runner.
 *
 * Usage:
 *   node scripts/typecheck-certification.js                 # coverage + both ratchets
 *   node scripts/typecheck-certification.js --inventory     # + error breakdown
 *   node scripts/typecheck-certification.js --base <ref>    # attribute vs a base ref
 *   node scripts/typecheck-certification.js --update-baseline
 *                                                           # DELIBERATE re-baseline
 *   node scripts/typecheck-certification.js --update-baseline --accept-new-debt
 *                                                           # ...including NEW debt
 *
 * RE-BASELINING IS NEVER AUTOMATIC. `--update-baseline` refuses to run under
 * CI, refuses to raise a scalar count, and refuses to absorb a net-new
 * fingerprint unless `--accept-new-debt` is passed explicitly — in which case
 * every absorbed fingerprint is printed so it appears in the review record.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const FP = require('./lib/typecheckFingerprint');

const ROOT = path.resolve(__dirname, '..');
const baselineFile = path.join(__dirname, 'typecheck-certification-baseline.json');
const fingerprintFile = path.join(__dirname, 'typecheck-certification-fingerprints.json');

const baselineDoc = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const BASELINES = baselineDoc.projects;

const argv = process.argv.slice(2);
const SHOW_INVENTORY = argv.includes('--inventory');
const UPDATE_BASELINE = argv.includes('--update-baseline');
const ACCEPT_NEW_DEBT = argv.includes('--accept-new-debt');
const baseIdx = argv.indexOf('--base');
const BASE_REF = baseIdx >= 0 ? argv[baseIdx + 1] : undefined;
const IN_CI = Boolean(process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0');

// Refuse a CI re-baseline BEFORE doing any work: there is no state in which an
// automated build is allowed to rewrite the type-debt baseline.
if (UPDATE_BASELINE && IN_CI) {
  process.stdout.write(
    'REFUSED — `--update-baseline` must never run in CI. Re-baselining is a deliberate, '
    + 'reviewed act by a human; an automated rewrite would let the ratchet silently absorb '
    + 'whatever the build produced.\n',
  );
  process.exit(1);
}

/** Committed per-error identity baseline (absent only before genesis). */
let FINGERPRINTS = null;
if (fs.existsSync(fingerprintFile)) {
  FINGERPRINTS = JSON.parse(fs.readFileSync(fingerprintFile, 'utf8'));
}

const SOURCE_EXT = /\.(ts|tsx)$/i;
const TEST_NAME = /\.(test|spec)\.(ts|tsx)$/i;
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'dist', 'artifacts']);

/** Recursively list .ts/.tsx files under `dir` (repo-relative, forward slashes). */
function walk(dir, acc = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(rel, acc);
    } else if (SOURCE_EXT.test(entry.name)) {
      acc.push(rel);
    }
  }
  return acc;
}

const ALL_BACKEND = walk('backend');
const isTestSurface = (rel) => rel.startsWith('backend/tests/')
  || TEST_NAME.test(rel)
  || rel.includes('/__tests__/');

/**
 * Expected program membership per project.
 * `backend/**\/*.d.ts` is emitted-typing noise; keep it out of the assertion.
 */
const EXPECTED = {
  'tsconfig.backend.json': ALL_BACKEND.filter((f) => !isTestSurface(f) && !f.endsWith('.d.ts')),
  'tsconfig.backend-tests.json': ALL_BACKEND.filter((f) => isTestSurface(f) && !f.endsWith('.d.ts')),
};

const norm = (p) => p.replace(/\\/g, '/').replace(/\r$/, '').toLowerCase();
const ROOT_PREFIX = `${norm(ROOT)}/`;

function runProject(project) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '-p', project,
      '--noEmit',
      '--incremental', 'false',
      '--listFiles',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=8192`.trim(),
      },
    },
  );

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const lines = output.split('\n');

  const errorLines = lines.filter((l) => /error TS\d+/.test(l));
  const errors = (output.match(/error TS\d+/g) || []).length;

  const program = new Set();
  for (const line of lines) {
    if (/error TS\d+/.test(line)) continue;
    const t = norm(line.trim());
    if (!t.startsWith(ROOT_PREFIX) || !SOURCE_EXT.test(t)) continue;
    program.add(t.slice(ROOT_PREFIX.length));
  }

  return { output, errors, errorLines, program, spawnFailed: result.status === null };
}

/** Which files did this change touch? Evidence for attribution, never an excuse. */
const CHANGED = FP.getChangedFiles(ROOT, { base: BASE_REF });

let failed = false;
let parseIncomplete = false;
const summary = [];
const freshInventories = {};

for (const project of Object.keys(BASELINES)) {
  process.stdout.write(`\n=== certification typecheck: ${project} ===\n`);
  const { output, errors, errorLines, program, spawnFailed } = runProject(project);

  if (spawnFailed) {
    process.stdout.write(`FAIL — tsc could not be executed for ${project}\n`);
    failed = true;
    continue;
  }

  // --- 1. coverage assertion -------------------------------------------------
  const expected = EXPECTED[project] || [];
  const missing = expected.filter((f) => !program.has(norm(f)));
  process.stdout.write(
    `coverage: ${expected.length - missing.length}/${expected.length} expected files in program\n`,
  );
  if (missing.length > 0) {
    failed = true;
    process.stdout.write(
      `COVERAGE FAIL — ${missing.length} file(s) are on disk but NOT type-checked by ${project}:\n`,
    );
    for (const f of missing.slice(0, 25)) process.stdout.write(`  - ${f}\n`);
    if (missing.length > 25) process.stdout.write(`  ... and ${missing.length - 25} more\n`);
  }

  // --- 2. non-regression baseline (scalar, PB-009) ---------------------------
  const baseline = BASELINES[project];
  process.stdout.write(`errors:   ${errors} (baseline ${baseline})\n`);

  if (SHOW_INVENTORY && errorLines.length > 0) {
    const byCode = new Map();
    const byFile = new Map();
    for (const line of errorLines) {
      const code = (line.match(/error (TS\d+)/) || [])[1];
      if (code) byCode.set(code, (byCode.get(code) || 0) + 1);
      const file = (line.match(/^(.+?)\(\d+,\d+\): error TS/) || [])[1];
      if (file) byFile.set(file, (byFile.get(file) || 0) + 1);
    }
    process.stdout.write(`files affected: ${byFile.size}\n`);
    process.stdout.write('by error code:\n');
    for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(n).padStart(5)}  ${code}\n`);
    }
    process.stdout.write('top files:\n');
    for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      process.stdout.write(`  ${String(n).padStart(5)}  ${file}\n`);
    }
  }

  let status;
  if (errors > baseline) {
    failed = true;
    status = `FAIL — ${errors - baseline} new TypeScript error(s) above baseline`;
  } else if (errors < baseline) {
    status = `PASS — debt reduced by ${baseline - errors}; lower "${project}" to ${errors} in `
      + 'scripts/typecheck-certification-baseline.json in a dedicated commit';
  } else {
    status = 'PASS — at baseline, no regression';
  }
  process.stdout.write(`${status}\n`);

  // --- 3. per-error identity ratchet (PB-011) --------------------------------
  const parsed = FP.parseErrors(output, ROOT);
  const parseCheck = FP.assertParseComplete(output, parsed);
  if (!parseCheck.ok) {
    failed = true;
    parseIncomplete = true;
    process.stdout.write(
      `FINGERPRINT FAIL — diagnostic parser saw ${parseCheck.parsed} of ${parseCheck.raw} `
      + 'errors. An unrecognised tsc diagnostic shape could hide new debt; fix '
      + 'scripts/lib/typecheckFingerprint.js before trusting this run.\n',
    );
  }

  const inventory = FP.buildInventory(parsed);
  freshInventories[project] = inventory;

  const baselineInv = FINGERPRINTS && FINGERPRINTS.projects && FINGERPRINTS.projects[project];
  if (!baselineInv) {
    failed = true;
    process.stdout.write(
      `FINGERPRINT FAIL — no per-error baseline for ${project} in `
      + `${path.basename(fingerprintFile)}. Generate it deliberately with `
      + '`npm run typecheck:certification:baseline`.\n',
    );
  } else {
    const diff = FP.diffInventory(baselineInv, inventory);
    const netNew = FP.attribute(diff.netNew, CHANGED);
    const attributedCount = netNew.filter((n) => n.attributed).reduce((a, n) => a + n.count, 0);
    const unattributedCount = diff.netNewCount - attributedCount;

    process.stdout.write(
      `fingerprints: ${Object.keys(baselineInv.files || {}).length} baselined file(s) / `
      + `${diff.baselineTotal} baselined error(s) · net-new ${diff.netNewCount} · `
      + `resolved ${diff.reducedCount}\n`,
    );
    process.stdout.write(`attribution source: ${CHANGED.source}\n`);

    if (diff.netNewCount > 0) {
      failed = true;
      process.stdout.write(
        `FINGERPRINT FAIL — ${diff.netNewCount} net-new type error(s) whose identity is NOT in `
        + `the baseline (${attributedCount} attributed, ${unattributedCount} unattributed). `
        + 'The scalar total can be unchanged and this is still a regression.\n',
      );
      for (const n of netNew.slice(0, 40)) {
        const tag = n.attributed ? 'ATTRIBUTED  ' : 'UNATTRIBUTED';
        process.stdout.write(
          `  [${tag}] ${n.file}\n`
          + `      ${n.code}: ${n.message}\n`
          + `      +${n.count} (baseline ${n.baselineCount} -> now ${n.currentCount})`
          + `${n.firstSeen ? ' · fingerprint never seen before' : ' · duplicate above baselined count'}\n`
          + (n.attributed
            ? '      attributed: this file is in the changed set of this change\n'
            : `      UNATTRIBUTED: this file is NOT in the changed set${
              n.attributionAvailable ? ' — cascade from an edit elsewhere' : ' — changed set unavailable'
            }; it is still a regression and still fails\n`),
        );
      }
      if (netNew.length > 40) {
        process.stdout.write(`  ... and ${netNew.length - 40} more net-new fingerprint(s)\n`);
      }
      if (diff.reducedCount > 0) {
        process.stdout.write(
          `  (${diff.reducedCount} baselined error(s) were also resolved — that credit does NOT `
          + 'offset the net-new ones. Trading a fixed error for a new one leaves the total flat '
          + 'and is still a regression.)\n',
        );
        for (const r of diff.reduced.slice(0, 20)) {
          process.stdout.write(`  [RESOLVED] ${r.file}\n      ${r.code}: ${r.message}\n`);
        }
      }
    } else if (diff.reducedCount > 0) {
      process.stdout.write(
        `FINGERPRINT PASS — no net-new identities; ${diff.reducedCount} baselined error(s) `
        + 'resolved. Lock the gain: `npm run typecheck:certification:baseline` in a dedicated, '
        + 'reviewed commit.\n',
      );
      for (const r of diff.reduced.slice(0, 20)) {
        process.stdout.write(
          `  [RESOLVED] ${r.file}\n      ${r.code}: ${r.message}\n`
          + `      -${r.count} (baseline ${r.baselineCount} -> now ${r.currentCount})\n`,
        );
      }
      if (diff.reduced.length > 20) {
        process.stdout.write(`  ... and ${diff.reduced.length - 20} more resolved fingerprint(s)\n`);
      }
    } else {
      process.stdout.write('FINGERPRINT PASS — every error matches a baselined identity; no net-new debt\n');
    }

    // Integrity: the two artifacts must describe the same reality. If they
    // disagree, someone re-baselined one half — which is exactly the partial
    // update that would reopen the scalar hole.
    if (diff.baselineTotal !== baseline) {
      failed = true;
      process.stdout.write(
        `BASELINE INTEGRITY FAIL — ${path.basename(baselineFile)} says ${baseline} for ${project} `
        + `but ${path.basename(fingerprintFile)} enumerates ${diff.baselineTotal}. `
        + 'Both artifacts must be regenerated together.\n',
      );
    }
  }

  summary.push({ project, errors, baseline, missing: missing.length });
}

/* ----------------------------------------------------------- re-baselining */

if (UPDATE_BASELINE) {
  process.stdout.write('\n── re-baseline requested (--update-baseline) ──\n');
  const genesis = !FINGERPRINTS;
  const blockers = [];
  for (const s of summary) {
    if (s.missing > 0) {
      blockers.push(
        `${s.project}: ${s.missing} file(s) on disk are NOT in the program. Re-baselining over a `
        + 'coverage failure would lock in a number lowered by exclusion — the exact gaming this '
        + 'guard exists to stop.',
      );
    }
  }
  if (parseIncomplete) {
    blockers.push(
      'the diagnostic parser did not account for every reported error; a baseline built from an '
      + 'incomplete parse would have blind spots.',
    );
  }
  for (const project of Object.keys(BASELINES)) {
    const inv = freshInventories[project];
    if (!inv) { blockers.push(`${project}: no inventory (tsc failed)`); continue; }
    if (inv.total > BASELINES[project]) {
      blockers.push(
        `${project}: total would RISE ${BASELINES[project]} -> ${inv.total}. `
        + 'The certification baseline ratchets DOWN only.',
      );
    }
    const baseInv = !genesis && FINGERPRINTS.projects && FINGERPRINTS.projects[project];
    if (baseInv) {
      const d = FP.diffInventory(baseInv, inv);
      if (d.netNewCount > 0 && !ACCEPT_NEW_DEBT) {
        blockers.push(
          `${project}: ${d.netNewCount} net-new fingerprint(s) would be absorbed. `
          + 'Fix them, or pass --accept-new-debt to record them explicitly in the review.',
        );
      } else if (d.netNewCount > 0) {
        process.stdout.write(`ACCEPTING ${d.netNewCount} net-new fingerprint(s) into ${project}:\n`);
        for (const n of FP.attribute(d.netNew, CHANGED)) {
          process.stdout.write(
            `  + ${n.file} ${n.code} (+${n.count})`
            + `${n.attributed ? ' [attributed]' : ' [UNATTRIBUTED]'}\n      ${n.message}\n`,
          );
        }
      }
    }
  }

  if (blockers.length > 0) {
    process.stdout.write('REFUSED:\n');
    for (const b of blockers) process.stdout.write(`  - ${b}\n`);
    process.exit(1);
  }

  const doc = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    typescript: (() => {
      try { return require('typescript/package.json').version; } catch { return 'unknown'; }
    })(),
    note: [
      'PB-011 per-error identity baseline for the backend certification surface.',
      'Identity = (repo-relative file, TS error code, normalized message). Line and column are',
      'intentionally excluded so unrelated edits above an error do not manufacture false',
      '"new error" reports. `count` preserves duplicates within a file.',
      'A fingerprint present here is PRE-EXISTING DEBT: informational, never a build failure.',
      'A fingerprint NOT present here — or exceeding its count — is NET-NEW DEBT and FAILS,',
      'even when the scalar total in typecheck-certification-baseline.json is unchanged.',
      'Regenerate ONLY via `npm run typecheck:certification:baseline` (refuses to run in CI,',
      'refuses to raise a total, and refuses to absorb net-new debt without --accept-new-debt).',
      'This file and typecheck-certification-baseline.json must always be regenerated together;',
      'the guard fails if their totals disagree.',
    ],
    projects: {},
  };
  for (const project of Object.keys(BASELINES)) {
    doc.projects[project] = freshInventories[project];
  }
  fs.writeFileSync(fingerprintFile, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `${genesis ? 'GENESIS' : 'UPDATED'} — wrote ${path.basename(fingerprintFile)}\n`,
  );

  let scalarChanged = false;
  for (const project of Object.keys(BASELINES)) {
    const total = freshInventories[project].total;
    if (baselineDoc.projects[project] !== total) {
      process.stdout.write(
        `  ${project}: ${baselineDoc.projects[project]} -> ${total}\n`,
      );
      baselineDoc.projects[project] = total;
      scalarChanged = true;
    }
  }
  if (scalarChanged) {
    fs.writeFileSync(baselineFile, `${JSON.stringify(baselineDoc, null, 2)}\n`, 'utf8');
    process.stdout.write(`UPDATED — wrote ${path.basename(baselineFile)}\n`);
  }
  process.stdout.write(
    'Commit BOTH artifacts together, in a dedicated commit, with the reason stated. '
    + 'A baseline change is a governance change, not a build artifact.\n',
  );
  process.exit(0);
}

process.stdout.write('\n── PB-009/PB-011 backend certification summary ──\n');
for (const s of summary) {
  process.stdout.write(
    `${s.project}: errors ${s.errors}/${s.baseline} · uncovered files ${s.missing}\n`,
  );
}
process.stdout.write(
  `RESULT: ${failed ? 'FAIL' : 'PASS'}\n`
  + 'NOTE: jest does NOT type-check (root tsconfig sets isolatedModules -> ts-jest is '
  + 'transpile-only). A green jest suite is NOT evidence that tests type-check; this '
  + 'script is.\n'
  + 'NOTE: this guard fails on NET-NEW ERROR IDENTITIES, not just on a rising total — '
  + 'trading a fixed error for a new one is a regression here.\n',
);
process.exit(failed ? 1 : 0);
