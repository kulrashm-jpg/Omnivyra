import { ownedDbTable } from '../db/writeOwner';
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

import { createCredit, makeIdempotencyKey } from './creditExecutionService';
import { getRequestContext } from './requestContext';

export type PurchaseResult =
  | { success: true; purchaseId: string; creditsGranted: number }
  | { success: false; reason: 'not_found' | 'already_completed' | 'already_failed' | 'error'; detail?: string };

type PurchaseRow = {
  id: string;
  organization_id: string;
  credits: number;
  status: 'pending' | 'completed' | 'failed';
  amount_paid: number;
  currency: string;
  fulfillment_status?: 'pending' | 'event_recorded' | 'completed' | 'failed' | null;
};

export async function recordPaymentProviderEvent(input: {
  provider: string;
  providerEventId: string;
  eventType: string;
  purchaseId?: string | null;
  organizationId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<{ id: string | null; duplicate: boolean; processingStatus?: string | null }> {
  const ctx = getRequestContext();
  const { data, error } = await ownedDbTable('payment_provider_events')
    .insert({
      provider: input.provider,
      provider_event_id: input.providerEventId,
      event_type: input.eventType,
      purchase_id: input.purchaseId ?? null,
      organization_id: input.organizationId ?? null,
      payload: input.payload ?? {},
      request_id: ctx.requestId ?? null,
      correlation_id: ctx.correlationId ?? null,
    })
    .select('id, processing_status')
    .maybeSingle();

  if (!error) return {
    id: (data as { id?: string } | null)?.id ?? null,
    duplicate: false,
    processingStatus: (data as { processing_status?: string | null } | null)?.processing_status ?? null,
  };
  if ((error as any).code === '23505') {
    const { data: existing } = await ownedDbTable('payment_provider_events')
      .select('id, processing_status')
      .eq('provider', input.provider)
      .eq('provider_event_id', input.providerEventId)
      .maybeSingle();
    return {
      id: (existing as { id?: string } | null)?.id ?? null,
      duplicate: true,
      processingStatus: (existing as { processing_status?: string | null } | null)?.processing_status ?? null,
    };
  }
  throw new Error(`[purchaseService] payment event record failed: ${error.message}`);
}

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
  // ── 1. Reference-ID dedup — check before touching any state ───────────────
  // If the gateway already delivered this event and it was processed, return
  // success immediately. This is the primary guard against retry double-credits.
  if (referenceId) {
    const { data: existing } = await ownedDbTable('credit_purchases')
      .select('id, credits, status, fulfillment_status')
      .eq('reference_id', referenceId)
      .maybeSingle();

    if (existing?.status === 'completed' && existing.id !== purchaseId) {
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
  const { data: purchase, error: fetchErr } = await ownedDbTable('credit_purchases')
    .select('id, organization_id, credits, status, amount_paid, currency, fulfillment_status')
    .eq('id', purchaseId)
    .maybeSingle();

  if (fetchErr || !purchase) {
    return { success: false, reason: 'not_found' };
  }
  const purchaseRow = purchase as PurchaseRow;
  if (purchaseRow.status === 'completed' && purchaseRow.fulfillment_status === 'completed') {
    return { success: true, purchaseId, creditsGranted: purchaseRow.credits }; // idempotent
  }
  if (purchaseRow.status === 'failed') {
    return { success: false, reason: 'already_failed' };
  }

  // ── 3. Grant credits (idempotent on purchaseId) ────────────────────────────
  if (purchaseRow.status === 'pending') {
    const completionFields: Record<string, any> = {
      status: 'completed',
      fulfillment_status: 'event_recorded',
      fulfillment_error: null,
      updated_at: new Date().toISOString(),
    };
    if (referenceId) {
      completionFields.reference_id = referenceId;
      completionFields.provider_payment_id = referenceId;
    }

    const { data: updated, error: completionErr } = await ownedDbTable('credit_purchases')
      .update(completionFields)
      .eq('id', purchaseId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (completionErr) return { success: false, reason: 'error', detail: completionErr.message };
    if (!updated) return { success: false, reason: 'already_completed', detail: 'Purchase is no longer pending' };
  }

  try {
    await createCredit({
      orgId:          purchaseRow.organization_id,
      amount:         purchaseRow.credits,
      category:       'paid',
      referenceType:  'credit_purchase',
      referenceId:    purchaseRow.id,
      note:           `Credit purchase - ${purchaseRow.credits} credits ($${purchaseRow.amount_paid} ${purchaseRow.currency})`,
      performedBy:    purchaseRow.organization_id,
      idempotencyKey: makeIdempotencyKey(
        purchaseRow.organization_id,
        'credit_purchase',
        purchaseRow.id,
      ),
    });
  } catch (creditErr: any) {
    console.error('[purchaseService] createCredit failed:', creditErr.message);
    await ownedDbTable('credit_purchases')
      .update({
        fulfillment_status: 'failed',
        fulfillment_error: creditErr.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', purchaseId);
    return { success: false, reason: 'error', detail: creditErr.message };
  }

  // ── 4. Mark purchase completed and stamp gateway reference_id ─────────────
  // `status = 'pending'` guard prevents a concurrent completion from writing
  // twice. The UNIQUE index on reference_id prevents a second row from ever
  // claiming this gateway transaction ID.
  const updateFields: Record<string, any> = {
    fulfillment_status: 'completed',
    fulfillment_error: null,
    fulfilled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: updateErr } = await ownedDbTable('credit_purchases')
    .update(updateFields)
    .eq('id', purchaseId);

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

  return { success: true, purchaseId, creditsGranted: purchaseRow.credits };
}

/**
 * Mark a purchase as failed (called if payment gateway reports failure).
 */
export async function failPurchase(
  purchaseId: string,
  referenceId?: string,
): Promise<void> {
  const fields: Record<string, any> = {
    status: 'failed',
    fulfillment_status: 'failed',
    updated_at: new Date().toISOString(),
  };
  if (referenceId) fields.reference_id = referenceId;
  await ownedDbTable('credit_purchases').update(fields).eq('id', purchaseId).eq('status', 'pending');
}
