/**
 * Governed session admission (`gov admit`) — strict session evidence and self-identification.
 *
 * Pure: every read goes through an injected port (the defaults live in intakeProbe.ts). Nothing
 * here writes, launches a process, opens a connection or reads a credential.
 *
 * A Claude Code session is identified only when independent evidence agrees:
 *   1. the session id Claude Code injects into its tool processes (CLAUDE_CODE_SESSION_ID),
 *   2. the registry record `<CLAUDE_PID>.json` naming that same session id and pid,
 *   3. the messaging socket the session injects (CLAUDE_CODE_MESSAGING_SOCKET) equal to the
 *      registry's, and present in the live pipe namespace (enumerated, never connected to),
 *   4. a live pid, and — where the platform can tell without launching a process — an actual
 *      process start equal to the registry's procStart.
 * Anything missing, malformed, contradictory or unverifiable refuses. A cwd is never evidence.
 *
 * Liveness is stricter than intake's `readLiveSessions` (which skips unreadable records): an
 * unreadable directory or record, a malformed record, or a record whose pid and socket disagree
 * refuses admission instead of being read as "no live session".
 */
import { SESSION_ID_RE } from './types';

export const SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';
export const PID_ENV = 'CLAUDE_PID';
export const SOCKET_ENV = 'CLAUDE_CODE_MESSAGING_SOCKET';

/** Registry records are named after the pid they describe. */
export const REGISTRY_RECORD_RE = /^([1-9]\d{0,9})\.json$/;
const FILETIME_RE = /^[1-9]\d{14,19}$/;
const WIN_PIPE_PREFIX = '\\\\.\\pipe\\';
/** Windows FILETIME (100 ns since 1601) → Unix ms. */
const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;
/** procStart must precede the registry's startedAt by no more than this (Claude writes the record at startup). */
export const PROC_START_WINDOW_MS = 15 * 60 * 1000;

export type AdmissionRefusalCode =
  | 'SELF_ID_UNAVAILABLE'
  | 'SELF_ID_INCOMPLETE'
  | 'REGISTRY_UNAVAILABLE'
  | 'REGISTRY_RECORD_MISSING'
  | 'REGISTRY_RECORD_UNREADABLE'
  | 'REGISTRY_RECORD_INVALID'
  | 'SESSION_MISMATCH'
  | 'SOCKET_MISMATCH'
  | 'PID_MISMATCH'
  | 'PROCESS_NOT_LIVE'
  | 'PID_REUSED'
  | 'LIVENESS_UNVERIFIABLE'
  | 'SESSION_NOT_LIVE'
  | 'SESSION_AMBIGUOUS';

export interface AdmissionRefusal {
  ok: false;
  code: AdmissionRefusalCode;
  /** Names the failed check; never contains a credential, token or socket path. */
  message: string;
}

/** A registry record that passed structural validation. */
export interface SessionRecord {
  file: string;
  pid: number;
  session_id: string;
  cwd: string | null;
  status: string | null;
  /** Windows FILETIME of the process start, exact decimal string. */
  proc_start: string;
  started_at_ms: number;
  /** Pipe name relative to \\.\pipe\ (never printed). */
  pipe: string;
  socket: string;
}

/** Read access to the Claude Code session registry. Both methods THROW when the data cannot be read. */
export interface SessionRegistryPort {
  list(): string[];
  read(file: string): string;
}

export interface SessionEvidencePort {
  registry: SessionRegistryPort;
  isPidAlive(pid: number): boolean;
  /** Live pipe names (relative to \\.\pipe\), by enumeration only. THROWS when unavailable. */
  listPipes(): ReadonlySet<string>;
  /**
   * Actual start of `pid` as an exact FILETIME string; `'unsupported'` when the platform cannot tell
   * without launching a process (the pipe check is then the only PID-reuse mitigation, with residual
   * risk — finding F-9); null when it
   * should be knowable but could not be established (refuses).
   */
  processStart(pid: number): string | null | 'unsupported';
}

export type StrictSessions = { ok: true; live: SessionRecord[]; stale: number; proc_start_checked: boolean } | AdmissionRefusal;

export interface AdmittedSession {
  ok: true;
  session_id: string;
  pid: number;
  /** 'self' = proven from the injected env; 'explicit' = --session with no self evidence at all. */
  source: 'self' | 'explicit';
  record: SessionRecord;
  /** Whether an actual process-start comparison ran (false = the platform cannot tell without a launch). */
  proc_start_checked: boolean;
}

const refuse = (code: AdmissionRefusalCode, message: string): AdmissionRefusal => ({ ok: false, code, message });

/** `\\.\pipe\<name>` → `<name>`; anything else (not a Windows pipe path) → null. Pure. */
export function pipeName(socket: string): string | null {
  if (!socket.startsWith(WIN_PIPE_PREFIX)) return null;
  const name = socket.slice(WIN_PIPE_PREFIX.length);
  return name === '' || name.includes('\0') ? null : name;
}

/** FILETIME decimal string → Unix ms, or null when malformed. Pure. */
export function filetimeToMs(ft: string): number | null {
  if (!FILETIME_RE.test(ft)) return null;
  return Number(BigInt(ft) / 10000n - FILETIME_EPOCH_OFFSET_MS);
}

/** Structural validation of one registry record. Every required field must be present and agree. Pure. */
export function parseSessionRecord(file: string, text: string): { ok: true; record: SessionRecord } | AdmissionRefusal {
  const m = REGISTRY_RECORD_RE.exec(file);
  if (!m) return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} is not named <pid>.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} is not valid JSON`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} is not an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0) return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has no valid pid`);
  if (String(r.pid) !== m[1]) return refuse('PID_MISMATCH', `registry record ${file} names pid ${r.pid}`);
  if (typeof r.sessionId !== 'string' || !SESSION_ID_RE.test(r.sessionId)) return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has no valid session id`);
  if (typeof r.messagingSocketPath !== 'string' || r.messagingSocketPath === '') return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has no messaging socket`);
  const pipe = pipeName(r.messagingSocketPath);
  if (pipe === null) return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has a messaging socket that is not a named pipe`);
  if (typeof r.procStart !== 'string' || filetimeToMs(r.procStart) === null) return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has no valid procStart`);
  if (typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt) || r.startedAt <= 0) return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has no valid startedAt`);
  const startMs = filetimeToMs(r.procStart) as number;
  if (startMs > r.startedAt + 1000 || startMs < r.startedAt - PROC_START_WINDOW_MS) {
    return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has a procStart inconsistent with its startedAt`);
  }
  if (r.cwd !== undefined && r.cwd !== null && typeof r.cwd !== 'string') return refuse('REGISTRY_RECORD_INVALID', `registry record ${file} has a non-string cwd`);
  return {
    ok: true,
    record: {
      file,
      pid: r.pid,
      session_id: r.sessionId,
      cwd: typeof r.cwd === 'string' ? r.cwd.split('\\').join('/') : null,
      status: typeof r.status === 'string' ? r.status : null,
      proc_start: r.procStart,
      started_at_ms: r.startedAt,
      pipe,
      socket: r.messagingSocketPath,
    },
  };
}

/**
 * Every registry record, validated; returns only the live ones. A record is live when its pid is
 * alive AND its pipe is listed; stale when neither (skipped); anything in between refuses (a live
 * pid without the session's pipe is treated as a possibly reused pid). This mitigates PID reuse; it does
 * not prove process identity (F-9). Fails closed on any unreadable or malformed data.
 */
export function readStrictSessions(port: SessionEvidencePort): StrictSessions {
  let names: string[];
  try {
    names = port.registry.list();
  } catch {
    return refuse('REGISTRY_UNAVAILABLE', 'the Claude Code session registry cannot be read');
  }
  let pipes: ReadonlySet<string>;
  try {
    pipes = port.listPipes();
  } catch {
    return refuse('LIVENESS_UNVERIFIABLE', 'the live session sockets cannot be enumerated');
  }
  const live: SessionRecord[] = [];
  let stale = 0;
  let checked = true;
  for (const file of [...names].sort()) {
    if (!file.endsWith('.json')) continue;
    let text: string;
    try {
      text = port.registry.read(file);
    } catch {
      return refuse('REGISTRY_RECORD_UNREADABLE', `registry record ${file} cannot be read`);
    }
    const parsed = parseSessionRecord(file, text);
    if (parsed.ok === false) return parsed;
    const rec = parsed.record;
    let alive: boolean;
    try {
      alive = port.isPidAlive(rec.pid) === true;
    } catch {
      return refuse('LIVENESS_UNVERIFIABLE', `liveness of the process in ${file} cannot be established`);
    }
    const piped = pipes.has(rec.pipe);
    if (!alive && !piped) {
      stale++;
      continue;
    }
    if (alive && !piped) return refuse('PID_REUSED', `the process in ${file} is running but its session socket is gone (possible reused pid)`);
    if (!alive && piped) return refuse('LIVENESS_UNVERIFIABLE', `the session socket in ${file} exists but its process is not running`);
    let actual: string | null | 'unsupported';
    try {
      actual = port.processStart(rec.pid);
    } catch {
      actual = null;
    }
    if (actual === null) return refuse('LIVENESS_UNVERIFIABLE', `the start of the process in ${file} cannot be established`);
    if (actual === 'unsupported') checked = false;
    else if (actual !== rec.proc_start) return refuse('PID_REUSED', `the process in ${file} started at a different time than the registry records (possible reused pid)`);
    live.push(rec);
  }
  return { ok: true, live, stale, proc_start_checked: checked };
}

/**
 * Proves which live session is asking. With self evidence (all three env values) the session is
 * the one the evidence agrees on, and an explicit --session must equal it (a fork asking as its
 * origin is refused). With NO self evidence at all, an explicit --session is validated against the
 * same live registry. Partial or contradictory self evidence never falls back to anything.
 */
export function resolveAdmittedSession(env: Record<string, string | undefined>, sessions: StrictSessions, explicit: string | null): AdmittedSession | AdmissionRefusal {
  if (sessions.ok === false) return sessions;
  const sid = (env[SESSION_ENV] ?? '').trim();
  const pidText = (env[PID_ENV] ?? '').trim();
  const socket = (env[SOCKET_ENV] ?? '').trim();
  const present = [sid, pidText, socket].filter((v) => v !== '').length;
  if (explicit !== null && !SESSION_ID_RE.test(explicit)) return refuse('SESSION_MISMATCH', '--session is not a lowercase uuid');

  if (present === 0) {
    if (explicit === null) {
      return refuse('SELF_ID_UNAVAILABLE', `this process carries no Claude Code session identity (${SESSION_ENV}, ${PID_ENV}, ${SOCKET_ENV}); pass --session <uuid> of a live session`);
    }
    const matches = sessions.live.filter((r) => r.session_id === explicit);
    if (matches.length === 0) return refuse('SESSION_NOT_LIVE', `session ${explicit} is not a live session in the registry`);
    if (matches.length > 1) return refuse('SESSION_AMBIGUOUS', `session ${explicit} appears in ${matches.length} live registry records`);
    return { ok: true, session_id: explicit, pid: matches[0].pid, source: 'explicit', record: matches[0], proc_start_checked: sessions.proc_start_checked };
  }
  if (present !== 3) return refuse('SELF_ID_INCOMPLETE', `the session identity in this process is incomplete (${SESSION_ENV}, ${PID_ENV} and ${SOCKET_ENV} are all required)`);
  if (!SESSION_ID_RE.test(sid)) return refuse('SELF_ID_INCOMPLETE', `${SESSION_ENV} is not a lowercase uuid`);
  if (!/^[1-9]\d{0,9}$/.test(pidText)) return refuse('SELF_ID_INCOMPLETE', `${PID_ENV} is not a pid`);
  const pid = Number(pidText);
  const rec = sessions.live.find((r) => r.pid === pid);
  if (!rec) return refuse('PROCESS_NOT_LIVE', `no live registry record for ${PID_ENV} ${pid}`);
  if (rec.session_id !== sid) return refuse('SESSION_MISMATCH', `${SESSION_ENV} does not match the registry record for pid ${pid}`);
  if (rec.socket !== socket) return refuse('SOCKET_MISMATCH', `${SOCKET_ENV} does not match the registry record for pid ${pid}`);
  if (sessions.live.filter((r) => r.session_id === sid).length !== 1) return refuse('SESSION_AMBIGUOUS', `session ${sid} appears in more than one live registry record`);
  if (explicit !== null && explicit !== sid) return refuse('SESSION_MISMATCH', `--session ${explicit} is not this session (${sid}); a session may only admit itself`);
  return { ok: true, session_id: sid, pid, source: 'self', record: rec, proc_start_checked: sessions.proc_start_checked };
}

/** What admission reports. The intake classification is reused verbatim; UNSUPPORTED covers identity and worktree refusals. */
export type AdmissionClass =
  | 'GOVERNED_RESUME'
  | 'EXISTING_STORY'
  | 'PRE_GOVERNANCE_ADOPTION'
  | 'NEW_WORK'
  | 'CONFLICTING_BINDINGS'
  | 'SESSION_BOUND_ELSEWHERE'
  | 'DUPLICATE_SESSION'
  | 'AMBIGUOUS_OWNERSHIP'
  | 'UNSUPPORTED'
  | string;

/** Intake refusals that only mean "new work needs its intent / scope" — admission reports them as NEW_WORK. */
export const NEW_WORK_INPUT_CODES: readonly string[] = ['INTENT_REQUIRED', 'AUTHORIZED_PATHS_UNKNOWN', 'NO_REGISTRY_ID'];
