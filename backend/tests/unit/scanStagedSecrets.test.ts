/**
 * SEC secret-scan — scripts/security/scan-staged-secrets.js (pure functions over diff text).
 *
 * Fixtures are synthetic (TESTONLY marker) and assembled at runtime from fragments, so this
 * file never contains a literal the secret gates would flag.
 */
import { spawnSync } from 'child_process';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const scanner = require('../../../scripts/security/scan-staged-secrets.js') as {
  parseAddedLines: (diff: string) => { added: Array<{ file: string; line: number; text: string }>; files: string[] };
  scanDiff: (diff: string, opts?: { allowlist?: unknown[] }) => Array<{ file: string; line: number; rule: string }>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gate = require('../../../scripts/check-secrets.js') as { fingerprint: (v: string) => string };

let seed = 0x57a9ed;
function noise(n: number, alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    s += alphabet[(seed >>> 16) % alphabet.length];
  }
  return s;
}
const OPENAI = 's' + 'k-proj-' + 'TESTONLY' + noise(44);
const ANTHROPIC = 's' + 'k-ant-api03-' + 'TESTONLY' + noise(40);
const GOCSPX = 'GOC' + 'SPX-' + 'TESTONLY' + noise(20);

function diff(file: string, hunks: Array<{ start: number; lines: string[] }>, isNew = false): string {
  const head = [`diff --git a/${file} b/${file}`, isNew ? 'new file mode 100644' : 'index 1111111..2222222 100644', isNew ? '--- /dev/null' : `--- a/${file}`, `+++ b/${file}`];
  const body = hunks.flatMap((h) => [`@@ -${h.start},0 +${h.start},${h.lines.length} @@ ctx`, ...h.lines]);
  return [...head, ...body].join('\n');
}

describe('parseAddedLines', () => {
  it('tracks new-file line numbers across hunks and ignores removed lines', () => {
    const d = diff('src/a.ts', [
      { start: 3, lines: ['+one', '-gone', '+two'] },
      { start: 40, lines: ['+forty'] },
    ]);
    const { added, files } = scanner.parseAddedLines(d);
    expect(files).toEqual(['src/a.ts']);
    expect(added).toEqual([
      { file: 'src/a.ts', line: 3, text: 'one' },
      { file: 'src/a.ts', line: 4, text: 'two' },
      { file: 'src/a.ts', line: 40, text: 'forty' },
    ]);
  });

  it('handles CRLF diffs and deleted files', () => {
    const d = ['diff --git a/x b/x', 'deleted file mode 100644', '--- a/x', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-old'].join('\r\n');
    expect(scanner.parseAddedLines(d).added).toEqual([]);
  });
});

describe('scanDiff', () => {
  it('reports file:line and rule id for added credentials — never the value', () => {
    const d = [
      diff('backend/x.ts', [{ start: 10, lines: ['+const ok = 1;', `+const k = "${OPENAI}";`] }]),
      diff('scripts/y.js', [{ start: 1, lines: [`+// ${ANTHROPIC}`, `+client_secret: ${GOCSPX}`] }]),
    ].join('\n');
    const findings = scanner.scanDiff(d);
    expect(findings).toEqual([
      { file: 'backend/x.ts', line: 11, rule: 'openai-api-key' },
      { file: 'scripts/y.js', line: 1, rule: 'anthropic-api-key' },
      { file: 'scripts/y.js', line: 2, rule: 'google-oauth-client-secret' },
    ]);
    const s = JSON.stringify(findings);
    for (const v of [OPENAI, ANTHROPIC, GOCSPX]) expect(s).not.toContain(v);
  });

  it('ignores removed lines and context lines (only additions matter)', () => {
    const d = diff('a.ts', [{ start: 5, lines: [`-const k = "${OPENAI}";`, '+const k = process.env.OPENAI_API_KEY;'] }]);
    expect(scanner.scanDiff(d)).toEqual([]);
  });

  it('accepts placeholders', () => {
    const d = diff('docs/setup.md', [{ start: 1, lines: ['+OPENAI_API_KEY=s' + 'k-your-openai-key-here-xxxxxxxxxxxxxxxxxxxxxxxx', '+DATABASE_URL=postgres://user:password@localhost:5432/db'] }]);
    expect(scanner.scanDiff(d)).toEqual([]);
  });

  it('flags a newly added dotenv file', () => {
    const d = diff('.env.production', [{ start: 1, lines: ['+FOO=bar'] }], true);
    expect(scanner.scanDiff(d)).toEqual([{ file: '.env.production', line: 0, rule: 'tracked-dotenv-file' }]);
    expect(scanner.scanDiff(diff('.env.example', [{ start: 1, lines: ['+FOO=bar'] }], true))).toEqual([]);
  });

  it('honours the fingerprint-pinned allowlist shared with the repo gate', () => {
    const d = diff('backend/tests/fixture.ts', [{ start: 2, lines: [`+const k = "${OPENAI}";`] }]);
    const allowlist = [{ file: 'backend/tests/fixture.ts', pattern: 'openai-api-key', fingerprint: gate.fingerprint(OPENAI), reason: 'synthetic fixture for unit test' }];
    expect(scanner.scanDiff(d, { allowlist })).toEqual([]);
    expect(scanner.scanDiff(d.replace('fixture.ts', 'other.ts'))).toHaveLength(1);
  });
});

describe('CLI', () => {
  it('exits 0 with no output when nothing secret is staged (runs against a temp repo)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os') as typeof import('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-staged-'));
    const git = (...args: string[]) => spawnSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    fs.mkdirSync(path.join(dir, 'scripts', 'security'), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../../../scripts/check-secrets.js'), path.join(dir, 'scripts', 'check-secrets.js'));
    fs.copyFileSync(path.resolve(__dirname, '../../../scripts/security/scan-staged-secrets.js'), path.join(dir, 'scripts', 'security', 'scan-staged-secrets.js'));
    fs.writeFileSync(path.join(dir, 'clean.txt'), 'hello\n');
    git('add', 'clean.txt');
    let r = spawnSync(process.execPath, ['scripts/security/scan-staged-secrets.js'], { cwd: dir, encoding: 'utf8' });
    expect(r.status).toBe(0);

    fs.writeFileSync(path.join(dir, 'leak.txt'), `x ${OPENAI}\n`);
    git('add', 'leak.txt');
    r = spawnSync(process.execPath, ['scripts/security/scan-staged-secrets.js'], { cwd: dir, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('leak.txt:1  [openai-api-key]');
    expect(r.stderr + r.stdout).not.toContain(OPENAI);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
