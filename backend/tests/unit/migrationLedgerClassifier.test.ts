/**
 * Migration-ledger classification (scripts/lib/migrationLedger.js) and its wiring
 * into verify-schema-parity.js.
 *
 * The probe this replaces compared `count(*)` of supabase_migrations.schema_migrations
 * with the number of local files. Here migrations are applied by hand and recording
 * is optional (docs/migration-discipline.md), and legacy 8-digit versions are shared
 * by several files, so that ratio always fired and could never be satisfied.
 */
import * as fs from 'fs';
import * as path from 'path';

import * as crypto from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyLedger, versionOf, versionProblem, HISTORICAL_VERSION_MAP } = require('../../../scripts/lib/migrationLedger');

const REPO = path.resolve(__dirname, '../../..');

describe('classifyLedger — identity by version, never by file count', () => {
  const files = [
    '20261201000000_alpha.sql',
    '20261202000000_beta.sql',
    '20261203000000_gamma.sql',
    '20260322_shared_one.sql',
    '20260322_shared_two.sql',
    '20260410_legacy_unique.sql',
    '20260632_pseudo_date.sql',
  ];

  it('identifies a recorded version only when exactly one file carries it', () => {
    const c = classifyLedger({ files, ledgerRows: [{ version: '20261201000000', name: 'alpha' }] });
    expect(c.recorded_identified).toEqual([{ version: '20261201000000', file: '20261201000000_alpha.sql' }]);
    expect(c.recorded_ambiguous).toEqual([]);
  });

  it('never infers which sibling of a shared version was recorded', () => {
    const c = classifyLedger({ files, ledgerRows: [{ version: '20260322', name: 'shared_one' }] });
    expect(c.recorded_identified).toEqual([]);
    expect(c.recorded_ambiguous).toEqual([
      { version: '20260322', files: ['20260322_shared_one.sql', '20260322_shared_two.sql'] },
    ]);
    // Ambiguity is not drift.
    expect(c.attention).toBe(false);
  });

  it('flags an orphan row — history the repository does not have — as attention', () => {
    const c = classifyLedger({ files, ledgerRows: [{ version: '20260525141657', name: 'ghost' }] });
    expect(c.orphans).toEqual([{ version: '20260525141657', name: 'ghost' }]);
    expect(c.attention).toBe(true);
  });

  it('reports missing records as UNRECORDED, never as unapplied, and not as drift', () => {
    const c = classifyLedger({ files, ledgerRows: [] });
    expect(c.unrecorded_unique.map((u: { version: string }) => u.version)).toEqual(
      ['20260410', '20260632', '20261201000000', '20261202000000', '20261203000000'],
    );
    expect(c.unrecorded_ambiguous).toEqual([
      { version: '20260322', files: ['20260322_shared_one.sql', '20260322_shared_two.sql'] },
    ]);
    expect(c.attention).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/unapplied/i);
  });

  it('does not require every file to have a ledger row', () => {
    const c = classifyLedger({ files, ledgerRows: [{ version: '20261201000000', name: 'alpha' }] });
    expect(c.local_files).toBe(7);
    expect(c.local_versions).toBe(6);
    expect(c.ledger_rows).toBe(1);
    expect(c.attention).toBe(false);
  });

  it('lists unrecorded 14-digit versions newer than the recorded high-water mark', () => {
    const c = classifyLedger({ files, ledgerRows: [{ version: '20261201000000', name: 'alpha' }] });
    expect(c.recorded_high_water).toBe('20261201000000');
    expect(c.unrecorded_newer_than_high_water).toEqual(['20261202000000', '20261203000000']);
  });

  it('reports a recorded name that differs from the file it identifies', () => {
    const c = classifyLedger({ files, ledgerRows: [{ version: '20261202000000', name: 'something_else' }] });
    expect(c.name_mismatches).toEqual([
      { version: '20261202000000', recorded_name: 'something_else', file: '20261202000000_beta.sql' },
    ]);
  });

  it('counts a repeated ledger version once', () => {
    const c = classifyLedger({
      files,
      ledgerRows: [{ version: '20261201000000', name: 'alpha' }, { version: '20261201000000', name: 'alpha' }],
    });
    expect(c.recorded_identified).toHaveLength(1);
  });

  it('reports malformed and impossible-date file names without treating them as drift', () => {
    const c = classifyLedger({
      files: [...files, 'no_version.sql', '2026122_seven_digits.sql', '20261299000000_bad_month.sql', '20261201250000_bad_hour.sql'],
      ledgerRows: [],
    });
    const problems = Object.fromEntries(c.invalid_filenames.map((f: { file: string; problem: string }) => [f.file, f.problem]));
    expect(problems['20260632_pseudo_date.sql']).toBe('impossible date');
    expect(problems['no_version.sql']).toBe('no leading version');
    expect(problems['2026122_seven_digits.sql']).toMatch(/7 digits/);
    expect(problems['20261299000000_bad_month.sql']).toBe('impossible date');
    expect(problems['20261201250000_bad_hour.sql']).toBe('impossible time');
    expect(c.attention).toBe(false);
  });

  it('parses versions the same way the migration-quality gate names them', () => {
    expect(versionOf('20261223000000_customer_readiness_snapshots_secured.sql')).toBe('20261223000000');
    expect(versionOf('20260322_x.sql')).toBe('20260322');
    expect(versionProblem('20261223000000')).toBeNull();
    expect(versionProblem('20260322')).toBeNull();
  });
});

describe('classifyLedger — against the real migration directory', () => {
  const files = fs.readdirSync(path.join(REPO, 'supabase', 'migrations'), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.sql'))
    .map((d) => d.name);

  it('accounts for every file exactly once, and has fewer versions than files', () => {
    const c = classifyLedger({ files, ledgerRows: [] });
    const accounted = c.unrecorded_unique.length
      + c.unrecorded_ambiguous.reduce((n: number, g: { files: string[] }) => n + g.files.length, 0);
    expect(accounted).toBe(files.length);
    expect(c.duplicate_version_groups).toBeGreaterThan(0);
    expect(c.local_versions).toBeLessThan(files.length);
  });
});

describe('HISTORICAL_VERSION_MAP — three evidence-backed exceptions, nothing else', () => {
  type Entry = { recorded_version: string; recorded_name: string; recorded_statements_md5: string; file: string; file_sha256: string; evidence: string };
  const MAP: Entry[] = HISTORICAL_VERSION_MAP;
  const migrationsDir = path.join(REPO, 'supabase', 'migrations');
  const realFiles = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.sql'))
    .map((d) => d.name);
  const realDigests = Object.fromEntries(MAP.map((e) => [
    e.file, crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, e.file))).digest('hex'),
  ]));
  const rowFor = (e: Entry) => ({ version: e.recorded_version, name: e.recorded_name, statements_md5: e.recorded_statements_md5 });
  const [title, runtime, lock] = MAP;

  it('holds exactly the three approved mappings, each with its evidence type', () => {
    expect(MAP.map((e) => [e.recorded_version, e.recorded_name, e.file, e.evidence])).toEqual([
      ['20260525141657', 'thread_title_column', '20260807_thread_title_column.sql', 'statement_identical_comment_stripped'],
      ['20260525223113', 'thread_runtime_executions', '20260808_thread_runtime_executions.sql', 'statement_executable_subset'],
      ['20260601022203', 'fix_creator_execution_lock_ambiguous_columns', '20260676_fix_creator_execution_lock_ambiguous_columns.sql', 'end_state_function_definitions'],
    ]);
    expect(Object.isFrozen(HISTORICAL_VERSION_MAP)).toBe(true);
  });

  it('pins the real files: each exists and hashes to its pinned digest', () => {
    for (const e of MAP) {
      expect(realFiles).toContain(e.file);
      expect(realDigests[e.file]).toBe(e.file_sha256);
      expect(versionOf(e.file)).not.toBe(e.recorded_version);
    }
  });

  it('accepts all three rows against the real migration directory, and nothing else changes', () => {
    const c = classifyLedger({ files: realFiles, ledgerRows: MAP.map(rowFor), fileDigests: realDigests });
    expect(c.recorded_by_version_map.map((m: { version: string; evidence: string }) => [m.version, m.evidence])).toEqual([
      ['20260525141657', 'statement_identical_comment_stripped'],
      ['20260525223113', 'statement_executable_subset'],
      ['20260601022203', 'end_state_function_definitions'],
    ]);
    expect(c.orphans).toEqual([]);
    expect(c.version_map_violations).toEqual([]);
    expect(c.attention).toBe(false);
    // An accepted file is recorded under another version — no longer listed as unrecorded.
    const unrecordedFiles = [
      ...c.unrecorded_unique.map((u: { file: string }) => u.file),
      ...c.unrecorded_ambiguous.flatMap((g: { files: string[] }) => g.files),
    ];
    for (const e of MAP) expect(unrecordedFiles).not.toContain(e.file);
  });

  it('never matches by name alone: same name under a different version stays an orphan', () => {
    const c = classifyLedger({
      files: realFiles, fileDigests: realDigests,
      ledgerRows: [{ version: '20260525141658', name: title.recorded_name, statements_md5: title.recorded_statements_md5 }],
    });
    expect(c.recorded_by_version_map).toEqual([]);
    expect(c.orphans).toEqual([{ version: '20260525141658', name: 'thread_title_column' }]);
    expect(c.attention).toBe(true);
  });

  const rejects = (label: string, input: object, problem: RegExp) => {
    it(`rejects ${label}`, () => {
      const c = classifyLedger(input);
      expect(c.recorded_by_version_map).toEqual([]);
      expect(c.version_map_violations).toHaveLength(1);
      expect(c.version_map_violations[0].problem).toMatch(problem);
      expect(c.attention).toBe(true);
    });
  };

  rejects('a different recorded name',
    { files: realFiles, fileDigests: realDigests, ledgerRows: [{ ...rowFor(runtime), name: 'thread_runtime_execution' }] },
    /recorded name/);
  rejects('a changed recorded statement fingerprint',
    { files: realFiles, fileDigests: realDigests, ledgerRows: [{ ...rowFor(runtime), statements_md5: '0'.repeat(32) }] },
    /fingerprint changed/);
  rejects('a row whose statement fingerprint was not read',
    { files: realFiles, fileDigests: realDigests, ledgerRows: [{ version: lock.recorded_version, name: lock.recorded_name }] },
    /fingerprint unavailable/);
  rejects('a missing mapped file (e.g. renamed to a different file name)',
    { files: realFiles.filter((f) => f !== lock.file).concat('20260676_fix_creator_execution_lock.sql'), fileDigests: realDigests, ledgerRows: [rowFor(lock)] },
    /is missing/);
  rejects('a changed mapped file',
    { files: realFiles, fileDigests: { ...realDigests, [title.file]: 'f'.repeat(64) }, ledgerRows: [rowFor(title)] },
    /changed \(sha256/);
  rejects('a mapped file that was not hashed',
    { files: realFiles, fileDigests: {}, ledgerRows: [rowFor(title)] },
    /was not hashed/);
  rejects('a duplicate version: a repository file now carries the recorded version',
    { files: realFiles.concat(`${title.recorded_version}_thread_title_column.sql`), fileDigests: realDigests, ledgerRows: [rowFor(title)] },
    /carries the recorded version/);
  rejects('a mapped file that is ALSO recorded under its own version',
    { files: realFiles, fileDigests: realDigests, ledgerRows: [rowFor(lock), { version: '20260676', name: 'fix_creator_execution_lock_ambiguous_columns' }] },
    /also recorded under its own version/);

  it('keeps an unrelated orphan a warning when every mapping holds', () => {
    const c = classifyLedger({
      files: realFiles, fileDigests: realDigests,
      ledgerRows: [...MAP.map(rowFor), { version: '20260101000000', name: 'unrelated_history' }],
    });
    expect(c.recorded_by_version_map).toHaveLength(3);
    expect(c.orphans).toEqual([{ version: '20260101000000', name: 'unrelated_history' }]);
    expect(c.attention).toBe(true);
  });
});

describe('verify-schema-parity — ledger wiring', () => {
  const source = fs.readFileSync(path.join(REPO, 'scripts', 'verify-schema-parity.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('reads ledger identities (version, name, statement fingerprint), not a row count', () => {
    expect(code).toMatch(/SELECT version, name, md5\(array_to_string\(statements, E'\\\\n'\)\) AS statements_md5 FROM supabase_migrations\.schema_migrations/);
    expect(code).not.toMatch(/count\(\*\)::int AS n FROM supabase_migrations\.schema_migrations/);
    expect(code).toMatch(/classifyLedger\(\{ files, ledgerRows: ledgerRes\.rows, fileDigests \}\)/);
  });

  it('hashes exactly the files the historical version map pins', () => {
    expect(code).toMatch(/for \(const \{ file \} of HISTORICAL_VERSION_MAP\)/);
    expect(code).toMatch(/createHash\('sha256'\)\.update\(fs\.readFileSync\(p\)\)/);
  });

  it('no longer compares ledger rows with a fraction of the file count', () => {
    expect(code).not.toMatch(/ledgerCount < localCount \* 0\.5/);
  });

  it('never reports an unreadable ledger as clean', () => {
    const at = code.indexOf('"SELECT version, name, md5(array_to_string(statements');
    const catchAt = code.indexOf('} catch (e) {', at);
    const after = code.slice(catchAt, catchAt + 200);
    expect(after).toMatch(/ledgerDesyncDetected = true/);
    expect(after).toMatch(/verified: false/);
  });

  it("publishes status 'ok' only under the exit-0 condition — INFO findings report 'INFO'", () => {
    expect(code).toMatch(/status: missing\.length === 0 && !ledgerDesyncDetected \? 'ok'/);
    expect(code).toMatch(/: 'INFO',/);
    expect(code).not.toMatch(/status: overall === 'INFO' && !ledgerDesyncDetected \? 'ok'/);
  });

  it('keeps the single exit-0 condition gated on the ledger result', () => {
    expect(code.match(/process\.exit\(0\)/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/missing\.length === 0 && !ledgerDesyncDetected[\s\S]{0,200}process\.exit\(0\)/);
  });
});
