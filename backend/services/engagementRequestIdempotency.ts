/**
 * Request-level idempotency for the engagement reply / like endpoints.
 *
 * The external action is recorded as ONE community_ai_actions row whose
 * primary key is derived here, deterministically, from the request identity.
 * executeAction(..., { persist: true, auto_insert: true }) inserts that row
 * already claimed ('executing') and REFUSES to act when a row with the id
 * already exists (retry, concurrent duplicate, or an earlier outcome). The
 * primary key is therefore the durable, atomic serialisation point: N
 * identical requests — sequential or concurrent, on any instance — perform the
 * platform action at most once. No second ledger: the action row is the
 * record.
 *
 * Key binding: tenant (organization) + acting user + action type + target.
 *   - With a client `Idempotency-Key` header, that key completes the identity:
 *     a retry with the same key replays; a new key is a new intent.
 *   - Without one (current UI clients send none), the identity is completed by
 *     a hash of the content and a 5-minute bucket: an identical retry or
 *     double-click inside the bucket is the same request.
 *
 * Unlike withIdempotency (api_idempotency_keys), a 5xx or a stale lock never
 * re-runs the action: the action row, not the HTTP response, decides.
 */

import { createHash } from 'crypto';
import type { NextApiRequest } from 'next';

export const ENGAGEMENT_IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000;
const CLIENT_KEY_SHAPE = /^[A-Za-z0-9._:\-]{8,200}$/;

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
  // Shape a sha256 digest as an RFC-4122 version-5-style UUID (variant 10xx),
  // so it is a valid value for the uuid primary key.
  const h = hex.slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20, 32)].join('-');
}

/**
 * Deterministic community_ai_actions.id for one engagement request.
 * Every component is server-derived except `clientKey` / `content`.
 */
export function deriveEngagementActionId(input: {
  scope: 'engagement-reply' | 'engagement-like';
  organizationId: string;
  userId: string | null;
  actionType: string;
  targetId: string;
  clientKey: string | null;
  content?: string | null;
  nowMs?: number;
}): string {
  const identity = input.clientKey
    ? ['client', input.clientKey]
    : [
        'auto',
        createHash('sha256').update(input.content ?? '').digest('hex'),
        String(Math.floor((input.nowMs ?? Date.now()) / ENGAGEMENT_IDEMPOTENCY_BUCKET_MS)),
      ];
  const basis = [
    'engagement-request-v1',
    input.scope,
    input.organizationId,
    input.userId ?? '',
    input.actionType,
    input.targetId,
    ...identity,
  ].join('\u001f');
  return uuidFromDigest(createHash('sha256').update(basis).digest('hex'));
}

/**
 * HTTP answer for a request whose action row already existed (the executor
 * did NOT act again). `null` = not a replay. A queued browser action
 * ('pending') is left to the caller's queued response.
 */
export function replayResponseFor(result: { deduplicated?: boolean; status?: unknown; prior_action_id?: string | null }):
  | { status: number; body: Record<string, unknown> }
  | null {
  if (result.deduplicated !== true) return null;
  const prior = String(result.status ?? '');
  const base = { replayed: true, prior_status: prior, action_id: result.prior_action_id ?? null };
  if (prior === 'executed' || prior === 'sent_unverified') {
    return { status: 200, body: { success: true, status: prior, ...base } };
  }
  if (prior === 'pending') return null;
  if (prior === 'executing' || prior === 'dispatched' || prior === 'acknowledged' || prior === 'approved' || prior === 'scheduled') {
    return { status: 409, body: { error: 'This request is already in progress', code: 'REQUEST_IN_PROGRESS', ...base } };
  }
  if (prior === 'uncertain') {
    return {
      status: 409,
      body: {
        error: 'The outcome of this request is uncertain and needs review; it will not be sent again automatically.',
        code: 'OUTCOME_UNCERTAIN',
        ...base,
      },
    };
  }
  return {
    status: 409,
    body: {
      error: 'This request was already processed and did not complete. Retry with a new Idempotency-Key to try again.',
      code: 'DUPLICATE_REQUEST',
      ...base,
    },
  };
}
