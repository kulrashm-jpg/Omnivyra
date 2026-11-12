/**
 * Payment-provider event STATE + ATTRIBUTES (migration 20270217000003, e9 ruling
 * 2026-11-12). payment_provider_events is an immutable ledger: its state lives in
 * payment_provider_event_state (written ONLY by the guarded, forward-only
 * advance_payment_provider_event_state_guarded) and its post-insert enrichment in
 * payment_provider_event_attributes (set-if-null). Shared by the Stripe and
 * Razorpay webhook paths.
 *
 * BOOKKEEPING semantics (e9): a failed state / attribute write is LOGGED and never
 * fails a webhook - the money action is what decides a non-2xx. A disallowed
 * transition (e.g. a late 'failed' after a terminal 'processed') is NOT an error:
 * it is logged as a metric and the state is unchanged.
 */
import { ownedDbRpc, ownedDbTable } from '../../db/writeOwner';
import { logger } from '../logger';

export type PaymentEventTargetState = 'processed' | 'duplicate' | 'failed' | 'requeued';

export async function markPaymentEventState(
  eventId: string,
  status: PaymentEventTargetState,
  error?: string | null,
): Promise<{ applied: boolean; current?: string | null }> {
  try {
    const { data, error: rpcErr } = await (ownedDbRpc('advance_payment_provider_event_state_guarded', {
      p_event_id: eventId,
      p_status: status,
      p_error: error ?? null,
    }) as unknown as Promise<{ data: { applied?: boolean; current?: string } | null; error: { message: string } | null }>);
    if (rpcErr) {
      logger.error('payment_event_state_write_failed', { eventId, status, message: rpcErr.message });
      return { applied: false, current: null };
    }
    const applied = data?.applied === true;
    if (!applied) {
      // e9: a late failure after success (or any refused transition) is a METRIC, never state.
      logger.warn('payment_event_state_transition_refused', { eventId, requested: status, current: data?.current ?? null });
    }
    return { applied, current: data?.current ?? null };
  } catch (err) {
    logger.error('payment_event_state_write_failed', { eventId, status, message: err instanceof Error ? err.message : String(err) });
    return { applied: false, current: null };
  }
}

/** The event's state; 'recorded' when it has no state row yet. THROWS on a read error (never "recorded" by assumption). */
export async function readPaymentEventState(eventId: string): Promise<string> {
  const { data, error } = await ownedDbTable('payment_provider_event_state')
    .select('processing_status')
    .eq('provider_event_pk', eventId)
    .maybeSingle();
  if (error) throw new Error(`[paymentEventState] state read failed for ${eventId}: ${error.message}`);
  return ((data as { processing_status?: string } | null)?.processing_status) ?? 'recorded';
}

export type PaymentEventAttributes = Partial<{
  provider_mode: string;
  signature_valid: boolean;
  signature_algorithm: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  beta_cohort: string | null;
  beta_access_level: string | null;
  monetization_beta_enabled: boolean;
}>;

/** Set-if-null enrichment (never overwrites). Bookkeeping: logged on failure, never throws. */
export async function setPaymentEventAttributes(eventId: string, attrs: PaymentEventAttributes): Promise<boolean> {
  try {
    const { error } = await (ownedDbRpc('set_payment_provider_event_attributes', { p_event_id: eventId, p_attrs: attrs }) as unknown as Promise<{ error: { message: string } | null }>);
    if (error) {
      logger.error('payment_event_attributes_write_failed', { eventId, message: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('payment_event_attributes_write_failed', { eventId, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * READERS (20270217000003): overlay each ledger row with its STATE and ATTRIBUTES
 * from the side tables. TRANSITIONAL fallback (e9): a row with no state /
 * attribute row keeps its inline ledger value (rows written before the side
 * tables were adopted; C18: 0 events in prod, so this is likely moot - a
 * post-launch backfill item is logged). THROWS on a read error (a reader must
 * not report a stale state as current).
 */
export async function overlayPaymentEventState<T extends { id: string; processing_status?: string | null; error_message?: string | null; processed_at?: string | null; provider_order_id?: string | null; provider_payment_id?: string | null }>(
  rows: T[],
): Promise<T[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [st, at] = await Promise.all([
    ownedDbTable('payment_provider_event_state').select('provider_event_pk, processing_status, error_message, processed_at').in('provider_event_pk', ids),
    ownedDbTable('payment_provider_event_attributes').select('provider_event_pk, provider_order_id, provider_payment_id').in('provider_event_pk', ids),
  ]);
  if (st.error) throw new Error(`[paymentEventState] state overlay read failed: ${st.error.message}`);
  if (at.error) throw new Error(`[paymentEventState] attributes overlay read failed: ${at.error.message}`);
  const sMap = new Map((st.data ?? []).map((r: any) => [r.provider_event_pk, r]));
  const aMap = new Map((at.data ?? []).map((r: any) => [r.provider_event_pk, r]));
  return rows.map((r) => {
    const s: any = sMap.get(r.id); const a: any = aMap.get(r.id);
    return {
      ...r,
      processing_status: s?.processing_status ?? r.processing_status ?? 'recorded',
      error_message: s ? s.error_message : r.error_message,
      processed_at: s ? s.processed_at : r.processed_at,
      provider_order_id: a?.provider_order_id ?? r.provider_order_id ?? null,
      provider_payment_id: a?.provider_payment_id ?? r.provider_payment_id ?? null,
    };
  });
}
