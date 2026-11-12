/**
 * Follow-up A to Work Item 2 (L-4): the unconfirmed-send sweep.
 *
 * A recipient whose send outcome is unknown stays `send_uncertain` (or `sending`, when the
 * process died after the claim) with no message id. Work Item 2 reconciles it when a status
 * webhook carries its marker for the same number. This sweep covers what that path cannot:
 * a webhook job that ran out of attempts after the event was recorded, and rows for which
 * no evidence ever arrived.
 *
 * For ONE tenant, a bounded page of rows older than a configurable age:
 *   - verified provider evidence in whatsapp_provider_events (verified_recipient_id, written
 *     by the webhook job only after the marker AND the number matched) for exactly one
 *     message id: the message id is attached and the events are applied through the same
 *     forward-only rule as the webhook (foldDeliveryEvidence), atomically with an audit row
 *     (whatsapp_attach_unconfirmed_send). A permanent failure writes the N-2 restriction
 *     first, as the webhook path does.
 *   - evidence naming two message ids: nothing changes; flagged for an operator.
 *   - no evidence: nothing is inferred. A stale `sending` row becomes `send_uncertain` (its
 *     outcome IS unknown), never `failed`; the row is flagged for an operator.
 *
 * Never: a provider call, a resend, a `failed` without a provider event saying so, a queue
 * job. Idempotent: every write is compare-and-set inside a database function, and the audit
 * collapses on (recipient, outcome). Meta's Cloud API offers no message-status read, so
 * webhook events are the only authoritative evidence; no other check exists to call.
 *
 * NOT scheduled anywhere. Nothing calls sweepUnconfirmedWhatsAppSends in production; a
 * scheduler or worker needs a separate owner decision. Counters are not touched here
 * (Follow-up B).
 */

import crypto from 'crypto';
import { ownedDbRpc, ownedDbTable } from '../db/writeOwner';
import {
  WHATSAPP_EVENT_CLOCK_SKEW_MS,
  WHATSAPP_SEND_TIMEOUT_MS,
  foldDeliveryEvidence,
  recordInvalidContact,
  type DeliveryEvidenceEvent,
} from './whatsappBroadcastService';

/** The floor on the age threshold: far above one provider call, so a live send is never swept. */
export const WHATSAPP_UNCONFIRMED_MIN_STALE_MS = 5 * 60_000;
export const WHATSAPP_UNCONFIRMED_DEFAULT_STALE_MS = 30 * 60_000;
export const WHATSAPP_UNCONFIRMED_DEFAULT_BATCH = 100;
export const WHATSAPP_UNCONFIRMED_MAX_BATCH = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnconfirmedSendSweepOptions {
  companyId: string;
  /** Default: WHATSAPP_UNCONFIRMED_STALE_AFTER_MS, else 30 minutes. Never below 5 minutes. */
  staleAfterMs?: number;
  /** Default: WHATSAPP_UNCONFIRMED_SWEEP_BATCH, else 100. At most 500. */
  batchSize?: number;
  now?: Date;
}

export interface UnconfirmedSendSweepResult {
  runId: string;
  examined: number;
  attached: number;
  markedUncertain: number;
  flaggedForReview: number;
  conflicting: number;
  /** Resolved by someone else (a webhook) between the read and the write. */
  alreadyResolved: number;
  errors: Array<{ recipientId: string; code: string }>;
}

export interface UnconfirmedSend {
  recipient_id: string;
  broadcast_id: string;
  status: 'sending' | 'send_uncertain';
  stale_since: string;
  has_evidence: boolean;
  flagged: boolean;
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

/** Threshold and page size, validated: a misconfiguration refuses, it never widens the sweep. */
export function resolveSweepConfig(opts: Pick<UnconfirmedSendSweepOptions, 'staleAfterMs' | 'batchSize'>): { staleAfterMs: number; batchSize: number } {
  const staleAfterMs = opts.staleAfterMs ?? envNumber('WHATSAPP_UNCONFIRMED_STALE_AFTER_MS') ?? WHATSAPP_UNCONFIRMED_DEFAULT_STALE_MS;
  const batchSize = opts.batchSize ?? envNumber('WHATSAPP_UNCONFIRMED_SWEEP_BATCH') ?? WHATSAPP_UNCONFIRMED_DEFAULT_BATCH;
  if (!(staleAfterMs >= WHATSAPP_UNCONFIRMED_MIN_STALE_MS)) {
    throw new Error(`unconfirmed-send sweep: staleAfterMs ${staleAfterMs} is below the ${WHATSAPP_UNCONFIRMED_MIN_STALE_MS} ms floor (a send takes up to ${WHATSAPP_SEND_TIMEOUT_MS} ms)`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > WHATSAPP_UNCONFIRMED_MAX_BATCH) {
    throw new Error(`unconfirmed-send sweep: batchSize must be an integer from 1 to ${WHATSAPP_UNCONFIRMED_MAX_BATCH}`);
  }
  return { staleAfterMs, batchSize };
}

function assertTenant(companyId: unknown): asserts companyId is string {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) throw new Error('unconfirmed-send sweep: a tenant (company id) is required');
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ownedDbRpc(fn, args);
  if (error) throw Object.assign(new Error(`${fn}: ${(error as { message?: string }).message ?? 'failed'}`), { code: 'rpc_failed' });
  return data as T;
}

/** A boolean function's answer: PostgREST returns the bare value; only `true` counts. */
async function rpcTrue(fn: string, args: Record<string, unknown>): Promise<boolean> {
  const data = await rpc<unknown>(fn, args);
  const row = Array.isArray(data) && data.length === 1 ? (data[0] as Record<string, unknown>) : null;
  return (row && typeof row === 'object' && fn in row ? row[fn] : data) === true;
}

/**
 * Stale unconfirmed sends of one tenant, rows with evidence first, then rows not yet flagged,
 * oldest first. Also the operator view: what is still unresolved and whether it is flagged.
 */
export async function listUnconfirmedWhatsAppSends(opts: { companyId: string; staleAfterMs?: number; limit?: number; now?: Date }): Promise<UnconfirmedSend[]> {
  assertTenant(opts.companyId);
  const { staleAfterMs, batchSize } = resolveSweepConfig({ staleAfterMs: opts.staleAfterMs, batchSize: opts.limit });
  const cutoff = new Date((opts.now ?? new Date()).getTime() - staleAfterMs).toISOString();
  const rows = await rpc<UnconfirmedSend[] | null>('whatsapp_unconfirmed_sends', {
    p_company_id: opts.companyId,
    p_cutoff:     cutoff,
    p_limit:      batchSize,
  });
  return rows ?? [];
}

type LedgerEvent = DeliveryEvidenceEvent & { id: string; wa_message_id: string };

export async function sweepUnconfirmedWhatsAppSends(opts: UnconfirmedSendSweepOptions): Promise<UnconfirmedSendSweepResult> {
  assertTenant(opts.companyId);
  const companyId = opts.companyId;
  const { staleAfterMs, batchSize } = resolveSweepConfig(opts);
  const cutoff = new Date((opts.now ?? new Date()).getTime() - staleAfterMs).toISOString();
  const runId = crypto.randomUUID();
  const result: UnconfirmedSendSweepResult = {
    runId, examined: 0, attached: 0, markedUncertain: 0, flaggedForReview: 0, conflicting: 0, alreadyResolved: 0, errors: [],
  };

  const candidates = await listUnconfirmedWhatsAppSends({ companyId, staleAfterMs, limit: batchSize, now: opts.now });

  const flag = async (recipientId: string, outcome: 'awaiting_operator_review' | 'conflicting_provider_evidence'): Promise<boolean> =>
    rpcTrue('whatsapp_flag_unconfirmed_send', {
      p_company_id: companyId, p_recipient_id: recipientId, p_outcome: outcome, p_sweep_run_id: runId,
    });

  for (const c of candidates) {
    result.examined++;
    try {
      // Evidence of THIS send only (CLASS-2): a retried recipient keeps its marker, so the ledger
      // also holds the earlier, failed message's events. Those predate the current claim
      // (stale_since = send_started_at) and are never attached to it.
      const claimedAt = new Date(c.stale_since).getTime();
      if (!Number.isFinite(claimedAt)) throw Object.assign(new Error('send time unknown'), { code: 'send_time_unknown' });
      const sendNotBefore = new Date(claimedAt - WHATSAPP_EVENT_CLOCK_SKEW_MS).toISOString();
      const { data: evidence, error } = await ownedDbTable('whatsapp_provider_events')
        .select('id, wa_message_id, event_status, event_at, error_code, error_title')
        .eq('verified_recipient_id', c.recipient_id)
        .gte('event_at', sendNotBefore)
        .order('event_at', { ascending: true });
      if (error) throw Object.assign(new Error('evidence unreadable'), { code: 'evidence_unreadable' });
      const events: LedgerEvent[] = (evidence ?? []).map((e: Record<string, unknown>) => ({
        id:            String(e.id),
        wa_message_id: String(e.wa_message_id),
        status:        e.event_status as LedgerEvent['status'],
        event_at:      new Date(String(e.event_at)).toISOString(),
        error_code:    typeof e.error_code === 'number' ? e.error_code : null,
        error_title:   typeof e.error_title === 'string' ? e.error_title : null,
      }));

      if (events.length === 0) {
        // No evidence: unknown stays unknown. Never failed, never resent.
        if (c.status === 'sending') {
          const marked = await rpcTrue('whatsapp_mark_stale_send_uncertain', {
            p_company_id: companyId, p_recipient_id: c.recipient_id, p_cutoff: cutoff, p_sweep_run_id: runId,
          });
          if (marked) result.markedUncertain++;
        }
        if (await flag(c.recipient_id, 'awaiting_operator_review')) result.flaggedForReview++;
        continue;
      }

      const messageIds = [...new Set(events.map((e) => e.wa_message_id))];
      if (messageIds.length !== 1) {
        // Two messages claim this recipient: a person decides, nothing is attached.
        if (await flag(c.recipient_id, 'conflicting_provider_evidence')) result.conflicting++;
        if (await flag(c.recipient_id, 'awaiting_operator_review')) result.flaggedForReview++;
        continue;
      }

      const state = foldDeliveryEvidence(events);
      if (state.permanentFailureCode !== null) {
        // N-2 before the move, as on the webhook path: a failed write leaves the row a
        // candidate, and the restriction collapses on its canonical key when retried.
        const { data: row, error: rowError } = await ownedDbTable('whatsapp_broadcast_recipients')
          .select('id, encrypted_phone')
          .eq('id', c.recipient_id)
          .eq('broadcast_id', c.broadcast_id)
          .maybeSingle();
        if (rowError || !row) throw Object.assign(new Error('recipient unreadable'), { code: 'recipient_unreadable' });
        await recordInvalidContact(companyId, String(row.encrypted_phone), messageIds[0], state.permanentFailureCode, c.recipient_id);
      }

      const attached = await rpcTrue('whatsapp_attach_unconfirmed_send', {
        p_company_id:         companyId,
        p_recipient_id:       c.recipient_id,
        p_wa_message_id:      messageIds[0],
        p_status:             state.status,
        p_sent_at:            state.sent_at,
        p_delivered_at:       state.delivered_at,
        p_read_at:            state.read_at,
        p_error_code:         state.error_code,
        p_error_message:      state.error_message,
        p_evidence_event_ids: events.map((e) => e.id),
        p_sweep_run_id:       runId,
      });
      if (attached) result.attached++;
      else result.alreadyResolved++;
    } catch (err) {
      // One row's failure never stops the page; the row stays a candidate for the next run.
      const code = (err as { code?: unknown }).code;
      result.errors.push({ recipientId: c.recipient_id, code: typeof code === 'string' ? code : 'unexpected' });
    }
  }
  return result;
}
