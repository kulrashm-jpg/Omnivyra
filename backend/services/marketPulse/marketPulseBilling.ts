/**
 * Market Pulse billing (OWNER ruling 2026-11-14 via e9; design D1(a) + D2(a) approved).
 *
 *   PRICE   8 credits per region (the owner's per-region price), action 'market_pulse' (its own ledger line).
 *   HOLD    8 x AI regions, reserved at run start BEFORE anything is written, for every door: the on-demand run
 *           (/api/market-pulse/run), the legacy one-time job (/api/market-pulse/job/create) and the automated cron.
 *           A refused hold = 402 (on demand) / skip (cron): no job row, no run, no AI call.
 *   SETTLE  8 x regions COMPLETED (an AI region that returned topics), capped at the hold; the remainder is released
 *           (owner rule "partial = actual + return the rest"). Zero completed = full release.
 *
 * Rate-independent: hold and settle are integer credit counts (amountOverride / confirm-to-actual), never USD converted
 * at an org's credit_rate_usd, so the pending rate equalisation cannot move them.
 *
 * 'api'-source runs make NO AI call (DB aggregation only), so they hold nothing and are not charged.
 * The HOLD is the gate: the client's credit_acknowledged boolean is never used as authorisation.
 */
import {
  confirmCreditReservationToActual,
  makeIdempotencyKey,
  releaseCreditReservation,
  reserveCreditsForWork,
  type CreditReservationHandle,
} from '../creditExecutionService';

export const MARKET_PULSE_ACTION = 'market_pulse' as const;
export const MARKET_PULSE_CREDITS_PER_REGION = 8;
export const MARKET_PULSE_REFERENCE_TYPE = 'market_pulse_run';

export type MarketPulseInsightSource = 'api' | 'llm' | 'hybrid' | 'ai';

/** Regions that make an AI call (and are therefore billed). 'api' = DB-only. */
export function billableRegionCount(regions: readonly string[], insightSource: MarketPulseInsightSource | undefined): number {
  if (insightSource === 'api') return 0;
  return Math.max(1, regions.length);
}

export type MarketPulseHoldResult =
  | { ok: true; reservation: CreditReservationHandle | null; credits: number }
  | { ok: false; status: 402 | 403 | 409 | 503; code: string; retryable: boolean; error: string; required?: number; available?: number };

/**
 * Reserve the run's credits. `jobId` is the pre-generated market_pulse_jobs_v1 id (the hold precedes the insert).
 * Refusals are typed; nothing is written by this function except the ledger HOLD itself on success.
 */
export async function holdMarketPulseRun(args: {
  orgId: string;
  userId: string;
  jobId: string;
  regions: readonly string[];
  insightSource: MarketPulseInsightSource | undefined;
  validateMembership: boolean;
}): Promise<MarketPulseHoldResult> {
  const billable = billableRegionCount(args.regions, args.insightSource);
  if (billable === 0) return { ok: true, reservation: null, credits: 0 };
  const credits = billable * MARKET_PULSE_CREDITS_PER_REGION;
  let r;
  try {
    r = await reserveCreditsForWork({
      userId: args.userId,
      orgId: args.orgId,
      action: MARKET_PULSE_ACTION,
      referenceType: MARKET_PULSE_REFERENCE_TYPE,
      referenceId: args.jobId,
      idempotencyKey: makeIdempotencyKey(args.orgId, MARKET_PULSE_ACTION, args.jobId),
      amountOverride: credits,
      note: `Market Pulse: ${billable} region(s) x ${MARKET_PULSE_CREDITS_PER_REGION} credits`,
      validateMembership: args.validateMembership,
    });
  } catch (err) {
    return { ok: false, status: 503, code: 'BILLING_UNAVAILABLE', retryable: true, error: `Market Pulse credit hold failed: ${(err as Error)?.message ?? 'unknown'}` };
  }
  if (r.status === 'reserved' || r.status === 'already_reserved') {
    const { status: _s, ...handle } = r;
    return { ok: true, reservation: handle as CreditReservationHandle, credits };
  }
  if (r.status === 'insufficient_credits') {
    return { ok: false, status: 402, code: 'INSUFFICIENT_CREDITS', retryable: false, error: 'Not enough credits for this Market Pulse run.', required: r.required, available: r.available };
  }
  if (r.status === 'no_credit_account') {
    return { ok: false, status: 402, code: 'NO_CREDIT_ACCOUNT', retryable: false, error: 'No credit account for this company.' };
  }
  if (r.status === 'not_a_member') {
    return { ok: false, status: 403, code: 'NOT_A_MEMBER', retryable: false, error: 'Not a member of this company.' };
  }
  if (r.status === 'org_control_blocked') {
    return { ok: false, status: 403, code: r.code, retryable: false, error: r.reason };
  }
  // already_confirmed / already_released: this job id was billed before - never run it again on the same key.
  return { ok: false, status: 409, code: 'RESERVATION_ALREADY_SETTLED', retryable: false, error: `Market Pulse reservation is ${r.status}.` };
}

/** The persisted form (market_pulse_jobs_v1.context_payload.credit_reservation). */
export function readPersistedReservation(contextPayload: unknown): CreditReservationHandle | null {
  const c = (contextPayload as { credit_reservation?: Record<string, unknown> } | null)?.credit_reservation;
  if (!c || typeof c !== 'object') return null;
  const need = ['orgId', 'userId', 'action', 'referenceType', 'referenceId', 'idempotencyKey', 'holdTransactionId', 'creditsReserved', 'split'];
  if (need.some((k) => (c as Record<string, unknown>)[k] === undefined || (c as Record<string, unknown>)[k] === null)) return null;
  return c as unknown as CreditReservationHandle;
}

/** Release a hold whose run never started (insert / run creation / enqueue failed after the hold). */
export async function releaseMarketPulseHold(handle: CreditReservationHandle | null, reason: string): Promise<void> {
  if (!handle) return;
  await releaseCreditReservation({ ...handle, note: `Market Pulse not started: ${reason.slice(0, 120)}` });
}

/**
 * Settle a finished (or cancelled / partially failed) run: 8 x completed regions, capped at the hold; the rest is
 * released by the same partial-confirm primitive. Zero completed regions = full release. Idempotent (fixed keys).
 */
export async function settleMarketPulseRun(handle: CreditReservationHandle | null, completedRegions: number): Promise<{ charged: number }> {
  if (!handle) return { charged: 0 };
  const actual = Math.min(handle.creditsReserved, Math.max(0, Math.floor(completedRegions)) * MARKET_PULSE_CREDITS_PER_REGION);
  if (actual <= 0) {
    await releaseCreditReservation({ ...handle, note: 'Market Pulse: no region completed - hold released' });
    return { charged: 0 };
  }
  await confirmCreditReservationToActual({ ...handle, note: `Market Pulse: ${completedRegions} region(s) completed` }, actual);
  return { charged: actual };
}

/**
 * OWNER 2026-11-14: automated Market Pulse runs at the company's chosen cadence ('weekly' default, or 'daily').
 * Due when it never ran, or the last run is at least one period ago (minus one hour so a daily 04:30 tick never slips a
 * day). Any value other than 'daily' is treated as weekly (the conservative, cheaper cadence).
 */
export function isMarketPulseRunDue(cadence: string | null | undefined, lastRunAt: string | null | undefined, now: Date): boolean {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt).getTime();
  if (!Number.isFinite(last)) return true;
  const periodHours = cadence === 'daily' ? 24 : 7 * 24;
  return now.getTime() - last >= (periodHours - 1) * 3600_000;
}

/**
 * Cancel a Market Pulse job, owning its hold correctly (05, 2026-11-14). A PENDING job was never claimed by the
 * processor, so nothing else will ever settle it: the conditional PENDING -> FAILED update (mutually exclusive with the
 * processor's conditional PENDING -> RUNNING claim) releases the hold when IT wins. A RUNNING job is cancelled by status
 * only - the processor observes the cancel and its finally settles the completed regions and releases the rest.
 */
export async function cancelMarketPulseJob(jobId: string, cancelledError: string): Promise<{ ok: boolean; wasPending: boolean }> {
  const { supabase } = await import('../../db/supabaseClient');
  const patch = { status: 'FAILED', error: cancelledError, completed_at: new Date().toISOString() };
  const pending = await supabase.from('market_pulse_jobs_v1').update(patch)
    .eq('id', jobId).eq('status', 'PENDING').select('id, context_payload');
  if (pending.error) return { ok: false, wasPending: false };
  const rows = (pending.data ?? []) as Array<{ context_payload?: unknown }>;
  if (rows.length === 1) {
    await releaseMarketPulseHold(readPersistedReservation(rows[0].context_payload), 'cancelled before start');
    return { ok: true, wasPending: true };
  }
  const running = await supabase.from('market_pulse_jobs_v1').update(patch).eq('id', jobId).eq('status', 'RUNNING');
  return { ok: !running.error, wasPending: false };
}
