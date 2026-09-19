// Append-only, hash-chained harness event log (CPG_U1_PROTOCOL_004 §6.5 evidence). Every execution attempt — authorised,
// refused, preview, repeated, post-window, malformed or failed verification — is one event. Each event carries the
// SHA-256 of its predecessor, so an edited, reordered or deleted interior event is detected. A truncated TAIL or a
// substituted whole log is NOT detectable from the file alone: the head hash must be published (procedural).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { canonicalJson, sha256 } from './canonical.mjs';

export const EVENT_LOG_SCHEMA = 'cpg-u1-harness-event/v1';
export const GENESIS = '0'.repeat(64);
export const EVENT_TYPES = Object.freeze([
  'LOG_OPENED',
  'RUN_STARTED', 'AUTHORIZED_EXECUTION', 'RUN_COMPLETED', 'RUN_INTERRUPTED_CLOSED',
  'PILOT_RUN_STARTED', 'PILOT_EXECUTION', 'PILOT_RUN_COMPLETED',
  'EXECUTION_REFUSED', 'PREVIEW_ATTEMPT', 'REPEATED_EXECUTION', 'POST_WINDOW_EXECUTION', 'MALFORMED_EXECUTION', 'VERIFICATION_FAILURE',
]);
/** Event types that are refusals: nothing was executed. */
export const REFUSAL_TYPES = Object.freeze(['EXECUTION_REFUSED', 'PREVIEW_ATTEMPT', 'REPEATED_EXECUTION', 'POST_WINDOW_EXECUTION', 'MALFORMED_EXECUTION', 'VERIFICATION_FAILURE']);

const eventHash = (e) => { const { event_sha256: _omit, ...body } = e; return sha256(canonicalJson(body)); };

/** Read and verify the whole chain. Throws on any break; returns the events and the head hash. */
export function readEventLog(path) {
  if (!existsSync(path)) return { events: [], head: GENESIS };
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length);
  let prev = GENESIS;
  const events = lines.map((line, i) => {
    let e;
    try { e = JSON.parse(line); } catch { throw new Error(`event log line ${i + 1} is not JSON`); }
    if (e.schema !== EVENT_LOG_SCHEMA) throw new Error(`event ${i + 1}: schema must be ${EVENT_LOG_SCHEMA}`);
    if (e.seq !== i + 1) throw new Error(`event ${i + 1}: sequence broken (found ${e.seq})`);
    if (e.prev_event_sha256 !== prev) throw new Error(`event ${i + 1}: hash chain broken (prev_event_sha256 mismatch)`);
    if (eventHash(e) !== e.event_sha256) throw new Error(`event ${i + 1}: event_sha256 does not recompute (event altered)`);
    if (!EVENT_TYPES.includes(e.type)) throw new Error(`event ${i + 1}: unknown type ${e.type}`);
    prev = e.event_sha256;
    return e;
  });
  return { events, head: prev };
}

/** Append one event to a verified chain; `at` comes from the injected clock (ISO UTC). */
export function appendEvent(path, type, at, fields = {}) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type ${type}`);
  const { events, head } = readEventLog(path);
  const body = { schema: EVENT_LOG_SCHEMA, seq: events.length + 1, prev_event_sha256: head, type, at, ...fields };
  const e = { ...body, event_sha256: eventHash(body) };
  appendFileSync(path, `${JSON.stringify(e)}\n`);
  return e;
}
