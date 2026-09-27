#!/usr/bin/env node
/**
 * PI-SCORE-PROVENANCE-001 — the scoring-surface governance gate.
 *
 * `SCORING_RULES_VERSION` only means something if it is impossible to change a
 * scoring rule without changing it. Nothing else enforces that: the weights
 * live in `prioritization.ts`, the version lives in `canonical/scoring.ts`, and
 * a one-line weight edit would otherwise silently reprice every lead while the
 * persisted `rules_version` kept claiming the old semantics. That is the exact
 * failure this gate exists to make impossible.
 *
 * HOW: a SHA-256 over each governed file, recorded next to the version it
 * belongs to. Change a governed file and the digest moves; if the version did
 * not move with it, this fails and names both.
 *
 * WHY A DIGEST AND NOT A LINT RULE: a rule would have to understand which edits
 * can change a score, and "this comment is harmless, that constant is not" is
 * not decidable. A digest over-reports instead of under-reporting: a comment fix
 * also trips it. That is the correct direction for a provenance gate — a
 * spurious version bump costs a line, a missed one silently corrupts history.
 *
 * SCOPE IS DELIBERATELY SMALL. Fourteen files, listed here, measured in
 * PI-SCORE-001A as the complete set that can alter a customer-visible score.
 * Unrelated files are NOT governed; this is not a general version-management
 * framework and must not become one.
 *
 * Usage:
 *   node scripts/ci/scoring-surface-digest.js            # verify (CI / T1)
 *   node scripts/ci/scoring-surface-digest.js --update   # re-pin after a
 *                                                        # deliberate version bump
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const PIN = path.join(__dirname, 'scoring-surface-digest.json');

/**
 * The governed surface. Every file here can change a LeadScore.
 * Adding a new score-producing rule means adding it here too — a contributor
 * outside this list would be ungoverned, which is the hole, not the feature.
 */
const SURFACE = [
  'backend/services/leadUnderstanding/engines/intent.ts',
  'backend/services/leadUnderstanding/engines/behavioral.ts',
  'backend/services/leadUnderstanding/engines/buyingSignal.ts',
  'backend/services/leadUnderstanding/engines/personaIcp.ts',
  'backend/services/leadUnderstanding/engines/prospectIcpFit.ts',
  'backend/services/leadUnderstanding/engines/qualification.ts',
  'backend/services/leadUnderstanding/engines/relationship.ts',
  'backend/services/leadUnderstanding/engines/enrichment.ts',
  'backend/services/leadUnderstanding/engines/prioritization.ts',
  'backend/services/leadUnderstanding/scoring.ts',
  'backend/services/leadUnderstanding/projection.ts',
  'backend/services/intelligence/canonical/scoring.ts',
  'backend/services/prospectIcp/evaluate.ts',
  'backend/services/prospectIcp/criteria.ts',
];

/** Read the live version straight from source — never from the pin file. */
function readVersion() {
  const src = fs.readFileSync(
    path.join(ROOT, 'backend/services/intelligence/canonical/scoring.ts'), 'utf8');
  const m = src.match(/export const SCORING_RULES_VERSION\s*=\s*'([^']+)'/);
  if (!m) {
    console.error('FAIL: SCORING_RULES_VERSION not found in canonical/scoring.ts');
    process.exit(1);
  }
  return m[1];
}

/**
 * Normalise line endings only. Nothing else: stripping comments or whitespace
 * would require deciding which edits are semantically inert, which is the
 * judgement this gate deliberately refuses to make.
 */
function digestOf(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`FAIL: governed file missing — ${rel}`);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function measure() {
  const files = {};
  for (const rel of SURFACE) files[rel] = digestOf(rel);
  return { version: readVersion(), files };
}

function main() {
  const actual = measure();

  if (process.argv.includes('--update')) {
    fs.writeFileSync(PIN, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`scoring surface re-pinned at ${actual.version} (${SURFACE.length} files)`);
    return;
  }

  if (!fs.existsSync(PIN)) {
    console.error('FAIL: no pin file. Run with --update to create it.');
    process.exit(1);
  }
  const pinned = JSON.parse(fs.readFileSync(PIN, 'utf8'));

  const changed = SURFACE.filter((rel) => pinned.files[rel] !== actual.files[rel]);
  const added = SURFACE.filter((rel) => !(rel in pinned.files));
  const removed = Object.keys(pinned.files).filter((rel) => !SURFACE.includes(rel));

  console.log('── scoring surface governance ──');
  console.log(`  pinned version : ${pinned.version}`);
  console.log(`  actual version : ${actual.version}`);
  console.log(`  governed files : ${SURFACE.length}`);
  console.log(`  changed        : ${changed.length}`);

  if (!changed.length && !added.length && !removed.length) {
    console.log(`RESULT: PASS — surface unchanged at ${actual.version}.`);
    return;
  }

  // The surface moved. That is allowed ONLY when the version moved with it.
  if (actual.version !== pinned.version) {
    console.log(`RESULT: PASS — surface changed and SCORING_RULES_VERSION moved `
      + `${pinned.version} → ${actual.version}. Re-pin with --update.`);
    return;
  }

  console.error('');
  console.error(`FAIL: the scoring surface changed but SCORING_RULES_VERSION is still ${actual.version}.`);
  for (const rel of changed) console.error(`    changed  ${rel}`);
  for (const rel of added)   console.error(`    added    ${rel}`);
  for (const rel of removed) console.error(`    removed  ${rel}`);
  console.error('');
  console.error('  A scoring rule moved without its version. Every score persisted from');
  console.error('  here would claim semantics that no longer hold. Bump');
  console.error('  SCORING_RULES_VERSION in backend/services/intelligence/canonical/scoring.ts,');
  console.error('  then re-pin with: node scripts/ci/scoring-surface-digest.js --update');
  process.exit(1);
}

main();
