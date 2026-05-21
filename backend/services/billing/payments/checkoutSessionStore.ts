/**
 * Checkout-session persistence store (billing_checkout_sessions).
 *
 * Backs the orchestrator's first-class idempotent replay: a normalized
 * checkout session is persisted once (keyed by idempotency_key); a repeated
 * identical request reads it back instead of dispatching to the provider
 * again.
 *
 * DEFAULT-PRESERVING: when billing_checkout_sessions is absent (migration
 * 20260718 unapplied) or a DB error occurs, find → null and persist →
 * best-effort no-op. The orchestrator then behaves exactly like the
 * pre-persistence foundation (dispatch every time; idempotency still carried
 * to the provider via the idempotency key). Never throws.
 *
 * PRICING-BLIND: persists only session/geography metadata — provider,
 * status, redirect, currency, methods — never an amount or plan price.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import type { NormalizedCheckoutSession } from './checkoutSessionOrchestrator';

export interface PersistCheckoutSessionInput {
  idempotencyKey: string;
  organizationId: string;
  intentType: 'subscription' | 'topup';
  referenceKey: string;
  currency: string;
  session: NormalizedCheckoutSession;
}

/** Look up a persisted normalized session by idempotency key. Never throws. */
export async function findPersistedCheckoutSession(
  idempotencyKey: string,
): Promise<NormalizedCheckoutSession | null> {
  try {
    const { data, error } = await supabase
      .from('billing_checkout_sessions')
      .select('provider, provider_reference, session_status, redirect_url, provider_mode, expires_at, supported_payment_methods')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      provider: String(row.provider ?? ''),
      provider_mode: (row.provider_mode === 'test' || row.provider_mode === 'live' ? row.provider_mode : 'unknown'),
      session_status: (row.session_status === 'created' ? 'created' : 'not_implemented'),
      redirect_url: typeof row.redirect_url === 'string' ? row.redirect_url : null,
      expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
      provider_reference: typeof row.provider_reference === 'string' ? row.provider_reference : null,
      supported_payment_methods: Array.isArray(row.supported_payment_methods)
        ? (row.supported_payment_methods as string[]) : [],
    };
  } catch (err) {
    logger.warn('checkout_session_find_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Persist a normalized session. Best-effort — a concurrent-insert race
 *  (23505) or a missing table is swallowed; never throws. */
export async function persistCheckoutSession(input: PersistCheckoutSessionInput): Promise<void> {
  try {
    const s = input.session;
    const { error } = await supabase.from('billing_checkout_sessions').insert({
      organization_id: input.organizationId,
      provider: s.provider,
      provider_reference: s.provider_reference,
      idempotency_key: input.idempotencyKey,
      intent_type: input.intentType,
      reference_key: input.referenceKey,
      session_status: s.session_status,
      redirect_url: s.redirect_url,
      currency: input.currency,
      provider_mode: s.provider_mode,
      expires_at: s.expires_at,
      supported_payment_methods: s.supported_payment_methods,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>);
    if (error && (error as { code?: string }).code !== '23505') {
      logger.warn('checkout_session_persist_failed', { message: error.message });
    }
  } catch (err) {
    logger.warn('checkout_session_persist_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── settlement-lifecycle persistence (migration 20260719) ───────────────────
// Additive: backs paymentSettlementOrchestrator. All default-preserving — when
// the settlement columns / billing_settlement_events table are absent, find →
// null, record → not-duplicate, apply → no-op. PRICING-BLIND throughout.

/** A persisted checkout session viewed through the settlement lens. */
export interface CheckoutSettlementRecord {
  idempotencyKey: string;
  organizationId: string;
  provider: string;
  providerReference: string | null;
  sessionStatus: string;
  /** Normalized settlement state — null when the 20260719 columns are absent. */
  settlementStatus: string | null;
}

/**
 * Locate the persisted checkout session a provider webhook settles, by
 * (provider, provider_reference). Never throws — returns null on any error.
 */
export async function findCheckoutSessionByProviderReference(
  provider: string,
  providerReference: string,
): Promise<CheckoutSettlementRecord | null> {
  try {
    const { data, error } = await supabase
      .from('billing_checkout_sessions')
      .select('idempotency_key, organization_id, provider, provider_reference, session_status, settlement_status')
      .eq('provider', provider)
      .eq('provider_reference', providerReference)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      idempotencyKey: String(row.idempotency_key ?? ''),
      organizationId: String(row.organization_id ?? ''),
      provider: String(row.provider ?? ''),
      providerReference: typeof row.provider_reference === 'string' ? row.provider_reference : null,
      sessionStatus: String(row.session_status ?? ''),
      settlementStatus: typeof row.settlement_status === 'string' ? row.settlement_status : null,
    };
  } catch (err) {
    logger.warn('checkout_session_settlement_find_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface RecordSettlementEventInput {
  provider: string;
  providerEventId: string;
  sessionReference: string;
  checkoutIdempotencyKey: string | null;
  eventType: string;
  normalizedStatus: string;
  providerRawStatus: string;
  payload: Record<string, unknown>;
}

/**
 * Append-only insert of a normalized settlement event. The UNIQUE(provider,
 * provider_event_id) constraint makes a redelivered webhook a deterministic
 * duplicate. Returns { duplicate } — true on a 23505 collision. When the table
 * is absent (migration unapplied) it reports not-duplicate, so the orchestrator
 * degrades to the forward-only state machine for idempotency. Never throws.
 */
export async function recordSettlementEvent(
  input: RecordSettlementEventInput,
): Promise<{ duplicate: boolean }> {
  try {
    const { error } = await supabase.from('billing_settlement_events').insert({
      provider: input.provider,
      provider_event_id: input.providerEventId,
      session_reference: input.sessionReference,
      checkout_idempotency_key: input.checkoutIdempotencyKey,
      event_type: input.eventType,
      normalized_status: input.normalizedStatus,
      provider_raw_status: input.providerRawStatus,
      payload: input.payload,
    } as Record<string, unknown>);
    if (!error) return { duplicate: false };
    if ((error as { code?: string }).code === '23505') return { duplicate: true };
    if (!String(error.message ?? '').toLowerCase().includes('does not exist')) {
      logger.warn('settlement_event_record_failed', { message: error.message });
    }
    return { duplicate: false };
  } catch (err) {
    logger.warn('settlement_event_record_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { duplicate: false };
  }
}

export interface ApplySettlementTransitionInput {
  idempotencyKey: string;
  settlementStatus: string;
  /** Provider event id. Omitted (null/undefined) by the expiry sweeper so an
   *  existing provider_event_reference is PRESERVED, not overwritten. */
  providerEventReference?: string | null;
  providerRawStatus: string;
  /** ISO timestamp — set ONLY when the session reached `succeeded`. */
  settledAt: string | null;
}

/**
 * Apply a normalized settlement-state transition onto the persisted checkout
 * session. Additive column writes only — no other session field is touched.
 * last_reconciled_at is always refreshed. Best-effort: a missing table/column
 * is swallowed; never throws.
 */
export async function applySettlementTransition(
  input: ApplySettlementTransitionInput,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      settlement_status: input.settlementStatus,
      provider_raw_status: input.providerRawStatus,
      last_reconciled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Preserve an existing provider_event_reference when none is supplied.
    if (input.providerEventReference != null) {
      patch.provider_event_reference = input.providerEventReference;
    }
    if (input.settledAt) patch.settled_at = input.settledAt;
    const { error } = await supabase
      .from('billing_checkout_sessions')
      .update(patch)
      .eq('idempotency_key', input.idempotencyKey);
    if (error && !String(error.message ?? '').toLowerCase().includes('does not exist')) {
      logger.warn('settlement_transition_apply_failed', { message: error.message });
    }
  } catch (err) {
    logger.warn('settlement_transition_apply_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** A non-terminal persisted session — a candidate for the expiry sweeper. */
export interface SettlementSweepCandidate {
  idempotencyKey: string;
  provider: string;
  providerReference: string | null;
  settlementStatus: string;
  createdAt: string | null;
  lastReconciledAt: string | null;
}

/**
 * List non-terminal (`created` / `pending`) persisted checkout sessions — the
 * candidate set for the deterministic expiry sweeper. Terminal sessions are
 * NEVER returned, so the sweeper cannot regress a terminal state. Never throws
 * — returns [] on any error / missing table.
 */
export async function findSettlementSweepCandidates(limit = 500): Promise<SettlementSweepCandidate[]> {
  try {
    const { data, error } = await supabase
      .from('billing_checkout_sessions')
      .select('idempotency_key, provider, provider_reference, settlement_status, created_at, last_reconciled_at')
      .in('settlement_status', ['created', 'pending'])
      .limit(limit);
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
      idempotencyKey: String(row.idempotency_key ?? ''),
      provider: String(row.provider ?? ''),
      providerReference: typeof row.provider_reference === 'string' ? row.provider_reference : null,
      settlementStatus: String(row.settlement_status ?? ''),
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
      lastReconciledAt: typeof row.last_reconciled_at === 'string' ? row.last_reconciled_at : null,
    }));
  } catch (err) {
    logger.warn('settlement_sweep_candidates_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
