/**
 * Durable request-level idempotency for /api/engagement/reply and /like.
 *
 * ONE request record per (tenant, acting user, scope, idempotency key) in
 * `engagement_request_idempotency` (migration 20261231000008). It is NOT a
 * second action ledger: it reserves the request, binds it to a canonical
 * payload fingerprint and points at the ONE community_ai_actions row the
 * request produced; the action's outcome stays in the action row.
 *
 * ── Identity ────────────────────────────────────────────────────────────────
 *   record id = uuid(sha256(v2, organization, actor, scope, key)) — the primary
 *   key IS the reservation: a plain INSERT either creates it (this caller
 *   proceeds) or fails 23505 (someone else holds it). Exactly one concurrent
 *   caller proceeds, on any instance.
 *   key = the client `Idempotency-Key` header (8-200 chars [A-Za-z0-9._:-]), or,
 *   when absent, `derived:<fingerprint>` — NO time bucket, so no boundary can
 *   ever split one request into two.
 *   fingerprint = sha256 of the normalized payload (scope, platform, source
 *   message/signal/thread, text, AI draft binding, account).
 *
 * ── States ──────────────────────────────────────────────────────────────────
 *   reserved          a caller holds the request; no outcome yet.
 *   completed         the action row was created and handed off: executed,
 *                     sent_unverified, queued for the extension (dispatched) or
 *                     deferred to the RPA retry queue. Replays read the live
 *                     action row.
 *   failed_not_acted  the attempt provably never reached the platform
 *                     (`may_have_acted === false`, or the action row was never
 *                     inserted). The SAME key may be retried.
 *   uncertain         the attempt may have reached the platform. Never resent;
 *                     never expires; never purged. Needs human review.
 *
 * ── Conflict rules (same key) ──────────────────────────────────────────────
 *   different fingerprint            → 422 IDEMPOTENCY_KEY_REUSED (nothing sent)
 *                                      — unless the record is expired AND
 *                                      completed/failed_not_acted (new request).
 *   reserved (fresh)                 → 409 REQUEST_IN_PROGRESS
 *   reserved (stale > 15 min)        → reconciled first (see below)
 *   uncertain                        → 409 OUTCOME_UNCERTAIN (review_status
 *                                      'needs_review'); never resent.
 *   completed (not expired)          → replay of the recorded outcome; no new
 *                                      action.
 *   failed_not_acted                 → retry: CAS reserve attempt n+1 with a NEW
 *                                      action id derived from (record, attempt);
 *                                      the retry runs every route + executor
 *                                      gate again.
 *
 * ── Lifecycle ───────────────────────────────────────────────────────────────
 *   expires_at = last transition + ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS (24 h).
 *   A user who deliberately repeats the SAME reply/like to the same target:
 *     - within 24 h without a key → replayed (no second send). To send it again
 *       on purpose sooner, the client must send a NEW Idempotency-Key.
 *     - after 24 h → treated as a new request (completed/failed_not_acted records
 *       are taken over by CAS).
 *     - if the earlier attempt is `uncertain` → refused until reviewed, at any
 *       age (only a new explicit key expresses new intent).
 *   Cleanup: purgeExpiredEngagementRequests deletes completed/failed_not_acted
 *   records ENGAGEMENT_REQUEST_PURGE_GRACE_MS (7 d) after expiry, bounded per
 *   call. It is called best-effort, tenant-scoped (limit 20), by
 *   reserveEngagementRequest on every fresh reservation — no cron/schedule —
 *   and may be called by an operator script. reserved/uncertain are never
 *   purged.
 *
 * ── Crash / timeout ─────────────────────────────────────────────────────────
 *   A `reserved` record older than ENGAGEMENT_REQUEST_STALE_MS is reconciled
 *   (on demand by the next request for that key, or reconcileStaleEngagementRequests):
 *     - no action row with the planned action id → insert a FENCE action row
 *       (status 'skipped') under that id. The executor's auto_insert can then
 *       never act under it (it dedups on the primary key), so "not acted" is
 *       proven → failed_not_acted.
 *     - an action row exists → handed-off statuses → completed; anything else
 *       (executing, failed, uncertain, …) → uncertain. Never released.
 *
 * Unlike withIdempotency (api_idempotency_keys) a 5xx or a stale lock NEVER
 * re-runs a side-effecting send.
 */

import { createHash, randomUUID } from 'crypto';
import type { NextApiRequest } from 'next';

export const ENGAGEMENT_REQUEST_TABLE = 'engagement_request_idempotency';
export const ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ENGAGEMENT_REQUEST_STALE_MS = 15 * 60 * 1000;
export const ENGAGEMENT_REQUEST_PURGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const ENGAGEMENT_REQUEST_PURGE_MAX = 500;
export const FENCE_REASON = 'engagement_request_reservation_abandoned';

const CLIENT_KEY_SHAPE = /^[A-Za-z0-9._:\-]{8,200}$/;

export type EngagementRequestScope = 'reply' | 'like';
export type EngagementRequestState = 'reserved' | 'completed' | 'failed_not_acted' | 'uncertain';

/** Action statuses meaning "the request was handed to the action ledger". */
const HANDED_OFF_STATUSES = new Set(['executed', 'sent_unverified', 'dispatched', 'deferred']);
/** Action ROW statuses (persisted vocabulary) meaning handed off. */
const HANDED_OFF_ROW_STATUSES = new Set(['executed', 'sent_unverified', 'pending', 'dispatched', 'acknowledged']);

export type EngagementRequestRecord = {
  id: string;
  organization_id: string;
  actor_id: string;
  scope: EngagementRequestScope;
  idempotency_key: string;
  key_source: 'client' | 'derived';
  request_fingerprint: string;
  state: EngagementRequestState;
  attempt: number;
  action_id: string;
  platform: string | null;
  action_type: string | null;
  target_id: string | null;
  outcome_status: string | null;
  outcome_error: string | null;
  reserved_at: string;
  finalized_at: string | null;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
};

/** Minimal PostgREST-shaped client (the service-role supabase client). */
export type DbClient = { from: (table: string) => any };

export type ClientIdempotencyKey =
  | { ok: true; key: string | null }
  | { ok: false; error: 'INVALID_IDEMPOTENCY_KEY' };

/** Reads the optional Idempotency-Key header (8-200 chars of [A-Za-z0-9._:-]). */
export function readClientIdempotencyKey(req: Pick<NextApiRequest, 'headers'>): ClientIdempotencyKey {
  const raw = req.headers?.['idempotency-key'];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim() ?? '';
  if (!value) return { ok: true, key: null };
  if (!CLIENT_KEY_SHAPE.test(value)) return { ok: false, error: 'INVALID_IDEMPOTENCY_KEY' };
  return { ok: true, key: value };
}

function uuidFromDigest(hex: string): string {
  // RFC-4122 version-5-style UUID (variant 10xx) from a sha256 digest.
  const h = hex.slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20, 32)].join('-');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Text normalization for the fingerprint: NFC, CRLF→LF, trimmed. Inner whitespace is significant. */
export function normalizeRequestText(text: string | null | undefined): string {
  return (text ?? '').toString().normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

/**
 * Canonical request fingerprint. Every field is normalized; absent values are
 * explicit nulls so field order / omission can never collide.
 */
export function computeRequestFingerprint(input: {
  scope: EngagementRequestScope;
  platform: string | null | undefined;
  messageId?: string | null;
  signalId?: string | null;
  threadId?: string | null;
  text?: string | null;
  aiDraftId?: string | null;
  aiGenerated?: boolean;
  /** The sending account. Engagement sends use the organization's connected
   *  account for the platform (no per-request account selection exists). */
  account: string;
}): string {
  const norm = (v: string | null | undefined) => {
    const s = (v ?? '').toString().trim();
    return s ? s : null;
  };
  const platform = (norm(input.platform) ?? '').toLowerCase();
  const canonical = [
    'engagement-request-fingerprint-v1',
    input.scope,
    platform === 'x' ? 'twitter' : platform || null,
    norm(input.messageId),
    norm(input.signalId),
    norm(input.threadId),
    input.scope === 'reply' ? normalizeRequestText(input.text) : null,
    norm(input.aiDraftId),
    input.aiGenerated === true,
    norm(input.account),
  ];
  return sha256(JSON.stringify(canonical));
}

/** Client key, or the server-derived key (no time bucket). */
export function resolveRequestKey(clientKey: string | null, fingerprint: string): { key: string; source: 'client' | 'derived' } {
  return clientKey ? { key: clientKey, source: 'client' } : { key: `derived:${fingerprint}`, source: 'derived' };
}

/** Deterministic record id: the primary key is the reservation. */
export function requestRecordId(input: { organizationId: string; actorId: string; scope: EngagementRequestScope; key: string }): string {
  return uuidFromDigest(sha256(['engagement-request-v2', input.organizationId, input.actorId, input.scope, input.key].join('\u001f')));
}

/** community_ai_actions.id for one attempt of one request record. */
export function actionIdForAttempt(recordId: string, attempt: number): string {
  return uuidFromDigest(sha256(['engagement-request-action-v2', recordId, String(attempt)].join('\u001f')));
}

export type RequestContext = {
  db: DbClient;
  organizationId: string;
  /** Server-derived acting user (never client input). */
  actorId: string;
  scope: EngagementRequestScope;
  clientKey: string | null;
  fingerprint: string;
  nowMs?: number;
};

export type HttpAnswer = { status: number; body: Record<string, unknown> };

export type ReserveOutcome =
  | { kind: 'proceed'; record: EngagementRequestRecord; actionId: string; attempt: number }
  | { kind: 'answer'; answer: HttpAnswer; record: EngagementRequestRecord | null };

const iso = (ms: number) => new Date(ms).toISOString();
const isExpired = (r: EngagementRequestRecord, now: number) => Date.parse(r.expires_at) <= now;
const isStale = (r: EngagementRequestRecord, now: number) => Date.parse(r.reserved_at) + ENGAGEMENT_REQUEST_STALE_MS <= now;

async function readRecord(db: DbClient, organizationId: string, id: string): Promise<{ record: EngagementRequestRecord | null; error: string | null }> {
  const { data, error } = await db
    .from(ENGAGEMENT_REQUEST_TABLE)
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) return { record: null, error: String(error.message || error.code || 'read_failed') };
  return { record: (data as EngagementRequestRecord | null) ?? null, error: null };
}

function base(record: EngagementRequestRecord) {
  return { request_state: record.state, action_id: record.action_id, attempt: record.attempt };
}

export const answers = {
  unavailable: (): HttpAnswer => ({
    status: 503,
    body: { error: 'Request idempotency is temporarily unavailable; nothing was sent. Retry with the same Idempotency-Key.', code: 'IDEMPOTENCY_UNAVAILABLE', retryable: true },
  }),
  mismatch: (r: EngagementRequestRecord): HttpAnswer => ({
    status: 422,
    body: { error: 'This Idempotency-Key was already used for a different request; nothing was sent.', code: 'IDEMPOTENCY_KEY_REUSED', ...base(r) },
  }),
  inProgress: (r: EngagementRequestRecord): HttpAnswer => ({
    status: 409,
    body: { error: 'This request is already in progress', code: 'REQUEST_IN_PROGRESS', ...base(r) },
  }),
  uncertain: (r: EngagementRequestRecord): HttpAnswer => ({
    status: 409,
    body: {
      error: 'The outcome of this request is uncertain and needs review; it will not be sent again automatically.',
      code: 'OUTCOME_UNCERTAIN',
      review_status: 'needs_review',
      ...base(r),
    },
  }),
};

/**
 * Decide what an existing record means for a request with `fingerprint`.
 * 'takeover' = this caller may CAS-reserve the next attempt.
 */
function decide(
  record: EngagementRequestRecord,
  fingerprint: string,
  now: number,
): 'replay' | 'mismatch' | 'in_progress' | 'stale' | 'uncertain' | 'takeover' {
  const sameFp = record.request_fingerprint === fingerprint;
  const terminalReusable = record.state === 'completed' || record.state === 'failed_not_acted';
  if (terminalReusable && isExpired(record, now)) return 'takeover';
  if (!sameFp) return 'mismatch';
  switch (record.state) {
    case 'completed':
      return 'replay';
    case 'failed_not_acted':
      return 'takeover';
    case 'uncertain':
      return 'uncertain';
    case 'reserved':
    default:
      return isStale(record, now) ? 'stale' : 'in_progress';
  }
}

/** Read the live action row and answer a replay of a completed request. */
export async function replayAnswer(db: DbClient, record: EngagementRequestRecord): Promise<HttpAnswer> {
  const { data: row } = await db
    .from('community_ai_actions')
    .select('id, status, execution_mode')
    .eq('id', record.action_id)
    .eq('organization_id', record.organization_id)
    .maybeSingle();
  const prior = String((row as { status?: string } | null)?.status ?? record.outcome_status ?? '');
  const body = { replayed: true, prior_status: prior, ...base(record) };
  if (prior === 'executed' || prior === 'sent_unverified') {
    return { status: 200, body: { success: true, status: prior, ...body } };
  }
  if (prior === 'pending' || prior === 'dispatched' || prior === 'acknowledged' || prior === 'executing' || prior === 'deferred') {
    return { status: 202, body: { success: true, status: 'queued', confirmed: false, ...body } };
  }
  if (prior === 'uncertain') return { status: 409, body: { ...answers.uncertain(record).body, ...body } };
  return {
    status: 409,
    body: {
      error: 'This request was already processed and did not complete. Retry with a new Idempotency-Key to try again.',
      code: 'DUPLICATE_REQUEST',
      ...body,
    },
  };
}

/**
 * Read-only early check (before any route gate mutates state): answers a
 * replay / mismatch / in-progress / uncertain request immediately. `null` =
 * continue to the gates and then reserveEngagementRequest.
 */
export async function inspectEngagementRequest(ctx: RequestContext): Promise<HttpAnswer | null> {
  const now = ctx.nowMs ?? Date.now();
  const { key } = resolveRequestKey(ctx.clientKey, ctx.fingerprint);
  const id = requestRecordId({ organizationId: ctx.organizationId, actorId: ctx.actorId, scope: ctx.scope, key });
  const { record, error } = await readRecord(ctx.db, ctx.organizationId, id);
  if (error) return answers.unavailable();
  if (!record) return null;
  const d = decide(record, ctx.fingerprint, now);
  if (d === 'replay') return replayAnswer(ctx.db, record);
  if (d === 'mismatch') return answers.mismatch(record);
  if (d === 'uncertain') return answers.uncertain(record);
  if (d === 'in_progress') return answers.inProgress(record);
  return null; // takeover / stale: resolved atomically by reserveEngagementRequest
}

/**
 * Atomic reservation, BEFORE any external call. Exactly one concurrent caller
 * receives `proceed`; it must then call executeAction with `actionId` and
 * finalizeEngagementRequest with the result.
 */
export async function reserveEngagementRequest(
  ctx: RequestContext & { platform: string; actionType: string; targetId: string },
): Promise<ReserveOutcome> {
  const now = ctx.nowMs ?? Date.now();
  const { key, source } = resolveRequestKey(ctx.clientKey, ctx.fingerprint);
  const id = requestRecordId({ organizationId: ctx.organizationId, actorId: ctx.actorId, scope: ctx.scope, key });
  const fresh: EngagementRequestRecord = {
    id,
    organization_id: ctx.organizationId,
    actor_id: ctx.actorId,
    scope: ctx.scope,
    idempotency_key: key,
    key_source: source,
    request_fingerprint: ctx.fingerprint,
    state: 'reserved',
    attempt: 1,
    action_id: actionIdForAttempt(id, 1),
    platform: ctx.platform,
    action_type: ctx.actionType,
    target_id: ctx.targetId,
    outcome_status: null,
    outcome_error: null,
    reserved_at: iso(now),
    finalized_at: null,
    expires_at: iso(now + ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS),
    created_at: iso(now),
    updated_at: iso(now),
  };
  const { error: insertError } = await ctx.db.from(ENGAGEMENT_REQUEST_TABLE).insert(fresh);
  if (!insertError) {
    // Bounded, tenant-scoped, best-effort lifecycle cleanup (no cron).
    try {
      await purgeExpiredEngagementRequests(ctx.db, { organizationId: ctx.organizationId, limit: 20, nowMs: now });
    } catch {
      /* cleanup never affects the request */
    }
    return { kind: 'proceed', record: fresh, actionId: fresh.action_id, attempt: 1 };
  }
  if (String(insertError.code || '') !== '23505') {
    return { kind: 'answer', answer: answers.unavailable(), record: null };
  }

  // The key is held. Decide on the current record; takeovers are CAS so a
  // concurrent racer loses cleanly. Bounded loop.
  for (let i = 0; i < 3; i += 1) {
    const { record, error } = await readRecord(ctx.db, ctx.organizationId, id);
    if (error || !record) return { kind: 'answer', answer: answers.unavailable(), record: null };
    const d = decide(record, ctx.fingerprint, now);
    if (d === 'replay') return { kind: 'answer', answer: await replayAnswer(ctx.db, record), record };
    if (d === 'mismatch') return { kind: 'answer', answer: answers.mismatch(record), record };
    if (d === 'uncertain') return { kind: 'answer', answer: answers.uncertain(record), record };
    if (d === 'in_progress') return { kind: 'answer', answer: answers.inProgress(record), record };
    if (d === 'stale') {
      await reconcileReservation(ctx.db, record, now);
      continue; // re-read and decide on the reconciled state
    }
    // takeover: next attempt, new action id, same gates.
    const attempt = record.attempt + 1;
    const next = {
      state: 'reserved' as const,
      attempt,
      action_id: actionIdForAttempt(id, attempt),
      request_fingerprint: ctx.fingerprint,
      key_source: source,
      platform: ctx.platform,
      action_type: ctx.actionType,
      target_id: ctx.targetId,
      outcome_status: null,
      outcome_error: null,
      reserved_at: iso(now),
      finalized_at: null,
      expires_at: iso(now + ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS),
      updated_at: iso(now),
    };
    const { data: won, error: casError } = await ctx.db
      .from(ENGAGEMENT_REQUEST_TABLE)
      .update(next)
      .eq('id', id)
      .eq('organization_id', ctx.organizationId)
      .eq('state', record.state)
      .eq('attempt', record.attempt)
      .select('*')
      .maybeSingle();
    if (casError) return { kind: 'answer', answer: answers.unavailable(), record };
    if (won) {
      const rec = { ...record, ...next } as EngagementRequestRecord;
      return { kind: 'proceed', record: rec, actionId: rec.action_id, attempt };
    }
  }
  const { record } = await readRecord(ctx.db, ctx.organizationId, id);
  return { kind: 'answer', answer: record ? answers.inProgress(record) : answers.unavailable(), record };
}

export type OutcomeClass = { state: Exclude<EngagementRequestState, 'reserved'>; outcomeStatus: string; error: string | null };

/**
 * Classify an executeAction result (or a thrown error) for the request record.
 * Only a PROVABLY not-acted attempt is `failed_not_acted`; everything that is
 * not handed off and not provably not-acted is `uncertain`.
 */
export function classifyExecutionOutcome(result: unknown, thrown?: unknown): OutcomeClass {
  if (thrown !== undefined) {
    const msg = String((thrown as Error)?.message ?? thrown ?? '');
    // executeAction throws this when the claimed action row could not be
    // inserted — before runExecution, so nothing reached the platform.
    if (msg.startsWith('community_ai_action_auto_insert_failed')) {
      return { state: 'failed_not_acted', outcomeStatus: 'failed', error: msg.slice(0, 500) };
    }
    return { state: 'uncertain', outcomeStatus: 'uncertain', error: msg.slice(0, 500) || 'EXECUTION_THREW' };
  }
  const r = (result ?? {}) as { status?: unknown; may_have_acted?: unknown; deduplicated?: unknown; error?: unknown };
  const status = String(r.status ?? '');
  const error = r.error == null ? null : typeof r.error === 'string' ? r.error : String((r.error as { code?: unknown }).code ?? 'error');
  if (r.deduplicated === true) {
    // An action row already existed under this attempt's id: only a handed-off
    // row is completed; nothing else is provable.
    return HANDED_OFF_ROW_STATUSES.has(status)
      ? { state: 'completed', outcomeStatus: status, error: null }
      : { state: 'uncertain', outcomeStatus: status || 'unknown', error };
  }
  if (HANDED_OFF_STATUSES.has(status)) return { state: 'completed', outcomeStatus: status, error: null };
  if (r.may_have_acted === false && (status === 'failed' || status === 'skipped' || status === 'blocked')) {
    return { state: 'failed_not_acted', outcomeStatus: status, error };
  }
  return { state: 'uncertain', outcomeStatus: status || 'unknown', error };
}

/** Compare-and-set the reservation (this attempt only) to its outcome. */
export async function finalizeEngagementRequest(
  db: DbClient,
  record: EngagementRequestRecord,
  outcome: OutcomeClass,
  nowMs?: number,
): Promise<{ ok: boolean }> {
  const now = nowMs ?? Date.now();
  const { data, error } = await db
    .from(ENGAGEMENT_REQUEST_TABLE)
    .update({
      state: outcome.state,
      outcome_status: outcome.outcomeStatus,
      outcome_error: outcome.error,
      finalized_at: iso(now),
      expires_at: iso(now + ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS),
      updated_at: iso(now),
    })
    .eq('id', record.id)
    .eq('organization_id', record.organization_id)
    .eq('state', 'reserved')
    .eq('attempt', record.attempt)
    .select('id')
    .maybeSingle();
  if (error) {
    console.warn('[engagementRequestIdempotency] finalize failed:', error.message);
    return { ok: false };
  }
  return { ok: !!data };
}

/**
 * Reconcile ONE stale reservation. Never releases a reservation that may have
 * acted: release (failed_not_acted) happens only after a fence action row was
 * inserted under the planned action id, which makes any late executeAction for
 * that attempt deduplicate instead of acting.
 */
export async function reconcileReservation(
  db: DbClient,
  record: EngagementRequestRecord,
  nowMs?: number,
): Promise<EngagementRequestState | null> {
  const now = nowMs ?? Date.now();
  if (record.state !== 'reserved' || !isStale(record, now)) return null;
  const cas = async (state: EngagementRequestState, outcomeStatus: string, err: string | null) => {
    const { data } = await db
      .from(ENGAGEMENT_REQUEST_TABLE)
      .update({
        state,
        outcome_status: outcomeStatus,
        outcome_error: err,
        finalized_at: iso(now),
        expires_at: iso(now + ENGAGEMENT_REQUEST_REPLAY_WINDOW_MS),
        updated_at: iso(now),
      })
      .eq('id', record.id)
      .eq('organization_id', record.organization_id)
      .eq('state', 'reserved')
      .eq('attempt', record.attempt)
      .select('id')
      .maybeSingle();
    return data ? state : null;
  };

  const readAction = async () =>
    db
      .from('community_ai_actions')
      .select('id, status, execution_result')
      .eq('id', record.action_id)
      .eq('organization_id', record.organization_id)
      .maybeSingle();

  let { data: action, error: readErr } = await readAction();
  if (readErr) return null;
  if (!action) {
    const { error: fenceErr } = await db.from('community_ai_actions').insert({
      id: record.action_id,
      tenant_id: record.organization_id,
      organization_id: record.organization_id,
      platform: record.platform ?? 'unknown',
      action_type: record.action_type ?? record.scope,
      target_id: record.target_id ?? 'unknown',
      suggested_text: null,
      requires_human_approval: false,
      status: 'skipped',
      skip_reason: FENCE_REASON,
      execution_correlation_id: randomUUID(),
      execution_result: { source: 'executor', reason: FENCE_REASON, request_id: record.id, attempt: record.attempt },
      created_at: iso(now),
      updated_at: iso(now),
    });
    if (!fenceErr) return cas('failed_not_acted', 'skipped', 'RESERVATION_ABANDONED');
    if (String(fenceErr.code || '') !== '23505') return null; // cannot prove anything: leave reserved
    ({ data: action, error: readErr } = await readAction());
    if (readErr || !action) return null;
  }
  const status = String((action as { status?: string }).status ?? '');
  const reason = (action as { execution_result?: { reason?: string } | null }).execution_result?.reason;
  if (status === 'skipped' && reason === FENCE_REASON) return cas('failed_not_acted', 'skipped', 'RESERVATION_ABANDONED');
  if (HANDED_OFF_ROW_STATUSES.has(status)) return cas('completed', status, null);
  return cas('uncertain', status || 'unknown', 'RESERVATION_STALE');
}

/** Bounded bulk reconcile of stale reservations (operator / maintenance caller; no schedule). */
export async function reconcileStaleEngagementRequests(
  db: DbClient,
  opts: { organizationId?: string; limit?: number; nowMs?: number } = {},
): Promise<{ examined: number; reconciled: number }> {
  const now = opts.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 50, ENGAGEMENT_REQUEST_PURGE_MAX));
  let q = db.from(ENGAGEMENT_REQUEST_TABLE).select('*').eq('state', 'reserved').lt('reserved_at', iso(now - ENGAGEMENT_REQUEST_STALE_MS));
  if (opts.organizationId) q = q.eq('organization_id', opts.organizationId);
  const { data, error } = await q.order('reserved_at', { ascending: true }).limit(limit);
  if (error || !Array.isArray(data)) return { examined: 0, reconciled: 0 };
  let reconciled = 0;
  for (const rec of data as EngagementRequestRecord[]) {
    if (await reconcileReservation(db, rec, now)) reconciled += 1;
  }
  return { examined: data.length, reconciled };
}

/**
 * Bounded retention cleanup: deletes completed / failed_not_acted records whose
 * expiry passed more than ENGAGEMENT_REQUEST_PURGE_GRACE_MS ago. Never touches
 * reserved or uncertain records.
 */
export async function purgeExpiredEngagementRequests(
  db: DbClient,
  opts: { organizationId?: string; limit?: number; nowMs?: number } = {},
): Promise<{ deleted: number }> {
  const now = opts.nowMs ?? Date.now();
  const cutoff = iso(now - ENGAGEMENT_REQUEST_PURGE_GRACE_MS);
  const limit = Math.max(1, Math.min(opts.limit ?? 100, ENGAGEMENT_REQUEST_PURGE_MAX));
  let q = db.from(ENGAGEMENT_REQUEST_TABLE).select('id').in('state', ['completed', 'failed_not_acted']).lt('expires_at', cutoff);
  if (opts.organizationId) q = q.eq('organization_id', opts.organizationId);
  const { data, error } = await q.limit(limit);
  if (error || !Array.isArray(data) || data.length === 0) return { deleted: 0 };
  const ids = (data as Array<{ id: string }>).map((r) => r.id);
  let del = db.from(ENGAGEMENT_REQUEST_TABLE).delete().in('id', ids).in('state', ['completed', 'failed_not_acted']).lt('expires_at', cutoff);
  if (opts.organizationId) del = del.eq('organization_id', opts.organizationId);
  const { error: delErr } = await del;
  return { deleted: delErr ? 0 : ids.length };
}

/** Actor id for the record namespace: the server-derived user, never client input. */
export function requestActorId(userId: string | null | undefined): string {
  return userId && String(userId).trim() ? String(userId).trim() : 'no-user';
}
