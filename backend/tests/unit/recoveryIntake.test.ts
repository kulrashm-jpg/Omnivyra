/**
 * scripts/release/recovery-intake.js — byte-level intake of SQL recovered from the
 * Supabase SQL Editor (release gate B0). Textual verdicts only; never semantic.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const TOOL = path.join(REPO, 'scripts', 'release', 'recovery-intake.js');
const CLOSE_ANON = path.join(REPO, 'supabase', 'migrations', '20261026000000_close_anon_rls_exposure.sql');

let dir: string;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-intake-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function intake(artifact: string, content: Buffer, extra: string[] = []) {
  const file = path.join(dir, `${artifact}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, content);
  const out = `${file}.intake.json`;
  const r = spawnSync(process.execPath, [TOOL, artifact, file, '--source', 'test', '--observed-at', 'n/a',
    '--exported-at', 'n/a', '--out', out, ...extra], { encoding: 'utf8' });
  const record = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  return { code: r.status, record, out };
}

const committed = () => fs.readFileSync(CLOSE_ANON);

describe('recovery-intake', () => {
  it('exact copy → BYTE_IDENTICAL (exit 0)', () => {
    const { code, record } = intake('close_anon', committed());
    expect(code).toBe(0);
    expect(record.verdict).toBe('BYTE_IDENTICAL');
    expect(record.semantic_equivalence).toBe('NOT_ASSESSED_BY_THIS_TOOL');
  });

  it('CRLF + BOM copy → IDENTICAL_AFTER_EOL_NORMALIZATION (exit 10), never BYTE_IDENTICAL', () => {
    const crlf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(committed().toString('latin1').replace(/\n/g, '\r\n'), 'latin1')]);
    const { code, record } = intake('close_anon', crlf);
    expect(code).toBe(10);
    expect(record.verdict).toBe('IDENTICAL_AFTER_EOL_NORMALIZATION');
  });

  it('one changed statement → DIFFERENT (exit 11) with the line reported', () => {
    const lines = committed().toString('utf8').split('\n');
    const idx = lines.findIndex((l) => /REVOKE/.test(l));
    expect(idx).toBeGreaterThanOrEqual(0);
    lines[idx] = `${lines[idx]} -- altered`;
    const { code, record } = intake('close_anon', Buffer.from(lines.join('\n'), 'utf8'));
    expect(code).toBe(11);
    expect(record.verdict).toBe('DIFFERENT');
    expect(record.differences.entries.some((e: { ref_line: number | null }) => e.ref_line === idx + 1)).toBe(true);
  });

  it('revoke8 has no committed text → NO_REFERENCE_TEXT (exit 12)', () => {
    const { code, record } = intake('revoke8', Buffer.from('-- test fixture, not real SQL\n'));
    expect(code).toBe(12);
    expect(record.verdict).toBe('NO_REFERENCE_TEXT');
    expect(record.reference).toBeNull();
  });

  it('a reference that does not match its pinned hash → REFERENCE_HASH_MISMATCH (exit 3)', () => {
    const fake = path.join(dir, 'fake-repo');
    fs.mkdirSync(path.join(fake, 'supabase', 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'supabase', 'migrations', path.basename(CLOSE_ANON)), 'tampered\n');
    const { code, record } = intake('close_anon', committed(), ['--repo', fake]);
    expect(code).toBe(3);
    expect(record.verdict).toBe('REFERENCE_HASH_MISMATCH');
  });

  it('refuses to overwrite an existing evidence file and rejects unknown artifacts', () => {
    const first = intake('revoke8', Buffer.from('x\n'));
    const again = spawnSync(process.execPath, [TOOL, 'revoke8', first.out.replace(/\.intake\.json$/, ''), '--out', first.out], { encoding: 'utf8' });
    expect(again.status).toBe(2);
    const bad = spawnSync(process.execPath, [TOOL, 'nope', first.out], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
  });
});
