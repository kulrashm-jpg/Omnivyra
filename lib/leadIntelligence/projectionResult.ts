/**
 * PI-LDB P0 — the verdict one lead-intelligence projection returns.
 *
 * `LeadIntelligenceSink.emit` used to be typed `Promise<void>`. That is the
 * whole defect: `upsertCanonicalLead` asks the database for the stored row's id
 * and therefore KNOWS whether the write landed, but had no channel to say so,
 * so the sink discarded the answer with a bare `return` and the orchestrator
 * reported `emitted: true` because nothing had thrown. Every failure below the
 * orchestrator — a missing table, a missing column, an RLS refusal, a rejected
 * payload — was caught and flattened to `null`, so the success claim was a
 * constant that no row ever had to earn.
 *
 * `persisted` is reserved for a write the database confirmed by returning an
 * id. The other three states exist so a caller can tell "there was nothing to
 * write" from "the write was refused" from "the write may have landed" —
 * distinctions a boolean cannot carry, and the reason a retry can be safe.
 */

/** What became of one projection attempt. */
export type LeadProjectionStatus =
  /** The row exists. The write returned its id. */
  | 'persisted'
  /** Nothing should have been written. A legitimate outcome, not a fault. */
  | 'skipped'
  /** The write did not happen, and that is known. */
  | 'failed'
  /**
   * The write was submitted and neither confirmed nor refused, so the row may
   * or may not exist. Reporting this as `failed` would be a guess, and a retry
   * is safe only because the upsert is keyed on (company_id, dedupe_key).
   */
  | 'pending_reconciliation';

/** Why the status is what it is. Always present unless `persisted`. */
export type LeadProjectionReason =
  /** No canonical prospect to project — a partial record, not a fault. */
  | 'no_prospect'
  /** No tenant on the lead; the write was never attempted. */
  | 'no_organization'
  /** The table or column the write needs does not exist in this schema. */
  | 'schema_not_applied'
  /** The database refused the write for this role (RLS / privileges). */
  | 'denied'
  /** The payload violated a constraint. */
  | 'invalid'
  /** The write failed for some other reason; see `error`. */
  | 'write_failed'
  /** The call reported no error and returned no row. */
  | 'no_row_returned'
  /**
   * PROVABLY nothing was transmitted: the TCP/TLS connection was never
   * established (DNS failure, refused connect, connect timeout, certificate
   * rejected), so not one byte of the upsert reached PostgREST. This is a
   * `failed`, never a `pending_reconciliation` — calling an unestablished
   * connection "the row may exist" manufactures uncertainty that the runtime
   * itself rules out, and it would send a reconciliation read after a row that
   * cannot be there.
   */
  | 'not_transmitted'
  /**
   * The request WAS transmitted and no response came back, or a response came
   * back that does not say whether the statement ran (a proxy's 408/504/502, a
   * reset socket, an aborted fetch). Genuinely unknown, and the only honest
   * companion status is `pending_reconciliation`.
   */
  | 'unconfirmed_transport'
  /**
   * The statement never reached Postgres because PostgREST could not get a
   * database connection and said so (PGRST000/001/002/003, 53300, 08001/08004,
   * 57P03). PostgREST answered, and its answer is that nothing ran.
   */
  | 'not_reached_database';

export interface LeadProjectionResult {
  status: LeadProjectionStatus;
  /** The stored row's id. Non-null ONLY when `status === 'persisted'`. */
  leadId: string | null;
  reason: LeadProjectionReason | null;
  /**
   * Problems that did NOT stop the lead row from existing — a failed timeline
   * event, for instance. A warning never downgrades `persisted`, because the
   * lead really is there and the Lead Database really will list it.
   */
  warnings: string[];
  error: string | null;
  /**
   * True only for a `persisted` verdict that was established by READING the row
   * back on its dedupe key after an unconfirmed write, rather than by the write
   * returning an id.
   *
   * The sink reads it for one purpose: NOT to append a timeline event.
   * `lead_intelligence_events` carries no unique constraint, so an append here
   * would duplicate provenance in exactly the case where the first attempt had
   * in fact succeeded — which is the one thing a reconciliation pass must not
   * do. Optional, so every existing `LeadProjectionResult` literal (and every
   * test double that builds one) stays valid and `isLeadProjectionResult`
   * keeps accepting it.
   */
  reconciled?: boolean;
}

/**
 * Every status, as a value. Exported so a test can assert the four states are
 * genuinely four — aliasing two of them together is the one mutation that
 * silently restores the old two-valued behaviour while every name still reads
 * correctly at the call sites.
 */
export const LEAD_PROJECTION_STATUSES = [
  'persisted',
  'skipped',
  'failed',
  'pending_reconciliation',
] as const satisfies readonly LeadProjectionStatus[];

/**
 * Compile-time exhaustiveness: if a status is added to the union and not to the
 * array above, this alias stops being `never` and the file stops compiling.
 */
type MissingProjectionStatus = Exclude<LeadProjectionStatus, (typeof LEAD_PROJECTION_STATUSES)[number]>;
const _allStatusesListed: MissingProjectionStatus[] = [];
void _allStatusesListed;

/** Postgres SQLSTATEs and PostgREST codes that mean "the schema is not there". */
const SCHEMA_NOT_APPLIED = new Set([
  '42P01', // undefined_table
  '42703', // undefined_column
  'PGRST204', // column not found in the schema cache
  'PGRST205', // table not found in the schema cache
  '42P10', // invalid_column_reference — the ON CONFLICT target does not exist
  '42704', // undefined_object (a missing constraint named in on_conflict)
  'PGRST202', // function not found in the schema cache
]);

/** Codes that mean the database understood the write and refused it. */
const DENIED = new Set([
  '42501', // insufficient_privilege (includes an RLS refusal)
  'PGRST301', // JWT/role problem
  'PGRST302', // anonymous access disabled
  '28000', // invalid_authorization_specification
  '28P01', // invalid_password
]);

/**
 * Codes that leave the outcome GENUINELY UNKNOWN.
 *
 * A connection that drops or a statement that is cancelled AFTER the upsert was
 * sent may or may not have committed. Calling that `failed` is a guess, and the
 * guess is the dangerous direction: it tells an operator the lead is missing and
 * sends them to re-enter data that may already be there. The contract has a
 * fourth state precisely for this, and the classifier was not using it — an
 * earlier version mapped `08006` to `write_failed`, and a test of mine PINNED
 * that as correct, which is worse than the defect because it defended it.
 *
 * Retrying is safe: the upsert is keyed on (company_id, dedupe_key).
 */
const AMBIGUOUS = new Set([
  '08006', // connection_failure
  '08003', // connection_does_not_exist
  '08007', // transaction_resolution_unknown — the name says it
  '57014', // query_canceled (statement_timeout)
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '08000', // connection_exception (the class; says nothing about when)
  '08P01', // protocol_violation
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  'XX001', // data_corrupted
  // PostgREST says "internal error" and does NOT say whether a statement had
  // already been issued on the connection it lost. Unlike PGRST000/002/003,
  // nothing here rules out a commit.
  'PGRST001',
  // Synthesised CLIENT-SIDE by postgrest-js when the response was 2xx and
  // `.maybeSingle()` got more than one row (dist/index.cjs processResponse,
  // inside `if (res.ok)`). The rows EXIST. It is the one code that must never
  // read as `failed`: the write landed, we just cannot name one id.
  'PGRST116',
]);

/** Codes that mean the payload itself was wrong. */
const INVALID = new Set([
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '22P02', // invalid_text_representation
  '22023', // invalid_parameter_value
  // `23505` was MISSING, so a unique violation on any constraint OTHER than
  // `lead_intelligence_dedupe_unique` fell through to `write_failed`. By the
  // time a 23505 reaches this classifier it is a genuinely rejected payload,
  // and the operator needs to be told which: the ordinary path names the
  // dedupe constraint in `on_conflict` with `resolution=merge-duplicates`, so
  // it cannot raise one, and the score-preserving path (Prompt 2C) issues a
  // plain INSERT that can — but it INTERCEPTS that constraint's violation as
  // "the row exists" and updates instead, so it never arrives here either.
  // See `isDedupeKeyTaken` in `leadIntelligenceRepository`.
  '23505', // unique_violation
  '23P01', // exclusion_violation
  '22001', // string_data_right_truncation
  'PGRST102', // the body PostgREST received was not valid JSON for this request
]);

/**
 * PostgREST/Postgres codes whose OWN MEANING is "no statement was executed".
 *
 * These are not transport guesses: PostgREST answered over HTTP, and what it
 * answered is that it never got a database connection. That makes them
 * PROVABLY pre-execution, and the one thing they must not be is
 * `pending_reconciliation` — a reconciliation read after a statement that
 * never ran costs a query and reports "unconfirmed" for a lead that is
 * definitely absent, which is the same false uncertainty in the other
 * direction.
 */
const NOT_REACHED_DATABASE = new Set([
  'PGRST000', // could not connect with the database (bad db-uri / PG not running)
  'PGRST002', // could not connect with the database while building the schema cache
  'PGRST003', // timed out waiting for a pool connection to become available
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '53300', // too_many_connections — raised at connection time
  '57P03', // cannot_connect_now (server starting up / shutting down)
]);

export function persisted(leadId: string, warnings: string[] = []): LeadProjectionResult {
  return { status: 'persisted', leadId, reason: null, warnings, error: null };
}

/**
 * `persisted`, established by a read-back rather than by the write's own answer.
 *
 * Still `persisted` — the row exists, the Lead Database will list it, and
 * `isProjected` must be true or the surface would hide a lead that is there.
 * The flag records HOW it was established, which is what lets the sink skip the
 * timeline append it would otherwise duplicate.
 */
export function persistedByReconciliation(leadId: string, warnings: string[] = []): LeadProjectionResult {
  return { status: 'persisted', leadId, reason: null, warnings, error: null, reconciled: true };
}

export function skipped(reason: LeadProjectionReason): LeadProjectionResult {
  return { status: 'skipped', leadId: null, reason, warnings: [], error: null };
}

export function failed(reason: LeadProjectionReason, error: string | null = null): LeadProjectionResult {
  return { status: 'failed', leadId: null, reason, warnings: [], error };
}

export function pendingReconciliation(
  reason: LeadProjectionReason,
  error: string | null = null,
): LeadProjectionResult {
  return { status: 'pending_reconciliation', leadId: null, reason, warnings: [], error };
}

/**
 * Turn a database error into a verdict. The code is what makes the four states
 * worth having: an operator who is told `schema_not_applied` knows to apply a
 * migration, where `write_failed` would have sent them looking at the data.
 */
export function classifyWriteError(code: string | null | undefined, message: string | null): LeadProjectionResult {
  const c = (code ?? '').toUpperCase();
  // Ambiguity is checked FIRST: a dropped connection must not be reported as a
  // definitive failure just because no later branch claimed it.
  if (AMBIGUOUS.has(c)) return pendingReconciliation('no_row_returned', message);
  if (SCHEMA_NOT_APPLIED.has(c)) return failed('schema_not_applied', message);
  if (DENIED.has(c)) return failed('denied', message);
  if (INVALID.has(c)) return failed('invalid', message);
  if (NOT_REACHED_DATABASE.has(c)) return failed('not_reached_database', message);
  return failed('write_failed', message);
}

/* ── the transport half ────────────────────────────────────────────────────
 *
 * Everything above was built for a libpq-shaped error and DOES NOT COVER THIS
 * CODE'S OWN TRANSPORT. Production writes go over HTTP through supabase-js, and
 * @supabase/postgrest-js 2.105.3 does not throw: with `shouldThrowOnError`
 * false — the default, and this repository never calls `.throwOnError()` — its
 * `PostgrestBuilder.then` wraps the whole fetch in `.catch` and RESOLVES with
 *
 *   { data: null, error: { message, details, hint, code: '' }, status: 0, statusText: '' }
 *
 * (dist/index.cjs, the `if (!this.shouldThrowOnError) res = res.catch(...)`
 * branch). So a refused connect, a reset socket and an aborted fetch all arrive
 * with `code === ''` — an EMPTY STRING, not undefined — and
 * `classifyWriteError('')` matches no set and lands on `failed('write_failed')`.
 * A socket that died after the POST was transmitted was being reported as a
 * definitive failure, which is the direction the file above calls dangerous.
 *
 * The non-JSON gateway half is the same defect wearing a different hat: a proxy
 * that answers `504 gateway timeout` with an HTML body cannot be JSON-parsed,
 * so `processResponse` falls back to `error = { message: body }` with NO `code`
 * property at all — and that, too, was `failed('write_failed')`, for a timeout
 * that says nothing about whether PostgREST committed.
 *
 * TWO fields decide it, and both are real:
 *
 *   `status`  — 0 means no HTTP response was processed AT ALL; any other value
 *               is the status a server actually sent. `upsertCanonicalLead-
 *               WithOutcome` was destructuring only `{ data, error }` and
 *               throwing this away.
 *   `details` — postgrest-js composes it as
 *                 `<err.name>: <err.message>\n\nCaused by: <cause.name>: <cause.message> (<cause.code>)`
 *               so the undici errno is present, and present as the trailing
 *               `(CODE)`. It is the ONLY place it appears. Matching the `(CODE)`
 *               suffix rather than the message text is deliberate: for a
 *               dual-stack connect failure the cause is an `AggregateError`
 *               whose `message` is EMPTY while its `code` is still there.
 *
 * The errno is what separates the two stages that must never be collapsed:
 *   PRE-SEND  — no connection was ever established, so no byte was sent, so
 *               nothing can have committed. `failed('not_transmitted')`.
 *   POST-SEND — the request went out and no usable answer came back.
 *               `pending_reconciliation('unconfirmed_transport')`.
 *
 * The tie-break for anything that proves neither is `pending_reconciliation`,
 * and the asymmetry is the reason: a false `pending` costs one keyed
 * single-row read, while a false `failed` tells an operator a lead is missing
 * and sends them to re-enter data that is already there.
 */

/** Where a write got to before it broke. */
export type LeadWriteStage =
  /** Nothing left this process, or no connection was ever established. */
  | 'pre_send'
  /** The request was transmitted; no usable response came back. */
  | 'post_send'
  /** A server answered, and its answer settles the question. */
  | 'answered';

/**
 * The fields of a `PostgrestResponse` the classifier needs. Deliberately a
 * loose shape with everything optional: the suites that double
 * `backend/db/writeOwner` return bare `{ data, error }` objects with no
 * `status`, and this must classify those EXACTLY as before rather than reading
 * `undefined` as `0` and calling every doubled failure a transport failure.
 */
export interface WriteResponseShape {
  code?: string | null;
  message?: string | null;
  /** postgrest-js: 0 = no HTTP response processed. ABSENT = unknown, not 0. */
  status?: number | null;
  /** postgrest-js' composed detail string; carries the undici errno as `(CODE)`. */
  details?: string | null;
  /** postgrest-js sets this only on its AbortError branch. */
  hint?: string | null;
}

/**
 * undici/Node errnos that can ONLY occur before the request is transmitted.
 *
 * Every one of these is a failure to ESTABLISH the connection — name
 * resolution, the TCP connect, or the TLS handshake. The request body is
 * written after all three, so a write cannot have reached PostgREST, and
 * `pending_reconciliation` here would be invented uncertainty.
 *
 * `ECONNRESET` is deliberately NOT here even though a reset can happen during a
 * TLS handshake: nothing in the error object says which, so it goes to the safe
 * side instead.
 */
const PRE_SEND_ERRNOS = [
  'ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'EAI_FAIL', 'ENODATA',
  'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EAFNOSUPPORT',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_INVALID_URL',
];

/** True when `details` names an errno that rules out transmission. */
function provesNotTransmitted(details: string | null | undefined): boolean {
  if (!details) return false;
  const d = details.toUpperCase();
  // Match the `(CODE)` suffix postgrest-js appends from `cause.code`, not loose
  // substrings: a stack frame or a hostname could contain any of these words.
  return PRE_SEND_ERRNOS.some((errno) => d.includes(`(${errno})`));
}

/**
 * Which stage a response broke at, from the fields the runtime actually gives.
 * Exported so a test can assert the STAGE, not only the final status — the
 * classification is the claim, and a status alone cannot show that pre-send and
 * post-send stayed apart.
 */
export function writeStageOf(res: WriteResponseShape): LeadWriteStage {
  const code = (res.code ?? '').toUpperCase();
  if (code) return 'answered';
  if (typeof res.status !== 'number') {
    // No `status` at all: a doubled seam, or an error object that carries only
    // a message. Nothing locates it, so it is not claimed to be post-send.
    return 'pre_send';
  }
  if (res.status === 0) return provesNotTransmitted(res.details) ? 'pre_send' : 'post_send';
  return 'answered';
}

/**
 * HTTP statuses, seen WITHOUT a PostgREST code, that leave the outcome unknown.
 *
 * `408`/`504` are a proxy saying it stopped waiting — not PostgREST saying it
 * did not run. `502`/`520`/`546` are an upstream connection that broke at an
 * unknown point. `503` with no code is an edge refusing, which USUALLY happens
 * before PostgREST, and "usually" is not proof. `429` is the same.
 *
 * `204` is here for a reason worth naming: postgrest-js REWRITES a `404` with
 * an empty body into `{ status: 204, error: null }` (`processResponse`), so a
 * blank 404 from an edge arrives looking like an accepted write that returned
 * nothing. It is not; it is unknown.
 */
const UNCERTAIN_STATUSES = new Set([204, 408, 425, 429, 499, 502, 503, 504, 507, 520, 521, 522, 523, 524, 546, 598, 599]);

/**
 * Turn a write response into a verdict, STAGE FIRST.
 *
 * `classifyWriteError` remains the code-only entry point and is unchanged for
 * every existing caller; this is the one that also reads `status` and
 * `details`. Order matters: a server's own code always wins, because it is the
 * only direct statement about whether the statement ran.
 */
export function classifyWriteOutcome(res: WriteResponseShape): LeadProjectionResult {
  const message = res.message ?? null;
  const code = (res.code ?? '').toUpperCase();

  // 1. PostgREST or Postgres answered with a code. That code is the evidence.
  if (code) return classifyWriteError(code, message);

  const status = typeof res.status === 'number' ? res.status : null;

  // 2. No code and no status: indistinguishable from the pre-`status` shape
  //    every doubled seam in this repository returns. Classified exactly as
  //    before, so no existing suite changes meaning.
  if (status === null) return failed('write_failed', message);

  // 3. A transport failure: no HTTP response was processed.
  if (status === 0) {
    if (provesNotTransmitted(res.details)) {
      // PROVABLY pre-send. A row cannot exist, so this is a definite failure
      // and reconciliation must not be sent looking for one.
      return failed('not_transmitted', message);
    }
    // Transmitted, or not provably otherwise: ECONNRESET, UND_ERR_SOCKET,
    // ETIMEDOUT, UND_ERR_HEADERS_TIMEOUT, `TypeError: terminated`, an
    // AbortError/TimeoutError. The POST may have committed.
    return pendingReconciliation('unconfirmed_transport', message);
  }

  // 4. A server answered 2xx. PostgREST only returns 2xx for a statement it
  //    ran, so the write COMMITTED — we simply have no id to name. Never
  //    `failed`, and `persisted` is unavailable without an id: the repository
  //    resolves this by reading the row back on its dedupe key.
  if (status >= 200 && status < 300) return pendingReconciliation('no_row_returned', message);

  // 5. Codeless statuses that settle nothing.
  if (UNCERTAIN_STATUSES.has(status)) return pendingReconciliation('unconfirmed_transport', message);

  // 6. Any other 4xx with no code — 400, 401, 403, 404, 405, 413, 414, 415 —
  //    is a rejection before execution.
  if (status >= 400 && status < 500) return failed('write_failed', message);

  // 7. Any other 5xx: the server broke somewhere it did not name. Unknown.
  return pendingReconciliation('unconfirmed_transport', message);
}

/** Structural check for a verdict object. */
export function isLeadProjectionResult(value: unknown): value is LeadProjectionResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<LeadProjectionResult>;
  return (
    typeof v.status === 'string'
    && (LEAD_PROJECTION_STATUSES as readonly string[]).includes(v.status)
    && Array.isArray(v.warnings)
    // A `persisted` verdict MUST name the row it claims. This is the one place
    // every unwrap passes through, so enforcing it here covers them all —
    // notably `projectionFailureFrom`, which carries the verdict off a THROWN
    // `LeadProjectionFailure`. A thrown failure means "not a confirmed row" by
    // definition, so a carried `persisted` is incoherent; accepting it let the
    // sink's own defensive throw be unwrapped back into a success claim, with
    // `isProjected()` answering true over an empty store. Rejecting it sends
    // `projectionFailureFrom` to null and the caller to its own
    // `failed('write_failed')` default, which is the safe direction.
    && (v.status !== 'persisted' || (typeof v.leadId === 'string' && v.leadId.length > 0))
  );
}

/**
 * The verdict carried by a thrown error, or null if it carries none.
 *
 * Identified STRUCTURALLY rather than with `instanceof`. The error class lives
 * in the sink's module, and tests routinely replace that whole module with
 * `jest.mock`, which leaves the imported class `undefined` — and
 * `e instanceof undefined` does not return false, it throws a TypeError. So an
 * `instanceof` check here would turn "the sink failed" into "the orchestrator
 * crashed" in exactly the situation the check exists to handle. This module is
 * pure and has no reason to be mocked.
 */
export function projectionFailureFrom(error: unknown): LeadProjectionResult | null {
  if (typeof error !== 'object' || error === null) return null;
  const carried = (error as { result?: unknown }).result;
  return isLeadProjectionResult(carried) ? carried : null;
}

/** True when the Lead Database is expected to list this lead. */
export function isProjected(result: LeadProjectionResult): boolean {
  return result.status === 'persisted';
}

/**
 * True when the operator should be told the lead may be missing. A `skipped`
 * projection is excluded deliberately: there was no prospect to list, so
 * warning about it would train operators to ignore the warning that matters.
 */
export function needsAttention(result: LeadProjectionResult): boolean {
  return result.status === 'failed' || result.status === 'pending_reconciliation';
}
