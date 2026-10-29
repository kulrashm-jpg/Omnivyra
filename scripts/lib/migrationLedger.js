'use strict';
/**
 * Classify the production migration ledger against the local migration files —
 * by VERSION, never by raw file count.
 *
 * Why not count rows vs files (the probe this replaces): migrations here are
 * applied by hand in the SQL editor and recording them in
 * supabase_migrations.schema_migrations is optional (docs/migration-discipline.md),
 * and 443 files share only 329 distinct versions (legacy 8-digit stamps are
 * reused by up to 12 files). A row-count ratio therefore always fires, can never
 * be satisfied, and cannot tell drift from the documented process.
 *
 * What a ledger row can and cannot prove:
 *   - a version that maps to exactly ONE local file identifies that file;
 *   - a version shared by several files proves only that SOME file with that
 *     version was recorded — never which one (`recorded_ambiguous`);
 *   - a version with no local file is history the repository does not have
 *     (`orphans`) — genuine drift;
 *   - a local version with no row is UNRECORDED, not unapplied: under the manual
 *     process its DDL may well be live. The column / index / type checks in
 *     verify-schema-parity.js are the evidence of what is applied; this module
 *     never claims a migration did or did not run.
 *
 * Pure: no I/O. verify-schema-parity.js supplies the file names and ledger rows.
 */

/** Leading version of a migration file name: the digits before the first `_`. */
function versionOf(fileName) {
  const m = /^(\d+)_/.exec(fileName);
  return m ? m[1] : null;
}

/**
 * A version is well-formed when it is 14 digits (YYYYMMDDHHMMSS) or a legacy 8
 * digits (YYYYMMDD) AND its date (and time) components are possible. Legacy
 * pseudo-dates such as 20260632 exist in history; they are reported, not failed.
 */
function versionProblem(version) {
  if (version == null) return 'no leading version';
  if (version.length !== 14 && version.length !== 8) return `version has ${version.length} digits (expected 14, or legacy 8)`;
  const month = Number(version.slice(4, 6));
  const day = Number(version.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return 'impossible date';
  if (version.length === 14) {
    const hh = Number(version.slice(8, 10));
    const mi = Number(version.slice(10, 12));
    const ss = Number(version.slice(12, 14));
    if (hh > 23 || mi > 59 || ss > 59) return 'impossible time';
  }
  return null;
}

/**
 * @param {{ files: string[], ledgerRows: Array<{ version: string, name?: string|null }> }} input
 *   files      — top-level migration file names (e.g. '20261223000000_x.sql')
 *   ledgerRows — rows of supabase_migrations.schema_migrations (version, name)
 */
function classifyLedger({ files, ledgerRows }) {
  const byVersion = new Map();
  const invalidFilenames = [];
  for (const f of files) {
    const v = versionOf(f);
    const problem = versionProblem(v);
    if (problem) invalidFilenames.push({ file: f, problem });
    if (v == null) continue;
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(f);
  }

  const recordedVersions = new Set();
  const recordedIdentified = [];
  const recordedAmbiguous = [];
  const orphans = [];
  const nameMismatches = [];
  for (const row of ledgerRows) {
    const v = String(row.version);
    if (recordedVersions.has(v)) continue; // the ledger keys on version; a repeat adds nothing
    recordedVersions.add(v);
    const siblings = byVersion.get(v);
    if (!siblings) {
      orphans.push({ version: v, name: row.name ?? null });
    } else if (siblings.length > 1) {
      recordedAmbiguous.push({ version: v, files: [...siblings].sort() });
    } else {
      recordedIdentified.push({ version: v, file: siblings[0] });
      const expectedName = siblings[0].replace(/^\d+_/, '').replace(/\.sql$/, '');
      if (row.name != null && row.name !== expectedName) {
        nameMismatches.push({ version: v, recorded_name: row.name, file: siblings[0] });
      }
    }
  }

  const unrecordedUnique = [];
  const unrecordedAmbiguous = [];
  for (const [v, siblings] of byVersion) {
    if (recordedVersions.has(v)) continue;
    if (siblings.length > 1) unrecordedAmbiguous.push({ version: v, files: [...siblings].sort() });
    else unrecordedUnique.push({ version: v, file: siblings[0] });
  }

  // Unrecorded 14-digit versions NEWER than every recorded 14-digit version: the
  // migrations most likely still awaiting application. Still not a claim that
  // they are unapplied — the schema checks decide that.
  const recorded14 = [...recordedVersions].filter((v) => v.length === 14 && byVersion.has(v)).sort();
  const highWater = recorded14.length ? recorded14[recorded14.length - 1] : null;
  const newerThanHighWater = unrecordedUnique
    .filter((u) => u.version.length === 14 && (highWater == null || u.version > highWater))
    .map((u) => u.version)
    .sort();

  const byVersionSorted = (a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
  return {
    local_files: files.length,
    local_versions: byVersion.size,
    duplicate_version_groups: [...byVersion.values()].filter((s) => s.length > 1).length,
    ledger_rows: ledgerRows.length,
    recorded_identified: recordedIdentified.sort(byVersionSorted),
    recorded_ambiguous: recordedAmbiguous.sort(byVersionSorted),
    orphans: orphans.sort(byVersionSorted),
    name_mismatches: nameMismatches.sort(byVersionSorted),
    unrecorded_unique: unrecordedUnique.sort(byVersionSorted),
    unrecorded_ambiguous: unrecordedAmbiguous.sort(byVersionSorted),
    recorded_high_water: highWater,
    unrecorded_newer_than_high_water: newerThanHighWater,
    invalid_filenames: invalidFilenames.sort((a, b) => (a.file < b.file ? -1 : 1)),
    // The ONLY ledger condition that is drift: history the repository does not have.
    attention: orphans.length > 0,
  };
}

module.exports = { classifyLedger, versionOf, versionProblem };
