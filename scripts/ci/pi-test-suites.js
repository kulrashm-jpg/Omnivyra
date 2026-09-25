#!/usr/bin/env node
/**
 * PI-VERIFY-001 — derive the Prospect Intelligence unit-test suite set.
 *
 * WHY THIS IS DERIVED AND NOT A LIST
 * ----------------------------------
 * Before PI-VERIFY-001 the PI suites ran only on a developer laptop: `npm test`
 * (`jest backend/tests`) is invoked by no workflow, so ~1866 backend suites —
 * the PI ones among them — were never a merge gate. Enforcing them needs a
 * selector, and a hand-written list is the wrong selector: it cannot notice a
 * PI suite added next week, so it rots into a silent exclusion.
 *
 * Two selectors were measured against the tree at 80748783, and NEITHER is
 * sufficient alone:
 *
 *   by NAME  (basename /^pi/)          -> 67 suites
 *   by IMPORT (references a PI module) -> 109 suites
 *   intersection                       ->  58
 *
 * So the name rule alone would miss 51 suites (a3PersonAnchor,
 * contactGovernanceEvaluator, li3dGovernanceWriter, leadIngestionCapabilityGate,
 * …) and the import rule alone would miss 9 (piWs10ProspectRoutes and the
 * .dom.tsx workspace suites, which exercise PI surfaces through pages/ or a
 * component rather than importing a backend PI module). The set is therefore
 * the UNION of the two, computed at run time.
 *
 * SCOPE
 * -----
 * Only the default jest project's territory is scanned. The real-schema suites
 * (`backend/tests/realschema/**`) are excluded because they require a live
 * PostgreSQL server and have their own project + workflow; `backend/tests/manual/**`
 * is excluded because it calls paid providers. Both are excluded by
 * jest.config.js's own testPathIgnorePatterns as well, so naming one here
 * would select a suite jest then refuses to run.
 *
 * Usage:
 *   node scripts/ci/pi-test-suites.js            # newline-separated paths
 *   node scripts/ci/pi-test-suites.js --count    # count only
 *   node scripts/ci/pi-test-suites.js --explain  # per-suite reason
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOT = path.join(ROOT, 'backend', 'tests');

// Directories that have their own jest project; see header.
const EXCLUDED_DIRS = new Set(['realschema', 'manual']);

/**
 * PI module markers. These are the Prospect Intelligence service directories
 * and HTTP surfaces as they exist at 80748783. A suite that mentions one is
 * exercising PI, whatever it is called.
 */
const PI_MARKERS = [
  'prospectIdentity',
  'prospectLifecycle',
  'prospectOutcomes',
  'prospectIcp',
  'prospectOutreach',
  'leadIngestion',
  'leadOutreachExecution',
  'services/enrichment',
  'pages/api/prospects',
  'pages/api/outreach',
  'pages/api/prospect-sources',
];

const isTestFile = (name) => /\.test\.tsx?$/.test(name);
const matchesByName = (name) => /^pi/.test(name);

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else if (entry.isFile() && isTestFile(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const selected = [];
for (const file of walk(SCAN_ROOT, []).sort()) {
  const base = path.basename(file);
  const byName = matchesByName(base);
  // Read only when the name did not already decide it.
  let byImport = false;
  if (!byName) {
    const src = fs.readFileSync(file, 'utf8');
    byImport = PI_MARKERS.some((m) => src.includes(m));
  } else {
    const src = fs.readFileSync(file, 'utf8');
    byImport = PI_MARKERS.some((m) => src.includes(m));
  }
  if (byName || byImport) {
    const reasons = [byName && 'name', byImport && 'import'].filter(Boolean);
    selected.push({
      // POSIX-separated and repo-relative: this string is handed to jest.
      rel: path.relative(ROOT, file).split(path.sep).join('/'),
      reasons,
    });
  }
}

if (process.argv.includes('--count')) {
  process.stdout.write(`${selected.length}\n`);
} else if (process.argv.includes('--explain')) {
  for (const s of selected) process.stdout.write(`${s.reasons.join('+').padEnd(12)} ${s.rel}\n`);
  process.stdout.write(`\ntotal: ${selected.length}\n`);
} else {
  for (const s of selected) process.stdout.write(`${s.rel}\n`);
}

/**
 * Floor guard. The derivation is meant to GROW as PI grows; a sudden collapse
 * means the selector broke (a renamed service directory, a moved test root),
 * and a selector that silently matches less is the exact failure this job
 * exists to prevent. 100 is a deliberate floor under the 120 measured at
 * 80748783 — loose enough to survive legitimate suite consolidation, tight
 * enough that a broken marker list cannot pass as a green run.
 */
const MIN_EXPECTED = 100;

if (selected.length < MIN_EXPECTED) {
  process.stderr.write(
    "PI suite derivation selected " + selected.length + " suites, below the floor of "
    + MIN_EXPECTED + ". Refusing to report success: the selector has probably broken "
    + "rather than PI having shrunk. If the reduction is genuine, lower MIN_EXPECTED "
    + "in this file in a dedicated commit.\n",
  );
  process.exit(1);
}
