/**
 * gov scope (Track 2): pattern matching, evaluateScope, and the real git probe
 * against throwaway repos under os.tmpdir(). No network.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGitProbe, evaluateScope, matchesPattern } from '../../../scripts/jev-flow/scope';

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function write(repo: string, rel: string, text: string): void {
  const f = path.join(repo, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}

function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-scope-'));
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'gov-test@example.invalid');
  sh(repo, 'config', 'user.name', 'gov test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  write(repo, '.gitignore', 'ignored/\n');
  write(repo, 'src/a.ts', 'a\n');
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'base');
  return repo;
}

const repos: string[] = [];
afterAll(() => {
  for (const r of repos) fs.rmSync(r, { recursive: true, force: true });
});

describe('matchesPattern', () => {
  const table: Array<[string, string, boolean]> = [
    ['scripts/jev-flow/verify.ts', 'scripts/jev-flow/**', true],
    ['scripts/jev-flow/sub/deep/x.ts', 'scripts/jev-flow/**', true],
    ['scripts/jev-flow', 'scripts/jev-flow/**', false],
    ['scripts/jev-flowX/a.ts', 'scripts/jev-flow/**', false],
    ['scripts/other/a.ts', 'scripts/jev-flow/**', false],
    ['backend/tests/unit/jevFlowScope.test.ts', 'backend/tests/unit/jevFlow*.test.ts', true],
    ['backend/tests/unit/sub/jevFlowScope.test.ts', 'backend/tests/unit/jevFlow*.test.ts', false],
    ['backend/tests/unit/other.test.ts', 'backend/tests/unit/jevFlow*.test.ts', false],
    ['scripts/a/x.ts', 'scripts/*/x.ts', true],
    ['scripts/a/b/x.ts', 'scripts/*/x.ts', false],
    ['scripts/*/x.ts', 'scripts/*/x.ts', true],
    ['package.json', 'package.json', true],
    ['package.jsonx', 'package.json', false],
    ['a/package.json', 'package.json', false],
    ['scripts/aXts', 'scripts/a.ts', false],
    ['scripts\\jev-flow\\verify.ts', 'scripts/jev-flow/**', true],
    ['scripts\\jev-flow\\verify.ts', 'scripts/jev-flow/verify.ts', true],
    ['src/a(1).ts', 'src/a(1).ts', true],
    ['', 'src/**', false],
    ['src/a.ts', '', false],
    ['src/a.ts', '/**', false],
  ];
  it.each(table)('%s ~ %s -> %s', (p, pat, want) => {
    expect(matchesPattern(p, pat)).toBe(want);
  });
});

describe('evaluateScope', () => {
  const scope = { authorized_paths: ['scripts/jev-flow/**', 'backend/tests/unit/jevFlow*.test.ts'], prohibited_paths: ['scripts/jev-flow/types.ts', '.claude/**'] };

  it('ok when every path is authorized; sorted + unique + normalized', () => {
    const r = evaluateScope(['scripts/jev-flow/verify.ts', 'backend/tests/unit/jevFlowScope.test.ts', 'scripts\\jev-flow\\verify.ts'], scope, 'b', 'h');
    expect(r).toEqual({
      ok: true,
      base_commit: 'b',
      head_commit: 'h',
      changed_paths: ['backend/tests/unit/jevFlowScope.test.ts', 'scripts/jev-flow/verify.ts'],
      outside_authorized: [],
      prohibited_touched: [],
    });
  });

  it('outside authorized -> not ok', () => {
    const r = evaluateScope(['scripts/jev-flow/a.ts', 'package.json'], scope, 'b', 'h');
    expect(r.ok).toBe(false);
    expect(r.outside_authorized).toEqual(['package.json']);
    expect(r.prohibited_touched).toEqual([]);
  });

  it('prohibited wins over authorized', () => {
    const r = evaluateScope(['scripts/jev-flow/types.ts'], scope, 'b', 'h');
    expect(r.ok).toBe(false);
    expect(r.outside_authorized).toEqual([]);
    expect(r.prohibited_touched).toEqual(['scripts/jev-flow/types.ts']);
  });

  it('prohibited and unauthorized both reported', () => {
    const r = evaluateScope(['.claude/settings.json'], scope, 'b', 'h');
    expect(r.outside_authorized).toEqual(['.claude/settings.json']);
    expect(r.prohibited_touched).toEqual(['.claude/settings.json']);
  });

  it('empty change set is ok', () => {
    expect(evaluateScope([], scope, 'b', 'h').ok).toBe(true);
  });
});

describe('createGitProbe (real git)', () => {
  const git = createGitProbe();
  let repo: string;
  let base: string;
  beforeEach(() => {
    repo = initRepo();
    repos.push(repo);
    base = sh(repo, 'rev-parse', 'HEAD');
  });

  it('headCommit / currentBranch / detached', async () => {
    expect(await git.headCommit(repo)).toBe(base);
    expect(await git.currentBranch(repo)).toBe('main');
    sh(repo, 'checkout', '-q', '--detach');
    expect(await git.currentBranch(repo)).toBeNull();
  });

  it('isClean: clean, unstaged, staged, untracked, ignored', async () => {
    expect(await git.isClean(repo)).toBe(true);
    write(repo, 'ignored/x.log', 'x');
    expect(await git.isClean(repo)).toBe(true);
    write(repo, 'src/a.ts', 'changed\n');
    expect(await git.isClean(repo)).toBe(false);
    sh(repo, 'add', 'src/a.ts');
    expect(await git.isClean(repo)).toBe(false);
    sh(repo, 'commit', '-q', '-m', 'c');
    expect(await git.isClean(repo)).toBe(true);
    write(repo, 'deep/new/untracked.txt', 'u');
    expect(await git.isClean(repo)).toBe(false);
  });

  it('isAncestor / changedPaths / commitsBetween / trailers', async () => {
    write(repo, 'src/b.ts', 'b\n');
    write(repo, 'docs/ü.md', 'u\n');
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'one', '-m', 'Governed-By: OMNI-7\nGov-Packet: sha256:abc');
    const c1 = sh(repo, 'rev-parse', 'HEAD');
    sh(repo, 'mv', 'src/a.ts', 'src/renamed.ts');
    sh(repo, 'commit', '-q', '-m', 'two');
    const c2 = sh(repo, 'rev-parse', 'HEAD');

    expect(await git.isAncestor(repo, base, c2)).toBe(true);
    expect(await git.isAncestor(repo, c2, c2)).toBe(true);
    expect(await git.isAncestor(repo, c2, base)).toBe(false);
    expect(await git.changedPaths(repo, base, c2)).toEqual(['docs/ü.md', 'src/a.ts', 'src/b.ts', 'src/renamed.ts']);
    expect(await git.commitsBetween(repo, base, c2)).toEqual([c1, c2]);
    expect(await git.commitsBetween(repo, c2, c2)).toEqual([]);
    expect(await git.commitTrailers(repo, c1)).toEqual({ 'Governed-By': ['OMNI-7'], 'Gov-Packet': ['sha256:abc'] });
    expect(await git.commitTrailers(repo, c2)).toEqual({});
  });

  it('rejects option-shaped revisions', async () => {
    await expect(git.changedPaths(repo, '--output=x', base)).rejects.toThrow(/invalid revision/);
    await expect(git.isAncestor(repo, '-x', base)).rejects.toThrow(/invalid revision/);
  });
});
