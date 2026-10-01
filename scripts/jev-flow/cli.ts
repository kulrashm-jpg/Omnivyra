/**
 * `gov` — the governed Claude workflow command line (Track 5).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/jev-flow/cli.ts <verb> [flags]
 *
 *   start        --story OMNI-n --slug <slug> --repo <git repo> [--base <ref>] [--worktree-root <dir>]
 *   attach       --story OMNI-n --session <uuid> [--worktree <path>] [--base <ref>] [--fork]
 *                (--worktree defaults to the current directory; without --base and
 *                without an earlier binding, a clean HEAD carrying exactly
 *                `Governed-By: <STORY>` and no Gov-Packet is adopted as the
 *                PRE_GOVERNANCE_ADOPTION_BASELINE)
 *   packet       --story OMNI-n --worktree <path> [--regenerate]
 *   verify       --story OMNI-n --worktree <path>
 *   judge        --story OMNI-n --worktree <path> --evidence <sha256:...> --invoked-by <human|claude-code>:<id> [--write-back] [--model <id>]
 *   submit       --story OMNI-n --evidence <sha256:...> [--worktree <path>]
 *   check-merge  --story OMNI-n --worktree <path> --evidence <sha256:...>
 *
 * Explicit and user-invoked only: no background work, no automatic JEV, never
 * launches `claude`, never merges / releases / deploys, never moves a Jira
 * workflow, never writes a protected Jira field. Jira reads use the Phase 2
 * reader identity (JEV_JIRA_IDENTITY=reader + JEV_READER_TOKEN) and its live
 * permission preflight; only `judge --write-back` uses the advisory identity
 * and the Phase 2 four-field write-back. Token values are never printed.
 *
 * Exit codes: 0 OK · 10 NOT_READY · 11 REFUSED · 12 STALE · 13 INTEGRITY_FAILED ·
 * 14 VERIFICATION_FAILED · 15 SCOPE_VIOLATION · 16 JUDGMENT_UNAVAILABLE ·
 * 64 usage · 70 ERROR. The last stdout line is `GOV_RESULT <canonical JSON>`.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FileAuditSink, defaultAuditDir, type AuditSink } from '../jev-bjc/audit';
import { canonicalJson } from '../jev-bjc/canonical';
import { createTypeSafeTransport, resolveApiKey, type JevTransport } from '../jev-bjc/provider';
import { resolveModel } from '../jev-jira/cli';
import { identityViolations, preflightPermissionKeys, resolveRuntimeIdentity, type RuntimeIdentity } from '../jev-jira/identity';
import { JiraClientError, createJiraClient, type JiraClient, type JiraCredentials, type JiraPermissionProbe } from '../jev-jira/jiraClient';
import { findByStory, bindSession } from './binding';
import { loadBundle } from './evidence';
import { createJiraQuery, type JiraQuery } from './jiraQuery';
import { runJudgeFlow } from './judgeFlow';
import { buildPacket, detectStale, loadPacket, storePacket } from './packet';
import { checkReadiness } from './readiness';
import { loadRegistry } from './registry';
import { createGitProbe } from './scope';
import { buildResumeInstructions, buildStartCommand, findSessionFile, fingerprintSession, newSessionId } from './session';
import { defaultRunner, normalizeWorktree, runVerification, type CommandRunner } from './verify';
import {
  ADOPTION_CLASSIFICATION,
  COMMIT_RE,
  SESSION_ID_RE,
  SHA256_REF_RE,
  STORY_KEY_RE,
  TRAILER_GOVERNED_BY,
  TRAILER_GOV_PACKET,
  govLayout,
  type AdoptionBaseline,
  type GitProbe,
  type GovLayout,
  type GovStatus,
  type ReadinessResult,
  type SessionBinding,
  type Sha256Ref,
  type StoredEvidenceBundle,
  type StoredPacket,
  type VerificationRegistry,
} from './types';

export interface GovIo {
  out(text: string): void;
  err(text: string): void;
}

export interface GovDeps {
  /** Read-only Story/AC query for the resolved reader credentials. */
  jiraQuery: (credentials: JiraCredentials) => JiraQuery;
  /** Phase 2 Jira client (permission preflight; judge reads and the four-field write-back). */
  jiraClient: (credentials: JiraCredentials) => JiraClient & JiraPermissionProbe;
  /** JEV transport, or null when no key is configured. */
  transport: (env: Record<string, string | undefined>) => JevTransport | null;
  git: GitProbe;
  runner: CommandRunner;
  registry: VerificationRegistry;
  now: () => Date;
  newSessionId: () => string;
  /** Creates a new worktree on a new branch at baseCommit (default: `git worktree add -b`, no shell). */
  createWorktree: (repoDir: string, worktreePath: string, branch: string, baseCommit: string) => Promise<void>;
  /** BJC audit sink (default: FileAuditSink(defaultAuditDir(env))). */
  bjcAudit: (env: Record<string, string | undefined>) => AuditSink;
  /** Full commit for a ref in `dir`, or null when it does not resolve. */
  resolveCommit: (dir: string, ref: string) => Promise<string | null>;
  /** True iff refs/heads/<branch> exists in `dir`. */
  branchExists: (dir: string, branch: string) => Promise<boolean>;
}

export const GOV_EXIT: Readonly<Record<GovStatus, number>> = {
  OK: 0,
  NOT_READY: 10,
  REFUSED: 11,
  STALE: 12,
  INTEGRITY_FAILED: 13,
  VERIFICATION_FAILED: 14,
  SCOPE_VIOLATION: 15,
  JUDGMENT_UNAVAILABLE: 16,
  ERROR: 70,
};
export const GOV_EXIT_USAGE = 64;
export const DEFAULT_BASE_REF = 'origin/main';
export const DEFAULT_WORKTREE_ROOT = 'C:/tmp';
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
/** Refs passed to git: never an option, no whitespace, no braces (`^{commit}` is appended by gov). */
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/~^@-]*$/;

const USAGE = [
  'usage: cli.ts <verb> [flags]',
  '  start       --story OMNI-<n> --slug <slug> --repo <git repo> [--base <ref>] [--worktree-root <dir>]',
  '  attach      --story OMNI-<n> --session <uuid> [--worktree <path>] [--base <ref>] [--fork]',
  '  packet      --story OMNI-<n> --worktree <path> [--regenerate]',
  '  verify      --story OMNI-<n> --worktree <path>',
  '  judge       --story OMNI-<n> --worktree <path> --evidence <sha256:...> --invoked-by <human|claude-code>:<id> [--write-back] [--model <id>]',
  '  submit      --story OMNI-<n> --evidence <sha256:...> [--worktree <path>]',
  '  check-merge --story OMNI-<n> --worktree <path> --evidence <sha256:...>',
].join('\n');

// ---------------------------------------------------------------- default deps

function runGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : -1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export function defaultGovDeps(): Omit<GovDeps, 'registry'> {
  return {
    jiraQuery: (credentials) => createJiraQuery({ credentials }),
    jiraClient: (credentials) => createJiraClient({ credentials }),
    transport: (env) => {
      const apiKey = resolveApiKey(env);
      return apiKey ? createTypeSafeTransport({ apiKey }) : null;
    },
    git: createGitProbe(),
    runner: defaultRunner,
    now: () => new Date(),
    newSessionId,
    createWorktree: async (repoDir, worktreePath, branch, baseCommit) => {
      if (!COMMIT_RE.test(baseCommit)) throw new Error('base must be a full commit id');
      const r = await runGit(['-C', repoDir, 'worktree', 'add', '-b', branch, worktreePath, baseCommit]);
      if (r.code !== 0) throw new Error(`git worktree add exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`);
    },
    bjcAudit: (env) => new FileAuditSink(defaultAuditDir(env)),
    resolveCommit: async (dir, ref) => {
      if (!REF_RE.test(ref)) return null;
      const r = await runGit(['-C', dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      const commit = r.stdout.trim();
      return r.code === 0 && COMMIT_RE.test(commit) ? commit : null;
    },
    branchExists: async (dir, branch) => {
      const r = await runGit(['-C', dir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      return r.code === 0;
    },
  };
}

// ---------------------------------------------------------------- helpers

/** Flag value; null when the flag is absent or has no value. */
function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  return typeof v === 'string' && v !== '' && !v.startsWith('--') ? v : null;
}

const has = (argv: string[], name: string) => argv.includes(name);
const posix = (p: string) => p.replace(/\\/g, '/');
const winPath = (p: string) => path.resolve(p).replace(/\//g, '\\');
const quoteIfNeeded = (p: string) => (/\s/.test(p) ? `"${p}"` : p);

class Outcome {
  constructor(
    readonly status: GovStatus,
    readonly message: string,
  ) {}
}

interface Run {
  io: GovIo;
  env: Record<string, string | undefined>;
  deps: GovDeps;
  result: Record<string, unknown>;
}

function finish(run: Run, status: GovStatus, message?: string): number {
  if (message && status === 'OK') run.io.out(`${status}: ${message}`);
  else if (message) run.io.err(`${status}: ${message}`);
  run.io.out(`GOV_RESULT ${canonicalJson({ ...run.result, status })}`);
  return GOV_EXIT[status];
}

function layoutOf(run: Run): GovLayout {
  try {
    return govLayout(run.env);
  } catch (err) {
    throw new Outcome('REFUSED', (err as Error).message);
  }
}

/** Phase 2 identity resolution + live permission preflight; never echoes a token. */
async function preflightIdentity(run: Run, writeBack: boolean): Promise<{ identity: RuntimeIdentity; credentials: JiraCredentials; client: JiraClient & JiraPermissionProbe }> {
  const resolved = resolveRuntimeIdentity(run.env, writeBack);
  if (resolved.ok === false) throw new Outcome('REFUSED', `Jira identity refused: ${resolved.message}`);
  const client = run.deps.jiraClient(resolved.credentials);
  let violations: string[];
  try {
    violations = identityViolations(resolved.identity, await client.getMyPermissions(preflightPermissionKeys(resolved.identity)));
  } catch (err) {
    violations = [err instanceof JiraClientError ? `${err.code}: ${err.message}` : 'permission probe failed'];
  }
  if (violations.length > 0) throw new Outcome('REFUSED', `Jira identity preflight failed for ${resolved.identity}: ${violations.join('; ')}`);
  return { identity: resolved.identity, credentials: resolved.credentials, client };
}

/** Readiness through the reader identity. */
async function readReadiness(run: Run, storyKey: string): Promise<ReadinessResult> {
  const { credentials } = await preflightIdentity(run, false);
  return checkReadiness(storyKey, { query: run.deps.jiraQuery(credentials), registry: run.deps.registry });
}

function printFindings(run: Run, readiness: ReadinessResult): void {
  run.io.err(`Story ${readiness.story_key} is NOT READY (${readiness.findings.length} finding(s)):`);
  for (const f of readiness.findings) run.io.err(`  [${f.code}] ${f.issue}${f.field ? ` ${f.field}` : ''}: ${f.message}`);
}

function requireReady(run: Run, readiness: ReadinessResult): void {
  if (readiness.ready !== true) {
    printFindings(run, readiness);
    run.result.findings = readiness.findings.map((f) => f.code);
    throw new Outcome('NOT_READY', 'nothing was created');
  }
}

/** Latest binding of the Story for this worktree, or null. */
function latestBinding(layout: GovLayout, storyKey: string, worktree: string): SessionBinding | null {
  const want = normalizeWorktree(worktree);
  const all = findByStory(layout, storyKey).filter((b) => normalizeWorktree(b.worktree) === want);
  return all.length > 0 ? all[all.length - 1] : null;
}

function requireBinding(layout: GovLayout, storyKey: string, worktree: string): SessionBinding {
  const b = latestBinding(layout, storyKey, worktree);
  if (!b) throw new Outcome('REFUSED', `no gov binding for ${storyKey} in ${posix(worktree)}; run gov start or gov attach first`);
  return b;
}

function loadPacketOrFail(layout: GovLayout, storyKey: string, hash: Sha256Ref): StoredPacket {
  try {
    return loadPacket(layout, storyKey, hash);
  } catch (err) {
    throw new Outcome('INTEGRITY_FAILED', (err as Error).message);
  }
}

/** loadBundle; a missing bundle is `missingStatus`, any integrity error is INTEGRITY_FAILED. */
function loadBundleOrFail(layout: GovLayout, storyKey: string, hash: string, missingStatus: GovStatus): StoredEvidenceBundle {
  if (!SHA256_REF_RE.test(hash)) throw new Outcome('INTEGRITY_FAILED', '--evidence must be sha256:<64 lowercase hex>');
  try {
    return loadBundle(layout, storyKey, hash as Sha256Ref);
  } catch (err) {
    const msg = (err as Error).message;
    throw new Outcome(msg.startsWith('INTEGRITY_FAILED') ? 'INTEGRITY_FAILED' : missingStatus, msg);
  }
}

async function resolveBase(run: Run, dir: string, ref: string): Promise<string> {
  let commit: string | null = null;
  try {
    commit = REF_RE.test(ref) ? await run.deps.resolveCommit(dir, ref) : null;
  } catch {
    commit = null;
  }
  if (commit === null || !COMMIT_RE.test(commit)) throw new Outcome('REFUSED', `base ref "${ref}" does not resolve to a commit in ${posix(dir)}`);
  return commit;
}

function storyArg(argv: string[]): string | null {
  const s = flag(argv, '--story');
  return s !== null && STORY_KEY_RE.test(s) ? s : null;
}

/** One or more `Governed-By` values, every one exactly the Story. */
function governedByExactly(t: Record<string, string[]>, story: string): boolean {
  const v = t[TRAILER_GOVERNED_BY] ?? [];
  return v.length > 0 && v.every((x) => x === story);
}

/**
 * Null when `commit` is a valid adoption baseline for `story` (carries
 * exactly `Governed-By: <story>` and no `Gov-Packet` trailer); otherwise the
 * reason. A git error is a reason (fail closed).
 */
async function adoptionBaselineProblem(git: GitProbe, worktree: string, story: string, commit: string): Promise<string | null> {
  let t: Record<string, string[]>;
  try {
    t = await git.commitTrailers(worktree, commit);
  } catch (err) {
    return `cannot read the trailers of ${commit}: ${(err as Error).message}`;
  }
  const governedBy = t[TRAILER_GOVERNED_BY] ?? [];
  if (governedBy.length === 0) return `commit ${commit} carries no "${TRAILER_GOVERNED_BY}" trailer, so it is not an adoption baseline for ${story}`;
  if (!governedByExactly(t, story)) return `commit ${commit} carries "${TRAILER_GOVERNED_BY}: ${governedBy.join(', ')}", not exactly "${TRAILER_GOVERNED_BY}: ${story}"`;
  if ((t[TRAILER_GOV_PACKET] ?? []).length > 0) return `commit ${commit} carries a "${TRAILER_GOV_PACKET}" trailer; an adoption baseline must not (its packet does not exist yet)`;
  return null;
}

// ---------------------------------------------------------------- verbs

async function cmdStart(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  const slug = flag(argv, '--slug');
  const repoArg = flag(argv, '--repo');
  if (!story || !slug || !SLUG_RE.test(slug) || !repoArg) return usage(run, 'start needs --story OMNI-<n>, --slug matching ^[a-z0-9][a-z0-9-]{1,40}$ and --repo');
  const n = story.slice('OMNI-'.length);
  const repo = path.resolve(repoArg);
  const root = path.resolve(flag(argv, '--worktree-root') ?? DEFAULT_WORKTREE_ROOT);
  const branch = `omni-${n}/${slug}`;
  const worktree = path.join(root, `omni-${n}-${slug}`);
  const baseRef = flag(argv, '--base') ?? DEFAULT_BASE_REF;
  run.result.story = story;
  const layout = layoutOf(run);

  const readiness = await readReadiness(run, story);
  requireReady(run, readiness);

  const baseCommit = await resolveBase(run, repo, baseRef);
  run.io.out(`Base: ${baseRef} resolved to ${baseCommit}`);
  if (fs.existsSync(worktree)) throw new Outcome('REFUSED', `worktree path already exists: ${posix(worktree)}`);
  if (await run.deps.branchExists(repo, branch)) throw new Outcome('REFUSED', `branch already exists: ${branch}`);

  // Pure: fails before anything is created.
  const packet = buildPacket(readiness, { commit: baseCommit, branch, worktree: posix(worktree) });
  await run.deps.createWorktree(repo, worktree, branch, baseCommit);
  const stored = storePacket(layout, packet);
  const md = layout.packetFile(story, stored.packet_hash, 'md');
  const sessionId = run.deps.newSessionId();
  const bound = bindSession(
    layout,
    { story_key: story, packet_hash: stored.packet_hash, session_id: sessionId, mode: 'new', worktree: posix(worktree), branch, base_commit: baseCommit, session_file: null },
    run.deps.now,
  );
  Object.assign(run.result, { base_commit: baseCommit, branch, worktree: posix(worktree), packet_hash: stored.packet_hash, packet_md: md, session_id: sessionId });
  if (bound.status === 'REFUSED') throw new Outcome('REFUSED', bound.message);

  const cmd = buildStartCommand({ sessionId, worktree: winPathIfWindows(worktree), packetMarkdownPath: md, storyKey: story });
  run.io.out(`Base commit: ${baseCommit}`);
  run.io.out(`Branch: ${branch}`);
  run.io.out(`Worktree: ${posix(worktree)}`);
  run.io.out(`Packet hash: ${stored.packet_hash}`);
  run.io.out(`Packet: ${md}`);
  run.io.out(`Session: ${sessionId} (${bound.message})`);
  run.io.out('Note: the new worktree has no node_modules; registry commands need it. To link it (gov does not run this):');
  run.io.out(`  cmd /c mklink /J ${quoteIfNeeded(`${winPath(worktree)}\\node_modules`)} ${quoteIfNeeded(`${winPath(repo)}\\node_modules`)}`);
  run.io.out('Start the governed session yourself (gov never launches claude):');
  run.io.out(`  ${cmd.display}`);
  return finish(run, 'OK');
}

function winPathIfWindows(p: string): string {
  return process.platform === 'win32' ? winPath(p) : path.resolve(p);
}

async function cmdAttach(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  const sessionId = flag(argv, '--session');
  const wtArg = flag(argv, '--worktree');
  if (!story || !sessionId || !SESSION_ID_RE.test(sessionId)) return usage(run, 'attach needs --story OMNI-<n> and --session <lowercase uuid> (--worktree defaults to the current directory)');
  if (has(argv, '--worktree') && wtArg === null) return usage(run, '--worktree needs a path');
  const worktree = path.resolve(wtArg ?? process.cwd());
  const baseRef = flag(argv, '--base');
  if (has(argv, '--base') && baseRef === null) return usage(run, '--base needs a ref');
  run.result.story = story;
  run.result.session_id = sessionId;
  const layout = layoutOf(run);

  const readiness = await readReadiness(run, story);
  requireReady(run, readiness);

  let file: string | null;
  try {
    file = findSessionFile(sessionId, run.env);
  } catch (err) {
    throw new Outcome('REFUSED', (err as Error).message);
  }
  if (file === null) throw new Outcome('REFUSED', `no Claude transcript found for session ${sessionId}`);
  const fingerprint = fingerprintSession(file);

  const git = run.deps.git;
  let branch: string | null;
  let clean: boolean;
  let head: string;
  try {
    branch = await git.currentBranch(worktree);
    clean = await git.isClean(worktree);
    head = await git.headCommit(worktree);
  } catch (err) {
    throw new Outcome('REFUSED', `${posix(worktree)} is not a usable git worktree: ${(err as Error).message}`);
  }
  if (branch === null) throw new Outcome('REFUSED', 'worktree HEAD is detached; the governed worktree must be on a named branch');
  if (clean !== true) throw new Outcome('REFUSED', 'worktree is dirty (staged, unstaged or untracked changes); attach needs a clean tree');

  let baseCommit: string;
  let adoption: AdoptionBaseline | null = null;
  if (baseRef !== null) {
    baseCommit = await resolveBase(run, worktree, baseRef);
  } else {
    const prior = latestBinding(layout, story, worktree);
    if (prior) {
      baseCommit = prior.base_commit;
      adoption = prior.adoption ?? null;
    } else {
      // Existing-work adoption: the clean HEAD must be the human's adoption-baseline commit.
      const why = await adoptionBaselineProblem(git, worktree, story, head);
      if (why !== null) {
        throw new Outcome(
          'REFUSED',
          `base is never inferred: ${why}. Pass --base <ref>, or adopt the existing work: commit it yourself as an adoption-baseline commit ` +
            `carrying the trailer "${TRAILER_GOVERNED_BY}: ${story}" and NO "${TRAILER_GOV_PACKET}" trailer, keep the tree clean, then re-run gov attach ` +
            `(that commit and everything before it are recorded as ${ADOPTION_CLASSIFICATION}, never as governed)`,
        );
      }
      baseCommit = head;
      adoption = { baseline_commit: head, classification: ADOPTION_CLASSIFICATION };
    }
  }
  let descends: boolean;
  try {
    descends = await git.isAncestor(worktree, baseCommit, head);
  } catch (err) {
    throw new Outcome('REFUSED', `ancestry check failed: ${(err as Error).message}`);
  }
  if (descends !== true) throw new Outcome('REFUSED', `HEAD ${head} does not descend from base ${baseCommit}`);
  run.io.out(`Base commit: ${baseCommit}`);

  const stored = storePacket(layout, buildPacket(readiness, { commit: baseCommit, branch, worktree: posix(worktree) }));
  const md = layout.packetFile(story, stored.packet_hash, 'md');
  const bound = bindSession(
    layout,
    { story_key: story, packet_hash: stored.packet_hash, session_id: sessionId, mode: 'attach', worktree: posix(worktree), branch, base_commit: baseCommit, session_file: fingerprint, adoption },
    run.deps.now,
  );
  Object.assign(run.result, { base_commit: baseCommit, branch, worktree: posix(worktree), packet_hash: stored.packet_hash, packet_md: md, transcript_sha256: fingerprint.sha256 });
  if (adoption !== null) run.result.adoption_baseline = adoption.baseline_commit;
  if (bound.status === 'REFUSED') throw new Outcome('REFUSED', bound.message);
  run.result.binding = bound.status;

  run.io.out(`Branch: ${branch}`);
  run.io.out(`Worktree: ${posix(worktree)}`);
  run.io.out(`Packet hash: ${stored.packet_hash}`);
  run.io.out(`Packet: ${md}`);
  run.io.out(`Binding: ${bound.status} (${bound.message})`);
  run.io.out(`Transcript (read-only): ${fingerprint.path} ${fingerprint.sha256}`);
  if (adoption !== null) {
    run.io.out(`Adoption baseline: ${adoption.baseline_commit} (${ADOPTION_CLASSIFICATION})`);
    run.io.out('The baseline and everything before it are pre-governance. Every subsequent commit must carry both trailers:');
    run.io.out(`  ${TRAILER_GOVERNED_BY}: ${story}`);
    run.io.out(`  ${TRAILER_GOV_PACKET}: ${stored.packet_hash}`);
  }
  if (fingerprint.cwd === null) {
    run.io.out("The transcript records no cwd: cd to the conversation's original directory, then run:");
    run.io.out(`  claude --resume ${sessionId}${has(argv, '--fork') ? ' --fork-session' : ''}`);
    run.io.out(`  In the resumed conversation, type: @${md}`);
  } else {
    run.io.out('Resume it yourself (gov never launches claude):');
    for (const step of buildResumeInstructions({ sessionId, sessionCwd: fingerprint.cwd, packetMarkdownPath: md, fork: has(argv, '--fork') }).steps) {
      run.io.out(`  ${step}`);
    }
  }
  return finish(run, 'OK');
}

async function cmdPacket(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  const wtArg = flag(argv, '--worktree');
  if (!story || !wtArg) return usage(run, 'packet needs --story OMNI-<n> and --worktree');
  const worktree = path.resolve(wtArg);
  run.result.story = story;
  const layout = layoutOf(run);
  const binding = requireBinding(layout, story, worktree);
  const stored = loadPacketOrFail(layout, story, binding.packet_hash);
  const fresh = await readReadiness(run, story);
  const reasons = detectStale(stored.packet, fresh);
  run.result.packet_hash = stored.packet_hash;

  if (reasons.length === 0) {
    const md = layout.packetFile(story, stored.packet_hash, 'md');
    run.result.packet_md = md;
    run.io.out(`Packet hash: ${stored.packet_hash} (fresh)`);
    run.io.out(`Packet: ${md}`);
    return finish(run, 'OK');
  }
  run.result.stale = reasons;
  if (!has(argv, '--regenerate')) {
    run.io.err(`Packet ${stored.packet_hash} is STALE:`);
    for (const r of reasons) run.io.err(`  - ${r}`);
    run.io.err('Run gov packet --regenerate to store a fresh packet for the same base.');
    return finish(run, 'STALE');
  }
  requireReady(run, fresh);
  const regenerated = storePacket(layout, buildPacket(fresh, stored.packet.base));
  const md = layout.packetFile(story, regenerated.packet_hash, 'md');
  const bound = bindSession(
    layout,
    {
      story_key: story,
      packet_hash: regenerated.packet_hash,
      session_id: binding.session_id,
      mode: binding.mode,
      worktree: binding.worktree,
      branch: binding.branch,
      base_commit: binding.base_commit,
      session_file: binding.session_file,
      adoption: binding.adoption ?? null,
    },
    run.deps.now,
  );
  if (bound.status === 'REFUSED') throw new Outcome('REFUSED', bound.message);
  Object.assign(run.result, { previous_packet_hash: stored.packet_hash, packet_hash: regenerated.packet_hash, packet_md: md, session_id: binding.session_id });
  run.io.out(`Regenerated packet (was ${stored.packet_hash}; ${reasons.length} change(s)).`);
  run.io.out(`Packet hash: ${regenerated.packet_hash}`);
  run.io.out(`Packet: ${md}`);
  run.io.out(`Session ${binding.session_id}: ${bound.message}`);
  run.io.out(`Hand the new packet to the session: @${md}`);
  return finish(run, 'OK');
}

async function cmdVerify(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  const wtArg = flag(argv, '--worktree');
  if (!story || !wtArg) return usage(run, 'verify needs --story OMNI-<n> and --worktree');
  const worktree = path.resolve(wtArg);
  run.result.story = story;
  const layout = layoutOf(run);
  const binding = requireBinding(layout, story, worktree);
  const stored = loadPacketOrFail(layout, story, binding.packet_hash);
  run.result.packet_hash = stored.packet_hash;
  const r = await runVerification({
    packet: stored.packet,
    packetHash: stored.packet_hash,
    worktree,
    registry: run.deps.registry,
    git: run.deps.git,
    layout,
    runner: run.deps.runner,
    now: run.deps.now,
  });
  run.io.out(`Verification: ${r.status} — ${r.message}`);
  if (r.scope) {
    const s = r.scope;
    run.io.out(`Scope: ${s.ok ? 'ok' : 'VIOLATION'} (${s.changed_paths.length} changed, ${s.outside_authorized.length} outside authorized, ${s.prohibited_touched.length} prohibited)`);
    for (const p of s.prohibited_touched) run.io.out(`  prohibited: ${p}`);
    for (const p of s.outside_authorized) run.io.out(`  outside authorized: ${p}`);
  }
  if (r.stored) {
    const b = r.stored.bundle;
    for (const it of b.items) run.io.out(`  ${it.id} ${it.registry_id} exit=${it.exit_code} ${it.result}${it.timed_out ? ' (timed out)' : ''} log=${it.log_sha256}`);
    run.io.out(`Deterministic result: ${b.deterministic_result}`);
    run.io.out(`Evidence bundle: ${r.stored.bundle_hash}`);
    Object.assign(run.result, { bundle_hash: r.stored.bundle_hash, head_commit: b.head_commit, deterministic_result: b.deterministic_result });
  }
  return finish(run, r.status);
}

async function cmdJudge(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  const wtArg = flag(argv, '--worktree');
  const evidence = flag(argv, '--evidence');
  const invokedBy = flag(argv, '--invoked-by');
  const model = resolveModel(argv);
  if (!story || !wtArg || !evidence || !invokedBy || !model) {
    return usage(run, 'judge needs --story OMNI-<n>, --worktree, --evidence sha256:<hex> and --invoked-by <human|claude-code>:<id>');
  }
  const worktree = path.resolve(wtArg);
  const writeBack = has(argv, '--write-back');
  run.result.story = story;
  run.result.write_back = writeBack;
  const layout = layoutOf(run);
  const binding = requireBinding(layout, story, worktree);
  const stored = loadPacketOrFail(layout, story, binding.packet_hash);
  const bundle = loadBundleOrFail(layout, story, evidence, 'REFUSED');
  Object.assign(run.result, { packet_hash: stored.packet_hash, bundle_hash: bundle.bundle_hash });

  const { identity, client } = await preflightIdentity(run, writeBack);
  run.io.out(`Jira identity: ${identity} (preflight ok)`);
  const res = await runJudgeFlow({
    stored,
    evidence: bundle,
    worktree,
    git: run.deps.git,
    jira: client,
    transport: run.deps.transport(run.env),
    bjcAudit: run.deps.bjcAudit(run.env),
    writeBack,
    invokedBy,
    model,
    now: run.deps.now,
  });
  for (const j of res.per_ac) {
    run.io.out(
      `  ${j.ac_key} ${j.ac_id}: deterministic ${j.deterministic_result} · JEV ${j.jev_answer ?? 'none'} · combined ${j.combined_verdict ?? 'none'} · Jira JEV verdict ${j.jira_jev_verdict ?? 'none'}` +
        ` · conflict ${j.conflict ? 'yes' : 'no'} · review ${j.review_required ? 'yes' : 'no'} · write-back ${j.writeback_status}`,
    );
  }
  run.result.model = res.model;
  run.result.per_ac = res.per_ac.map((j) => ({ ac_key: j.ac_key, combined_verdict: j.combined_verdict, writeback_status: j.writeback_status }));
  return finish(run, res.status, res.error ?? `judged ${res.per_ac.length} AC(s); JEV is advisory only`);
}

/** The single Evidence References line a human pastes into Jira (pinned format). */
export function evidenceReferenceLine(bundle: StoredEvidenceBundle): string {
  const b = bundle.bundle;
  return [`gov-evidence ${bundle.bundle_hash}`, `head ${b.head_commit.slice(0, 12)}`, ...b.items.map((i) => `${i.registry_id}=${i.result}`)].join(' ');
}

async function cmdSubmit(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  const evidence = flag(argv, '--evidence');
  if (!story || !evidence) return usage(run, 'submit needs --story OMNI-<n> and --evidence sha256:<hex>');
  run.result.story = story;
  const layout = layoutOf(run);
  const bundle = loadBundleOrFail(layout, story, evidence, 'REFUSED');
  const wtArg = flag(argv, '--worktree');
  if (wtArg !== null && normalizeWorktree(wtArg) !== normalizeWorktree(bundle.bundle.worktree)) {
    throw new Outcome('REFUSED', `evidence was produced in ${bundle.bundle.worktree}, not ${posix(path.resolve(wtArg))}`);
  }
  const stored = loadPacketOrFail(layout, story, bundle.bundle.packet_hash);
  const b = bundle.bundle;
  const refs = evidenceReferenceLine(bundle);
  Object.assign(run.result, { packet_hash: stored.packet_hash, bundle_hash: bundle.bundle_hash, deterministic_result: b.deterministic_result });
  run.io.out(`gov submit ${story}: values for a HUMAN to record in Jira (gov writes nothing)`);
  run.io.out(`Evidence bundle: ${bundle.bundle_hash} (deterministic ${b.deterministic_result}, head ${b.head_commit}, packet ${stored.packet_hash})`);
  for (const ac of stored.packet.acceptance_criteria) {
    run.io.out('');
    run.io.out(`${ac.key} ${ac.ac_id} — Jira transition "Record Result":`);
    run.io.out(`  Kind: ${ac.kind}`);
    run.io.out(`  Deterministic Result: ${b.deterministic_result}`);
    run.io.out(`  Evidence Kind: ${ac.evidence_kind}`);
    run.io.out(`  Evidence References: ${refs}`);
  }
  run.io.out('');
  run.io.out('Verification / Disposition (Jira transition "Record Verification") is the human\'s decision; gov does not record it.');
  return finish(run, 'OK');
}

interface MergeCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** Status when this check fails. */
  fail: GovStatus;
}

async function cmdCheckMerge(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  const wtArg = flag(argv, '--worktree');
  const evidence = flag(argv, '--evidence');
  if (!story || !wtArg || !evidence) return usage(run, 'check-merge needs --story OMNI-<n>, --worktree and --evidence sha256:<hex>');
  const worktree = path.resolve(wtArg);
  run.result.story = story;
  const layout = layoutOf(run);
  const checks: MergeCheck[] = [];
  const print = (c: MergeCheck) => {
    checks.push(c);
    run.io.out(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
  };
  const conclude = (): number => {
    run.result.checks = checks.map((c) => ({ name: c.name, ok: c.ok }));
    const failed = checks.filter((c) => !c.ok);
    if (failed.length === 0) return finish(run, 'OK', 'all merge checks passed (gov never merges; merging is a human decision)');
    const order: GovStatus[] = ['INTEGRITY_FAILED', 'REFUSED', 'SCOPE_VIOLATION', 'VERIFICATION_FAILED'];
    const status = order.find((s) => failed.some((c) => c.fail === s)) ?? 'ERROR';
    return finish(run, status, `${failed.length} merge check(s) failed: ${failed.map((c) => c.name).join(', ')}`);
  };

  // (a) binding
  const binding = latestBinding(layout, story, worktree);
  print({ name: 'binding', ok: !!binding, detail: binding ? `session ${binding.session_id} (${binding.mode})` : `no binding for ${story} in ${posix(worktree)}`, fail: 'REFUSED' });
  if (!binding) return conclude();

  // (b) packet
  let stored: StoredPacket;
  try {
    stored = loadPacket(layout, story, binding.packet_hash);
  } catch (err) {
    print({ name: 'packet-integrity', ok: false, detail: (err as Error).message, fail: 'INTEGRITY_FAILED' });
    return conclude();
  }
  const base = stored.packet.base;
  const baseOk = base.commit === binding.base_commit && base.branch === binding.branch && normalizeWorktree(base.worktree) === normalizeWorktree(binding.worktree);
  print({ name: 'packet-integrity', ok: baseOk, detail: baseOk ? `${stored.packet_hash} base ${base.commit}` : 'packet base does not match the binding', fail: 'INTEGRITY_FAILED' });
  run.result.packet_hash = stored.packet_hash;

  // (c) bundle
  let bundle: StoredEvidenceBundle;
  try {
    if (!SHA256_REF_RE.test(evidence)) throw new Error('--evidence must be sha256:<64 lowercase hex>');
    bundle = loadBundle(layout, story, evidence as Sha256Ref);
  } catch (err) {
    print({ name: 'evidence-integrity', ok: false, detail: (err as Error).message, fail: 'INTEGRITY_FAILED' });
    return conclude();
  }
  const b = bundle.bundle;
  run.result.bundle_hash = bundle.bundle_hash;
  const bindOk = b.packet_hash === stored.packet_hash && b.story_key === story && b.base_commit === base.commit;
  print({
    name: 'evidence-integrity',
    ok: bindOk,
    detail: bindOk ? `${bundle.bundle_hash} for packet ${stored.packet_hash}` : 'evidence bundle was not produced for this Story packet and base',
    fail: 'INTEGRITY_FAILED',
  });

  // (d) HEAD + clean tree
  const git = run.deps.git;
  let head: string | null = null;
  let clean = false;
  try {
    head = await git.headCommit(worktree);
    clean = await git.isClean(worktree);
  } catch (err) {
    print({ name: 'head', ok: false, detail: `git probe failed: ${(err as Error).message}`, fail: 'INTEGRITY_FAILED' });
    return conclude();
  }
  print({ name: 'head', ok: head === b.head_commit, detail: head === b.head_commit ? `HEAD ${head} is the verified commit` : `HEAD ${head} != verified ${b.head_commit}`, fail: 'INTEGRITY_FAILED' });
  print({ name: 'clean-tree', ok: clean === true, detail: clean === true ? 'no uncommitted or untracked changes' : 'worktree has uncommitted or untracked changes', fail: 'INTEGRITY_FAILED' });

  // (e) deterministic result + scope
  print({ name: 'deterministic', ok: b.deterministic_result === 'PASS', detail: `deterministic ${b.deterministic_result}`, fail: 'VERIFICATION_FAILED' });
  print({ name: 'scope', ok: !!b.scope && b.scope.ok === true, detail: b.scope && b.scope.ok === true ? 'scope ok' : 'scope violation recorded', fail: 'SCOPE_VIOLATION' });

  // (f, g) every commit in base..HEAD carries both trailers; at least one commit
  // (an adopted Story may have zero governed commits after its baseline).
  const adoption = binding.adoption ?? null;
  if (adoption !== null) return checkAdoptedCommits(run, git, worktree, story, binding, stored, head, adoption, print, conclude);
  let commits: string[] = [];
  try {
    commits = await git.commitsBetween(worktree, base.commit, head);
  } catch (err) {
    print({ name: 'trailers', ok: false, detail: `cannot list ${base.commit}..HEAD: ${(err as Error).message}`, fail: 'INTEGRITY_FAILED' });
    return conclude();
  }
  print({ name: 'commits', ok: commits.length > 0, detail: `${commits.length} commit(s) in base..HEAD`, fail: 'REFUSED' });
  const bad: string[] = [];
  for (const c of commits) {
    const t = await git.commitTrailers(worktree, c);
    const governed = (t[TRAILER_GOVERNED_BY] ?? []).includes(story);
    const packetOk = (t[TRAILER_GOV_PACKET] ?? []).includes(stored.packet_hash);
    if (!governed || !packetOk) bad.push(`${c.slice(0, 12)}${governed ? '' : ` missing ${TRAILER_GOVERNED_BY}: ${story}`}${packetOk ? '' : ` missing ${TRAILER_GOV_PACKET}: ${stored.packet_hash}`}`);
  }
  print({
    name: 'trailers',
    ok: bad.length === 0,
    detail: bad.length === 0 ? `every commit carries ${TRAILER_GOVERNED_BY} and ${TRAILER_GOV_PACKET}` : bad.join('; '),
    fail: 'INTEGRITY_FAILED',
  });
  return conclude();
}

/**
 * check-merge (f, g) for an adopted Story. The baseline must equal the packet
 * and binding base, be an ancestor of (or equal to) HEAD, and be a valid
 * adoption-baseline commit; the commits after it are the governed commits and
 * each must carry exactly `Governed-By: <story>` and `Gov-Packet: <packet
 * hash>`. Commits before the baseline are pre-governance and not inspected.
 * Any git error or mismatch is INTEGRITY_FAILED (fail closed).
 */
async function checkAdoptedCommits(
  run: Run,
  git: GitProbe,
  worktree: string,
  story: string,
  binding: SessionBinding,
  stored: StoredPacket,
  head: string,
  adoption: AdoptionBaseline,
  print: (c: MergeCheck) => void,
  conclude: () => number,
): Promise<number> {
  const baseline = adoption && typeof adoption === 'object' ? adoption.baseline_commit : null;
  run.result.adoption_baseline = typeof baseline === 'string' ? baseline : null;
  const fail = (detail: string): number => {
    print({ name: 'adoption-baseline', ok: false, detail, fail: 'INTEGRITY_FAILED' });
    return conclude();
  };
  if (typeof baseline !== 'string' || !COMMIT_RE.test(baseline)) return fail('adoption baseline is not a full commit id');
  if (adoption.classification !== ADOPTION_CLASSIFICATION) return fail(`adoption classification is not ${ADOPTION_CLASSIFICATION}`);
  if (binding.mode !== 'attach') return fail('adoption is only valid on an attach binding');
  if (baseline !== stored.packet.base.commit || baseline !== binding.base_commit) return fail('adoption baseline does not equal the packet and binding base commit');
  let descends: boolean;
  try {
    descends = await git.isAncestor(worktree, baseline, head);
  } catch (err) {
    return fail(`ancestry check failed: ${(err as Error).message}`);
  }
  if (descends !== true) return fail(`baseline ${baseline} is not an ancestor of HEAD ${head}`);
  const why = await adoptionBaselineProblem(git, worktree, story, baseline);
  if (why !== null) return fail(why);
  print({ name: 'adoption-baseline', ok: true, detail: `baseline ${baseline.slice(0, 12)} ${ADOPTION_CLASSIFICATION}`, fail: 'INTEGRITY_FAILED' });

  let commits: string[];
  try {
    commits = await git.commitsBetween(worktree, baseline, head);
  } catch (err) {
    print({ name: 'trailers', ok: false, detail: `cannot list ${baseline}..HEAD: ${(err as Error).message}`, fail: 'INTEGRITY_FAILED' });
    return conclude();
  }
  run.result.governed_commits = commits.length;
  print({ name: 'commits', ok: true, detail: `baseline ${baseline.slice(0, 12)} ${ADOPTION_CLASSIFICATION}; ${commits.length} governed commit(s)`, fail: 'REFUSED' });
  const bad: string[] = [];
  for (const c of commits) {
    let t: Record<string, string[]>;
    try {
      t = await git.commitTrailers(worktree, c);
    } catch (err) {
      bad.push(`${c.slice(0, 12)} trailers unreadable: ${(err as Error).message}`);
      continue;
    }
    const governed = governedByExactly(t, story);
    const packets = t[TRAILER_GOV_PACKET] ?? [];
    const packetOk = packets.length > 0 && packets.every((p) => p === stored.packet_hash);
    if (!governed || !packetOk) bad.push(`${c.slice(0, 12)}${governed ? '' : ` missing ${TRAILER_GOVERNED_BY}: ${story}`}${packetOk ? '' : ` missing ${TRAILER_GOV_PACKET}: ${stored.packet_hash}`}`);
  }
  print({
    name: 'trailers',
    ok: bad.length === 0,
    detail: bad.length === 0 ? `every governed commit carries ${TRAILER_GOVERNED_BY} and ${TRAILER_GOV_PACKET}` : bad.join('; '),
    fail: 'INTEGRITY_FAILED',
  });
  return conclude();
}

function usage(run: Run, message?: string): number {
  if (message) run.io.err(message);
  run.io.err(USAGE);
  return GOV_EXIT_USAGE;
}

// ---------------------------------------------------------------- entry

export async function runGov(argv: string[], env: Record<string, string | undefined>, io: GovIo, deps?: Partial<GovDeps>): Promise<number> {
  const [verb, ...rest] = argv;
  const defaults = defaultGovDeps();
  let registry: VerificationRegistry | null = deps?.registry ?? null;
  const resolved = { ...defaults, ...(deps ?? {}) } as GovDeps;
  // The registry file is read only when a verb needs it.
  Object.defineProperty(resolved, 'registry', {
    get: () => {
      if (registry === null) registry = loadRegistry();
      return registry;
    },
  });
  const run: Run = { io, env, deps: resolved, result: { verb: verb ?? null } };
  const verbs: Record<string, (r: Run, a: string[]) => Promise<number>> = {
    start: cmdStart,
    attach: cmdAttach,
    packet: cmdPacket,
    verify: cmdVerify,
    judge: cmdJudge,
    submit: cmdSubmit,
    'check-merge': cmdCheckMerge,
  };
  const handler = verb ? verbs[verb] : undefined;
  if (!handler) return usage(run, verb ? `unknown verb: ${verb}` : undefined);
  try {
    return await handler(run, rest);
  } catch (err) {
    if (err instanceof Outcome) return finish(run, err.status, err.message);
    return finish(run, 'ERROR', `unexpected error: ${(err as Error)?.message ?? 'unknown'}`);
  }
}

if (require.main === module) {
  runGov(process.argv.slice(2), process.env, {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
  }).then((code) => process.exit(code));
}
