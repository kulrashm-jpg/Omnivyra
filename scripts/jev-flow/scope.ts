/**
 * gov scope evaluation + git probe.
 *
 * Scope is pure: changed paths are matched against the packet's authorized /
 * prohibited patterns (prohibited always wins). The git probe shells out to
 * `git` with execFile (argv array, NO shell) and is the single GitProbe
 * implementation other tracks receive by injection.
 */
import { execFile } from 'node:child_process';
import type { GitProbe, PacketScope, ScopeResult } from './types';

// ---------------------------------------------------------------- patterns

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PacketScope pattern rules (types.ts): repo-relative, forward slashes;
 * `dir/**` matches everything under dir/; `*` matches within one segment;
 * otherwise exact. Backslashes in either argument are normalized to `/`.
 */
export function matchesPattern(filePath: string, pattern: string): boolean {
  const p = normalizePath(filePath);
  let pat = normalizePath(pattern);
  if (p === '' || pat === '') return false;
  let tail = '';
  if (pat.endsWith('/**')) {
    pat = pat.slice(0, -3);
    tail = '/.+';
    if (pat === '') return false;
  }
  const body = pat
    .split('*')
    .map(escapeRe)
    .join('[^/]*');
  return new RegExp(`^${body}${tail}$`).test(p);
}

function sortedUnique(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter((p) => p !== ''))].sort();
}

/** Pure scope verdict: ok iff nothing is outside authorized and nothing prohibited is touched. */
export function evaluateScope(changed: string[], scope: PacketScope, base: string, head: string): ScopeResult {
  const changed_paths = sortedUnique(changed);
  const prohibited_touched = changed_paths.filter((p) => scope.prohibited_paths.some((pat) => matchesPattern(p, pat)));
  const outside_authorized = changed_paths.filter((p) => !scope.authorized_paths.some((pat) => matchesPattern(p, pat)));
  return {
    ok: outside_authorized.length === 0 && prohibited_touched.length === 0,
    base_commit: base,
    head_commit: head,
    changed_paths,
    outside_authorized,
    prohibited_touched,
  };
}

// ---------------------------------------------------------------- git probe

/** Revisions passed to git: no leading `-` (never an option), no whitespace. */
const REV_RE = /^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]*$/;

function rev(value: string): string {
  if (typeof value !== 'string' || !REV_RE.test(value)) throw new Error('git probe: invalid revision');
  return value;
}

interface GitOut {
  code: number;
  stdout: string;
  stderr: string;
}

function git(worktree: string, args: string[]): Promise<GitOut> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', worktree, '-c', 'core.quotepath=off', ...args],
      { shell: false, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code !== 'number') {
          reject(new Error(`git ${args[0]} failed to start: ${err.message}`));
          return;
        }
        resolve({ code: err ? ((err as unknown as { code: number }).code) : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function gitOk(worktree: string, args: string[]): Promise<string> {
  const r = await git(worktree, args);
  if (r.code !== 0) throw new Error(`git ${args[0]} exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`);
  return r.stdout;
}

function parseTrailers(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    (out[m[1]] = out[m[1]] || []).push(m[2].trim());
  }
  return out;
}

export function createGitProbe(): GitProbe {
  return {
    async headCommit(worktree) {
      return (await gitOk(worktree, ['rev-parse', '--verify', 'HEAD'])).trim();
    },
    async currentBranch(worktree) {
      const r = await git(worktree, ['symbolic-ref', '--short', '-q', 'HEAD']);
      if (r.code === 1) return null;
      if (r.code !== 0) throw new Error(`git symbolic-ref exited ${r.code}`);
      return r.stdout.trim() || null;
    },
    async isClean(worktree) {
      const out = await gitOk(worktree, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']);
      return out.trim() === '';
    },
    async isAncestor(worktree, ancestor, commit) {
      const r = await git(worktree, ['merge-base', '--is-ancestor', rev(ancestor), rev(commit)]);
      if (r.code === 0) return true;
      if (r.code === 1) return false;
      throw new Error(`git merge-base exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`);
    },
    async changedPaths(worktree, base, head) {
      const out = await gitOk(worktree, ['diff', '--name-only', '-z', '--no-renames', rev(base), rev(head), '--']);
      return sortedUnique(out.split('\0'));
    },
    async commitsBetween(worktree, base, head) {
      const out = await gitOk(worktree, ['rev-list', '--reverse', `${rev(base)}..${rev(head)}`, '--']);
      return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s !== '');
    },
    async commitTrailers(worktree, commit) {
      const out = await gitOk(worktree, ['log', '-1', '--format=%(trailers:only,unfold)', rev(commit), '--']);
      return parseTrailers(out);
    },
  };
}
