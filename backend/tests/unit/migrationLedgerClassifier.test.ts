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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyLedger, versionOf, versionProblem } = require('../../../scripts/lib/migrationLedger');

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

describe('verify-schema-parity — ledger wiring', () => {
  const source = fs.readFileSync(path.join(REPO, 'scripts', 'verify-schema-parity.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('reads ledger identities (version, name), not a row count', () => {
    expect(code).toMatch(/SELECT version, name FROM supabase_migrations\.schema_migrations/);
    expect(code).not.toMatch(/count\(\*\)::int AS n FROM supabase_migrations\.schema_migrations/);
    expect(code).toMatch(/classifyLedger\(\{ files, ledgerRows: ledgerRes\.rows \}\)/);
  });

  it('no longer compares ledger rows with a fraction of the file count', () => {
    expect(code).not.toMatch(/ledgerCount < localCount \* 0\.5/);
  });

  it('never reports an unreadable ledger as clean', () => {
    const at = code.indexOf("'SELECT version, name FROM supabase_migrations.schema_migrations");
    const catchAt = code.indexOf('} catch (e) {', at);
    const after = code.slice(catchAt, catchAt + 200);
    expect(after).toMatch(/ledgerDesyncDetected = true/);
    expect(after).toMatch(/verified: false/);
  });

  it('keeps the single exit-0 condition gated on the ledger result', () => {
    expect(code.match(/process\.exit\(0\)/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/missing\.length === 0 && !ledgerDesyncDetected[\s\S]{0,200}process\.exit\(0\)/);
  });
});
