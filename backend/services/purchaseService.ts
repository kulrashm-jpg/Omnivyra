/**
 * Purchase Service
 *
 * Handles the "on successful purchase" side-effect: marking a credit_purchases
 * row as completed and crediting the organization's paid wallet.
 *
 * The payment gateway calls `completePurchase()` (via the /purchases/complete
 * API) after it confirms payment. This is the ONLY place that transitions a
 * purchase to 'completed' and issues credits.
 *
 * Idempotent: the purchase.id is used as the referenceId for createCredit,
 * so retries from the gateway do not double-credit the organization.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { createCredit, makeIdempotencyKey } from './creditExecutionService';

function serviceSupabase() {
  return supabase;
}

export type PurchaseResult =
  | { success: true; purchaseId: string; creditsGranted: number }
  | { success: false; reason: 'not_found' | 'already_completed' | 'already_failed' | 'error'; detail?: string };

/**
 * Mark a pending purchase as completed and credit the organization.
 *
 * Duplicate-safe at two levels:
 *   1. If `referenceId` is provided, we check for an already-completed purchase
 *      with that gateway ID before touching anything else. Gateway retries that
 *      send the same reference_id are short-circuited here — no second credit.
 *   2. `createCredit` is idempotent on its own idempotency key, so even if two
 *      concurrent requests slip past check (1), only one credit is written.
 *   3. The DB UNIQUE index on reference_id prevents a second purchase row from
 *      ever sharing the same gateway transaction ID.
 *
 * @param purchaseId  The credit_purchases.id to complete.
 * @param referenceId Payment gateway transaction ID — used for dedup + audit.
 */
export async function completePurchase(
  purchaseId: string,
  referenceId?: string,
): Promise<PurchaseResult> {
  const sb = serviceSupabase();

  // ── 1. Reference-ID dedup — check before touching any state ───────────────
  // If the gateway already delivered this event and it was processed, return
  // success immediately. This is the primary guard against retry double-credits.
  if (referenceId) {
    const { data: existing } = await sb
      .from('credit_purchases')
      .select('id, credits, status')
      .eq('reference_id', referenceId)
      .maybeSingle();

    if (existing?.status === 'completed') {
      // Already processed — idempotent success, no re-crediting.
      return { success: true, purchaseId: existing.id, creditsGranted: existing.credits };
    }

    // If a row exists but is pending/failed for a different purchaseId,
    // the gateway is associating the same reference_id with a different row.
    // Treat this as a not_found for the requested purchaseId to avoid confusion.
    if (existing && existing.id !== purchaseId) {
      console.error(
        `[purchaseService] reference_id ${referenceId} belongs to purchase ${existing.id}, not ${purchaseId}`,
      );
      return { success: false, reason: 'not_found' };
    }
  }

  // ── 2. Fetch and validate the purchase by ID ───────────────────────────────
  const { data: purchase, error: fetchErr } = await sb
    .from('credit_purchases')
    .select('id, organization_id, credits, status, amount_paid, currency')
    .eq('id', purchaseId)
    .maybeSingle();

  if (fetchErr || !purchase) {
    return { success: false, reason: 'not_found' };
  }
  if (purchase.status === 'completed') {
    return { success: true, purchaseId, creditsGranted: purchase.credits }; // idempotent
  }
  if (purchase.status === 'failed') {
    return { success: false, reason: 'already_failed' };
  }

  // ── 3. Grant credits (idempotent on purchaseId) ────────────────────────────
  try {
    await createCredit({
      orgId:          purchase.organization_id,
      amount:         purchase.credits,
      category:       'paid',
      referenceType:  'credit_purchase',
      referenceId:    purchase.id,
      note:           `Credit purchase — ${purchase.credits} credits ($${purchase.amount_paid} ${purchase.currency})`,
      performedBy:    purchase.organization_id,
      idempotencyKey: makeIdempotencyKey(
        purchase.organization_id,
        'credit_purchase',
        purchase.id,
      ),
    });
  } catch (creditErr: any) {
    console.error('[purchaseService] createCredit failed:', creditErr.message);
    return { success: false, reason: 'error', detail: creditErr.message };
  }

  // ── 4. Mark purchase completed and stamp gateway reference_id ─────────────
  // `status = 'pending'` guard prevents a concurrent completion from writing
  // twice. The UNIQUE index on reference_id prevents a second row from ever
  // claiming this gateway transaction ID.
  const updateFields: Record<string, any> = { status: 'completed' };
  if (referenceId) updateFields.reference_id = referenceId;

  const { error: updateErr } = await sb
    .from('credit_purchases')
    .update(updateFields)
    .eq('id', purchaseId)
    .eq('status', 'pending');

  if (updateErr) {
    // Unique violation on reference_id (23505): a concurrent request already
    // wrote this reference_id. The credit was already granted (idempotent key).
    // Log and return success — the org has been correctly credited once.
    if ((updateErr as any).code === '23505') {
      console.warn(`[purchaseService] reference_id collision on update — already processed: ${referenceId}`);
    } else {
      console.warn('[purchaseService] status update failed (may have raced):', updateErr.message);
    }
  }

  return { success: true, purchaseId, creditsGranted: purchase.credits };
}

/**
 * Mark a purchase as failed (called if payment gateway reports failure).
 */
export async function failPurchase(
  purchaseId: string,
  referenceId?: string,
): Promise<void> {
  const sb = serviceSupabase();
  const fields: Record<string, any> = { status: 'failed' };
  if (referenceId) fields.reference_id = referenceId;
  await sb.from('credit_purchases').update(fields).eq('id', purchaseId).eq('status', 'pending');
}

export type RefundResult =
  | { success: true; purchaseId: string; creditsRefunded: number; alreadyRefunded?: boolean }
  | {
      success: false;
      reason:
        | 'not_found'
        | 'not_completed'
        | 'insufficient_paid_balance'
        | 'ledger_failed';
      detail?: string;
      availableCredits?: number;
    };

/**
 * Reverse a completed purchase by debiting the org's paid balance and writing a
 * compensating ledger row, then marking the purchase as refunded.
 *
 * Idempotency:
 *   - `idempotencyKey` is required (typically the request's Idempotency-Key
 *     header). It scopes the underlying hold/confirm reservation pair so retries
 *     are absorbed at the ledger layer.
 *   - If the purchase is already 'refunded', the call is a no-op success.
 *
 * Failure modes:
 *   - 'not_found'                : no purchase row with this id
 *   - 'not_completed'            : purchase is pending/failed (nothing to reverse)
 *   - 'insufficient_paid_balance': org has spent some/all of the credits;
 *                                  caller must decide whether to allow a partial
 *                                  refund or take the loss
 *   - 'ledger_failed'            : RPC error during hold/confirm
 */
export async function refundPurchase(opts: {
  purchaseId:     string;
  performedBy:    string;
  idempotencyKey: string;
  reason?:        string;
}): Promise<RefundResult> {
  if (!opts.idempotencyKey || !opts.idempotencyKey.trim()) {
    throw new Error('refundPurchase: idempotencyKey is required');
  }
  const sb = serviceSupabase();

  // ── 1. Fetch purchase ─────────────────────────────────────────────────────
  const { data: purchase, error: fetchErr } = await sb
    .from('credit_purchases')
    .select('id, organization_id, credits, status')
    .eq('id', opts.purchaseId)
    .maybeSingle();

  if (fetchErr || !purchase) {
    return { success: false, reason: 'not_found' };
  }
  if (purchase.status === 'refunded') {
    // Idempotent — already refunded.
    return { success: true, purchaseId: purchase.id, creditsRefunded: purchase.credits, alreadyRefunded: true };
  }
  if (purchase.status !== 'completed') {
    return { success: false, reason: 'not_completed', detail: `status=${purchase.status}` };
  }

  // ── 2. Verify the org still has the paid credits to reverse ──────────────
  const { data: wallet } = await sb
    .from('organization_credits')
    .select('paid_balance, reserved_paid')
    .eq('organization_id', purchase.organization_id)
    .maybeSingle();
  const paidAvailable = Math.max(
    0,
    ((wallet as any)?.paid_balance ?? 0) - ((wallet as any)?.reserved_paid ?? 0),
  );
  if (paidAvailable < purchase.credits) {
    return {
      success:          false,
      reason:           'insufficient_paid_balance',
      detail:           'Some credits have already been consumed; full refund would create a negative balance',
      availableCredits: paidAvailable,
    };
  }

  // ── 3. HOLD + CONFIRM the refund amount on paid_balance ───────────────────
  const baseKey       = makeIdempotencyKey(opts.performedBy, 'purchase_refund', `${purchase.id}:${opts.idempotencyKey}`);
  const holdKey       = `${baseKey}:hold`;
  const confirmKey    = `${baseKey}:confirm`;
  const note          = `Refund of purchase ${purchase.id}${opts.reason ? ` — ${opts.reason}` : ''}`;

  const hold = await sb.rpc('apply_credit_reservation', {
    p_org_id:           purchase.organization_id,
    p_phase:            'hold',
    p_free_amount:      0,
    p_incentive_amount: 0,
    p_paid_amount:      purchase.credits,
    p_idempotency_key:  holdKey,
    p_reference_type:   'purchase_refund',
    p_reference_id:     purchase.id,
    p_note:             note,
    p_performed_by:     opts.performedBy,
    p_parent_id:        null,
  });
  if (hold.error) {
    return { success: false, reason: 'ledger_failed', detail: hold.error.message };
  }

  const confirm = await sb.rpc('apply_credit_reservation', {
    p_org_id:           purchase.organization_id,
    p_phase:            'confirm',
    p_free_amount:      0,
    p_incentive_amount: 0,
    p_paid_amount:      purchase.credits,
    p_idempotency_key:  confirmKey,
    p_reference_type:   'purchase_refund',
    p_reference_id:     purchase.id,
    p_note:             note,
    p_performed_by:     opts.performedBy,
    p_parent_id:        null,
  });
  if (confirm.error) {
    // Compensating release so we don't leave reserved_paid stuck.
    try {
      await sb.rpc('apply_credit_reservation', {
        p_org_id:           purchase.organization_id,
        p_phase:            'release',
        p_free_amount:      0,
        p_incentive_amount: 0,
        p_paid_amount:      purchase.credits,
        p_idempotency_key:  `${baseKey}:release`,
        p_reference_type:   'purchase_refund',
        p_reference_id:     purchase.id,
        p_note:             `${note} (release after confirm failure)`,
        p_performed_by:     opts.performedBy,
        p_parent_id:        null,
      });
    } catch {
      // Best-effort — log already captured upstream by the RPC error.
    }
    return { success: false, reason: 'ledger_failed', detail: confirm.error.message };
  }

  // ── 4. Mark purchase as refunded ─────────────────────────────────────────
  const { error: updateErr } = await sb
    .from('credit_purchases')
    .update({
      status:              'refunded',
      refunded_at:         new Date().toISOString(),
      refund_reason:       opts.reason ?? null,
      refunded_by_user_id: opts.performedBy,
      refund_credits:      purchase.credits,
    })
    .eq('id', purchase.id)
    .eq('status', 'completed');

  if (updateErr) {
    // Ledger reversal already succeeded — log but do not unwind.
    console.warn('[purchaseService] refund status update failed (ledger already reversed):', updateErr.message);
  }

  return { success: true, purchaseId: purchase.id, creditsRefunded: purchase.credits };
}
