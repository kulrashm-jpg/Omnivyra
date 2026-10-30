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
 * Pure: no I/O. verify-schema-parity.js supplies the file names, ledger rows and
 * the digests of the files named in HISTORICAL_VERSION_MAP.
 */

/**
 * HISTORICAL COMPATIBILITY EXCEPTIONS — not a rule, and not to be extended casually.
 *
 * Three production ledger rows were written in May/June 2026 under tool-generated
 * timestamp versions, while the repository committed the same migrations under
 * legacy 8-digit names. Renaming the files is refused by the migration-quality
 * gate (ordering floor) and the ledger must not be edited, so each row is tied to
 * its file here by EVIDENCE, never by name. A row is accepted only when ALL of
 * these hold; otherwise it stays an orphan and the failed check is reported:
 *   - the ledger row's version AND name equal the entry;
 *   - md5(array_to_string(statements, E'\n')) of the row equals the fingerprint
 *     captured read-only from production on 2026-10-28;
 *   - no repository file carries the recorded version itself;
 *   - the named file exists and its sha256 equals the pinned digest;
 *   - the file's own version is not ALSO recorded in the ledger.
 *
 * `evidence` states what was established — and therefore what was NOT:
 *   statement_identical_comment_stripped — the recorded statement IS the file
 *     with its comment lines removed (md5 reproduced locally);
 *   statement_executable_subset — the recorded statement is an executable subset
 *     of the annotated file, not the same text;
 *   end_state_function_definitions — the live function definitions match the
 *     file's; the recorded migration text is different.
 */
const HISTORICAL_VERSION_MAP = Object.freeze([
  Object.freeze({
    recorded_version: '20260525141657',
    recorded_name: 'thread_title_column',
    recorded_statements_md5: '606a5a58a42249b8829c5b94f29a2863',
    file: '20260807_thread_title_column.sql',
    file_sha256: 'f8bdc653ad942db5ffc60c1a1dced03841a933da3acb7c825bde8e8714600d36',
    evidence: 'statement_identical_comment_stripped',
    rationale: 'Recorded statement equals the comment-stripped file exactly.',
  }),
  Object.freeze({
    recorded_version: '20260525223113',
    recorded_name: 'thread_runtime_executions',
    recorded_statements_md5: '20420cbdbe0c16b350356684ce03d750',
    file: '20260808_thread_runtime_executions.sql',
    file_sha256: '2f73a30e8ab1566e029a64d87fb6d46aa8133c67597bc5e2d621b5f1e7262834',
    evidence: 'statement_executable_subset',
    rationale: 'Recorded SQL is an executable subset of the annotated file; the texts are not identical.',
  }),
  Object.freeze({
    recorded_version: '20260601022203',
    recorded_name: 'fix_creator_execution_lock_ambiguous_columns',
    recorded_statements_md5: '15917b525abe692758ff49b1b7210d30',
    file: '20260676_fix_creator_execution_lock_ambiguous_columns.sql',
    file_sha256: '6fc42e4d51077f473ed37f534ef9a22337dbdbc9289c269dcf096f172a718741',
    evidence: 'end_state_function_definitions',
    rationale: 'Live function definitions match the file (table-qualified); the recorded migration text differs.',
  }),
]);

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
 * Why a HISTORICAL_VERSION_MAP entry does not apply to its ledger row, or null.
 * `recordedVersions` is every version in the ledger.
 */
function versionMapProblem(entry, row, { byVersion, fileSet, fileDigests, recordedVersions }) {
  if (row.name !== entry.recorded_name) return `recorded name '${row.name}' is not '${entry.recorded_name}'`;
  if (row.statements_md5 == null) return 'recorded statement fingerprint unavailable';
  if (row.statements_md5 !== entry.recorded_statements_md5) return 'recorded statement fingerprint changed';
  if (byVersion.has(entry.recorded_version)) return 'a repository file now carries the recorded version itself';
  if (!fileSet.has(entry.file)) return `mapped file ${entry.file} is missing`;
  const digest = fileDigests[entry.file];
  if (digest == null) return `mapped file ${entry.file} was not hashed`;
  if (digest !== entry.file_sha256) return `mapped file ${entry.file} changed (sha256 ${digest})`;
  if (recordedVersions.has(versionOf(entry.file))) return `mapped file ${entry.file} is also recorded under its own version`;
  return null;
}

/**
 * @param {{ files: string[], ledgerRows: Array<{ version: string, name?: string|null, statements_md5?: string|null }>,
 *           fileDigests?: Record<string, string>, versionMap?: ReadonlyArray<object> }} input
 *   files       — top-level migration file names (e.g. '20261223000000_x.sql')
 *   ledgerRows  — rows of supabase_migrations.schema_migrations (version, name, statement fingerprint)
 *   fileDigests — sha256 of each file named in the version map, keyed by file name
 *   versionMap  — defaults to HISTORICAL_VERSION_MAP; overridable for tests only
 */
function classifyLedger({ files, ledgerRows, fileDigests = {}, versionMap = HISTORICAL_VERSION_MAP }) {
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

  const allRecorded = new Set(ledgerRows.map((r) => String(r.version)));
  const mapByVersion = new Map(versionMap.map((e) => [e.recorded_version, e]));
  const mapContext = { byVersion, fileSet: new Set(files), fileDigests, recordedVersions: allRecorded };
  const recordedVersions = new Set();
  const recordedIdentified = [];
  const recordedAmbiguous = [];
  const recordedByVersionMap = [];
  const versionMapViolations = [];
  const orphans = [];
  const nameMismatches = [];
  for (const row of ledgerRows) {
    const v = String(row.version);
    if (recordedVersions.has(v)) continue; // the ledger keys on version; a repeat adds nothing
    recordedVersions.add(v);
    const siblings = byVersion.get(v);
    const entry = mapByVersion.get(v);
    if (entry) {
      const problem = versionMapProblem(entry, row, mapContext);
      if (problem) {
        versionMapViolations.push({ version: v, file: entry.file, problem });
      } else {
        recordedByVersionMap.push({ version: v, name: entry.recorded_name, file: entry.file, evidence: entry.evidence });
        continue;
      }
    }
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

  // A file accepted through the version map IS recorded, under another version.
  const mappedFiles = new Set(recordedByVersionMap.map((m) => m.file));
  const unrecordedUnique = [];
  const unrecordedAmbiguous = [];
  for (const [v, all] of byVersion) {
    if (recordedVersions.has(v)) continue;
    const siblings = all.filter((f) => !mappedFiles.has(f));
    if (siblings.length > 1) unrecordedAmbiguous.push({ version: v, files: [...siblings].sort() });
    else if (siblings.length === 1) unrecordedUnique.push({ version: v, file: siblings[0] });
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
    recorded_by_version_map: recordedByVersionMap.sort(byVersionSorted),
    version_map_violations: versionMapViolations.sort(byVersionSorted),
    orphans: orphans.sort(byVersionSorted),
    name_mismatches: nameMismatches.sort(byVersionSorted),
    unrecorded_unique: unrecordedUnique.sort(byVersionSorted),
    unrecorded_ambiguous: unrecordedAmbiguous.sort(byVersionSorted),
    recorded_high_water: highWater,
    unrecorded_newer_than_high_water: newerThanHighWater,
    invalid_filenames: invalidFilenames.sort((a, b) => (a.file < b.file ? -1 : 1)),
    // Drift: history the repository does not have, or a version-map exception
    // whose evidence no longer holds.
    attention: orphans.length > 0 || versionMapViolations.length > 0,
  };
}

module.exports = { classifyLedger, versionOf, versionProblem, HISTORICAL_VERSION_MAP };
