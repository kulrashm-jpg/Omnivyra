/**
 * Governed Claude workflow ("gov") — Claude Code session discovery (Track 3).
 *
 * Strictly READ-ONLY with respect to Claude transcripts: files are located by
 * readdir/stat and opened read-only to fingerprint them. Nothing here writes,
 * renames, touches or locks a transcript, and nothing launches `claude` — the
 * command builders only return argv / text for a human to run.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SESSION_ID_RE, STORY_KEY_RE, type SessionFileFingerprint, type Sha256Ref } from './types';

export const CLAUDE_PROJECTS_DIR_ENV = 'CLAUDE_PROJECTS_DIR';
/** Max transcript lines scanned for cwd / gitBranch. */
export const FINGERPRINT_SCAN_LINES = 200;

/** Claude Code projects directory: CLAUDE_PROJECTS_DIR or ~/.claude/projects. */
export function claudeProjectsDir(env: Record<string, string | undefined>): string {
  const override = (env[CLAUDE_PROJECTS_DIR_ENV] ?? '').trim();
  return path.resolve(override || path.join(os.homedir(), '.claude', 'projects'));
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) throw new Error('invalid session id (expected lowercase UUID)');
}

/**
 * Locates `<projectsDir>/<slug>/<sessionId>.jsonl` (top-level only; subagent
 * transcripts are ignored). Returns null when absent; throws when ambiguous.
 */
export function findSessionFile(sessionId: string, env: Record<string, string | undefined>): string | null {
  assertSessionId(sessionId);
  const root = claudeProjectsDir(env);
  let slugs: fs.Dirent[];
  try {
    slugs = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const hits: string[] = [];
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    const candidate = path.join(root, slug.name, `${sessionId}.jsonl`);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (stat.isFile()) hits.push(candidate);
  }
  if (hits.length > 1) throw new Error(`session ${sessionId} is ambiguous: found in ${hits.length} project directories`);
  return hits.length === 1 ? hits[0] : null;
}

/** Read-only fingerprint of a transcript: exact-byte sha256, size, recorded cwd / gitBranch. */
export function fingerprintSession(file: string): SessionFileFingerprint {
  const abs = path.resolve(file);
  const fd = fs.openSync(abs, 'r');
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const sha256 = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` as Sha256Ref;
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  const lines = bytes.toString('utf8').split(/\r?\n/, FINGERPRINT_SCAN_LINES);
  for (const line of lines) {
    if (cwd !== null && gitBranch !== null) break;
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const rec = parsed as Record<string, unknown>;
    if (cwd === null && typeof rec.cwd === 'string' && rec.cwd) cwd = rec.cwd;
    if (gitBranch === null && typeof rec.gitBranch === 'string' && rec.gitBranch) gitBranch = rec.gitBranch;
  }
  return { path: abs, sha256, bytes: bytes.length, cwd, git_branch: gitBranch };
}

/** Fresh session id for `claude --session-id`. */
export function newSessionId(): string {
  const id = crypto.randomUUID().toLowerCase();
  assertSessionId(id);
  return id;
}

/** Double-quotes a display argument containing whitespace/shell metacharacters (backslashes kept for Windows paths). */
function shellQuote(arg: string): string {
  return /[\s"'`$&|<>;()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

export interface StartCommandInput {
  sessionId: string;
  worktree: string;
  packetMarkdownPath: string;
  storyKey: string;
}

export interface StartCommand {
  cwd: string;
  argv: string[];
  display: string;
}

/**
 * Command that starts a NEW governed session with a fixed id; the packet enters
 * as the first user turn (`@packet`), never via --append-system-prompt.
 */
export function buildStartCommand(input: StartCommandInput): StartCommand {
  assertSessionId(input.sessionId);
  if (!STORY_KEY_RE.test(input.storyKey)) throw new Error('invalid story key');
  const packet = input.packetMarkdownPath;
  const cwd = input.worktree;
  const prompt = `@${packet} Implement ${input.storyKey} within the authorized paths in this governed packet.`;
  const argv = ['claude', '--session-id', input.sessionId, '--add-dir', path.dirname(packet), prompt];
  const display = `cd ${shellQuote(cwd)} && ${argv.map(shellQuote).join(' ')}`;
  return { cwd, argv, display };
}

export interface ResumeInstructionsInput {
  sessionId: string;
  sessionCwd: string;
  packetMarkdownPath: string;
  fork: boolean;
}

/**
 * Human steps to resume (or fork) an existing session and hand it the packet.
 * `cd` to the transcript's recorded cwd first: resuming from another cwd is not
 * guaranteed to find the session. No step modifies the transcript.
 */
export function buildResumeInstructions(input: ResumeInstructionsInput): { steps: string[] } {
  assertSessionId(input.sessionId);
  if (!input.sessionCwd) throw new Error('session cwd is required (recorded cwd of the transcript)');
  const packet = input.packetMarkdownPath;
  const steps = [
    `cd "${input.sessionCwd}"`,
    `claude --resume ${input.sessionId}${input.fork ? ' --fork-session' : ''}`,
    `In the resumed conversation, type: @${packet}`,
    'Note: --append-system-prompt is not used because Claude Code ignores it on resume; the packet enters as a normal user turn.',
  ];
  return { steps };
}
