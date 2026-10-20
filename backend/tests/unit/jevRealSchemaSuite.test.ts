/**
 * scripts/ci/real-schema-suite.js — the registry entrypoint that runs ONE named
 * set of real-schema suites through the hardened bash harness.
 *
 * Hermetic except the one test that asks Jest itself which files a pattern
 * selects (`--listTests`, which never runs a suite, its setup, or a database).
 * No Docker, no database, no bash is ever started: every spawn below is a fake.
 */
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const suite = require('../../../scripts/ci/real-schema-suite.js');

jest.setTimeout(300000);

const ROOT = path.resolve(__dirname, '../../..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'ci', 'real-schema-suite.js'), 'utf8');
const LI3 = 'backend/tests/realschema/li3_contact_governance.test.ts';
const LI3D = 'backend/tests/realschema/li3d_governance_writer.test.ts';

type Call = { cmd: string; args: string[]; opts: Record<string, unknown> };

/** A fake spawnSync: `git --exec-path`, jest `--listTests` and the harness are all answered here. */
function fakeSpawn(opts: { listed?: string[]; harnessStatus?: number; execPath?: string } = {}) {
  const calls: Call[] = [];
  const spawnSync = (cmd: string, args: string[], o: Record<string, unknown>) => {
    calls.push({ cmd, args, opts: o });
    if (cmd === 'git') return { status: 0, stdout: `${opts.execPath ?? 'C:/Git/mingw64/libexec/git-core'}\n` };
    if (args.includes('--listTests')) {
      return { status: 0, stdout: (opts.listed ?? []).map((p) => path.join(ROOT, p)).join('\n') };
    }
    return { status: opts.harnessStatus ?? 0 };
  };
  return { calls, spawnSync };
}

function runWith(argv: string[], deps: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = suite.run(argv, { PATH: 'x' }, { out: (s: string) => out.push(s), err: (s: string) => err.push(s), ...deps });
  return { code, out, err };
}

const harnessCalls = (calls: Call[]) => calls.filter((c) => c.args.includes(suite.HARNESS));

describe('argument validation', () => {
  it.each([
    [[], 'at least one suite'],
    [['--list'], 'at least one suite'],
    [['/abs/backend/tests/realschema/x.test.ts'], 'not an exact'],
    [['backend/tests/realschema/../unit/x.test.ts'], 'not an exact'],
    [['backend\\tests\\realschema\\li3_contact_governance.test.ts'], 'not an exact'],
    [['backend/tests/realschema/li3.*'], 'not an exact'],
    [['backend/tests/realschema/li3*.test.ts'], 'not an exact'],
    [['backend/tests/realschema/setup.ts'], 'not an exact'],
    [['backend/tests/unit/jevFlowCli.test.ts'], 'not an exact'],
    [['li3_contact_governance'], 'not an exact'],
    [[LI3, LI3], 'duplicate'],
  ])('%j → usage 64, nothing spawned', (argv, msg) => {
    const f = fakeSpawn();
    const r = runWith(argv as string[], { spawnSync: f.spawnSync });
    expect(r.code).toBe(64);
    expect(r.err.join('\n')).toContain(msg);
    expect(f.calls).toEqual([]);
  });

  it('caps the number of suites', () => {
    const many = Array.from({ length: 21 }, (_, i) => `backend/tests/realschema/s${i}.test.ts`);
    expect(suite.parseArgs(many).error).toContain('at most 20');
  });
});

describe('selection pattern', () => {
  const re = (names: string[]) => new RegExp(suite.buildPattern(names));

  it('matches exactly the named files, under either path separator', () => {
    const p = re(['li3_contact_governance']);
    expect(p.test(`/repo/${LI3}`)).toBe(true);
    expect(p.test(`C:\\repo\\${LI3.replace(/\//g, '\\')}`)).toBe(true);
  });

  it('never matches a longer name, a prefix sibling, or another directory', () => {
    const p = re(['li3_contact_governance']);
    expect(p.test(`/repo/${LI3D}`)).toBe(false);
    expect(p.test('/repo/backend/tests/realschema/li3_contact_governance_extra.test.ts')).toBe(false);
    expect(p.test('/repo/backend/tests/realschema/xli3_contact_governance.test.ts')).toBe(false);
    expect(p.test('/repo/backend/tests/unit/li3_contact_governance.test.ts')).toBe(false);
    expect(p.test(`/repo/${LI3}.bak`)).toBe(false);
    expect(p.test(`/repo/${LI3}x`)).toBe(false);
  });

  it('real Jest resolution: --list of li3_contact_governance selects that file only (not li3d)', () => {
    const r = runWith(['--list', LI3]);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([`selected 1 suite(s): ${LI3}`]);
  });
});

describe('run', () => {
  it('a missing suite → 2, Jest and the harness never invoked', () => {
    const f = fakeSpawn();
    const r = runWith(['backend/tests/realschema/does_not_exist.test.ts'], { spawnSync: f.spawnSync });
    expect(r.code).toBe(2);
    expect(f.calls).toEqual([]);
  });

  it('Jest selecting anything other than the requested set → 3, harness never invoked', () => {
    const f = fakeSpawn({ listed: [LI3, LI3D] });
    const r = runWith([LI3], { spawnSync: f.spawnSync, platform: 'linux' });
    expect(r.code).toBe(3);
    expect(r.err.join('\n')).toContain('selection mismatch');
    expect(harnessCalls(f.calls)).toEqual([]);
  });

  it('--list never invokes bash or the harness', () => {
    const f = fakeSpawn({ listed: [LI3] });
    expect(runWith(['--list', LI3], { spawnSync: f.spawnSync, platform: 'linux' }).code).toBe(0);
    expect(f.calls.map((c) => c.cmd)).toEqual([process.execPath]);
  });

  it('runs the bash harness once, no shell, with W6_ONLY = the verified pattern, and returns its exit code', () => {
    const f = fakeSpawn({ listed: [LI3], harnessStatus: 7 });
    const r = runWith([LI3], { spawnSync: f.spawnSync, platform: 'linux' });
    expect(r.code).toBe(7);
    const [h] = harnessCalls(f.calls);
    expect(h.cmd).toBe('bash');
    expect(h.args).toEqual([suite.HARNESS]);
    expect(h.opts.shell).toBe(false);
    expect(h.opts.cwd).toBe(ROOT);
    expect((h.opts.env as Record<string, string>).W6_ONLY).toBe(suite.buildPattern(['li3_contact_governance']));
    expect((h.opts.env as Record<string, string>).PATH).toBe('x');
    expect(harnessCalls(f.calls)).toHaveLength(1);
  });

  it('no safe bash on Windows → 4, harness never invoked', () => {
    const f = fakeSpawn({ listed: [LI3] });
    const r = runWith([LI3], { spawnSync: f.spawnSync, platform: 'win32', existsSync: (p: string) => fs.existsSync(p) && !p.endsWith('bash.exe') });
    expect(r.code).toBe(4);
    expect(harnessCalls(f.calls)).toEqual([]);
  });
});

describe('resolveBash', () => {
  const deps = (exists: (p: string) => boolean, execPath = 'C:/Git/mingw64/libexec/git-core') => ({
    platform: 'win32',
    spawnSync: fakeSpawn({ execPath }).spawnSync,
    existsSync: exists,
  });
  const gitRoot = path.resolve('C:/Git/mingw64/libexec/git-core', '..', '..', '..');

  it('Windows: Git Bash next to git — bin/ first, then usr/bin/', () => {
    expect(suite.resolveBash(deps(() => true))).toBe(path.join(gitRoot, 'bin', 'bash.exe'));
    expect(suite.resolveBash(deps((p) => p.includes(`usr${path.sep}bin`)))).toBe(path.join(gitRoot, 'usr', 'bin', 'bash.exe'));
  });

  it('Windows: never a PATH bash (WSL System32 / WindowsApps); null when Git Bash is absent', () => {
    expect(suite.resolveBash(deps(() => false))).toBeNull();
    // Only the two Git-relative candidates are ever probed.
    const probed: string[] = [];
    suite.resolveBash(deps((p) => { probed.push(p); return false; }));
    expect(probed).toEqual([path.join(gitRoot, 'bin', 'bash.exe'), path.join(gitRoot, 'usr', 'bin', 'bash.exe')]);
  });

  it('non-Windows: plain bash', () => {
    expect(suite.resolveBash({ platform: 'linux' })).toBe('bash');
  });
});

describe('static guarantees', () => {
  it('no shell, and the database target is never chosen or overridden here', () => {
    expect(SRC).not.toMatch(/shell:\s*true/);
    expect(SRC).not.toMatch(/W6_DB_URL/);
    expect(SRC).not.toMatch(/\bdocker\b|\bpsql\b/);
  });
});
