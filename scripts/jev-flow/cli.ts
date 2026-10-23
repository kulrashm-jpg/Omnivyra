/**
 * `gov` — the governed Claude workflow command line (Track 5).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/jev-flow/cli.ts <verb> [flags]
 *
 *   ready        --story OMNI-n [--report] [--json]   (readiness only: GET-only Jira reads; creates nothing)
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
 *   intake       [--worktree <path>] [--session <uuid>] [--story OMNI-n] [--intent "<text>"]
 *                [--authorized <pattern>]... [--prohibited <pattern>]... [--verification <id>]...
 *                [--judgment-ac "<text>"]... [--base <ref>] [--bind]
 *                (classifies the worktree — GOVERNED_RESUME / EXISTING_STORY / NEW_WORK /
 *                PRE_GOVERNANCE_ADOPTION — and stores a Story proposal when none exists;
 *                read-only apart from GOV_HOME; --bind hands over to attach / start)
 *   intake       --apply sha256:<proposal>
 *                (HUMAN only: interactive terminal, typed proposal hash, the human's own
 *                Jira identity GOV_INTAKE_EMAIL + GOV_INTAKE_TOKEN; creates the Story/ACs)
 *   intake       --check-forms
 *                (HUMAN identity, read-only: are the OMNI Story / AC create forms intake-safe?)
 *   audit-branch --worktree <path> [--base <ref>]
 *                (read-only detection: classifies every commit in base..HEAD as governed,
 *                adoption baseline, malformed or ungoverned; writes nothing, blocks nothing)
 *   reconcile    [--story OMNI-n]...
 *                (read-only dry run: evaluates every AC of each governed Story in the ledger
 *                against its own registry item and evidence freshness, compares Jira and
 *                prints the change set only a HUMAN may apply; no apply mode, writes nothing)
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
import readline from 'node:readline';
import { FileAuditSink, defaultAuditDir, type AuditSink } from '../jev-bjc/audit';
import { canonicalJson } from '../jev-bjc/canonical';
import { createTypeSafeTransport, resolveApiKey, type JevTransport } from '../jev-bjc/provider';
import { resolveModel } from '../jev-jira/cli';
import { identityViolations, preflightPermissionKeys, resolveRuntimeIdentity, type RuntimeIdentity } from '../jev-jira/identity';
import { JiraClientError, createJiraClient, type JiraClient, type JiraCredentials, type JiraPermissionProbe } from '../jev-jira/jiraClient';
import { AUDIT_COMMIT_CLASSES, auditBranch } from './auditBranch';
import { findByStory, findBySession, bindSession, readBindings } from './binding';
import {
  appendIntakeAudit,
  baselineCommands,
  classifyIntake,
  loadIntakeRules,
  loadProposal,
  renderProposalMarkdown,
  samePath,
  slugFrom,
  storeProposal,
  storyCandidateFromIssue,
  type IntakeAuditInput,
  type IntakeRules,
  type StoryCandidate,
} from './intake';
import {
  AC_ALWAYS_SENT,
  AC_CREATE_FIELDS,
  STORY_ALWAYS_SENT,
  STORY_CREATE_FIELDS,
  applyIntakeProposal,
  checkCreateForms,
  createFormImplicit,
  createIntakeJira,
  createIntakeReader,
  isGateField,
  INTAKE_FRESHNESS_VARS,
  checkIntakeCredentialFreshness,
  parseRegQueryValue,
  resolveIntakeCredentials,
  type FormsCheck,
  type IntakeFreshnessVar,
  type UserEnvRead,
  type UserEnvReader,
  type IntakeJira,
  type IntakeReader,
} from './intakeJira';
import { NEW_WORK_INPUT_CODES, readStrictSessions, resolveAdmittedSession, type SessionEvidencePort } from './admission';
import { createSessionEvidencePort, parseNulList, parsePorcelainZ, readLiveSessions, type IntakeProbe, type LiveSession, type WorktreeState } from './intakeProbe';
import { loadBundle } from './evidence';
import { acSubmission } from './lifecycle';
import { RECONCILE_AC_FIELDS, acEvidenceReferenceLine, runReconcile, type ReconcilePorts } from './reconcile';
import { createJiraQuery, type JiraQuery } from './jiraQuery';
import { runJudgeFlow } from './judgeFlow';
import { buildPacket, detectStale, loadPacket, storePacket } from './packet';
import { checkReadiness, checkReadinessReport, type ReadinessReport } from './readiness';
import { describeProtectedViolation, evaluateProtectedPaths, loadProtectedPathPolicy, type ProtectedPathPolicy } from './protectedPaths';
import { loadRegistry } from './registry';
import { createGitProbe } from './scope';
import { buildResumeInstructions, buildStartCommand, findSessionFile, fingerprintSession, newSessionId } from './session';
import { defaultRunner, normalizeWorktree, runVerification, type CommandRunner } from './verify';
import {
  ADOPTION_CLASSIFICATION,
  AUTOMATION_POLICY_PATH,
  COMMIT_RE,
  SESSION_ID_RE,
  SHA256_REF_RE,
  STORY_KEY_RE,
  TRAILER_GOVERNED_BY,
  TRAILER_GOV_PACKET,
  govLayout,
  type AdoptionBaseline,
  type EvidenceKind,
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
  /** intake: read-only worktree probe. */
  intakeProbe: IntakeProbe;
  /** intake: live Claude sessions (registry under ~/.claude/sessions). */
  liveSessions: (env: Record<string, string | undefined>) => LiveSession[];
  /** intake: read-only active-Story search (reader credentials). */
  intakeReader: (credentials: JiraCredentials) => IntakeReader;
  /** intake --apply: Story/AC creation under the human's own Jira identity. */
  intakeJira: (credentials: JiraCredentials) => IntakeJira;
  /** intake: rules (default prohibited paths, path → registry ids), validated against the registry. */
  intakeRules: (registry: VerificationRegistry) => IntakeRules;
  /** intake --apply: true only for an interactive terminal (a human at the keyboard). */
  isInteractive: () => boolean;
  /** intake --apply: one line typed by the human. */
  prompt: (question: string) => Promise<string>;
  /** intake --check-forms / --apply: reads one human-intake variable from the authoritative Windows User environment. */
  readUserEnv: UserEnvReader;
  /** verify / check-merge: the reviewed protected-path policy (B3); throws when unavailable (fail closed). */
  protectedPolicy: (registry: VerificationRegistry) => ProtectedPathPolicy;
  /** admit: read-only session evidence (registry, pid liveness, pipe namespace); every read throws on failure. */
  sessionEvidence: (env: Record<string, string | undefined>) => SessionEvidencePort;
  /** reconcile: text of a repo file at a commit (read-only `git show`), or null when absent. */
  readCommitFile: (worktree: string, commit: string, relPath: string) => Promise<string | null>;
  /** reconcile: the automation policy in force (this tool's AUTOMATION-POLICY.md), or null when unreadable. */
  automationPolicyText: () => string | null;
}

/**
 * The single read-only registry launch: `reg query HKCU\Environment /v <name>` for GOV_INTAKE_EMAIL /
 * GOV_INTAKE_TOKEN only (execFile, no shell). Non-Windows always refuses — the Windows User
 * environment is the only authoritative source, and there is no fallback. Raw output is parsed
 * and discarded; it is never logged, audited or returned.
 */
export function readWindowsUserEnv(name: IntakeFreshnessVar): Promise<UserEnvRead> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ state: 'unavailable', reason: 'the Windows User environment is only available on Windows' });
  }
  if (!(INTAKE_FRESHNESS_VARS as readonly string[]).includes(name)) {
    return Promise.resolve({ state: 'unavailable', reason: 'only the human-intake variables can be read' });
  }
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Environment', '/v', name],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        const code = err ? (err as { code?: unknown }).code : 0;
        resolve(parseRegQueryValue(name, err ? null : String(stdout), typeof code === 'number' ? code : null));
      },
    );
  });
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
  '  ready       --story OMNI-<n> [--report] [--json]',
  '  start       --story OMNI-<n> --slug <slug> --repo <git repo> [--base <ref>] [--worktree-root <dir>]',
  '  attach      --story OMNI-<n> --session <uuid> [--worktree <path>] [--base <ref>] [--fork]',
  '  packet      --story OMNI-<n> --worktree <path> [--regenerate]',
  '  verify      --story OMNI-<n> --worktree <path>',
  '  judge       --story OMNI-<n> --worktree <path> --evidence <sha256:...> --invoked-by <human|claude-code>:<id> [--write-back] [--model <id>]',
  '  submit      --story OMNI-<n> --evidence <sha256:...> [--worktree <path>]',
  '  check-merge --story OMNI-<n> --worktree <path> --evidence <sha256:...>',
].join('\n');

/** Governed entry (kept separate from the per-Story verbs above). */
const INTAKE_USAGE = [
  '  intake      [--worktree <path>] [--session <uuid>] [--story OMNI-<n>] [--intent "<text>"] [--authorized <p>]... [--prohibited <p>]...',
  '              [--verification <id>]... [--judgment-ac "<text>"]... [--authorize-protected <id>]... [--base <ref>] [--bind]',
  '  intake      (human only, interactive terminal, your own Jira identity) --apply sha256:<proposal>',
  '  intake      (human only, your own Jira identity; read-only) --check-forms',
].join('\n');

/** Read-only detection (kept separate: it governs no Story and needs no binding). */
const AUDIT_USAGE = '  audit-branch --worktree <path> [--base <ref>]   (read-only: reports commits in base..HEAD that do not carry governance)';

/** Read-only reconciliation (kept separate: it covers every Story in the ledger and writes nothing). */
const RECONCILE_USAGE = '  reconcile   [--story OMNI-<n>]...   (read-only dry run: per-AC lifecycle vs Jira; prints the change set a human may apply)';

/** Read-only admission (kept separate: it binds nothing and executes nothing it prints). */
const ADMIT_USAGE = '  admit       [--worktree <path>] [--session <uuid>] [--base <ref>]   (read-only: identifies this session, classifies the work, prints the next gov command)';

// ---------------------------------------------------------------- default deps

function runGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : -1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/**
 * gov intake worktree probe — read-only git only (rev-parse, symbolic-ref,
 * status, merge-base, diff). Never add / commit / stash / reset / checkout /
 * rebase: intake reports the user's work, it never touches it.
 */
export function createIntakeProbe(): IntakeProbe {
  return {
    async worktreeState(worktree: string, baseRef: string): Promise<WorktreeState> {
      const wt = path.resolve(worktree);
      if (!REF_RE.test(baseRef)) throw new Error(`invalid base ref: ${baseRef}`);
      const head = await runGit(['-C', wt, 'rev-parse', '--verify', 'HEAD']);
      const headCommit = head.stdout.trim();
      if (head.code !== 0 || !COMMIT_RE.test(headCommit)) throw new Error(`not a git worktree with a commit: ${posix(wt)}`);
      const br = await runGit(['-C', wt, 'symbolic-ref', '--short', '-q', 'HEAD']);
      const branch = br.code === 0 && br.stdout.trim() !== '' ? br.stdout.trim() : null;
      const status = await runGit(['-C', wt, 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
      if (status.code !== 0) throw new Error(`git status failed in ${posix(wt)}`);
      const dirty = parsePorcelainZ(status.stdout);
      const mb = await runGit(['-C', wt, 'merge-base', 'HEAD', baseRef]);
      const mergeBase = mb.code === 0 && COMMIT_RE.test(mb.stdout.trim()) ? mb.stdout.trim() : null;
      let changed: string[] = [];
      if (mergeBase !== null) {
        const diff = await runGit(['-C', wt, 'diff', '--name-only', '-z', mergeBase, headCommit]);
        if (diff.code !== 0) throw new Error(`git diff failed in ${posix(wt)}`);
        changed = parseNulList(diff.stdout);
      }
      return { worktree: posix(wt), branch, head: headCommit, clean: dirty.length === 0, dirty_files: dirty, base_ref: baseRef, merge_base: mergeBase, changed_since_base: changed };
    },
  };
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
    intakeProbe: createIntakeProbe(),
    liveSessions: (env) => readLiveSessions(env),
    intakeReader: (credentials) => createIntakeReader({ credentials }),
    intakeJira: (credentials) => createIntakeJira({ credentials }),
    intakeRules: (registry) => loadIntakeRules(registry),
    isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
    prompt: (question) =>
      new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
          rl.close();
          resolve(answer);
        });
      }),
    readUserEnv: readWindowsUserEnv,
    protectedPolicy: (registry) => loadProtectedPathPolicy(registry),
    sessionEvidence: (env) => createSessionEvidencePort(env),
    readCommitFile: async (worktree, commit, relPath) => {
      if (!COMMIT_RE.test(commit)) throw new Error('commit must be a full commit id');
      if (!/^[A-Za-z0-9._/-]+$/.test(relPath) || relPath.split('/').includes('..')) throw new Error('invalid repo path');
      const r = await runGit(['-C', path.resolve(worktree), 'show', `${commit}:${relPath}`]);
      return r.code === 0 ? r.stdout : null;
    },
    automationPolicyText: () => {
      try {
        return fs.readFileSync(path.join(__dirname, path.basename(AUTOMATION_POLICY_PATH)), 'utf8');
      } catch {
        return null;
      }
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

/** Readiness plus its report, through the same reader identity and the same Jira reads. */
async function readReadinessReport(run: Run, storyKey: string): Promise<{ readiness: ReadinessResult; report: ReadinessReport }> {
  const { credentials } = await preflightIdentity(run, false);
  return checkReadinessReport(storyKey, { query: run.deps.jiraQuery(credentials), registry: run.deps.registry });
}

function printTable(run: Run, header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()}`;
  run.io.out(line(header));
  for (const r of rows) run.io.out(line(r));
}

/** Human-readable report on stdout. Field values are never printed, only presence and counts. */
function printReport(run: Run, report: ReadinessReport): void {
  const dash = (v: string | null) => v ?? '-';
  const codes = (c: string[]) => (c.length > 0 ? c.join(',') : '-');
  run.io.out(`Readiness report: ${report.story_key} ${report.ready ? 'READY' : 'NOT READY'} (${report.findings.length} finding(s))${report.evaluated ? '' : '; evaluation stopped early'}`);
  run.io.out('Story fields:');
  printTable(
    run,
    ['FIELD', 'NAME', 'REQUIRED', 'PRESENT', 'ENTRIES', 'VALID', 'FINDINGS'],
    report.story_fields.map((f) => [f.field, f.name, f.required ? 'yes' : 'no', f.present ? 'yes' : 'no', f.entries === null ? '-' : String(f.entries), f.valid === null ? 'unchecked' : f.valid ? 'yes' : 'no', codes(f.findings)]),
  );
  run.io.out(`Acceptance Criteria (${report.acceptance_criteria.length}):`);
  printTable(
    run,
    ['KEY', 'AC ID', 'KIND', 'EVIDENCE KIND', 'STATUS', 'VERIFICATION', 'FLAGS', 'FINDINGS'],
    report.acceptance_criteria.map((a) => [
      a.key,
      dash(a.ac_id),
      dash(a.kind),
      dash(a.evidence_kind),
      dash(a.status),
      dash(a.verification),
      [a.orphan ? 'orphan' : '', a.duplicate ? 'duplicate' : ''].filter(Boolean).join(',') || '-',
      codes(a.findings),
    ]),
  );
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

/**
 * Readiness only, through the same reader identity, permission preflight and
 * GET-only query as `start`. Never resolves a base and never creates a branch,
 * worktree, packet or binding; GOV_HOME is not touched.
 */
async function cmdReady(run: Run, argv: string[]): Promise<number> {
  const story = storyArg(argv);
  if (!story) return usage(run, 'ready needs --story OMNI-<n>');
  const wantReport = has(argv, '--report');
  if (has(argv, '--json') && !wantReport) return usage(run, 'ready --json requires --report');
  run.result.story = story;
  let readiness: ReadinessResult;
  if (wantReport) {
    const r = await readReadinessReport(run, story);
    readiness = r.readiness;
    // --json: one canonical JSON line (sorted keys), then the usual GOV_RESULT line.
    if (has(argv, '--json')) run.io.out(canonicalJson(r.report));
    else printReport(run, r.report);
  } else {
    readiness = await readReadiness(run, story);
  }
  requireReady(run, readiness);
  return finish(run, 'OK', `Story ${story} is READY; nothing was created`);
}

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
  let protectedPolicy: ProtectedPathPolicy;
  try {
    protectedPolicy = run.deps.protectedPolicy(run.deps.registry);
  } catch (err) {
    throw new Outcome('REFUSED', `protected-path policy unavailable: ${(err as Error).message}`);
  }
  const r = await runVerification({
    packet: stored.packet,
    packetHash: stored.packet_hash,
    worktree,
    registry: run.deps.registry,
    git: run.deps.git,
    layout,
    runner: run.deps.runner,
    now: run.deps.now,
    protectedPolicy,
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

/** The bundle-wide Evidence References line (pinned format); submit prints the per-AC form (reconcile.ts acEvidenceReferenceLine). */
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
  Object.assign(run.result, { packet_hash: stored.packet_hash, bundle_hash: bundle.bundle_hash, deterministic_result: b.deterministic_result });
  const kinds = registryKinds(run.deps.registry);
  const perAc: Array<Record<string, string>> = [];
  run.io.out(`gov submit ${story}: values for a HUMAN to record in Jira (gov writes nothing)`);
  run.io.out(`Evidence bundle: ${bundle.bundle_hash} (deterministic ${b.deterministic_result}, head ${b.head_commit}, packet ${stored.packet_hash})`);
  for (const ac of stored.packet.acceptance_criteria) {
    // Per AC: its own registry item, never the bundle-wide result; a Judgment AC gets no deterministic result.
    const sub = acSubmission(ac, bundle, stored, kinds);
    run.io.out('');
    run.io.out(`${ac.key} ${ac.ac_id} — Jira transition "Record Result":`);
    run.io.out(`  Kind: ${ac.kind}`);
    if (sub.kind === 'deterministic') {
      run.io.out(`  Deterministic Result: ${sub.result} (${sub.item_id} ${sub.registry_id})`);
      run.io.out(`  Evidence Kind: ${ac.evidence_kind}`);
      run.io.out(`  Evidence References: ${acEvidenceReferenceLine({ ...sub, bundle_hash: bundle.bundle_hash, head_commit: b.head_commit })}`);
      perAc.push({ ac_key: ac.key, registry_id: sub.registry_id, result: sub.result });
    } else if (sub.kind === 'human') {
      run.io.out(`  Deterministic Result: none — a human decides this AC (${sub.reason}); gov records no deterministic result for it`);
      run.io.out(`  Evidence Kind: ${ac.evidence_kind}`);
      perAc.push({ ac_key: ac.key, result: 'HUMAN_DECISION', reason: sub.reason });
    } else {
      run.io.out(`  Deterministic Result: none — no usable evidence item for this AC (${sub.reason})`);
      run.io.out(`  Evidence Kind: ${ac.evidence_kind}`);
      perAc.push({ ac_key: ac.key, result: 'INSUFFICIENT_EVIDENCE', reason: sub.reason });
    }
  }
  run.result.per_ac = perAc;
  run.io.out('');
  run.io.out('Verification / Disposition (Jira transition "Record Verification") is the human\'s decision; gov does not record it.');
  return finish(run, 'OK');
}

function registryKinds(registry: VerificationRegistry): Record<string, EvidenceKind> {
  return Object.fromEntries(registry.entries.map((e) => [e.id, e.evidence_kind]));
}

async function cmdReconcile(run: Run, argv: string[]): Promise<number> {
  if (has(argv, '--apply')) return usage(run, 'reconcile is a dry run only: there is no --apply; a human makes every Jira change');
  const only = flagsAll(argv, '--story');
  if (only === null || only.some((k) => !STORY_KEY_RE.test(k))) return usage(run, 'reconcile takes only [--story OMNI-<n>]...');
  const unknown = argv.filter((a, i) => a !== '--story' && !(i > 0 && argv[i - 1] === '--story'));
  if (unknown.length > 0) return usage(run, `reconcile: unexpected argument(s): ${unknown.join(', ')}`);
  run.result.dry_run = true;
  const layout = layoutOf(run);
  let stories: string[];
  try {
    stories = [...new Set(readBindings(layout).map((b) => b.story_key))];
  } catch (err) {
    throw new Outcome('INTEGRITY_FAILED', (err as Error).message);
  }
  if (only.length === 0 && stories.length === 0) {
    run.result.stories = [];
    return finish(run, 'OK', 'no governed Story in the ledger; nothing to reconcile');
  }
  const { credentials, client } = await preflightIdentity(run, false);
  const query = run.deps.jiraQuery(credentials);
  const ports: ReconcilePorts = {
    layout,
    registry: run.deps.registry,
    git: run.deps.git,
    readCommitFile: run.deps.readCommitFile,
    currentPolicyText: run.deps.automationPolicyText(),
    readiness: (key) => checkReadiness(key, { query, registry: run.deps.registry }),
    readAc: (key) => client.getIssue(key, RECONCILE_AC_FIELDS),
  };
  const report = await runReconcile(only.length > 0 ? only : null, ports);

  run.io.out('gov reconcile: DRY RUN — proposals for a HUMAN; gov writes nothing (no Jira, ledger, evidence or git change; no JEV)');
  const counts: Record<string, number> = { NO_OP: 0, INVALIDATE_STALE_EVIDENCE: 0, CONFLICT: 0, INSUFFICIENT_EVIDENCE: 0, HUMAN_DECISION: 0 };
  let proposed = 0;
  for (const st of report.stories) {
    run.io.out('');
    run.io.out(`${st.story_key}: packet ${st.packet_hash ?? 'none'} · current evidence ${st.bundle_hash ?? 'none'}`);
    for (const f of st.integrity_failures) run.io.out(`  INTEGRITY: ${f}`);
    if (st.error) {
      run.io.out(`  not reconciled: ${st.error}`);
      continue;
    }
    const moved = st.freshness.filter((c) => !c.fresh).map((c) => c.dimension);
    if (st.bundle_hash) run.io.out(`  freshness: ${moved.length === 0 ? 'current' : `STALE (${moved.join(', ')})`}`);
    for (const a of st.per_ac) {
      counts[a.disposition] += 1;
      proposed += a.changes.length;
      run.io.out(`  ${a.ac_key} ${a.ac_id}: ${a.state} → ${a.disposition} (${a.reasons.join(', ')})${a.jev_advisory ? ` · JEV advisory ${a.jev_advisory} (advisory only)` : ''}`);
      for (const c of a.changes) run.io.out(`    human may set ${c.field}: ${c.current ?? '(empty)'} → ${c.proposed ?? '(clear)'}`);
    }
  }
  run.io.out('');
  run.io.out(`Change set: ${report.change_set_hash} (${proposed} proposed field change(s); dry run — nothing was written)`);
  run.result.change_set_hash = report.change_set_hash;
  run.result.counts = counts;
  run.result.proposed_changes = proposed;
  run.result.stories = report.stories.map((st) => ({ story: st.story_key, bundle_hash: st.bundle_hash, error: st.error, per_ac: st.per_ac.map((a) => ({ ac_key: a.ac_key, state: a.state, disposition: a.disposition })) }));
  if (report.stories.some((st) => st.integrity_failures.length > 0)) return finish(run, 'INTEGRITY_FAILED', 'stored packet or evidence failed its integrity check; see INTEGRITY lines');
  if (report.stories.some((st) => st.error !== null)) return finish(run, 'ERROR', 'at least one Story could not be reconciled; see "not reconciled" lines');
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

  // (e2) protected paths (B3), recomputed from git over base..HEAD against the reviewed policy:
  // the bundle alone is not trusted for this, and a bundle from before enforcement gets no pass.
  let guarded: ReturnType<typeof evaluateProtectedPaths>;
  try {
    const policy = run.deps.protectedPolicy(run.deps.registry);
    const changed = await git.changedPaths(worktree, base.commit, head);
    guarded = evaluateProtectedPaths(changed, { invariants: stored.packet.story.invariants ?? [], registry_ids: stored.packet.verification.registry_ids ?? [] }, policy);
  } catch (err) {
    print({ name: 'protected-paths', ok: false, detail: `protected-path check unavailable: ${(err as Error).message}`, fail: 'INTEGRITY_FAILED' });
    return conclude();
  }
  print({
    name: 'protected-paths',
    ok: guarded.ok,
    detail: guarded.ok
      ? `${guarded.protected_changed.length} protected path(s) changed, each under an exact reviewed authorization`
      : describeProtectedViolation(guarded),
    fail: 'SCOPE_VIOLATION',
  });

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

// ---------------------------------------------------------------- audit-branch

/**
 * `gov audit-branch` (N-14 detection, A1(b)). Read-only: git through the probe, GOV_HOME
 * packets and ledger read, nothing written anywhere. OK only when every commit in
 * base..HEAD is GOVERNED or a recorded ADOPTION_BASELINE (or there are none); any
 * ungoverned, malformed or unverifiable commit is INTEGRITY_FAILED. It never blocks,
 * merges, releases or deploys — wiring it into a required check is a human authority decision.
 */
async function cmdAuditBranch(run: Run, argv: string[]): Promise<number> {
  const wtArg = flag(argv, '--worktree');
  if (!wtArg) return usage(run, 'audit-branch needs --worktree <path>');
  const baseRef = flag(argv, '--base') ?? DEFAULT_BASE_REF;
  const worktree = path.resolve(wtArg);
  const layout = layoutOf(run);
  const base = await resolveBase(run, worktree, baseRef);
  let head: string;
  try {
    head = await run.deps.git.headCommit(worktree);
  } catch (err) {
    throw new Outcome('REFUSED', `not a git worktree with a commit: ${posix(worktree)} (${(err as Error).message})`);
  }
  const bindings = readBindings(layout);
  let report: Awaited<ReturnType<typeof auditBranch>>;
  try {
    report = await auditBranch({
      git: run.deps.git,
      worktree,
      base,
      head,
      packetIntact: (story, hash) => {
        try {
          loadPacket(layout, story, hash as Sha256Ref);
          return true;
        } catch {
          return false;
        }
      },
      isAdoptionBaseline: (story, commit) => bindings.some((b) => b.story_key === story && b.adoption?.baseline_commit === commit),
    });
  } catch (err) {
    throw new Outcome('INTEGRITY_FAILED', `cannot audit ${base}..${head}: ${(err as Error).message}`);
  }
  Object.assign(run.result, { worktree: posix(worktree), base_commit: base, head_commit: head, verdict: report.verdict, counts: report.counts });
  run.io.out(`gov audit-branch ${posix(worktree)}: ${base.slice(0, 12)}..${head.slice(0, 12)} (${report.commits.length} commit(s); read-only, nothing written)`);
  for (const c of report.commits) run.io.out(`  ${c.commit.slice(0, 12)} ${c.classification} — ${c.detail}`);
  run.io.out(`Counts: ${AUDIT_COMMIT_CLASSES.map((k) => `${k}=${report.counts[k]}`).join(' ')}`);
  run.io.out('Detection only: GOVERNED means the trailers reference an intact stored packet — it does not prove scope, evidence or session; use gov verify / check-merge.');
  if (report.verdict === 'NO_COMMITS' || report.verdict === 'ALL_GOVERNED') return finish(run, 'OK', `verdict ${report.verdict}`);
  return finish(run, 'INTEGRITY_FAILED', `verdict ${report.verdict}`);
}

// ---------------------------------------------------------------- intake

/** Every value of a repeatable flag, in order. A flag present without a value is null (usage error). */
function flagsAll(argv: string[], name: string): string[] | null {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== name) continue;
    const v = argv[i + 1];
    if (typeof v !== 'string' || v === '' || v.startsWith('--')) return null;
    out.push(v);
    i++;
  }
  return out;
}

const MAX_LISTED = 50;

function listPaths(run: Run, label: string, paths: string[]): void {
  run.io.out(`${label} (${paths.length}):`);
  for (const p of paths.slice(0, MAX_LISTED)) run.io.out(`  ${p}`);
  if (paths.length > MAX_LISTED) run.io.out(`  … ${paths.length - MAX_LISTED} more`);
}

/** `gov` as the README defines it; printed commands are for the human (or the governed session) to run. */
const GOV = 'gov';

/** What intake (and admission) gather before classifying; read-only apart from the Jira GETs. */
interface IntakeGatherInput {
  worktree: string;
  baseRef: string;
  sessionArg: string | null;
  storyFlag: string | null;
  /** Read at the same point intake always read it (after the session transcript check). */
  readLive: () => LiveSession[];
  options: { intent: string | null; authorized: string[]; prohibited: string[]; verification: string[]; judgmentAcs: string[]; authorizations: string[] };
}

/**
 * Intake's input gathering and classification, shared verbatim by `gov intake` and `gov admit`:
 * rules → worktree state → ledger → resume check → session lookup → live sessions → Jira → classifyIntake.
 * Writes nothing; refusals are thrown as Outcomes exactly as intake always threw them.
 */
async function gatherIntake(run: Run, layout: GovLayout, input: IntakeGatherInput) {
  const { worktree, baseRef, sessionArg, storyFlag } = input;
  const { intent, authorized, prohibited, verification, judgmentAcs, authorizations } = input.options;
  let rules: IntakeRules;
  try {
    rules = run.deps.intakeRules(run.deps.registry);
  } catch (err) {
    throw new Outcome('REFUSED', `intake rules are invalid: ${(err as Error).message}`);
  }

  let state;
  try {
    state = await run.deps.intakeProbe.worktreeState(worktree, baseRef);
  } catch (err) {
    throw new Outcome('REFUSED', `${posix(worktree)} is not a usable git worktree: ${(err as Error).message}`);
  }
  Object.assign(run.result, { worktree: state.worktree, branch: state.branch, head: state.head, merge_base: state.merge_base, clean: state.clean });
  run.io.out(`Worktree: ${state.worktree}`);
  run.io.out(`Branch: ${state.branch ?? '(detached)'}`);
  run.io.out(`HEAD: ${state.head}`);
  run.io.out(`Merge-base with ${state.base_ref}: ${state.merge_base ?? '(none)'}`);
  run.io.out(`State: ${state.clean ? 'clean' : `DIRTY — ${state.dirty_files.length} uncommitted/untracked path(s); intake changes none of them`}`);
  if (!state.clean) listPaths(run, 'Uncommitted paths', state.dirty_files);
  if (state.changed_since_base.length > 0) listPaths(run, `Committed since merge-base`, state.changed_since_base);

  let ledger: SessionBinding[];
  try {
    ledger = readBindings(layout);
  } catch (err) {
    throw new Outcome('INTEGRITY_FAILED', (err as Error).message);
  }
  const forWorktree = ledger.filter((b) => samePath(b.worktree, state.worktree));
  let resumeCheck: { packetIntact: boolean; descends: boolean } | null = null;
  if (forWorktree.length > 0) {
    const latest = forWorktree[forWorktree.length - 1];
    let packetIntact = false;
    try {
      loadPacket(layout, latest.story_key, latest.packet_hash);
      packetIntact = true;
    } catch {
      packetIntact = false;
    }
    let descends = false;
    try {
      descends = (await run.deps.git.isAncestor(worktree, latest.base_commit, state.head)) === true;
    } catch {
      descends = false;
    }
    resumeCheck = { packetIntact, descends };
  }

  const sessionBoundStory = sessionArg ? (findBySession(layout, sessionArg)?.story_key ?? null) : null;
  if (sessionArg) {
    let file: string | null;
    try {
      file = findSessionFile(sessionArg, run.env);
    } catch (err) {
      throw new Outcome('REFUSED', (err as Error).message);
    }
    if (file === null) throw new Outcome('REFUSED', `no Claude transcript found for session ${sessionArg}`);
  }
  const live = input.readLive();

  let explicitStory: StoryCandidate | null = null;
  let activeStories: StoryCandidate[] = [];
  if (forWorktree.length === 0) {
    const { credentials } = await preflightIdentity(run, false);
    try {
      if (storyFlag) {
        const issue = await run.deps.jiraQuery(credentials).getStory(storyFlag);
        explicitStory = issue ? storyCandidateFromIssue(issue) : null;
      } else {
        activeStories = (await run.deps.intakeReader(credentials).searchActiveStories()).map(storyCandidateFromIssue);
      }
    } catch (err) {
      throw new Outcome('REFUSED', `Jira read failed: ${err instanceof JiraClientError ? err.code : (err as Error).message}`);
    }
  }

  const decision = classifyIntake({
    state,
    bindingsForWorktree: forWorktree,
    resumeCheck,
    sessionId: sessionArg,
    sessionBoundStory,
    liveSessions: live,
    explicitStoryKey: storyFlag,
    explicitStory,
    activeStories,
    options: { intent, authorized, prohibited, verification, judgmentAcs, authorizations },
    rules,
    registry: run.deps.registry,
  });
  return { state, forWorktree, live, decision };
}

async function cmdIntake(run: Run, argv: string[]): Promise<number> {
  if (has(argv, '--apply')) return cmdIntakeApply(run, argv);
  if (has(argv, '--check-forms')) return cmdIntakeCheckForms(run);
  const wtArg = flag(argv, '--worktree');
  if (has(argv, '--worktree') && wtArg === null) return usage(run, '--worktree needs a path');
  const sessionArg = flag(argv, '--session');
  if (has(argv, '--session') && (sessionArg === null || !SESSION_ID_RE.test(sessionArg))) return usage(run, '--session needs a lowercase uuid');
  const storyFlag = flag(argv, '--story');
  if (has(argv, '--story') && (storyFlag === null || !STORY_KEY_RE.test(storyFlag))) return usage(run, '--story needs OMNI-<n>');
  const intent = flag(argv, '--intent');
  if (has(argv, '--intent') && intent === null) return usage(run, '--intent needs text');
  const baseRef = flag(argv, '--base') ?? DEFAULT_BASE_REF;
  if (has(argv, '--base') && flag(argv, '--base') === null) return usage(run, '--base needs a ref');
  const authorized = flagsAll(argv, '--authorized');
  const prohibited = flagsAll(argv, '--prohibited');
  const verification = flagsAll(argv, '--verification');
  const judgmentAcs = flagsAll(argv, '--judgment-ac');
  const authorizations = flagsAll(argv, '--authorize-protected');
  if (!authorized || !prohibited || !verification || !judgmentAcs || !authorizations) {
    return usage(run, '--authorized, --prohibited, --verification, --judgment-ac and --authorize-protected each need a value');
  }
  const bind = has(argv, '--bind');
  const worktree = path.resolve(wtArg ?? process.cwd());
  run.result.intake = true;
  if (authorizations.length > 0) run.result.protected_authorizations = [...new Set(authorizations)].sort();
  const layout = layoutOf(run);

  const { state, live, decision } = await gatherIntake(run, layout, {
    worktree,
    baseRef,
    sessionArg,
    storyFlag,
    readLive: () => run.deps.liveSessions(run.env),
    options: { intent, authorized, prohibited, verification, judgmentAcs, authorizations },
  });

  const auditBase: Omit<IntakeAuditInput, 'event' | 'outcome'> = {
    worktree: state.worktree,
    branch: state.branch,
    head: state.head,
    merge_base: state.merge_base,
    dirty_file_count: state.dirty_files.length,
    session_id: sessionArg,
    protected_authorizations: [...new Set(authorizations)].sort(),
  };
  const audit = (input: Omit<IntakeAuditInput, keyof typeof auditBase> & Partial<typeof auditBase>) => appendIntakeAudit(layout, { ...auditBase, ...input } as IntakeAuditInput, run.deps.now);

  if (decision.kind === 'REFUSED') {
    run.result.refusal = decision.code;
    run.io.err(`Intake refused [${decision.code}]: ${decision.message}`);
    for (const d of decision.details.slice(0, MAX_LISTED)) run.io.err(`  ${d}`);
    audit({ event: 'refused', refusal: decision.code, outcome: decision.message });
    throw new Outcome('REFUSED', 'nothing was created, committed, bound or changed');
  }
  run.result.classification = decision.kind;
  run.io.out(`Classification: ${decision.kind}`);

  // 1. GOVERNED_RESUME — resume; never a second Story, baseline, binding or agent.
  if (decision.kind === 'GOVERNED_RESUME') {
    const b = decision.binding;
    const md = layout.packetFile(b.story_key, b.packet_hash, 'md');
    Object.assign(run.result, { story: b.story_key, session_id: b.session_id, packet_hash: b.packet_hash, packet_md: md });
    run.io.out(`Governed by ${b.story_key} · session ${b.session_id} (${b.mode}) · packet ${b.packet_hash}`);
    if (b.adoption) run.io.out(`Adoption baseline: ${b.adoption.baseline_commit} (${b.adoption.classification})`);
    run.io.out('Resume normally (nothing new is created):');
    if (live.some((s) => s.session_id === b.session_id)) {
      run.io.out(`  The session is running: in its window, type @${md}`);
    } else if (b.mode === 'new') {
      run.io.out(`  cd ${quoteIfNeeded(winPathIfWindows(b.worktree))} && claude --resume ${b.session_id}`);
    } else {
      for (const step of buildResumeInstructions({ sessionId: b.session_id, sessionCwd: b.session_file?.cwd ?? b.worktree, packetMarkdownPath: md, fork: false }).steps) run.io.out(`  ${step}`);
    }
    run.io.out(`  Check the packet is current: ${GOV} packet --story ${b.story_key} --worktree ${quoteIfNeeded(b.worktree)}`);
    audit({ event: 'classify', classification: decision.kind, candidate_story: b.story_key, session_id: b.session_id, packet_hash: b.packet_hash, adoption_classification: b.adoption ? b.adoption.classification : null, outcome: 'resume' });
    return finish(run, 'OK');
  }

  // 2. EXISTING_STORY, or adoption with a covering Story.
  if (decision.kind === 'EXISTING_STORY' || (decision.kind === 'PRE_GOVERNANCE_ADOPTION' && decision.candidate !== null)) {
    const story = decision.kind === 'EXISTING_STORY' ? decision.story : decision.candidate!;
    run.result.story = story.key;
    run.io.out(`Story: ${story.key} — ${story.summary} (reused; no new Story)`);
    const readiness = await readReadiness(run, story.key);
    requireReady(run, readiness);
    const owner = decision.owner;

    if (decision.kind === 'PRE_GOVERNANCE_ADOPTION') {
      run.io.out('PRE-GOVERNANCE ADOPTION: an adoption baseline is required. Intake never stashes, resets, rebases or commits.');
      run.io.out(`Subject: ${decision.subject ?? '(unknown)'} · owner session: ${owner}`);
      run.io.out('You (the human) make the baseline commit:');
      for (const c of baselineCommands(state.worktree, story.key, story.summary, false)) run.io.out(`  ${c}`);
      run.io.out('Then bind the existing session (it keeps running; no restart):');
      run.io.out(`  ${GOV} intake --worktree ${quoteIfNeeded(state.worktree)} --session ${owner} --story ${story.key} --bind`);
      audit({ event: 'classify', classification: decision.kind, candidate_story: story.key, session_id: owner, outcome: 'baseline required' });
      return finish(run, 'OK');
    }

    // Clean tree: decide the hand-over to attach / start.
    let headTrailers: Record<string, string[]> = {};
    try {
      headTrailers = await run.deps.git.commitTrailers(worktree, state.head);
    } catch {
      headTrailers = {};
    }
    const gb = headTrailers[TRAILER_GOVERNED_BY] ?? [];
    const adoptedHead = gb.length > 0 && gb.every((v) => v === story.key) && (headTrailers[TRAILER_GOV_PACKET] ?? []).length === 0;
    let handover: { verb: 'attach' | 'start'; argv: string[] } | null = null;
    if (owner !== null) {
      if (adoptedHead) handover = { verb: 'attach', argv: ['--story', story.key, '--session', owner, '--worktree', worktree] };
      else if (state.changed_since_base.length === 0) handover = { verb: 'attach', argv: ['--story', story.key, '--session', owner, '--worktree', worktree, '--base', state.head] };
    } else if (state.changed_since_base.length === 0) {
      handover = { verb: 'start', argv: ['--story', story.key, '--slug', slugFrom(story.summary), '--repo', worktree, '--base', state.head] };
    }
    if (handover === null) {
      run.io.out(`HEAD carries ${state.changed_since_base.length} pre-governance commit(s) since the merge-base. Make an adoption baseline (human), then bind:`);
      for (const c of baselineCommands(state.worktree, story.key, story.summary, true)) run.io.out(`  ${c}`);
      run.io.out(`  ${GOV} intake --worktree ${quoteIfNeeded(state.worktree)} --session ${owner ?? '<uuid of the owning session>'} --story ${story.key} --bind`);
      audit({ event: 'classify', classification: decision.kind, candidate_story: story.key, session_id: owner, outcome: 'baseline required' });
      return finish(run, 'OK');
    }
    const display = `${GOV} ${handover.verb} ${handover.argv.map((a) => quoteIfNeeded(posix(a))).join(' ')}`;
    if (!bind) {
      run.io.out('Next step (or re-run intake with --bind to do it now):');
      run.io.out(`  ${display}`);
      audit({ event: 'classify', classification: decision.kind, candidate_story: story.key, session_id: owner, outcome: `next: ${handover.verb}` });
      return finish(run, 'OK');
    }
    run.io.out(`Binding through the existing gov ${handover.verb}:`);
    let code: number;
    try {
      code = handover.verb === 'attach' ? await cmdAttach(run, handover.argv) : await cmdStart(run, handover.argv);
    } catch (err) {
      audit({ event: 'bind', classification: decision.kind, candidate_story: story.key, session_id: owner, outcome: `${handover.verb} refused: ${(err as Error).message}` });
      throw err;
    }
    audit({
      event: 'bind',
      classification: decision.kind,
      candidate_story: story.key,
      session_id: (run.result.session_id as string | undefined) ?? owner,
      packet_hash: (run.result.packet_hash as string | undefined) ?? null,
      adoption_classification: run.result.adoption_baseline ? ADOPTION_CLASSIFICATION : null,
      outcome: `${handover.verb} exit ${code}`,
    });
    return code;
  }

  // 3./4. NEW_WORK or adoption without a Story → proposal (nothing is created in Jira).
  const proposal = decision.proposal!;
  const stored = storeProposal(layout, proposal);
  Object.assign(run.result, { proposal_hash: stored.proposal_hash, label: stored.label, proposal_md: intakeProposalMd(layout, stored.proposal_hash) });
  if (decision.kind === 'PRE_GOVERNANCE_ADOPTION') {
    run.io.out('PRE-GOVERNANCE ADOPTION: no Story covers this work; an adoption baseline will be required after the Story exists.');
    run.io.out(`Subject: ${decision.subject ?? '(unknown)'} · owner session: ${decision.owner}`);
  }
  run.io.out('');
  for (const line of renderProposalMarkdown(stored).split('\n')) run.io.out(line);
  run.io.out(`Proposal stored: ${intakeProposalMd(layout, stored.proposal_hash)}`);
  run.io.out('To approve, YOU run (interactive terminal, your own Jira identity in GOV_INTAKE_EMAIL / GOV_INTAKE_TOKEN):');
  run.io.out(`  ${GOV} intake --apply ${stored.proposal_hash}`);
  audit({ event: 'classify', classification: decision.kind, proposal_hash: stored.proposal_hash, label: stored.label, session_id: decision.owner, outcome: 'proposal stored' });
  return finish(run, 'OK');
}

/**
 * `gov admit` — explicit, read-only admission. Identifies which live Claude Code session is asking
 * (admission.ts), classifies the work with intake's own gathering and classifier, and prints the
 * exact next gov command. It never stores a proposal, writes the intake audit, binds, calls Jira
 * for anything but GETs, commits, invokes JEV, or executes the command it prints: the user decides.
 */
async function cmdAdmit(run: Run, argv: string[]): Promise<number> {
  const wtArg = flag(argv, '--worktree');
  if (has(argv, '--worktree') && wtArg === null) return usage(run, '--worktree needs a path');
  const sessionArg = flag(argv, '--session');
  if (has(argv, '--session') && (sessionArg === null || !SESSION_ID_RE.test(sessionArg))) return usage(run, '--session needs a lowercase uuid');
  const baseRef = flag(argv, '--base') ?? DEFAULT_BASE_REF;
  if (has(argv, '--base') && flag(argv, '--base') === null) return usage(run, '--base needs a ref');
  const worktree = path.resolve(wtArg ?? process.cwd());
  run.result.admit = true;
  run.result.next_command = null;
  const NOTHING = 'Admission is read-only: nothing was bound, stored, created, committed or executed.';
  const refuseAs = (classification: string, code: string, message: string, details: string[] = []): never => {
    Object.assign(run.result, { classification, refusal: code });
    run.io.out(`Classification: ${classification}`);
    run.io.err(`Admission refused [${code}]: ${message}`);
    for (const d of details.slice(0, MAX_LISTED)) run.io.err(`  ${d}`);
    run.io.out(NOTHING);
    throw new Outcome('REFUSED', 'admission refused; nothing changed');
  };

  // 1. Who is asking — from agreeing evidence, never inferred from a cwd.
  let port: SessionEvidencePort;
  try {
    port = run.deps.sessionEvidence(run.env);
  } catch {
    return refuseAs('UNSUPPORTED', 'REGISTRY_UNAVAILABLE', 'the session evidence cannot be read');
  }
  const strict = readStrictSessions(port);
  const admitted = resolveAdmittedSession(run.env, strict, sessionArg);
  if (admitted.ok === false) {
    return refuseAs('UNSUPPORTED', admitted.code, admitted.message, admitted.code === 'SELF_ID_UNAVAILABLE' ? ['Admission never falls back to the working directory.'] : []);
  }
  const self = admitted.session_id;
  Object.assign(run.result, { session_id: self, pid: admitted.pid, identity_source: admitted.source, proc_start_checked: admitted.proc_start_checked });
  run.io.out(`Session: ${self} (pid ${admitted.pid}; ${admitted.source === 'self' ? 'identified from this process: registry, pid and socket agree' : 'explicit --session, validated against the live registry'})`);
  if (!admitted.proc_start_checked) run.io.out('  (process start not compared: not knowable here without launching a process; the session-pipe check only mitigates PID reuse — F-9)');
  const live = strict.ok ? strict.live.map((r) => ({ session_id: r.session_id, cwd: r.cwd, status: r.status, pid: r.pid })) : [];

  // 2. What the work is — intake's own gathering and classifier, with nothing stored.
  const layout = layoutOf(run);
  let gathered: Awaited<ReturnType<typeof gatherIntake>>;
  try {
    gathered = await gatherIntake(run, layout, {
      worktree,
      baseRef,
      sessionArg: self,
      storyFlag: null,
      readLive: () => live,
      options: { intent: null, authorized: [], prohibited: [], verification: [], judgmentAcs: [], authorizations: [] },
    });
  } catch (err) {
    if (err instanceof Outcome && err.status === 'REFUSED') return refuseAs('UNSUPPORTED', 'NOT_ADMISSIBLE', err.message);
    throw err;
  }
  const { state, decision } = gathered;
  const sessionBinding = findBySession(layout, self);
  run.io.out(`Session binding: ${sessionBinding ? `${sessionBinding.story_key} (${sessionBinding.mode}) in ${sessionBinding.worktree}` : 'none'}`);
  const wt = quoteIfNeeded(state.worktree);
  const next = (lines: string[], command: string) => {
    run.result.next_command = command;
    run.io.out('Next governed step — run it ONLY after the user explicitly says yes:');
    for (const l of lines) run.io.out(`  ${l}`);
    run.io.out(`  ${command}`);
    run.io.out(NOTHING);
    return finish(run, 'OK');
  };

  if (decision.kind === 'REFUSED') {
    if (NEW_WORK_INPUT_CODES.includes(decision.code)) {
      run.result.classification = 'NEW_WORK';
      run.io.out('Classification: NEW_WORK (no Story covers this work; a proposal needs its intent and scope)');
      return next(['Describe the work, then propose a Story (the proposal is stored; Story creation stays the human --apply):'], `${GOV} intake --worktree ${wt} --session ${self} --intent "<what this work is>" [--authorized <path>]... [--verification <id>]...`);
    }
    return refuseAs(decision.code, decision.code, decision.message, decision.details);
  }
  run.result.classification = decision.kind;
  run.io.out(`Classification: ${decision.kind}`);

  if (decision.kind === 'GOVERNED_RESUME') {
    const b = decision.binding;
    Object.assign(run.result, { story: b.story_key, packet_hash: b.packet_hash });
    run.io.out(`Story: ${b.story_key} · packet ${b.packet_hash} · base ${b.base_commit}`);
    if (b.adoption) run.io.out(`Adoption baseline: ${b.adoption.baseline_commit} (${b.adoption.classification})`);
    return next(['Already governed by this session. Confirm the packet is current, then continue the work:'], `${GOV} packet --story ${b.story_key} --worktree ${wt}`);
  }
  if (decision.kind === 'EXISTING_STORY') {
    run.result.story = decision.story.key;
    run.io.out(`Story: ${decision.story.key} — ${decision.story.summary}`);
    return next(['Bind this session to the existing Story through intake (it re-checks everything, then runs gov attach/start):'], `${GOV} intake --worktree ${wt} --session ${self} --story ${decision.story.key} --bind`);
  }
  // PRE_GOVERNANCE_ADOPTION / NEW_WORK with a proposal (admission never stores it).
  if (decision.candidate !== null) {
    run.result.story = decision.candidate.key;
    run.io.out(`Story: ${decision.candidate.key} — ${decision.candidate.summary}`);
    run.io.out(`Subject: ${decision.subject ?? '(unknown)'} · uncommitted paths: ${state.dirty_files.length}`);
    return next(
      ['A HUMAN first commits the adoption baseline (never Claude):', ...baselineCommands(state.worktree, decision.candidate.key, decision.candidate.summary, false).map((c) => `  ${c}`), 'Then bind:'],
      `${GOV} intake --worktree ${wt} --session ${self} --story ${decision.candidate.key} --bind`,
    );
  }
  run.io.out(`Subject: ${decision.subject ?? '(unknown)'} · no Story covers this work`);
  return next(['Propose a Story for it (the proposal is stored; Story creation stays the human --apply):'], `${GOV} intake --worktree ${wt} --session ${self}`);
}

function intakeProposalMd(layout: GovLayout, hash: Sha256Ref): string {
  return path.join(layout.home, 'intake', 'proposals', `${hash.slice('sha256:'.length)}.md`);
}

/**
 * `gov intake --check-forms` — read-only: under the human's own Jira identity, confirm the OMNI
 * Story and Acceptance Criterion create forms are intake-safe. GET requests only; creates nothing.
 */
async function cmdIntakeCheckForms(run: Run): Promise<number> {
  run.result.intake = true;
  run.result.check_forms = true;
  const layout = layoutOf(run);
  const creds = resolveIntakeCredentials(run.env);
  if (creds.ok === false) throw new Outcome('REFUSED', creds.message);
  const fresh = await checkIntakeCredentialFreshness(run.env, run.deps.readUserEnv);
  if (fresh.ok === false) throw new Outcome('REFUSED', fresh.message);
  let forms: FormsCheck;
  try {
    forms = await checkCreateForms(run.deps.intakeJira(creds.credentials), STORY_ALWAYS_SENT, AC_ALWAYS_SENT);
  } catch (err) {
    throw new Outcome('ERROR', `Jira read failed: ${(err as Error & { code?: string }).code ?? (err as Error).message}`);
  }
  for (const [kind, form] of [['story', forms.story_form], ['ac', forms.ac_form]] as const) {
    if (form.length === 0) continue;
    run.io.out(`${kind === 'story' ? 'Story' : 'Acceptance Criterion'} create form (${form.length} field(s)):`);
    for (const f of form) {
      const allowed = (kind === 'story' ? STORY_CREATE_FIELDS : AC_CREATE_FIELDS).includes(f.fieldId) || createFormImplicit(kind).includes(f.fieldId);
      const verdict = isGateField(f.fieldId, f.name) ? 'GATE — must be removed' : allowed ? 'allowed' : 'NOT ALLOWED — must be removed';
      run.io.out(`  ${f.fieldId} | ${f.name}${f.required ? ' (required)' : ''} | ${verdict}`);
    }
  }
  for (const p of forms.problems) run.io.err(`  - ${p}`);
  Object.assign(run.result, { forms_ok: forms.ok, problems: forms.problems.length, refusal: forms.refusal });
  appendIntakeAudit(layout, { event: 'check-forms', approved_by: forms.approved_by, outcome: forms.ok ? 'create forms intake-safe' : `${forms.refusal}: ${forms.problems.length} problem(s)` }, run.deps.now);
  if (!forms.ok) throw new Outcome('REFUSED', forms.message);
  return finish(run, 'OK', forms.message);
}

async function cmdIntakeApply(run: Run, argv: string[]): Promise<number> {
  const hash = flag(argv, '--apply');
  if (hash === null) return usage(run, '--apply needs sha256:<proposal hash>');
  run.result.intake = true;
  run.result.proposal_hash = hash;
  const layout = layoutOf(run);
  let stored;
  try {
    stored = loadProposal(layout, hash);
  } catch (err) {
    const msg = (err as Error).message;
    throw new Outcome(msg.startsWith('INTEGRITY_FAILED') ? 'INTEGRITY_FAILED' : 'REFUSED', msg);
  }
  const p = stored.proposal;
  const auditBase = { worktree: p.worktree, branch: p.branch, head: p.head, merge_base: p.merge_base, session_id: p.session_id, proposal_hash: stored.proposal_hash, label: stored.label, classification: p.classification };
  const refuse = (message: string): never => {
    appendIntakeAudit(layout, { ...auditBase, event: 'apply', outcome: `refused: ${message}` }, run.deps.now);
    throw new Outcome('REFUSED', `${message}; nothing was created`);
  };
  if (run.deps.isInteractive() !== true) refuse('--apply needs an interactive terminal: a human approves by typing the proposal hash');
  const creds = resolveIntakeCredentials(run.env);
  if (creds.ok === false) refuse(creds.message);
  const fresh = await checkIntakeCredentialFreshness(run.env, run.deps.readUserEnv);
  if (fresh.ok === false) refuse(fresh.message);
  for (const line of renderProposalMarkdown(stored).split('\n')) run.io.out(line);
  const typed = (await run.deps.prompt('Type the full proposal hash to approve creating this Story in Jira: ')).trim();
  if (typed !== stored.proposal_hash) refuse('the typed hash does not match the proposal');

  const res = await applyIntakeProposal(stored, run.deps.intakeJira((creds as { credentials: JiraCredentials }).credentials));
  Object.assign(run.result, { story: res.story_key, created_story: res.created_story, created_acs: res.created_acs, reused_acs: res.reused_acs });
  appendIntakeAudit(
    layout,
    {
      ...auditBase,
      event: 'apply',
      story_key: res.story_key,
      created_acs: res.created_acs,
      reused_acs: res.reused_acs,
      approved_by: res.approved_by,
      outcome: res.ok ? res.message : `${res.refusal}: ${res.message}`,
    },
    run.deps.now,
  );
  if (!res.ok) {
    if (res.story_key) run.io.err(`Partial: ${res.story_key} exists; created ACs ${res.created_acs.join(', ') || 'none'}. Re-running --apply reuses them.`);
    throw new Outcome(res.refusal === 'JIRA_ERROR' ? 'ERROR' : 'REFUSED', res.message);
  }
  const key = res.story_key!;
  run.io.out(`Applied: ${res.message} (approved by ${res.approved_by?.display_name ?? 'unknown'})`);
  run.io.out('Next:');
  if (p.classification === 'PRE_GOVERNANCE_ADOPTION') {
    run.io.out('  1. Make the adoption baseline (you):');
    for (const c of baselineCommands(p.worktree, key, p.story.summary, false)) run.io.out(`     ${c}`);
    run.io.out('  2. Bind the existing session (it keeps running; no restart):');
    run.io.out(`     ${GOV} intake --worktree ${quoteIfNeeded(p.worktree)} --session ${p.session_id ?? '<uuid>'} --story ${key} --bind`);
  } else {
    run.io.out(`  ${GOV} intake --worktree ${quoteIfNeeded(p.worktree)}${p.session_id ? ` --session ${p.session_id}` : ''} --story ${key} --bind`);
  }
  return finish(run, 'OK');
}

function usage(run: Run, message?: string): number {
  if (message) run.io.err(message);
  run.io.err(USAGE);
  run.io.err(INTAKE_USAGE);
  run.io.err(AUDIT_USAGE);
  run.io.err(ADMIT_USAGE);
  run.io.err(RECONCILE_USAGE);
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
    ready: cmdReady,
    start: cmdStart,
    attach: cmdAttach,
    packet: cmdPacket,
    verify: cmdVerify,
    judge: cmdJudge,
    submit: cmdSubmit,
    'check-merge': cmdCheckMerge,
    intake: cmdIntake,
    'audit-branch': cmdAuditBranch,
    admit: cmdAdmit,
    reconcile: cmdReconcile,
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
