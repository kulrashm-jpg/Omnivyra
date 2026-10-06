/**
 * gov intake — read-only probes (worktree state + live Claude sessions).
 *
 * Strictly READ-ONLY. The git half of the probe (status / rev-parse /
 * symbolic-ref / merge-base / diff only — never add, commit, stash, reset,
 * checkout or rebase) runs in cli.ts with the other gov git calls, so every
 * git invocation stays in one classified place; this module holds its types
 * and pure parsers. Live sessions are read from Claude Code's session
 * registry (`~/.claude/sessions/<pid>.json`); transcripts are never opened
 * here. A session record's `cwd` is NOT proof of worktree ownership (sessions
 * commonly record the main checkout while working in another worktree), so the
 * classifier treats it only as a claim.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SESSION_ID_RE } from './types';

export const CLAUDE_SESSIONS_DIR_ENV = 'CLAUDE_SESSIONS_DIR';

export interface WorktreeState {
  /** Absolute worktree path, forward slashes. */
  worktree: string;
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  head: string;
  /** True iff no staged, unstaged or untracked (non-ignored) changes. */
  clean: boolean;
  /** Paths with uncommitted or untracked changes (sorted, unique, forward slashes; both sides of a rename). */
  dirty_files: string[];
  /** Ref the merge-base was computed against (default origin/main). */
  base_ref: string;
  /** merge-base(HEAD, base_ref), or null when it cannot be computed. */
  merge_base: string | null;
  /** Paths changed in merge_base..HEAD (sorted, unique); empty when merge_base is null. */
  changed_since_base: string[];
}

export interface LiveSession {
  session_id: string;
  /** cwd the session process reports — a claim, never proof of ownership. */
  cwd: string | null;
  status: string | null;
  pid: number | null;
}

export interface IntakeProbe {
  worktreeState(worktree: string, baseRef: string): Promise<WorktreeState>;
}

const NUL = String.fromCharCode(0);
const posix = (p: string) => p.split(path.win32.sep).join(path.posix.sep);

function sortedUniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(posix).filter((p) => p !== ''))].sort();
}

/** `git status --porcelain=v1 -z` → every touched path (renames/copies contribute both paths). Pure. */
export function parsePorcelainZ(out: string): string[] {
  const tokens = out.split(NUL);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 4) continue;
    const xy = tok.slice(0, 2);
    paths.push(tok.slice(3));
    if (xy[0] === 'R' || xy[0] === 'C') {
      const orig = tokens[i + 1];
      if (typeof orig === 'string' && orig !== '') paths.push(orig);
      i++;
    }
  }
  return sortedUniquePaths(paths);
}

/** NUL-separated path list (`git diff --name-only -z`) → sorted unique forward-slash paths. Pure. */
export function parseNulList(out: string): string[] {
  return sortedUniquePaths(out.split(NUL));
}

/** Claude Code session registry: CLAUDE_SESSIONS_DIR or ~/.claude/sessions. */
export function claudeSessionsDir(env: Record<string, string | undefined>): string {
  const override = (env[CLAUDE_SESSIONS_DIR_ENV] ?? '').trim();
  return path.resolve(override || path.join(os.homedir(), '.claude', 'sessions'));
}

export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Live sessions from the registry: one `<pid>.json` per running Claude Code
 * process. Records whose process is gone, or that are unreadable, are skipped.
 */
export function readLiveSessions(env: Record<string, string | undefined>, isPidAlive: (pid: number) => boolean = defaultIsPidAlive): LiveSession[] {
  const dir = claudeSessionsDir(env);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return [];
  }
  const out: LiveSession[] = [];
  for (const name of names.sort()) {
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const sid = typeof rec.sessionId === 'string' ? rec.sessionId.toLowerCase() : '';
    if (!SESSION_ID_RE.test(sid)) continue;
    const pid = typeof rec.pid === 'number' ? rec.pid : null;
    if (pid !== null && !isPidAlive(pid)) continue;
    out.push({ session_id: sid, cwd: typeof rec.cwd === 'string' ? posix(rec.cwd) : null, status: typeof rec.status === 'string' ? rec.status : null, pid });
  }
  return out;
}
