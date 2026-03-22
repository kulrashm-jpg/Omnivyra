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

import { createClient } from '@supabase/supabase-js';
import { createCredit, makeIdempotencyKey } from './creditExecutionService';

function serviceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
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
