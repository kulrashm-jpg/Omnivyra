/**
 * Purchase closure — P1 (Truth & Safety).
 *
 * THE single place a top-up purchase is closed without a provider success.
 * Two callers, one rule:
 *
 *   M5  closePurchaseFromClient()      the browser reported failure/cancel
 *   B3  expireStalePendingPurchases()  a pending purchase outlived its TTL
 *
 * The rule both obey: **ask the provider first**. A client claim and the clock
 * are both weaker evidence than the gateway. Before any close we call
 * `resolveProviderOrderOutcome`, and:
 *
 *   paid    → FULFILL (the payment is real; closing it would strand money)
 *   unpaid  → close
 *   unknown → do nothing, leave pending, retry next sweep
 *
 * `unknown` is deliberately not "unpaid". A Razorpay outage must never look
 * like a customer who did not pay.
 *
 * Closures are recorded in `credit_purchases.provider_payload.closure` with
 * `reopenable: true`, because the DB CHECK on `status` admits only
 * ('pending','completed','failed') — there is no 'expired'/'cancelled' value to
 * write, and inventing one would need a migration this phase does not require.
 * The marker is what lets `reopenSystemClosedPurchase` distinguish "we closed
 * this" from "the provider declined this", so a late webhook can still be
 * honoured and a genuinely declined payment can never be resurrected.
 *
 * This module grants no credits of its own. Fulfillment always runs through the
 * existing idempotent `completePurchase` → `createCredit` path.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { completePurchase, reopenSystemClosedPurchase } from '../purchaseService';
import { generateTopupInvoice } from './topupInvoiceService';
import { resolveProviderOrderOutcome } from '../payments/orchestrator';
import type { PaymentProviderId } from '../payments/orchestrator';

/** How long an unresolved checkout may stay pending before the sweeper acts. */
const DEFAULT_CHECKOUT_TTL_MINUTES = 30;
/** Safety cap so one sweep can never fan out unboundedly. */
const DEFAULT_SCAN_LIMIT = 200;

export type ClosureReason = 'client_reported_failure' | 'client_cancelled' | 'stale_pending_expiry';

export type ClosureAction =
  | 'closed'              // provider said unpaid → purchase moved to failed
  | 'fulfilled'           // provider said paid → credits granted instead
  | 'deferred_unknown'    // provider could not be reached → left pending
  | 'already_completed'   // terminal success, untouched
  | 'already_closed'      // terminal failure, untouched (idempotent)
  | 'not_found';

export interface ClosureOutcome {
  purchaseId: string;
  action: ClosureAction;
  detail?: string;
}

interface PurchaseRow {
  id: string;
  organization_id: string;
  status: string | null;
  fulfillment_status: string | null;
  provider: string | null;
  provider_order_id: string | null;
  provider_payload: Record<string, unknown> | null;
  created_at: string;
}

const PURCHASE_COLUMNS =
  'id, organization_id, status, fulfillment_status, provider, provider_order_id, provider_payload, created_at';

function ttlMinutes(): number {
  const raw = Number(process.env.PAYMENT_CHECKOUT_TTL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHECKOUT_TTL_MINUTES;
}

/**
 * Grant for a purchase the PROVIDER has confirmed as paid. Reopens a
 * system-closed row first so a late confirmation is never lost, then defers
 * entirely to the existing idempotent fulfillment.
 */
export async function fulfillProviderConfirmedPurchase(
  purchaseId: string,
  providerPaymentId?: string,
): Promise<{ ok: boolean; creditsGranted?: number; detail?: string }> {
  const fulfillable = await reopenSystemClosedPurchase(purchaseId);
  if (!fulfillable) {
    logger.warn('payment_fulfillment_blocked', { purchaseId, reason: 'not_reopenable' });
    return { ok: false, detail: 'purchase_not_reopenable' };
  }

  const result = await completePurchase(purchaseId, providerPaymentId || undefined);
  if (!result.success) {
    logger.error('payment_reconciliation_failed', {
      purchaseId, reason: (result as { reason?: string }).reason ?? 'unknown',
    });
    return { ok: false, detail: (result as { reason?: string }).reason ?? 'fulfillment_failed' };
  }

  try { await generateTopupInvoice(purchaseId); }
  catch (e) { logger.warn('payment_invoice_deferred', { purchaseId, message: e instanceof Error ? e.message : String(e) }); }

  logger.info('payment_fulfillment_completed', {
    purchaseId, creditsGranted: result.creditsGranted, source: 'provider_confirmed',
  });
  return { ok: true, creditsGranted: result.creditsGranted };
}

/**
 * Close one purchase, provider-first. Shared by M5 and B3 so both can never
 * drift apart on the race rule.
 */
async function closeOnePurchase(row: PurchaseRow, reason: ClosureReason): Promise<ClosureOutcome> {
  const purchaseId = row.id;

  // Terminal states are untouchable — a completed purchase must never be
  // downgraded, and a second close is a no-op, not an error.
  if (row.status === 'completed') {
    return { purchaseId, action: 'already_completed' };
  }
  if (row.status === 'failed') {
    return { purchaseId, action: 'already_closed' };
  }

  // Provider is the authority. No provider order means nothing was ever
  // presented for payment, so there is nothing the provider could confirm.
  let outcome: Awaited<ReturnType<typeof resolveProviderOrderOutcome>> = {
    outcome: 'unpaid', providerRawStatus: 'no_provider_order',
  };
  if (row.provider && row.provider_order_id) {
    outcome = await resolveProviderOrderOutcome(row.provider as PaymentProviderId, row.provider_order_id);
  }

  if (outcome.outcome === 'paid') {
    // The client said failed / the clock said stale — the provider says paid.
    // Provider wins, always.
    logger.warn('payment_close_overridden_by_provider', {
      purchaseId, reason, providerRawStatus: outcome.providerRawStatus ?? null,
    });
    const f = await fulfillProviderConfirmedPurchase(purchaseId, outcome.providerPaymentId);
    return f.ok
      ? { purchaseId, action: 'fulfilled', detail: 'provider_confirmed_paid' }
      : { purchaseId, action: 'deferred_unknown', detail: f.detail };
  }

  if (outcome.outcome === 'unknown') {
    // Never convert an outage into a closure. Leave it pending for the next sweep.
    logger.warn('payment_close_deferred', { purchaseId, reason, detail: outcome.reason ?? 'provider_unreachable' });
    return { purchaseId, action: 'deferred_unknown', detail: outcome.reason };
  }

  // Provider-confirmed unpaid → safe to close.
  const payload = (row.provider_payload ?? {}) as Record<string, unknown>;
  const { data: updated } = await ownedDbTable('credit_purchases')
    .update({
      status: 'failed',
      fulfillment_status: 'failed',
      provider_payload: {
        ...payload,
        closure: {
          reason,
          at: new Date().toISOString(),
          source: 'omnivyra',
          provider_raw_status: outcome.providerRawStatus ?? null,
          // We closed this, not the provider — a later provider-confirmed
          // success may reopen it. See reopenSystemClosedPurchase.
          reopenable: true,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', purchaseId)
    .eq('status', 'pending')   // CAS — a concurrent completion wins
    .select('id')
    .maybeSingle();

  if (!updated) {
    // Someone completed it between our read and our write. Correct outcome.
    return { purchaseId, action: 'already_completed', detail: 'raced_to_completion' };
  }

  logger.info(reason === 'stale_pending_expiry' ? 'payment_pending_expired' : 'payment_cancelled', {
    purchaseId, organizationId: row.organization_id, reason,
    providerRawStatus: outcome.providerRawStatus ?? null,
  });
  return { purchaseId, action: 'closed' };
}

/**
 * M5 — close a purchase the browser reported as failed or cancelled.
 *
 * Ownership is enforced by the caller's org guard AND re-checked here: the
 * purchase must belong to `organizationId` or we report not_found rather than
 * leak that the id exists.
 */
export async function closePurchaseFromClient(args: {
  purchaseId: string;
  organizationId: string;
  reason: Extract<ClosureReason, 'client_reported_failure' | 'client_cancelled'>;
}): Promise<ClosureOutcome> {
  const { data } = await supabase
    .from('credit_purchases')
    .select(PURCHASE_COLUMNS)
    .eq('id', args.purchaseId)
    .maybeSingle();

  const row = data as PurchaseRow | null;
  if (!row || row.organization_id !== args.organizationId) {
    return { purchaseId: args.purchaseId, action: 'not_found' };
  }

  logger.info('payment_failed', {
    purchaseId: args.purchaseId, organizationId: args.organizationId,
    reason: args.reason, source: 'client_report',
  });

  return closeOnePurchase(row, args.reason);
}

export interface ExpirySweepResult {
  scanned: number;
  closed: number;
  fulfilled: number;
  deferred: number;
  untouched: number;
  ttlMinutes: number;
  details: ClosureOutcome[];
}

/**
 * B3 — close pending purchases that outlived the checkout TTL.
 *
 * Deliberately NOT "expire anything old": every candidate is checked against
 * the provider first, so an old-but-paid purchase is fulfilled rather than
 * expired, and an unreachable provider defers instead of closing.
 */
export async function expireStalePendingPurchases(opts?: {
  ttlMinutes?: number;
  scanLimit?: number;
  organizationId?: string;
}): Promise<ExpirySweepResult> {
  const ttl = opts?.ttlMinutes && opts.ttlMinutes > 0 ? opts.ttlMinutes : ttlMinutes();
  const limit = opts?.scanLimit && opts.scanLimit > 0 ? opts.scanLimit : DEFAULT_SCAN_LIMIT;
  const cutoff = new Date(Date.now() - ttl * 60_000).toISOString();

  let q = supabase
    .from('credit_purchases')
    .select(PURCHASE_COLUMNS)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (opts?.organizationId) q = q.eq('organization_id', opts.organizationId);

  const { data, error } = await q;
  if (error) {
    logger.error('payment_pending_expiry_scan_failed', { message: error.message });
    throw new Error(`[purchaseClosureService] stale-pending scan failed: ${error.message}`);
  }

  const rows = (data ?? []) as PurchaseRow[];
  const details: ClosureOutcome[] = [];
  let closed = 0, fulfilled = 0, deferred = 0, untouched = 0;

  for (const row of rows) {
    const outcome = await closeOnePurchase(row, 'stale_pending_expiry');
    details.push(outcome);
    if (outcome.action === 'closed') closed++;
    else if (outcome.action === 'fulfilled') fulfilled++;
    else if (outcome.action === 'deferred_unknown') deferred++;
    else untouched++;
  }

  logger.info('payment_pending_expiry_sweep', {
    scanned: rows.length, closed, fulfilled, deferred, untouched, ttlMinutes: ttl,
  });

  return { scanned: rows.length, closed, fulfilled, deferred, untouched, ttlMinutes: ttl, details };
}
