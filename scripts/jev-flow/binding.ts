/**
 * Governed Claude workflow ("gov") — session ↔ Story binding ledger (Track 3).
 *
 * Append-only JSONL at layout.bindingsFile (under GOV_HOME, which govLayout
 * guarantees is outside any git work tree). One session governs one Story;
 * re-binding the same session/Story to a regenerated packet appends a record.
 * Nothing here writes anywhere except the ledger.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BINDING_SCHEMA,
  COMMIT_RE,
  GOVERNANCE_VERSION,
  SESSION_ID_RE,
  SHA256_REF_RE,
  STORY_KEY_RE,
  type GovLayout,
  type SessionBinding,
} from './types';

export type BindInput = Omit<SessionBinding, 'schema' | 'governance_version' | 'bound_at'>;
export type BindStatus = 'BOUND' | 'ALREADY_BOUND' | 'REFUSED';

export interface BindResult {
  status: BindStatus;
  binding: SessionBinding | null;
  message: string;
}

function validationError(input: BindInput): string | null {
  if (!input || typeof input !== 'object') return 'binding input is required';
  if (!STORY_KEY_RE.test(input.story_key ?? '')) return 'invalid story key';
  if (!SESSION_ID_RE.test(input.session_id ?? '')) return 'invalid session id';
  if (!SHA256_REF_RE.test(input.packet_hash ?? '')) return 'invalid packet hash';
  if (input.mode !== 'new' && input.mode !== 'attach') return 'invalid binding mode';
  if (!input.worktree) return 'worktree is required';
  if (!input.branch) return 'branch is required';
  if (!COMMIT_RE.test(input.base_commit ?? '')) return 'invalid base commit';
  if (input.mode === 'attach') {
    const f = input.session_file;
    if (!f) return 'mode=attach requires a session_file fingerprint';
    if (!SHA256_REF_RE.test(f.sha256 ?? '')) return 'invalid session_file sha256';
  } else if (input.session_file !== null) {
    return 'mode=new requires session_file null';
  }
  return null;
}

/** All ledger records in append order. A corrupt line throws (never skipped). */
export function readBindings(layout: GovLayout): SessionBinding[] {
  let text: string;
  try {
    text = fs.readFileSync(layout.bindingsFile, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: SessionBinding[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec: SessionBinding;
    try {
      rec = JSON.parse(line) as SessionBinding;
    } catch {
      throw new Error(`corrupt binding ledger line ${i + 1}: ${layout.bindingsFile}`);
    }
    if (!rec || typeof rec !== 'object' || rec.schema !== BINDING_SCHEMA) {
      throw new Error(`corrupt binding ledger line ${i + 1}: unexpected schema`);
    }
    out.push(rec);
  }
  return out;
}

/** Latest binding of a session, or null. */
export function findBySession(layout: GovLayout, sessionId: string): SessionBinding | null {
  const all = readBindings(layout).filter((b) => b.session_id === sessionId);
  return all.length > 0 ? all[all.length - 1] : null;
}

/** All bindings of a Story, oldest first. */
export function findByStory(layout: GovLayout, storyKey: string): SessionBinding[] {
  return readBindings(layout).filter((b) => b.story_key === storyKey);
}

/** Latest binding of a Story, or null. */
export function latestForStory(layout: GovLayout, storyKey: string): SessionBinding | null {
  const all = findByStory(layout, storyKey);
  return all.length > 0 ? all[all.length - 1] : null;
}

/**
 * Binds a session to a Story packet. Idempotent on (session, story, packet,
 * worktree, branch); refuses a session already bound to a different Story.
 */
export function bindSession(layout: GovLayout, input: BindInput, now: () => Date = () => new Date()): BindResult {
  const invalid = validationError(input);
  if (invalid !== null) return { status: 'REFUSED', binding: null, message: invalid };

  const existing = readBindings(layout).filter((b) => b.session_id === input.session_id);
  const otherStory = existing.find((b) => b.story_key !== input.story_key);
  if (otherStory) {
    return {
      status: 'REFUSED',
      binding: null,
      message: `session ${input.session_id} is already bound to ${otherStory.story_key}; one session governs one Story`,
    };
  }
  const same = existing.find(
    (b) => b.packet_hash === input.packet_hash && b.worktree === input.worktree && b.branch === input.branch,
  );
  if (same) return { status: 'ALREADY_BOUND', binding: same, message: `session ${input.session_id} already bound to ${input.story_key}` };

  const binding: SessionBinding = {
    schema: BINDING_SCHEMA,
    governance_version: GOVERNANCE_VERSION,
    story_key: input.story_key,
    packet_hash: input.packet_hash,
    session_id: input.session_id,
    mode: input.mode,
    worktree: input.worktree,
    branch: input.branch,
    base_commit: input.base_commit,
    bound_at: now().toISOString(),
    session_file: input.session_file,
  };
  fs.mkdirSync(path.dirname(layout.bindingsFile), { recursive: true });
  fs.appendFileSync(layout.bindingsFile, `${JSON.stringify(binding)}\n`, { encoding: 'utf8', flag: 'a' });
  const message = existing.length > 0
    ? `session ${input.session_id} re-bound to ${input.story_key} (new packet ${input.packet_hash})`
    : `session ${input.session_id} bound to ${input.story_key}`;
  return { status: 'BOUND', binding, message };
}
