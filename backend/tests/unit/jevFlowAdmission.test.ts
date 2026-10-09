/**
 * OMNI-38 — governed session admission (`gov admit`).
 *
 * Hermetic: the Claude Code session evidence (registry, pid liveness, pipe namespace, process
 * start) is an injected fake; git work runs in throwaway repos under os.tmpdir(); GOV_HOME and the
 * transcripts directory are temp dirs; Jira is the same in-memory reader fake the intake suite
 * uses. Nothing launches claude, reaches JEV or writes Jira. Every CLI case proves admission left
 * the repo, GOV_HOME and the transcripts byte-identical.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ts from 'typescript';
import { AC_FIELDS, STORY_FIELDS } from '../../../scripts/jev-jira/fields';
import type { JiraClient, JiraCredentials, JiraIssue, JiraPermissionProbe } from '../../../scripts/jev-jira/jiraClient';
import { STORY_AUTHORIZED_PATHS_FIELD, type JiraQuery } from '../../../scripts/jev-flow/jiraQuery';
import { validateRegistry } from '../../../scripts/jev-flow/registry';
import { GOV_EXIT, createIntakeProbe, runGov, type GovDeps } from '../../../scripts/jev-flow/cli';
import { bindSession } from '../../../scripts/jev-flow/binding';
import { validateIntakeRules, type IntakeRules } from '../../../scripts/jev-flow/intake';
import { createSessionEvidencePort, readLiveSessions } from '../../../scripts/jev-flow/intakeProbe';
import {
  NEW_WORK_INPUT_CODES,
  PROC_START_WINDOW_MS,
  filetimeToMs,
  parseSessionRecord,
  pipeName,
  readStrictSessions,
  resolveAdmittedSession,
  type SessionEvidencePort,
  type StrictSessions,
} from '../../../scripts/jev-flow/admission';
import { govLayout, type VerificationRegistry } from '../../../scripts/jev-flow/types';

jest.setTimeout(180000);

const SELF = '0f1e2d3c-4b5a-4968-8776-655443322110';
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FORK = '2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e';
const SELF_PID = 4242;
const OTHER_PID = 5151;
const FORK_PID = 6161;
const STARTED = Date.parse('2026-10-09T06:13:05.687Z');
// Built at runtime; never credential-shaped.
const READER_TOKEN = ['reader', 'test', 'value'].join('-');
const SECRET_TOKEN = ['messaging', 'secret', 'value'].join('-');
const PIPE_ROOT = '\\\\.\\pipe\\';
const pipeOf = (n: number) => `LOCAL\\cc-msg-${n.toString(16).padStart(8, '0')}${'ab'.repeat(8)}`;
const socketOf = (n: number) => `${PIPE_ROOT}${pipeOf(n)}`;
const filetime = (ms: number) => ((BigInt(ms) + 11644473600000n) * 10000n + 1234n).toString();

const REGISTRY: VerificationRegistry = validateRegistry({
  schema: 'gov-registry/1',
  entries: [
    { id: 't.pass', description: 'unit tests', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'test_run', timeout_ms: 60000 },
    { id: 't.types', description: 'typecheck', argv: ['node', '-e', 'process.exit(0)'], evidence_kind: 'typecheck', timeout_ms: 60000 },
  ],
});
const RULES: IntakeRules = validateIntakeRules(
  {
    schema: 'gov-intake-rules/1',
    default_prohibited_paths: ['supabase/migrations/**', '.claude/settings*.json', '.env*'],
    verification_mappings: [{ paths: ['src/**'], registry_ids: ['t.pass', 't.types'] }],
  },
  REGISTRY,
);

// ---------------------------------------------------------------- session evidence fake

interface RecordSpec {
  pid: number;
  sid: string;
  cwd?: string | null;
  procStart?: string;
  startedAt?: number;
  socket?: string;
}
function recordText(r: RecordSpec, override: Record<string, unknown> = {}): string {
  const started = r.startedAt ?? STARTED;
  return JSON.stringify({
    pid: r.pid,
    sessionId: r.sid,
    cwd: r.cwd === undefined ? 'C:\\virality' : r.cwd,
    startedAt: started,
    procStart: r.procStart ?? filetime(started - 3400),
    kind: 'interactive',
    entrypoint: 'cli',
    messagingSocketPath: r.socket ?? socketOf(r.pid),
    status: 'idle',
    ...override,
  });
}

class FakeEvidence implements SessionEvidencePort {
  files = new Map<string, string | Error>();
  alive = new Set<number>();
  pipes = new Set<string>();
  starts = new Map<number, string | null | 'unsupported' | Error>();
  listError: Error | null = null;
  pipesError: Error | null = null;
  aliveError: Error | null = null;
  readonly calls: string[] = [];
  /** A live session: record + live pid + listed pipe. */
  add(spec: RecordSpec, opts: { alive?: boolean; piped?: boolean } = {}): this {
    this.files.set(`${spec.pid}.json`, recordText(spec));
    if (opts.alive !== false) this.alive.add(spec.pid);
    if (opts.piped !== false) this.pipes.add(pipeName(spec.socket ?? socketOf(spec.pid)) as string);
    return this;
  }
  registry = {
    list: (): string[] => {
      this.calls.push('list');
      if (this.listError) throw this.listError;
      return [...this.files.keys()];
    },
    read: (file: string): string => {
      this.calls.push(`read ${file}`);
      const v = this.files.get(file);
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (v instanceof Error) throw v;
      return v;
    },
  };
  isPidAlive(pid: number): boolean {
    if (this.aliveError) throw this.aliveError;
    return this.alive.has(pid);
  }
  listPipes(): ReadonlySet<string> {
    if (this.pipesError) throw this.pipesError;
    return new Set(this.pipes);
  }
  processStart(pid: number): string | null | 'unsupported' {
    const v = this.starts.has(pid) ? this.starts.get(pid)! : 'unsupported';
    if (v instanceof Error) throw v;
    return v;
  }
}

const selfEnv = (sid = SELF, pid = SELF_PID, socket = socketOf(pid)): Record<string, string> => ({
  CLAUDE_CODE_SESSION_ID: sid,
  CLAUDE_PID: String(pid),
  CLAUDE_CODE_MESSAGING_SOCKET: socket,
});

const standard = () => new FakeEvidence().add({ pid: SELF_PID, sid: SELF }).add({ pid: OTHER_PID, sid: OTHER });

// ================================================================ strict liveness reader (direct)

describe('readStrictSessions — strict liveness, never "no sessions" on error', () => {
  it('a live session needs a valid record, a live pid AND its listed pipe', () => {
    const r = readStrictSessions(standard());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.live.map((x) => [x.pid, x.session_id])).toEqual([
        [SELF_PID, SELF],
        [OTHER_PID, OTHER],
      ]);
      expect(r.stale).toBe(0);
      expect(r.proc_start_checked).toBe(false);
    }
  });

  it('1/2. a missing or unreadable registry directory refuses (REGISTRY_UNAVAILABLE), unlike the lax intake reader', () => {
    const e = standard();
    e.listError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'REGISTRY_UNAVAILABLE' });
    e.listError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'REGISTRY_UNAVAILABLE' });
    // The lax reader intake keeps using is unchanged: a missing directory reads as no sessions.
    expect(readLiveSessions({ CLAUDE_SESSIONS_DIR: path.join(os.tmpdir(), `gov-admit-missing-${process.pid}-${Date.now()}`) })).toEqual([]);
  });

  it('3/4. a listed record that cannot be read refuses (REGISTRY_RECORD_UNREADABLE)', () => {
    const e = standard();
    e.files.set(`${OTHER_PID}.json`, Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'REGISTRY_RECORD_UNREADABLE' });
  });

  it('the pipe namespace that cannot be enumerated refuses (LIVENESS_UNVERIFIABLE)', () => {
    const e = standard();
    e.pipesError = new Error('unsupported');
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'LIVENESS_UNVERIFIABLE' });
  });

  it('a liveness probe that throws refuses (LIVENESS_UNVERIFIABLE)', () => {
    const e = standard();
    e.aliveError = new Error('EINVAL');
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'LIVENESS_UNVERIFIABLE' });
  });

  it.each([
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['pid null', recordText({ pid: OTHER_PID, sid: OTHER }, { pid: null })],
    ['pid as a string', recordText({ pid: OTHER_PID, sid: OTHER }, { pid: String(OTHER_PID) })],
    ['pid zero', recordText({ pid: OTHER_PID, sid: OTHER }, { pid: 0 })],
    ['no session id', recordText({ pid: OTHER_PID, sid: OTHER }, { sessionId: undefined })],
    ['an uppercase session id', recordText({ pid: OTHER_PID, sid: OTHER.toUpperCase() })],
    ['no messaging socket', recordText({ pid: OTHER_PID, sid: OTHER }, { messagingSocketPath: undefined })],
    ['a socket that is not a named pipe', recordText({ pid: OTHER_PID, sid: OTHER, socket: '/tmp/cc.sock' })],
    ['no procStart', recordText({ pid: OTHER_PID, sid: OTHER }, { procStart: undefined })],
    ['a numeric procStart (precision lost)', recordText({ pid: OTHER_PID, sid: OTHER }, { procStart: 134359999822787940 })],
    ['a procStart after startedAt', recordText({ pid: OTHER_PID, sid: OTHER, procStart: filetime(STARTED + 60_000) })],
    ['a procStart long before startedAt', recordText({ pid: OTHER_PID, sid: OTHER, procStart: filetime(STARTED - PROC_START_WINDOW_MS - 60_000) })],
    ['no startedAt', recordText({ pid: OTHER_PID, sid: OTHER }, { startedAt: undefined })],
    ['a non-string cwd', recordText({ pid: OTHER_PID, sid: OTHER }, { cwd: 42 })],
  ])('5/6/7. a malformed record (%s) refuses REGISTRY_RECORD_INVALID — even when it is not ours', (_label, text) => {
    const e = standard();
    e.files.set(`${OTHER_PID}.json`, text);
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'REGISTRY_RECORD_INVALID' });
  });

  it('7. a record whose pid differs from its file name refuses (PID_MISMATCH)', () => {
    const e = standard();
    e.files.set(`${OTHER_PID}.json`, recordText({ pid: OTHER_PID + 1, sid: OTHER }));
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'PID_MISMATCH' });
  });

  it('a .json file not named <pid>.json refuses; non-.json files are not records', () => {
    const e = standard();
    e.files.set('README.txt', 'not a record');
    expect(readStrictSessions(e).ok).toBe(true);
    e.files.set('notes.json', '{}');
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'REGISTRY_RECORD_INVALID' });
  });

  it('8. a dead pid with no pipe is stale: skipped, never a live session', () => {
    const e = standard().add({ pid: 7777, sid: FORK }, { alive: false, piped: false });
    const r = readStrictSessions(e);
    expect(r).toMatchObject({ ok: true, stale: 1 });
    if (r.ok) expect(r.live.map((x) => x.session_id)).not.toContain(FORK);
  });

  it('9. a live pid whose session pipe is gone is a reused pid (PID_REUSED)', () => {
    const e = standard().add({ pid: 7777, sid: FORK }, { alive: true, piped: false });
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'PID_REUSED' });
  });

  it('a listed pipe whose pid is not running cannot be verified (LIVENESS_UNVERIFIABLE)', () => {
    const e = standard().add({ pid: 7777, sid: FORK }, { alive: false, piped: true });
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'LIVENESS_UNVERIFIABLE' });
  });

  it('10. where the actual process start is knowable it must equal procStart (else PID_REUSED)', () => {
    const e = standard();
    const rec = parseSessionRecord(`${SELF_PID}.json`, e.files.get(`${SELF_PID}.json`) as string);
    if (rec.ok === false) throw new Error('fixture');
    e.starts.set(SELF_PID, rec.record.proc_start);
    e.starts.set(OTHER_PID, filetime(STARTED - 3400).replace(/4$/, '5'));
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'PID_REUSED' });
    const r2 = parseSessionRecord(`${OTHER_PID}.json`, e.files.get(`${OTHER_PID}.json`) as string);
    if (r2.ok === false) throw new Error('fixture');
    e.starts.set(OTHER_PID, r2.record.proc_start);
    expect(readStrictSessions(e)).toMatchObject({ ok: true, proc_start_checked: true });
  });

  it('12. a process start that should be knowable but cannot be established refuses (null or a throwing probe)', () => {
    const e = standard();
    e.starts.set(OTHER_PID, null);
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'LIVENESS_UNVERIFIABLE' });
    e.starts.set(OTHER_PID, new Error('probe failed'));
    expect(readStrictSessions(e)).toMatchObject({ ok: false, code: 'LIVENESS_UNVERIFIABLE' });
  });

  it('pure helpers: pipe names and FILETIME conversion are exact', () => {
    expect(pipeName(socketOf(1))).toBe(pipeOf(1));
    expect(pipeName('/tmp/x.sock')).toBeNull();
    expect(pipeName(PIPE_ROOT)).toBeNull();
    expect(filetimeToMs(filetime(STARTED))).toBe(STARTED);
    expect(filetimeToMs('12')).toBeNull();
    expect(filetimeToMs('0134359999822787946')).toBeNull();
  });

  it('refusal messages never carry the socket path', () => {
    const e = standard().add({ pid: 7777, sid: FORK }, { alive: true, piped: false });
    expect(JSON.stringify(readStrictSessions(e))).not.toContain('cc-msg-');
  });
});

// ================================================================ the default evidence port (real fs, temp dirs)

describe('createSessionEvidencePort — the production port lists and reads, and throws instead of hiding failure', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  afterEach(() => Object.defineProperty(process, 'platform', realPlatform));

  it('lists and reads registry records from CLAUDE_SESSIONS_DIR', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-admit-reg-'));
    try {
      fs.writeFileSync(path.join(dir, `${SELF_PID}.json`), recordText({ pid: SELF_PID, sid: SELF }));
      const port = createSessionEvidencePort({ CLAUDE_SESSIONS_DIR: dir });
      expect(port.registry.list()).toEqual([`${SELF_PID}.json`]);
      expect(parseSessionRecord(`${SELF_PID}.json`, port.registry.read(`${SELF_PID}.json`)).ok).toBe(true);
      expect(() => port.registry.read('999999.json')).toThrow();
      expect(port.processStart(SELF_PID)).toBe('unsupported');
      expect(port.isPidAlive(process.pid)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a missing registry directory throws (and so refuses), never reads as no sessions', () => {
    const port = createSessionEvidencePort({ CLAUDE_SESSIONS_DIR: path.join(os.tmpdir(), `gov-admit-none-${process.pid}-${Date.now()}`) });
    expect(() => port.registry.list()).toThrow();
    expect(readStrictSessions(port)).toMatchObject({ ok: false, code: 'REGISTRY_UNAVAILABLE' });
  });

  it('outside Windows the pipe namespace is unavailable, so liveness refuses', () => {
    Object.defineProperty(process, 'platform', { ...realPlatform, value: 'linux' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-admit-reg-'));
    try {
      const port = createSessionEvidencePort({ CLAUDE_SESSIONS_DIR: dir });
      expect(() => port.listPipes()).toThrow();
      expect(readStrictSessions(port)).toMatchObject({ ok: false, code: 'LIVENESS_UNVERIFIABLE' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  (process.platform === 'win32' ? it : it.skip)('on Windows the pipe namespace is enumerated', () => {
    expect(createSessionEvidencePort({}).listPipes()).toBeInstanceOf(Set);
  });
});

// ================================================================ self-identification (direct)

describe('resolveAdmittedSession — fail-closed self-identification', () => {
  const sessions = (e: FakeEvidence = standard()): StrictSessions => readStrictSessions(e);

  it('proven self: env session id, registry record, live pid and socket agree', () => {
    expect(resolveAdmittedSession(selfEnv(), sessions(), null)).toMatchObject({ ok: true, session_id: SELF, pid: SELF_PID, source: 'self' });
  });

  it('missing self-ID with no --session → SELF_ID_UNAVAILABLE (never the cwd)', () => {
    const r = resolveAdmittedSession({}, sessions(), null);
    expect(r).toMatchObject({ ok: false, code: 'SELF_ID_UNAVAILABLE' });
  });

  it.each([
    ['no session id', { CLAUDE_PID: String(SELF_PID), CLAUDE_CODE_MESSAGING_SOCKET: socketOf(SELF_PID) }],
    ['no pid', { CLAUDE_CODE_SESSION_ID: SELF, CLAUDE_CODE_MESSAGING_SOCKET: socketOf(SELF_PID) }],
    ['no socket', { CLAUDE_CODE_SESSION_ID: SELF, CLAUDE_PID: String(SELF_PID) }],
    ['a malformed session id', { ...selfEnv(), CLAUDE_CODE_SESSION_ID: 'not-a-uuid' }],
    ['a malformed pid', { ...selfEnv(), CLAUDE_PID: '0x10' }],
  ])('incomplete self-ID (%s) refuses SELF_ID_INCOMPLETE and never falls back to --session', (_l, env) => {
    expect(resolveAdmittedSession(env, sessions(), null)).toMatchObject({ ok: false, code: 'SELF_ID_INCOMPLETE' });
    expect(resolveAdmittedSession(env, sessions(), SELF)).toMatchObject({ ok: false, code: 'SELF_ID_INCOMPLETE' });
  });

  it('env session id disagreeing with the registry → SESSION_MISMATCH', () => {
    expect(resolveAdmittedSession(selfEnv(OTHER), sessions(), null)).toMatchObject({ ok: false, code: 'SESSION_MISMATCH' });
  });

  it('registry/socket disagreement → SOCKET_MISMATCH', () => {
    expect(resolveAdmittedSession(selfEnv(SELF, SELF_PID, socketOf(OTHER_PID)), sessions(), null)).toMatchObject({ ok: false, code: 'SOCKET_MISMATCH' });
  });

  it('a pid with no live record (dead, stale or unknown) → PROCESS_NOT_LIVE', () => {
    const e = new FakeEvidence().add({ pid: SELF_PID, sid: SELF }, { alive: false, piped: false });
    expect(resolveAdmittedSession(selfEnv(), sessions(e), null)).toMatchObject({ ok: false, code: 'PROCESS_NOT_LIVE' });
    expect(resolveAdmittedSession(selfEnv(SELF, 9999), sessions(), null)).toMatchObject({ ok: false, code: 'PROCESS_NOT_LIVE' });
  });

  it('a strict-reader refusal is passed through unchanged', () => {
    const e = standard();
    e.listError = new Error('EACCES');
    expect(resolveAdmittedSession(selfEnv(), sessions(e), null)).toMatchObject({ ok: false, code: 'REGISTRY_UNAVAILABLE' });
  });

  it('--session equal to the proven self is accepted; any other session is refused (forks gain no authority)', () => {
    const e = standard().add({ pid: FORK_PID, sid: FORK });
    expect(resolveAdmittedSession(selfEnv(), sessions(e), SELF)).toMatchObject({ ok: true, source: 'self' });
    // A fork (its own env) asking as its origin.
    expect(resolveAdmittedSession(selfEnv(FORK, FORK_PID), sessions(e), SELF)).toMatchObject({ ok: false, code: 'SESSION_MISMATCH' });
    expect(resolveAdmittedSession(selfEnv(), sessions(e), OTHER)).toMatchObject({ ok: false, code: 'SESSION_MISMATCH' });
    expect(resolveAdmittedSession(selfEnv(), sessions(e), 'NOT-A-UUID')).toMatchObject({ ok: false, code: 'SESSION_MISMATCH' });
  });

  it('with no self evidence at all, --session gets the same live-registry validation', () => {
    expect(resolveAdmittedSession({}, sessions(), OTHER)).toMatchObject({ ok: true, session_id: OTHER, pid: OTHER_PID, source: 'explicit' });
    // forged: not in the registry
    expect(resolveAdmittedSession({}, sessions(), FORK)).toMatchObject({ ok: false, code: 'SESSION_NOT_LIVE' });
    // stale: its process is gone
    const stale = standard().add({ pid: 7777, sid: FORK }, { alive: false, piped: false });
    expect(resolveAdmittedSession({}, sessions(stale), FORK)).toMatchObject({ ok: false, code: 'SESSION_NOT_LIVE' });
    // reused pid: the whole registry refuses
    const reused = standard().add({ pid: 7777, sid: FORK }, { alive: true, piped: false });
    expect(resolveAdmittedSession({}, sessions(reused), FORK)).toMatchObject({ ok: false, code: 'PID_REUSED' });
    // two live records claiming one session id
    const twice = standard().add({ pid: 7777, sid: OTHER });
    expect(resolveAdmittedSession({}, sessions(twice), OTHER)).toMatchObject({ ok: false, code: 'SESSION_AMBIGUOUS' });
    expect(resolveAdmittedSession(selfEnv(OTHER, OTHER_PID), sessions(twice), null)).toMatchObject({ ok: false, code: 'SESSION_AMBIGUOUS' });
  });
});

// ================================================================ CLI harness

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs.reverse()) fs.rmSync(d, { recursive: true, force: true });
});
function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}
function write(dir: string, rel: string, text: string): void {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
}
function commit(dir: string, files: Record<string, string>): string {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'work');
  return sh(dir, 'rev-parse', 'HEAD');
}
function repo(featureFiles: Record<string, string> | null = null): string {
  const r = tmp('gov-admit-repo-');
  sh(r, 'init', '-q', '-b', 'main');
  sh(r, 'config', 'user.email', 'gov-test@example.invalid');
  sh(r, 'config', 'user.name', 'gov test');
  sh(r, 'config', 'commit.gpgsign', 'false');
  commit(r, { 'README.md': 'base\n' });
  sh(r, 'checkout', '-q', '-b', 'feature/x');
  if (featureFiles) commit(r, featureFiles);
  return r;
}
function treeHash(dir: string): string {
  const h = crypto.createHash('sha256');
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        h.update(path.relative(dir, p));
        h.update(fs.readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}
/** HEAD, refs, index, stash, status and every byte (including .git) of a repo. */
function repoSnapshot(r: string): string {
  return [sh(r, 'rev-parse', 'HEAD'), sh(r, 'for-each-ref'), sh(r, 'stash', 'list'), sh(r, 'status', '--porcelain=v1', '--untracked-files=all'), treeHash(r)].join('|');
}

const sel = (value: string, id: string) => ({ value, id });
function storyIssue(key: string, authorized: string): JiraIssue {
  return {
    key,
    fields: {
      summary: 'Existing work',
      issuetype: { id: '10005' },
      project: { id: '10033' },
      status: { id: '10036', name: 'In Progress' },
      updated: '2026-10-06T09:00:00.000+0000',
      [STORY_FIELDS.objective]: 'Do the work',
      [STORY_FIELDS.architecture]: null,
      [STORY_FIELDS.invariants]: null,
      [STORY_AUTHORIZED_PATHS_FIELD]: authorized,
      [STORY_FIELDS.prohibitedPaths]: 'src/secret/**',
      [STORY_FIELDS.verificationRequirements]: 't.pass\nt.types',
    },
  };
}
function acIssue(key: string, parent: string): JiraIssue {
  return {
    key,
    fields: {
      summary: `AC ${key}`,
      issuetype: { id: '10074' },
      project: { id: '10033' },
      status: { id: '10037', name: 'Open' },
      parent: { key: parent },
      updated: '2026-10-06T10:00:00.000+0000',
      [AC_FIELDS.acId]: 'AC-1',
      [AC_FIELDS.statement]: 'unit tests pass',
      [AC_FIELDS.kind]: sel('Deterministic', '10024'),
      [AC_FIELDS.evidenceKind]: sel('Test', '10026'),
      [AC_FIELDS.verification]: sel('UNVERIFIED', '10038'),
    },
  };
}
const READER_PERMS = { BROWSE_PROJECTS: true, EDIT_ISSUES: false, TRANSITION_ISSUES: false, CREATE_ISSUES: false, DELETE_ISSUES: false, ADMINISTER_PROJECTS: false, ADMINISTER: false };

interface Ctx {
  env: Record<string, string>;
  home: string;
  projects: string;
  evidence: FakeEvidence;
  stories: JiraIssue[];
  jira: string[];
  deps: Partial<GovDeps>;
}
function makeCtx(): Ctx {
  const home = path.join(tmp('gov-admit-home-'), 'gov');
  const projects = tmp('gov-admit-projects-');
  const ctx: Ctx = {
    env: {
      GOV_HOME: home,
      CLAUDE_PROJECTS_DIR: projects,
      JEV_JIRA_IDENTITY: 'reader',
      JEV_READER_TOKEN: READER_TOKEN,
      CLAUDE_CODE_MESSAGING_TOKEN: SECRET_TOKEN,
      ...selfEnv(),
    },
    home,
    projects,
    evidence: standard(),
    stories: [],
    jira: [],
    deps: {},
  };
  for (const sid of [SELF, OTHER, FORK]) transcript(ctx, sid);
  const query = (): JiraQuery => ({
    getStory: async (key) => {
      ctx.jira.push(`GET story ${key}`);
      const s = ctx.stories.find((x) => x.key === key);
      return s ? JSON.parse(JSON.stringify(s)) : null;
    },
    listAcceptanceCriteria: async (key) => {
      ctx.jira.push(`GET acs ${key}`);
      return [acIssue(`OMNI-${Number(key.slice(5)) + 100}`, key)];
    },
  });
  ctx.deps = {
    registry: REGISTRY,
    now: () => new Date('2026-10-09T12:00:00.000Z'),
    intakeRules: () => RULES,
    intakeProbe: createIntakeProbe(),
    jiraQuery: () => query(),
    jiraClient: ((c: JiraCredentials) =>
      ({
        async getMyPermissions() {
          ctx.jira.push('GET mypermissions');
          return c.token === READER_TOKEN ? { ...READER_PERMS } : {};
        },
        async getIssue() {
          throw new Error('admission must not read issues through the advisory client');
        },
        async updateAdvisoryFields() {
          ctx.jira.push('WRITE');
          throw new Error('admission must never write Jira');
        },
      }) as JiraClient & JiraPermissionProbe) as GovDeps['jiraClient'],
    intakeReader: () => ({
      searchActiveStories: async () => {
        ctx.jira.push('GET search');
        return JSON.parse(JSON.stringify(ctx.stories));
      },
    }),
    intakeJira: () => {
      throw new Error('admission must never build the human intake (write) client');
    },
    transport: () => {
      throw new Error('admission must never reach JEV');
    },
    liveSessions: () => {
      throw new Error('admission must never use the lax live-session reader');
    },
    createWorktree: async () => {
      throw new Error('admission must never create a worktree');
    },
    sessionEvidence: () => ctx.evidence,
  };
  return ctx;
}
function transcript(ctx: Ctx, sid: string): void {
  const d = path.join(ctx.projects, 'C--virality');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${sid}.jsonl`), `${JSON.stringify({ type: 'user', sessionId: sid, cwd: 'C:\\virality' })}\n`);
}

interface RunOut {
  code: number;
  out: string;
  err: string;
  result: Record<string, unknown>;
}
async function gov(ctx: Ctx, argv: string[]): Promise<RunOut> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runGov(argv, ctx.env, { out: (t) => out.push(t), err: (t) => err.push(t) }, ctx.deps);
  const line = out.filter((l) => l.startsWith('GOV_RESULT ')).pop();
  return { code, out: out.join('\n'), err: err.join('\n'), result: line ? JSON.parse(line.slice('GOV_RESULT '.length)) : {} };
}

/** Runs `gov admit` and proves it changed nothing: repo bytes/refs/index, GOV_HOME, transcripts; no Jira write. */
async function admit(ctx: Ctx, r: string | null, extra: string[] = []): Promise<RunOut> {
  const before = { repo: r ? repoSnapshot(r) : '', home: treeHash(ctx.home), projects: treeHash(ctx.projects) };
  const res = await gov(ctx, ['admit', ...(r ? ['--worktree', r, '--base', 'main'] : []), ...extra]);
  expect({ repo: r ? repoSnapshot(r) : '', home: treeHash(ctx.home), projects: treeHash(ctx.projects) }).toEqual(before);
  expect(ctx.jira.filter((c) => !c.startsWith('GET'))).toEqual([]);
  expect(fs.existsSync(path.join(ctx.home, 'intake'))).toBe(false);
  const all = `${res.out}\n${res.err}\n${JSON.stringify(res.result)}`;
  expect(all).not.toContain(SECRET_TOKEN);
  expect(all).not.toContain(READER_TOKEN);
  expect(all).not.toContain('cc-msg-');
  return res;
}

const layoutOf = (ctx: Ctx) => govLayout(ctx.env);
const PACKET = `sha256:${'c'.repeat(64)}` as `sha256:${string}`;
function bind(ctx: Ctx, story: string, sid: string, worktree: string, base: string): void {
  const res = bindSession(layoutOf(ctx), { story_key: story, packet_hash: PACKET, session_id: sid, mode: 'new', worktree: worktree.split(path.sep).join('/'), branch: 'feature/x', base_commit: base, session_file: null });
  if (res.status === 'REFUSED') throw new Error(res.message);
}

// ================================================================ CLI scenarios

describe('gov admit — classification through the shared intake classifier', () => {
  it('one proven live session + a clean branch with no Story → NEW_WORK, prints (never runs) gov intake --intent', async () => {
    const ctx = makeCtx();
    const r = repo();
    const res = await admit(ctx, r);
    expect(res.code).toBe(0);
    expect(res.result).toMatchObject({ classification: 'NEW_WORK', session_id: SELF, identity_source: 'self' });
    expect(String(res.result.next_command)).toMatch(new RegExp(`^gov intake --worktree \\S+ --session ${SELF} --intent `));
    expect(res.out).toContain('run it ONLY after the user explicitly says yes');
    // Story creation stays the human's --apply: admission never offers it as a command to run.
    expect(String(res.result.next_command)).not.toContain('--apply');
    expect(res.out.split('\n').filter((l) => /^\s*gov intake --apply/.test(l))).toEqual([]);
  });

  it('an existing Story covering clean committed work → EXISTING_STORY, prints the intake --bind hand-over', async () => {
    const ctx = makeCtx();
    ctx.stories = [storyIssue('OMNI-6', 'src/**')];
    const r = repo({ 'src/feature.ts': 'export const f = 1;\n' });
    const res = await admit(ctx, r);
    expect(res.code).toBe(0);
    expect(res.result).toMatchObject({ classification: 'EXISTING_STORY', story: 'OMNI-6' });
    expect(res.result.next_command).toBe(`gov intake --worktree ${r.split(path.sep).join('/')} --session ${SELF} --story OMNI-6 --bind`);
  });

  it('uncommitted work a Story covers → PRE_GOVERNANCE_ADOPTION: the human baseline first, then the bind', async () => {
    const ctx = makeCtx();
    ctx.stories = [storyIssue('OMNI-6', 'src/**')];
    const r = repo();
    write(r, 'src/wip.ts', 'export const w = 1;\n');
    const res = await admit(ctx, r);
    expect(res.code).toBe(0);
    expect(res.result).toMatchObject({ classification: 'PRE_GOVERNANCE_ADOPTION', story: 'OMNI-6' });
    expect(res.out).toContain('A HUMAN first commits the adoption baseline');
    expect(res.out).toContain('Governed-By: OMNI-6');
    expect(res.result.next_command).toContain('--story OMNI-6 --bind');
  });

  it('uncommitted work no Story covers → PRE_GOVERNANCE_ADOPTION proposal, which admission does NOT store', async () => {
    const ctx = makeCtx();
    const r = repo();
    write(r, 'src/wip.ts', 'export const w = 1;\n');
    const res = await admit(ctx, r);
    expect(res.code).toBe(0);
    expect(res.result.classification).toBe('PRE_GOVERNANCE_ADOPTION');
    expect(res.result.next_command).toBe(`gov intake --worktree ${r.split(path.sep).join('/')} --session ${SELF}`);
  });

  it('already governed by this session → GOVERNED_RESUME (no Jira read at all)', async () => {
    const ctx = makeCtx();
    const r = repo();
    bind(ctx, 'OMNI-6', SELF, r, sh(r, 'rev-parse', 'HEAD'));
    // GOVERNED_RESUME needs an intact packet; with a fabricated hash the binding is not resumable.
    const res = await admit(ctx, r);
    expect(res.result.classification).toBe('CONFLICTING_BINDINGS');
    expect(res.code).toBe(GOV_EXIT.REFUSED);
    expect(ctx.jira).toEqual([]);
  });

  it('a real governed binding (gov attach) → GOVERNED_RESUME with the packet step', async () => {
    const ctx = makeCtx();
    ctx.stories = [storyIssue('OMNI-6', 'src/**')];
    const r = repo();
    const attach = await gov(ctx, ['attach', '--story', 'OMNI-6', '--session', SELF, '--worktree', r, '--base', 'main']);
    expect(attach.code).toBe(0);
    ctx.jira.length = 0;
    const res = await admit(ctx, r);
    expect(res.code).toBe(0);
    expect(res.result).toMatchObject({ classification: 'GOVERNED_RESUME', story: 'OMNI-6' });
    expect(res.result.next_command).toBe(`gov packet --story OMNI-6 --worktree ${r.split(path.sep).join('/')}`);
    expect(ctx.jira).toEqual([]);
  });
});

describe('gov admit — ownership refusals are preserved', () => {
  it('conflicting bindings (two Stories on one worktree) → CONFLICTING_BINDINGS', async () => {
    const ctx = makeCtx();
    const r = repo();
    const head = sh(r, 'rev-parse', 'HEAD');
    bind(ctx, 'OMNI-6', OTHER, r, head);
    bind(ctx, 'OMNI-9', FORK, r, head);
    const res = await admit(ctx, r);
    expect(res.code).toBe(GOV_EXIT.REFUSED);
    expect(res.result.classification).toBe('CONFLICTING_BINDINGS');
    expect(res.result.next_command).toBeNull();
  });

  it('this session already bound to another Story elsewhere → SESSION_BOUND_ELSEWHERE', async () => {
    const ctx = makeCtx();
    const elsewhere = repo();
    bind(ctx, 'OMNI-9', SELF, elsewhere, sh(elsewhere, 'rev-parse', 'HEAD'));
    const res = await admit(ctx, repo());
    expect(res.code).toBe(GOV_EXIT.REFUSED);
    expect(res.result.classification).toBe('SESSION_BOUND_ELSEWHERE');
  });

  it('a worktree governed by another session → DUPLICATE_SESSION (a matching repo is not identity)', async () => {
    const ctx = makeCtx();
    ctx.stories = [storyIssue('OMNI-6', 'src/**')];
    const r = repo();
    expect((await gov(ctx, ['attach', '--story', 'OMNI-6', '--session', OTHER, '--worktree', r, '--base', 'main'])).code).toBe(0);
    const res = await admit(ctx, r);
    expect(res.code).toBe(GOV_EXIT.REFUSED);
    expect(res.result.classification).toBe('DUPLICATE_SESSION');
  });

  it('claimant preservation: another live session whose cwd is the worktree → DUPLICATE_SESSION, dirty or clean', async () => {
    const ctx = makeCtx();
    const r = repo();
    ctx.evidence.add({ pid: FORK_PID, sid: FORK, cwd: r });
    expect((await admit(ctx, r)).result.classification).toBe('DUPLICATE_SESSION');
    write(r, 'src/wip.ts', 'x\n');
    expect((await admit(ctx, r)).result.classification).toBe('DUPLICATE_SESSION');
  });

  it('a forked session (its own id) on its origin\'s governed worktree → DUPLICATE_SESSION; asking as the origin → SESSION_MISMATCH', async () => {
    const ctx = makeCtx();
    ctx.stories = [storyIssue('OMNI-6', 'src/**')];
    ctx.evidence.add({ pid: FORK_PID, sid: FORK });
    const r = repo();
    expect((await gov(ctx, ['attach', '--story', 'OMNI-6', '--session', SELF, '--worktree', r, '--base', 'main'])).code).toBe(0);
    ctx.env = { ...ctx.env, ...selfEnv(FORK, FORK_PID) };
    expect((await admit(ctx, r)).result.classification).toBe('DUPLICATE_SESSION');
    const asOrigin = await admit(ctx, r, ['--session', SELF]);
    expect(asOrigin.code).toBe(GOV_EXIT.REFUSED);
    expect(asOrigin.result).toMatchObject({ classification: 'UNSUPPORTED', refusal: 'SESSION_MISMATCH' });
  });
});

describe('gov admit — identity refusals (UNSUPPORTED), never a cwd fallback', () => {
  const cases: Array<[string, (ctx: Ctx) => void, string]> = [
    ['missing self-ID', (c) => {
      for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDE_CODE_MESSAGING_SOCKET']) delete c.env[k];
    }, 'SELF_ID_UNAVAILABLE'],
    ['env/registry session mismatch', (c) => Object.assign(c.env, { CLAUDE_CODE_SESSION_ID: OTHER }), 'SESSION_MISMATCH'],
    ['registry/socket mismatch', (c) => Object.assign(c.env, { CLAUDE_CODE_MESSAGING_SOCKET: socketOf(OTHER_PID) }), 'SOCKET_MISMATCH'],
    ['pid mismatch (no live record)', (c) => Object.assign(c.env, { CLAUDE_PID: '9999' }), 'PROCESS_NOT_LIVE'],
    ['dead pid', (c) => c.evidence.alive.delete(SELF_PID), 'LIVENESS_UNVERIFIABLE'],
    ['reused pid', (c) => c.evidence.pipes.delete(pipeOf(SELF_PID)), 'PID_REUSED'],
    ['registry missing', (c) => {
      c.evidence.listError = new Error('ENOENT');
    }, 'REGISTRY_UNAVAILABLE'],
    ['registry record malformed', (c) => c.evidence.files.set(`${SELF_PID}.json`, '{'), 'REGISTRY_RECORD_INVALID'],
  ];
  it.each(cases)('%s → UNSUPPORTED, exit 11, nothing written', async (_l, mutate, code) => {
    const ctx = makeCtx();
    ctx.stories = [storyIssue('OMNI-6', 'src/**')];
    const r = repo();
    // The worktree is even bound to this session — a matching repo is still not identity.
    bind(ctx, 'OMNI-6', SELF, r, sh(r, 'rev-parse', 'HEAD'));
    mutate(ctx);
    const res = await admit(ctx, r);
    expect(res.code).toBe(GOV_EXIT.REFUSED);
    expect(res.result).toMatchObject({ classification: 'UNSUPPORTED', refusal: code });
    expect(res.result.next_command).toBeNull();
    expect(ctx.jira).toEqual([]);
  });

  it('explicit --session with no self evidence follows the same live-registry validation', async () => {
    const ctx = makeCtx();
    for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDE_CODE_MESSAGING_SOCKET']) delete ctx.env[k];
    const r = repo();
    const ok = await admit(ctx, r, ['--session', OTHER]);
    expect(ok.code).toBe(0);
    expect(ok.result).toMatchObject({ session_id: OTHER, identity_source: 'explicit', classification: 'NEW_WORK' });
    const forged = await admit(ctx, r, ['--session', FORK]);
    expect(forged.result).toMatchObject({ classification: 'UNSUPPORTED', refusal: 'SESSION_NOT_LIVE' });
    ctx.evidence.pipes.delete(pipeOf(OTHER_PID));
    expect((await admit(ctx, r, ['--session', OTHER])).result).toMatchObject({ classification: 'UNSUPPORTED', refusal: 'PID_REUSED' });
  });

  it('explicit --session equal to the proven self selects it; a malformed --session is a usage error', async () => {
    const ctx = makeCtx();
    const r = repo();
    expect((await admit(ctx, r, ['--session', SELF])).result).toMatchObject({ session_id: SELF, identity_source: 'self' });
    expect((await gov(ctx, ['admit', '--worktree', r, '--session', 'nope'])).code).toBe(64);
  });

  it('no worktree (not a git repository) → UNSUPPORTED', async () => {
    const ctx = makeCtx();
    const notRepo = tmp('gov-admit-plain-');
    const res = await admit(ctx, null, ['--worktree', notRepo]);
    expect(res.code).toBe(GOV_EXIT.REFUSED);
    expect(res.result).toMatchObject({ classification: 'UNSUPPORTED', refusal: 'NOT_ADMISSIBLE' });
  });
});

describe('gov admit — explicit opt-in, read-only, no authority', () => {
  it('declining is the default: admission leaves zero trace (no ledger, proposal, audit, git or transcript change)', async () => {
    const ctx = makeCtx();
    ctx.stories = [storyIssue('OMNI-6', 'src/**')];
    const r = repo({ 'src/feature.ts': 'x\n' });
    const res = await admit(ctx, r);
    expect(res.result.classification).toBe('EXISTING_STORY');
    expect(fs.existsSync(layoutOf(ctx).bindingsFile)).toBe(false);
    expect(fs.existsSync(path.join(ctx.home, 'packets'))).toBe(false);
  });

  it('only the shared classifier decides: the new-work input refusals are exactly the three intake codes', () => {
    expect([...NEW_WORK_INPUT_CODES].sort()).toEqual(['AUTHORIZED_PATHS_UNKNOWN', 'INTENT_REQUIRED', 'NO_REGISTRY_ID']);
  });

  const REPO_ROOT = path.resolve(__dirname, '../../..');
  const cliSrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts/jev-flow/cli.ts'), 'utf8');
  const sf = ts.createSourceFile('cli.ts', cliSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fnText = (name: string): string => {
    let out = '';
    const walk = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === name) out = n.getText(sf);
      n.forEachChild(walk);
    };
    walk(sf);
    return out;
  };

  it('cmdAdmit has no write, bind, store, audit, Jira-write, JEV, git-write or process surface', () => {
    const body = fnText('cmdAdmit');
    expect(body).not.toBe('');
    for (const forbidden of [
      'bindSession',
      'storeProposal',
      'appendIntakeAudit',
      'cmdAttach',
      'cmdStart',
      'cmdIntake(',
      'applyIntakeProposal',
      'intakeJira',
      'createWorktree',
      'transport',
      'runJudgeFlow',
      'runVerification',
      'writeFile',
      'execFile',
      'spawn',
      'liveSessions(',
    ]) {
      expect(body).not.toContain(forbidden);
    }
    expect(body).toContain('readStrictSessions(port)');
    expect(body).toContain('resolveAdmittedSession(');
    expect(body).toContain('gatherIntake(');
  });

  it('gatherIntake (shared with intake) has no write path of its own', () => {
    const body = fnText('gatherIntake');
    expect(body).not.toBe('');
    for (const forbidden of ['bindSession', 'storeProposal', 'appendIntakeAudit', 'writeFile', 'cmdAttach', 'cmdStart']) expect(body).not.toContain(forbidden);
    expect(body).toContain('classifyIntake(');
  });

  it('admission.ts is pure (imports only the shared types) and the evidence port only lists and reads', () => {
    const adm = fs.readFileSync(path.join(REPO_ROOT, 'scripts/jev-flow/admission.ts'), 'utf8');
    const imports = [...adm.matchAll(/^import[^;]*from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./types']);
    const probe = fs.readFileSync(path.join(REPO_ROOT, 'scripts/jev-flow/intakeProbe.ts'), 'utf8');
    const port = probe.slice(probe.indexOf('export function createSessionEvidencePort'));
    expect(port).not.toBe('');
    for (const forbidden of ['writeFile', 'openSync', 'createConnection', 'connect(', 'execFile', 'spawn', 'statSync', "require('net')", 'node:net']) {
      expect(port).not.toContain(forbidden);
    }
    expect(port).toContain("processStart: () => 'unsupported'");
  });

  it('admit stays outside the pinned 7-verb USAGE and is listed in its own usage block', () => {
    const usage = /const USAGE = \[([\s\S]*?)\]\.join/.exec(cliSrc)?.[1] ?? '';
    expect(usage).not.toContain('admit');
    expect(cliSrc).toMatch(/const ADMIT_USAGE = '  admit /);
  });
});
