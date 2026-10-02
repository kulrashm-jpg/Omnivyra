/**
 * gov verify (Track 2): registry loader, evidence store, and runVerification
 * against throwaway git repos under os.tmpdir(); GOV_HOME is a separate temp
 * dir outside any work tree. Fake runners plus real `node -e` registry runs.
 * No network.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_REGISTRY_FILE, loadRegistry, registryDigest, resolveEntries, validateRegistry } from '../../../scripts/jev-flow/registry';
import { createGitProbe } from '../../../scripts/jev-flow/scope';
import { buildBundle, loadBundle, storeBundle, storeLog } from '../../../scripts/jev-flow/evidence';
import { defaultRunner, runVerification, spawnSpec, type CommandRunner } from '../../../scripts/jev-flow/verify';
import {
  GOVERNANCE_VERSION,
  HUMAN_ONLY_RULES,
  PACKET_SCHEMA,
  canonicalHash,
  govLayout,
  hashHex,
  packetHash,
  type GovLayout,
  type GovernedPacket,
  type VerificationRegistry,
} from '../../../scripts/jev-flow/types';

jest.setTimeout(120000);

const STORY = 'OMNI-7';
const BRANCH = 'gov/omni-7';
const FIXED = new Date('2026-10-01T12:00:00.000Z');
const fixedNow = () => FIXED;

const TEST_REGISTRY: VerificationRegistry = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 't.pass', description: 'exit 0', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
    { id: 't.fail', description: 'exit 1', argv: ['node', '-e', 'process.exit(1)'], evidence_kind: 'typecheck', timeout_ms: 60000 },
    { id: 't.dirty', description: 'dirties tree', argv: ['node', '-e', "require('fs').writeFileSync('dirt.txt','x')"], evidence_kind: 'build', timeout_ms: 60000 },
  ],
});

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function write(repo: string, rel: string, text: string): void {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  repo: string;
  base: string;
  head: string;
  layout: GovLayout;
}

const templates = new Map<string, { dir: string; base: string; head: string }>();

/** Build the template repo once per change set (git process startup is slow on Windows CI hosts). */
function template(changed: string[]): { dir: string; base: string; head: string } {
  const key = changed.join('|');
  const hit = templates.get(key);
  if (hit) return hit;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-verify-tpl-'));
  tmpDirs.push(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'gov-test@example.invalid');
  sh(dir, 'config', 'user.name', 'gov test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, 'README.md', 'base\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'base');
  const base = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'checkout', '-q', '-b', BRANCH);
  for (const c of changed) write(dir, c, `change ${c}\n`);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'work', '-m', `Governed-By: ${STORY}`);
  const head = sh(dir, 'rev-parse', 'HEAD');
  const t = { dir, base, head };
  templates.set(key, t);
  return t;
}

/** Fresh copy of a repo with base on main and one governed commit on BRANCH touching `changed`. */
function fixture(changed: string[] = ['scripts/jev-flow/x.ts']): Fixture {
  const t = template(changed);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-verify-repo-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-verify-home-'));
  tmpDirs.push(repo, home);
  fs.cpSync(t.dir, repo, { recursive: true });
  return { repo, base: t.base, head: t.head, layout: govLayout({ GOV_HOME: home }) };
}

function makePacket(fx: Fixture, ids: string[], registry: VerificationRegistry = TEST_REGISTRY, over: Partial<GovernedPacket> = {}): GovernedPacket {
  return {
    schema: PACKET_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story: { key: STORY, summary: 's', status: 'In Progress', objective: 'o', architecture: null, invariants: [], updated: '2026-10-01T10:00:00.000+0000' },
    acceptance_criteria: [],
    scope: { authorized_paths: ['scripts/jev-flow/**'], prohibited_paths: ['scripts/jev-flow/types.ts'] },
    verification: { registry_ids: ids, registry_digest: registryDigest(registry, ids) },
    base: { commit: fx.base, branch: BRANCH, worktree: fx.repo.replace(/\\/g, '/') },
    rules: [...HUMAN_ONLY_RULES],
    ...over,
  };
}

const okRunner = (): jest.Mock => jest.fn(async () => ({ exitCode: 0, output: Buffer.from('ok\n'), timedOut: false }));

async function verify(fx: Fixture, packet: GovernedPacket, runner?: CommandRunner, registry = TEST_REGISTRY) {
  return runVerification({ packet, packetHash: packetHash(packet), worktree: fx.repo, registry, git: createGitProbe(), layout: fx.layout, runner, now: fixedNow });
}

function evidenceFiles(layout: GovLayout): string[] {
  const dir = layout.evidenceDir(STORY);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

// ---------------------------------------------------------------- registry

describe('registry', () => {
  const entry = { id: 'a.b', description: 'd', argv: ['node', 'x.js'], evidence_kind: 'test_run', timeout_ms: 1000 };
  const reg = (entries: unknown[], schema = 'gov-registry/1') => ({ schema, entries });

  it('real verification-registry.json loads and validates', () => {
    const r = loadRegistry();
    expect(path.basename(DEFAULT_REGISTRY_FILE)).toBe('verification-registry.json');
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.entries.every((e) => e.argv[0] === 'node')).toBe(true);
  });

  it('loads from an explicit file', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gov-reg-')), 'r.json');
    tmpDirs.push(path.dirname(f));
    fs.writeFileSync(f, JSON.stringify(reg([entry])));
    expect(loadRegistry(f).entries[0].id).toBe('a.b');
    fs.writeFileSync(f, '{not json');
    expect(() => loadRegistry(f)).toThrow(/invalid verification registry/);
  });

  it.each([
    ['bad schema', reg([entry], 'gov-registry/2')],
    ['argv[0] not node', reg([{ ...entry, argv: ['bash', '-c', 'true'] }])],
    ['argv[0] absolute node path', reg([{ ...entry, argv: ['/usr/bin/node', 'x.js'] }])],
    ['empty argv', reg([{ ...entry, argv: [] }])],
    ['empty argv element', reg([{ ...entry, argv: ['node', ''] }])],
    ['NUL in argv', reg([{ ...entry, argv: ['node', 'a\0b'] }])],
    ['non-string argv', reg([{ ...entry, argv: ['node', 1] }])],
    ['duplicate ids', reg([entry, { ...entry }])],
    ['bad id', reg([{ ...entry, id: 'Bad Id' }])],
    ['bad evidence kind', reg([{ ...entry, evidence_kind: 'lint' }])],
    ['zero timeout', reg([{ ...entry, timeout_ms: 0 }])],
    ['fractional timeout', reg([{ ...entry, timeout_ms: 1.5 }])],
    ['timeout too large', reg([{ ...entry, timeout_ms: 3_600_001 }])],
    ['unknown key', reg([{ ...entry, shell: true }])],
    ['no entries', reg([])],
  ])('rejects %s', (_name, value) => {
    expect(() => validateRegistry(value)).toThrow(/invalid verification registry/);
  });

  it('resolveEntries keeps order and refuses unknown ids', () => {
    const r = resolveEntries(TEST_REGISTRY, ['t.fail', 't.pass']);
    expect(r.ok === true && r.entries.map((e) => e.id)).toEqual(['t.fail', 't.pass']);
    const u = resolveEntries(TEST_REGISTRY, ['t.pass', 'nope', 'nope']);
    expect(u.ok === false && u.unknown).toEqual(['nope']);
  });

  it('registryDigest = canonicalHash(entries in ids order) (shared formula)', () => {
    const [p, f] = TEST_REGISTRY.entries;
    expect(registryDigest(TEST_REGISTRY, ['t.pass', 't.fail'])).toBe(canonicalHash([p, f]));
    expect(registryDigest(TEST_REGISTRY, ['t.fail', 't.pass'])).toBe(canonicalHash([f, p]));
    expect(registryDigest(TEST_REGISTRY, ['t.pass'])).not.toBe(registryDigest(TEST_REGISTRY, ['t.fail']));
  });
});

// ---------------------------------------------------------------- runner

describe('default runner', () => {
  it('spawns process.execPath with no shell', () => {
    const spec = spawnSpec(['node', '-e', 'x'], { cwd: '/w' });
    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toEqual(['-e', 'x']);
    expect(spec.options.shell).toBe(false);
    expect(spec.options.cwd).toBe('/w');
    expect(() => spawnSpec(['bash', '-c', 'true'], { cwd: '/w' })).toThrow(/argv\[0\]/);
  });

  it('captures output + exit code, and kills on timeout', async () => {
    const r = await defaultRunner(['node', '-e', "process.stdout.write('out');process.stderr.write('err');process.exit(3)"], { cwd: os.tmpdir(), timeoutMs: 60000 });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
    expect(r.output.toString('utf8')).toContain('out');
    expect(r.output.toString('utf8')).toContain('err');
    const t = await defaultRunner(['node', '-e', 'setTimeout(()=>{},60000)'], { cwd: os.tmpdir(), timeoutMs: 300 });
    expect(t.timedOut).toBe(true);
    expect(t.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------- evidence store

describe('evidence store', () => {
  function sampleBundle(fx: Fixture) {
    const log = storeLog(fx.layout, STORY, Buffer.from('log text'));
    return buildBundle({
      story_key: STORY,
      packet_hash: canonicalHash('p'),
      worktree: fx.repo,
      branch: BRANCH,
      base_commit: fx.base,
      head_commit: fx.head,
      registry_digest: canonicalHash('r'),
      scope: { ok: true, base_commit: fx.base, head_commit: fx.head, changed_paths: [], outside_authorized: [], prohibited_touched: [] },
      items: [{ id: 'EV-1', registry_id: 't.pass', evidence_kind: 'test_run', argv_digest: canonicalHash(['node']), exit_code: 0, result: 'PASS', timed_out: false, log_sha256: log.sha256, log_bytes: log.bytes, started_at: FIXED.toISOString(), finished_at: FIXED.toISOString() }],
      verified_at: FIXED.toISOString(),
    });
  }

  it('stores idempotently, loads, and logs are content-addressed', () => {
    const fx = fixture();
    const b = sampleBundle(fx);
    expect(b.deterministic_result).toBe('PASS');
    const s1 = storeBundle(fx.layout, b);
    const s2 = storeBundle(fx.layout, b);
    expect(s2).toEqual(s1);
    expect(loadBundle(fx.layout, STORY, s1.bundle_hash)).toEqual(s1);
    const log = storeLog(fx.layout, STORY, Buffer.from('log text'));
    expect(fs.readFileSync(fx.layout.logFile(STORY, log.sha256), 'utf8')).toBe('log text');
    expect(log.bytes).toBe(8);
    expect(buildBundle({ ...b, items: [{ ...b.items[0], result: 'FAIL' }] }).deterministic_result).toBe('FAIL');
    expect(buildBundle({ ...b, scope: { ...b.scope, ok: false } }).deterministic_result).toBe('FAIL');
  });

  it('loadBundle detects content, hash and filename tampering', () => {
    const fx = fixture();
    const s = storeBundle(fx.layout, sampleBundle(fx));
    const file = fx.layout.evidenceFile(STORY, s.bundle_hash);
    const original = fs.readFileSync(file, 'utf8');

    fs.writeFileSync(file, original.replace('"exit_code":0', '"exit_code":1'));
    expect(() => loadBundle(fx.layout, STORY, s.bundle_hash)).toThrow(/^INTEGRITY_FAILED/);

    const other = canonicalHash('other');
    fs.writeFileSync(fx.layout.evidenceFile(STORY, other), original);
    expect(() => loadBundle(fx.layout, STORY, other)).toThrow(/^INTEGRITY_FAILED/);

    fs.writeFileSync(file, original.replace(hashHex(s.bundle_hash), hashHex(other)));
    expect(() => loadBundle(fx.layout, STORY, s.bundle_hash)).toThrow(/^INTEGRITY_FAILED/);

    fs.writeFileSync(file, '{');
    expect(() => loadBundle(fx.layout, STORY, s.bundle_hash)).toThrow(/^INTEGRITY_FAILED/);
  });

  it('refuses credential-shaped content', () => {
    const fx = fixture();
    const b = sampleBundle(fx);
    const leak = { ...b, branch: ['sk', 'Q'.repeat(30)].join('-') };
    expect(() => storeBundle(fx.layout, leak)).toThrow(/credential-shaped/);
    expect(evidenceFiles(fx.layout)).toEqual([]);
  });
});

// ---------------------------------------------------------------- runVerification

describe('runVerification refusals (no command runs)', () => {
  it('unknown registry id -> REFUSED', async () => {
    const fx = fixture();
    const runner = okRunner();
    const r = await verify(fx, makePacket(fx, ['t.pass', 'nope']), runner);
    expect(r.status).toBe('REFUSED');
    expect(r.message).toMatch(/unknown registry id.*nope/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('dirty tree (unstaged) -> REFUSED', async () => {
    const fx = fixture();
    write(fx.repo, 'scripts/jev-flow/x.ts', 'edited\n');
    const runner = okRunner();
    const r = await verify(fx, makePacket(fx, ['t.pass']), runner);
    expect(r).toEqual({ status: 'REFUSED', message: expect.stringMatching(/dirty\/uncommitted/) });
    expect(runner).not.toHaveBeenCalled();
  });

  it('dirty tree (staged) -> REFUSED', async () => {
    const fx = fixture();
    write(fx.repo, 'scripts/jev-flow/y.ts', 'new\n');
    sh(fx.repo, 'add', '-A');
    const runner = okRunner();
    expect((await verify(fx, makePacket(fx, ['t.pass']), runner)).status).toBe('REFUSED');
    expect(runner).not.toHaveBeenCalled();
  });

  it('untracked file -> REFUSED', async () => {
    const fx = fixture();
    write(fx.repo, 'scratch/untracked.txt', 'u');
    const runner = okRunner();
    const r = await verify(fx, makePacket(fx, ['t.pass']), runner);
    expect(r.status).toBe('REFUSED');
    expect(r.message).toMatch(/dirty/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('wrong branch -> REFUSED', async () => {
    const fx = fixture();
    sh(fx.repo, 'checkout', '-q', '-b', 'other');
    const runner = okRunner();
    const r = await verify(fx, makePacket(fx, ['t.pass']), runner);
    expect(r.status).toBe('REFUSED');
    expect(r.message).toMatch(/branch/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('wrong worktree -> REFUSED', async () => {
    const fx = fixture();
    const packet = makePacket(fx, ['t.pass']);
    packet.base.worktree = path.join(os.tmpdir(), 'elsewhere').replace(/\\/g, '/');
    const runner = okRunner();
    const r = await verify(fx, packet, runner);
    expect(r.status).toBe('REFUSED');
    expect(r.message).toMatch(/worktree/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('HEAD not descending from base -> REFUSED', async () => {
    const fx = fixture();
    sh(fx.repo, 'checkout', '-q', 'main');
    write(fx.repo, 'README.md', 'diverged\n');
    sh(fx.repo, 'commit', '-q', '-am', 'diverge');
    const diverged = sh(fx.repo, 'rev-parse', 'HEAD');
    sh(fx.repo, 'checkout', '-q', BRANCH);
    const packet = makePacket(fx, ['t.pass']);
    packet.base.commit = diverged;
    const runner = okRunner();
    const r = await verify(fx, packet, runner);
    expect(r.status).toBe('REFUSED');
    expect(r.message).toMatch(/descend/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('scope violation -> SCOPE_VIOLATION, runner never called', async () => {
    const fx = fixture(['scripts/jev-flow/x.ts', 'package.json']);
    const runner = okRunner();
    const r = await verify(fx, makePacket(fx, ['t.pass']), runner);
    expect(r.status).toBe('SCOPE_VIOLATION');
    expect(r.scope.outside_authorized).toEqual(['package.json']);
    expect(r.scope.head_commit).toBe(fx.head);
    expect(r.stored).toBeUndefined();
    expect(runner).not.toHaveBeenCalled();
    expect(evidenceFiles(fx.layout)).toEqual([]);
  });

  it('prohibited path -> SCOPE_VIOLATION', async () => {
    const fx = fixture(['scripts/jev-flow/types.ts']);
    const runner = okRunner();
    const r = await verify(fx, makePacket(fx, ['t.pass']), runner);
    expect(r.status).toBe('SCOPE_VIOLATION');
    expect(r.scope.prohibited_touched).toEqual(['scripts/jev-flow/types.ts']);
    expect(r.scope.outside_authorized).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it('packet hash mismatch -> INTEGRITY_FAILED', async () => {
    const fx = fixture();
    const packet = makePacket(fx, ['t.pass']);
    const runner = okRunner();
    const r = await runVerification({ packet: { ...packet, rules: [] }, packetHash: packetHash(packet), worktree: fx.repo, registry: TEST_REGISTRY, git: createGitProbe(), layout: fx.layout, runner, now: fixedNow });
    expect(r.status).toBe('INTEGRITY_FAILED');
    expect(runner).not.toHaveBeenCalled();
  });

  it('registry drift -> STALE', async () => {
    const fx = fixture();
    const packet = makePacket(fx, ['t.pass']);
    const drifted: VerificationRegistry = { ...TEST_REGISTRY, entries: TEST_REGISTRY.entries.map((e) => (e.id === 't.pass' ? { ...e, timeout_ms: 1234 } : e)) };
    const runner = okRunner();
    const r = await verify(fx, packet, runner, drifted);
    expect(r.status).toBe('STALE');
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('runVerification execution', () => {
  it('PASS with a fake runner: fields recorded and bundle deterministic', async () => {
    const fx = fixture();
    const packet = makePacket(fx, ['t.pass', 't.fail']);
    const calls: Array<{ argv: string[]; cwd: string; timeoutMs: number }> = [];
    const runner: CommandRunner = async (argv, opts) => {
      calls.push({ argv, ...opts });
      return { exitCode: 0, output: Buffer.from(`ran ${argv[2]}`), timedOut: false };
    };
    const r1 = await verify(fx, packet, runner);
    expect(r1.status).toBe('OK');
    expect(calls.map((c) => c.argv)).toEqual([TEST_REGISTRY.entries[0].argv, TEST_REGISTRY.entries[1].argv]);
    expect(calls.every((c) => c.cwd === fx.repo && c.timeoutMs === 60000)).toBe(true);

    const b = r1.stored.bundle;
    expect(b.head_commit).toBe(fx.head);
    expect(b.base_commit).toBe(fx.base);
    expect(b.branch).toBe(BRANCH);
    expect(b.packet_hash).toBe(packetHash(packet));
    expect(b.registry_digest).toBe(packet.verification.registry_digest);
    expect(b.deterministic_result).toBe('PASS');
    expect(b.verified_at).toBe(FIXED.toISOString());
    expect(b.scope.changed_paths).toEqual(['scripts/jev-flow/x.ts']);
    expect(b.items.map((i) => [i.id, i.registry_id, i.evidence_kind, i.exit_code, i.result])).toEqual([
      ['EV-1', 't.pass', 'test_run', 0, 'PASS'],
      ['EV-2', 't.fail', 'typecheck', 0, 'PASS'],
    ]);
    const log = Buffer.from('ran process.exit(0)');
    const logRef = storeLog(fx.layout, STORY, log);
    expect(b.items[0].log_sha256).toBe(logRef.sha256);
    expect(b.items[0].log_bytes).toBe(log.length);
    expect(b.items[0].argv_digest).toBe(canonicalHash(TEST_REGISTRY.entries[0].argv));
    expect(b.items[0].started_at).toBe(FIXED.toISOString());
    expect(b.items[0].finished_at).toBe(FIXED.toISOString());

    const r2 = await verify(fx, packet, runner);
    expect(r2.stored.bundle_hash).toBe(r1.stored.bundle_hash);
    expect(evidenceFiles(fx.layout)).toEqual([`${hashHex(r1.stored.bundle_hash)}.json`]);
    expect(loadBundle(fx.layout, STORY, r1.stored.bundle_hash)).toEqual(r1.stored);
    // nothing written into the repo
    expect(sh(fx.repo, 'status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  it('real run: node -e process.exit(0) -> OK', async () => {
    const fx = fixture();
    const r = await verify(fx, makePacket(fx, ['t.pass']));
    expect(r.status).toBe('OK');
    expect(r.stored.bundle.items[0]).toMatchObject({ registry_id: 't.pass', exit_code: 0, result: 'PASS', timed_out: false });
  });

  it('real run: exit 1 -> VERIFICATION_FAILED with stored bundle', async () => {
    const fx = fixture();
    const r = await verify(fx, makePacket(fx, ['t.pass', 't.fail']));
    expect(r.status).toBe('VERIFICATION_FAILED');
    expect(r.message).toMatch(/EV-2 t\.fail/);
    expect(r.stored.bundle.deterministic_result).toBe('FAIL');
    expect(r.stored.bundle.items.map((i) => [i.exit_code, i.result])).toEqual([[0, 'PASS'], [1, 'FAIL']]);
    expect(loadBundle(fx.layout, STORY, r.stored.bundle_hash).bundle.deterministic_result).toBe('FAIL');
  });

  it('timed-out command is FAIL', async () => {
    const fx = fixture();
    const runner: CommandRunner = async () => ({ exitCode: 0, output: Buffer.alloc(0), timedOut: true });
    const r = await verify(fx, makePacket(fx, ['t.pass']), runner);
    expect(r.status).toBe('VERIFICATION_FAILED');
    expect(r.stored.bundle.items[0]).toMatchObject({ timed_out: true, result: 'FAIL' });
  });

  it('real run: command that dirties the tree -> REFUSED, no bundle', async () => {
    const fx = fixture();
    const r = await verify(fx, makePacket(fx, ['t.dirty']));
    expect(r.status).toBe('REFUSED');
    expect(r.message).toMatch(/dirty/);
    expect(r.stored).toBeUndefined();
    expect(evidenceFiles(fx.layout)).toEqual([]);
  });

  it('command that moves HEAD -> REFUSED', async () => {
    const fx = fixture();
    const runner: CommandRunner = async (_argv, opts) => {
      sh(opts.cwd, 'commit', '-q', '--allow-empty', '-m', 'sneaky');
      return { exitCode: 0, output: Buffer.alloc(0), timedOut: false };
    };
    const r = await verify(fx, makePacket(fx, ['t.pass']), runner);
    expect(r.status).toBe('REFUSED');
    expect(r.message).toMatch(/HEAD moved/);
    expect(evidenceFiles(fx.layout)).toEqual([]);
  });
});
