/**
 * Orchestration, Follow-up D-2 — the ONE claim of an engine request (`requested -> submitting`)
 * for engines that use the request ledger (WhatsApp, community).
 *
 * It calls public.orch_claim_engine_request (migration 20270129000001), which in one transaction
 * takes the person's advisory lock, reads their contact history, applies the frequency gap and
 * makes the claim. Two journeys of one person can therefore never both pass the gap and both
 * claim. See the migration header for the transaction flow and the lock rules.
 *
 * It answers like the compare-and-set it replaces (true: this caller claimed), and reports WHY
 * nothing was claimed through `options.verdict`, so an adapter can tell "another caller holds
 * it" from "the frequency policy defers it" from "the history is contradictory".
 *
 * FAILS CLOSED: a database error, a lock timeout (55P03) or an answer it cannot read claims
 * nothing (`unavailable`), so the step waits; it never falls back to an unguarded claim.
 */

import { ownedDbRpc } from '../../db/writeOwner';
import { NON_CONTACT_CHANNELS } from './journeyPolicy';

export const ENGINE_REQUEST_CLAIM_RPC = 'orch_claim_engine_request';

export type ClaimVerdict =
  | { readonly outcome: 'deferred'; readonly lastContactAt: string; readonly basis: 'completed' | 'possible_contact' }
  | { readonly outcome: 'invalid_history' }
  | { readonly outcome: 'task_not_found' }
  | { readonly outcome: 'unavailable'; readonly code: string };

export interface ClaimOptions {
  /** The step policy's minimum gap between actions, in hours; absent or <= 0 means no gap. */
  gapHours?: number | null;
  /** The sweep's clock (the same `now` the sweeper decided with). */
  now?: string;
  /** Written with the claim, once (the community action id). */
  externalRef?: string | null;
  /** Set when nothing was claimed for a reason other than "another caller holds it". */
  verdict?: ClaimVerdict;
}

const rowOf = (data: unknown): Record<string, unknown> | null => {
  if (Array.isArray(data)) return data.length === 1 && data[0] && typeof data[0] === 'object' ? (data[0] as Record<string, unknown>) : null;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
};

export async function claimEngineRequest(
  organizationId: string,
  executionTaskId: string,
  options: ClaimOptions = {},
): Promise<boolean> {
  const gap = typeof options.gapHours === 'number' && options.gapHours > 0 ? options.gapHours : null;
  let res: { data: unknown; error: unknown };
  try {
    res = await ownedDbRpc(ENGINE_REQUEST_CLAIM_RPC, {
      p_organization_id: organizationId,
      p_execution_task_id: executionTaskId,
      p_external_ref: options.externalRef ?? null,
      p_min_gap_hours: gap,
      p_now: options.now ?? new Date().toISOString(),
      p_non_contact_channels: [...NON_CONTACT_CHANNELS],
    }) as { data: unknown; error: unknown };
  } catch (e) {
    options.verdict = { outcome: 'unavailable', code: String((e as { code?: unknown })?.code ?? 'claim_failed') };
    return false;
  }
  if (res.error) {
    options.verdict = { outcome: 'unavailable', code: String((res.error as { code?: unknown })?.code ?? 'claim_failed') };
    return false;
  }
  const row = rowOf(res.data);
  const outcome = row?.outcome;
  switch (outcome) {
    case 'claimed':
      return true;
    case 'not_claimed':
      return false;
    case 'deferred': {
      const at = row?.last_contact_at;
      const basis = row?.basis;
      if (typeof at !== 'string' || Number.isNaN(Date.parse(at)) || (basis !== 'completed' && basis !== 'possible_contact')) {
        options.verdict = { outcome: 'unavailable', code: 'claim_answer_unreadable' };
        return false;
      }
      options.verdict = { outcome: 'deferred', lastContactAt: at, basis };
      return false;
    }
    case 'invalid_history':
    case 'task_not_found':
      options.verdict = { outcome };
      return false;
    default:
      options.verdict = { outcome: 'unavailable', code: 'claim_answer_unreadable' };
      return false;
  }
}

/** How an adapter reports a claim that took nothing, or null when another caller simply holds it. */
export function claimRefusal(verdict: ClaimVerdict | undefined, gapHours: number | null | undefined, now: string | undefined):
  { outcome: string; reason: string } | null {
  if (verdict === undefined) return null;
  switch (verdict.outcome) {
    case 'deferred': {
      const nowMs = Date.parse(now ?? new Date().toISOString());
      const since = (nowMs - Date.parse(verdict.lastContactAt)) / 3_600_000;
      const what = verdict.basis === 'completed'
        ? 'the person was contacted'
        : 'a communication to the person is queued or unconfirmed (possible contact, not a confirmed send)';
      return { outcome: 'frequency_deferred', reason: `${what} ${since.toFixed(1)}h ago; policy requires ${gapHours ?? '?'}h; nothing was claimed` };
    }
    case 'invalid_history':
      return { outcome: 'frequency_history_invalid', reason: 'a possible contact of this person has no recorded queue time; fail closed, nothing was claimed' };
    case 'task_not_found':
      return { outcome: 'request_unavailable', reason: 'the execution task was not found in this tenant; nothing was claimed' };
    case 'unavailable':
      return { outcome: 'claim_unavailable', reason: `the claim could not be made (${verdict.code}); nothing was claimed` };
  }
}
