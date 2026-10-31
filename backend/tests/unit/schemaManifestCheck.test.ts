/**
 * F-D1 — `generate-schema-manifest.js --check` contract.
 *
 * generated/schema-column-manifest.json is committed and shipped verbatim:
 * bootFingerprint reads its manifest_hash and /api/health/version reports it.
 * Nothing regenerates it at build time, and it sat stale from 2026-05-20
 * (316e8b28) to 2026-10-31 (a870a80a… committed vs 344021bc… regenerated).
 *
 * These tests run the REAL script (hermetic: it reads supabase/migrations
 * only — no DB, no network) against copies of the committed file written to a
 * temp dir, so the committed file is never modified.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'generate-schema-manifest.js');
const COMMITTED = path.join(REPO, 'generated', 'schema-column-manifest.json');

function sha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function check(manifestPath: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--check', '--manifest', manifestPath], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// Each case spawns the real script (~3-7 s on a loaded box); keep well clear of
// the 30 s project default.
jest.setTimeout(120_000);

describe('generate-schema-manifest --check', () => {
  let dir: string;
  let committed: any;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-manifest-check-'));
    committed = JSON.parse(fs.readFileSync(COMMITTED, 'utf8'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeVariant(name: string, mutate: (m: any) => void): string {
    const copy = JSON.parse(JSON.stringify(committed));
    mutate(copy);
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(copy, null, 2));
    return p;
  }

  it('passes on the committed manifest and never writes it', () => {
    const before = sha(COMMITTED);
    const r = check(COMMITTED);
    expect(r.out).toMatch(/schema-manifest --check: OK/);
    expect(r.status).toBe(0);
    expect(sha(COMMITTED)).toBe(before);
  });

  it('ignores generated_at and first_consumer (not part of the hash)', () => {
    const p = writeVariant('cosmetic.json', (m) => {
      m.generated_at = '1999-01-01T00:00:00.000Z';
      for (const c of m.columns) c.first_consumer = null;
    });
    expect(check(p).status).toBe(0);
  });

  it('fails on the pre-fix stale manifest shape (source attribution drift)', () => {
    // The real 2026-05-20 defect: users/companies core columns attributed to
    // 20260325_activity_cost_test_data.sql instead of the bootstrap migration.
    const p = writeVariant('stale-attribution.json', (m) => {
      const row = m.columns.find((c: any) => c.table === 'users' && c.column === 'id');
      row.source_migration = '20260325_activity_cost_test_data.sql';
    });
    const r = check(p);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/FAIL/);
    expect(r.out).toMatch(/users\.id=/);
  });

  it('fails when a column the migrations declare is missing', () => {
    const p = writeVariant('missing-column.json', (m) => {
      m.columns = m.columns.filter((c: any) => !(c.table === 'companies' && c.column === 'require_assignment_approval'));
    });
    expect(check(p).status).toBe(1);
  });

  it('fails when only the hash is hand-edited', () => {
    const p = writeVariant('bad-hash.json', (m) => {
      m.manifest_hash = 'a870a80a849344183b2841a04125c601b343719630944f489eb87b438508e6bc';
    });
    const r = check(p);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/manifest_hash/);
  });

  it('fails when lifecycle_critical is flipped', () => {
    const p = writeVariant('critical-flip.json', (m) => {
      const row = m.columns.find((c: any) => c.column === 'deleted_at');
      row.lifecycle_critical = !row.lifecycle_critical;
    });
    expect(check(p).status).toBe(1);
  });

  it('exits 2 when the manifest is missing or unreadable', () => {
    expect(check(path.join(dir, 'does-not-exist.json')).status).toBe(2);
    const garbage = path.join(dir, 'garbage.json');
    fs.writeFileSync(garbage, '{not json');
    expect(check(garbage).status).toBe(2);
  });
});

describe('predeploy-check wires the manifest gate', () => {
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'predeploy-check.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('runs --check and blocks on failure', () => {
    const at = src.indexOf("node scripts/generate-schema-manifest.js --check");
    expect(at).toBeGreaterThan(-1);
    const tail = src.slice(at, at + 600);
    expect(tail).toMatch(/RESULT: BLOCKED/);
    expect(tail).toMatch(/process\.exit\(1\)/);
  });

  it('accepts critical env from the process env only when ALL four names are set', () => {
    expect(src).toMatch(/present\.length < CRITICAL_ENV\.length/);
    expect(src).toMatch(/unverified\.push\('critical env SKIPPED \(no \.env\.local\)'\)/);
  });
});
