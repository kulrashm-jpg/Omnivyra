/**
 * Canonical settlement-lifecycle orchestration (SANDBOX-ONLY FOUNDATION).
 *
 * THE single backend path a provider settlement webhook flows through. It
 * composes — never duplicates — the persisted checkout-session primitives:
 *
 *   normalizeSettlementWebhook  → heterogeneous provider payload → 1 contract
 *   recordSettlementEvent       → append-only idempotency anchor
 *   findCheckoutSessionByProviderReference → match the persisted session
 *   applySettlementTransition   → forward-only normalized state transition
 *
 * Normalized lifecycle states ONLY (created/pending/authorized/succeeded/
 * failed/cancelled/expired). Provider-specific raw states are stored internally
 * (provider_raw_status) but NEVER leak into the normalized contract.
 *
 * STRICTLY a foundation:
 *   - SANDBOX/TEST mode only. NO live settlement activation.
 *   - NO wallet funding, NO credit issuance, NO subscription entitlement
 *     activation, NO invoice generation, NO ledger mutation. This module moves
 *     a checkout session through normalized states and NOTHING downstream.
 *   - PRICING-BLIND: no amount is read, computed, persisted, or returned. The
 *     normalized contract + every result carry only lifecycle metadata.
 *   - Idempotency: a redelivered webhook collides on the append-only event
 *     ledger (UNIQUE provider,event_id) → safe no-op; a stale / out-of-order
 *     event is rejected by the forward-only state machine → safe no-op.
 *
 * Dependency-injectable (the `deps` param) so it is unit-testable without a DB.
 */

import { logger } from '../../logger';
import type { SupportedProvider } from './paymentProviderAdapter';
import {
  findCheckoutSessionByProviderReference as realFindByProviderReference,
  recordSettlementEvent as realRecordSettlementEvent,
  applySettlementTransition as realApplySettlementTransition,
} from './checkoutSessionStore';

/** Normalized internal settlement states — the ONLY externally visible states. */
export type SettlementState =
  | 'created' | 'pending' | 'authorized' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

const KNOWN_PROVIDERS: SupportedProvider[] = ['razorpay', 'stripe', 'cashfree', 'phonepe'];

// ── normalized webhook contract ─────────────────────────────────────────────
export interface NormalizedSettlementEvent {
  /** Deterministic per-event id — a redelivery of the SAME event reuses it. */
  providerEventId: string;
  eventType: string;
  /** The provider order/session reference (matched to provider_reference). */
  sessionReference: string;
  normalizedStatus: SettlementState;
  /** Provider-specific raw status — stored internally, never surfaced. */
  providerRawStatus: string;
}

export type NormalizeResult =
  | { ok: true; event: NormalizedSettlementEvent }
  | { ok: false; reason: string };

// ── lifecycle state machine — forward-only ──────────────────────────────────
const PROGRESSIVE_RANK: Record<string, number> = { created: 0, pending: 1, authorized: 2, succeeded: 3 };
const TERMINAL_STATES = new Set<SettlementState>(['succeeded', 'failed', 'cancelled', 'expired']);
const FAILURE_STATES = new Set<SettlementState>(['failed', 'cancelled', 'expired']);

/**
 * A transition is permitted ONLY when it moves the lifecycle forward. A repeat
 * (from === to), a regression to `created`, a move out of a terminal state, or
 * a backward progressive step are all rejected — the caller treats a rejected
 * transition as a deterministic, idempotent no-op.
 */
export function canTransition(from: SettlementState, to: SettlementState): boolean {
  if (from === to) return false;              // identical → idempotent no-op
  if (TERMINAL_STATES.has(from)) return false; // terminal is final
  if (FAILURE_STATES.has(to)) return true;    // any non-terminal → a failure terminal
  if (to === 'created') return false;         // never regress to created
  return PROGRESSIVE_RANK[to] > PROGRESSIVE_RANK[from]; // forward-only progression
}

// ── provider webhook normalization ──────────────────────────────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

const RAZORPAY_EVENT_MAP: Record<string, SettlementState> = {
  'payment.authorized': 'authorized',
  'payment.captured': 'succeeded',
  'order.paid': 'succeeded',
  'payment.failed': 'failed',
  'payment.pending': 'pending',
};
const RAZORPAY_STATUS_MAP: Record<string, SettlementState> = {
  created: 'created', authorized: 'authorized', captured: 'succeeded',
  failed: 'failed', paid: 'succeeded', attempted: 'pending', pending: 'pending',
};

const STRIPE_EVENT_MAP: Record<string, SettlementState> = {
  'payment_intent.created': 'created',
  'payment_intent.processing': 'pending',
  'payment_intent.requires_action': 'authorized',
  'payment_intent.amount_capturable_updated': 'authorized',
  'payment_intent.succeeded': 'succeeded',
  'payment_intent.payment_failed': 'failed',
  'payment_intent.canceled': 'cancelled',
  'checkout.session.completed': 'succeeded',
  'checkout.session.expired': 'expired',
  'checkout.session.async_payment_failed': 'failed',
};
const STRIPE_STATUS_MAP: Record<string, SettlementState> = {
  requires_payment_method: 'created', requires_confirmation: 'created',
  processing: 'pending', requires_action: 'authorized', requires_capture: 'authorized',
  succeeded: 'succeeded', canceled: 'cancelled',
};

const CASHFREE_STATUS_MAP: Record<string, SettlementState> = {
  SUCCESS: 'succeeded', PAID: 'succeeded', FAILED: 'failed', PENDING: 'pending',
  ACTIVE: 'pending', FLAGGED: 'pending', NOT_ATTEMPTED: 'created',
  USER_DROPPED: 'cancelled', CANCELLED: 'cancelled', VOID: 'cancelled',
  TERMINATED: 'cancelled', EXPIRED: 'expired',
};

const PHONEPE_STATUS_MAP: Record<string, SettlementState> = {
  COMPLETED: 'succeeded', PAYMENT_SUCCESS: 'succeeded',
  FAILED: 'failed', PAYMENT_ERROR: 'failed',
  PENDING: 'pending', PAYMENT_PENDING: 'pending',
  DECLINED: 'cancelled', PAYMENT_DECLINED: 'cancelled',
  EXPIRED: 'expired',
};

/** Deterministic per-event id: the provider's native id when present, else a
 *  composite that collides on a redelivery of the same event but differs
 *  across distinct lifecycle events. */
function eventId(native: string, provider: string, eventType: string, ref: string, raw: string): string {
  if (native) return native;
  return `${provider}:${eventType}:${ref}:${raw}`;
}

function buildEvent(
  native: string, provider: string, eventType: string, ref: string,
  rawStatus: string, state: SettlementState | null,
): NormalizeResult {
  if (!ref) return { ok: false, reason: 'missing_session_reference' };
  if (!state) return { ok: false, reason: `unmapped_status:${eventType || rawStatus || 'unknown'}` };
  return {
    ok: true,
    event: {
      providerEventId: eventId(native, provider, eventType, ref, rawStatus),
      eventType: eventType || 'unknown',
      sessionReference: ref,
      normalizedStatus: state,
      providerRawStatus: rawStatus || eventType || 'unknown',
    },
  };
}

function normalizeRazorpay(p: Record<string, unknown>): NormalizeResult {
  const payload = asRecord(p.payload);
  const payEntity = asRecord(asRecord(payload.payment).entity);
  const orderEntity = asRecord(asRecord(payload.order).entity);
  const eventType = str(p.event);
  const ref = str(payEntity.order_id) || str(orderEntity.id) || str(p.order_id);
  const rawStatus = str(payEntity.status) || str(orderEntity.status);
  const state = RAZORPAY_EVENT_MAP[eventType]
    ?? RAZORPAY_STATUS_MAP[rawStatus.toLowerCase()] ?? null;
  return buildEvent(str(p.id), 'razorpay', eventType, ref, rawStatus || eventType, state);
}

function normalizeStripe(p: Record<string, unknown>): NormalizeResult {
  const obj = asRecord(asRecord(p.data).object);
  const eventType = str(p.type);
  const ref = str(obj.id);
  const rawStatus = str(obj.status);
  const state = STRIPE_EVENT_MAP[eventType]
    ?? STRIPE_STATUS_MAP[rawStatus.toLowerCase()] ?? null;
  return buildEvent(str(p.id), 'stripe', eventType, ref, rawStatus || eventType, state);
}

function normalizeCashfree(p: Record<string, unknown>): NormalizeResult {
  const data = asRecord(p.data);
  const order = asRecord(data.order);
  const payment = asRecord(data.payment);
  const eventType = str(p.type);
  const ref = str(order.order_id) || str(p.order_id);
  const rawStatus = str(payment.payment_status) || str(order.order_status);
  const state = CASHFREE_STATUS_MAP[rawStatus.toUpperCase()] ?? null;
  const native = str(p.event_id) || str(data.event_id);
  return buildEvent(native, 'cashfree', eventType, ref, rawStatus, state);
}

function normalizePhonepe(p: Record<string, unknown>): NormalizeResult {
  const data = asRecord(p.data);
  const eventType = str(p.code) || str(data.responseCode);
  const state = str(data.state) || str(p.state);
  const ref = str(data.merchantTransactionId) || str(p.merchantTransactionId) || str(data.transactionId);
  const rawStatus = state || eventType;
  const normalized = PHONEPE_STATUS_MAP[state.toUpperCase()]
    ?? PHONEPE_STATUS_MAP[eventType.toUpperCase()] ?? null;
  const native = str(p.eventId) || str(data.transactionId) || str(p.transactionId);
  return buildEvent(native, 'phonepe', eventType, ref, rawStatus, normalized);
}

/**
 * Normalize a provider webhook payload into the single settlement-event
 * contract. Provider-specific lifecycle vocabulary is collapsed here; nothing
 * downstream ever sees a provider-specific status.
 */
export function normalizeSettlementWebhook(
  provider: SupportedProvider,
  payload: Record<string, unknown>,
): NormalizeResult {
  switch (provider) {
    case 'razorpay': return normalizeRazorpay(payload);
    case 'stripe':   return normalizeStripe(payload);
    case 'cashfree': return normalizeCashfree(payload);
    case 'phonepe':  return normalizePhonepe(payload);
    default:         return { ok: false, reason: 'unknown_provider' };
  }
}

// Provider-specific sandbox webhook verification now lives in
// paymentWebhookVerifier.ts (verifyProviderWebhookSignature).

// ── reconciliation ──────────────────────────────────────────────────────────
export interface SettlementOrchestratorDeps {
  findCheckoutSessionByProviderReference: typeof realFindByProviderReference;
  recordSettlementEvent: typeof realRecordSettlementEvent;
  applySettlementTransition: typeof realApplySettlementTransition;
}

const DEFAULT_DEPS: SettlementOrchestratorDeps = {
  findCheckoutSessionByProviderReference: realFindByProviderReference,
  recordSettlementEvent: realRecordSettlementEvent,
  applySettlementTransition: realApplySettlementTransition,
};

export type ReconcileSettlementResult =
  | {
      ok: true;
      /** reconciled = a transition was applied; duplicate = redelivered event;
       *  no_transition = stale/out-of-order (idempotent no-op);
       *  unmatched = no persisted session for this reference. */
      status: 'reconciled' | 'duplicate' | 'no_transition' | 'unmatched';
      replayed: boolean;
      settlement_state: SettlementState | null;
      previous_state: SettlementState | null;
    }
  | { ok: false; status: 'unknown_provider' | 'invalid_payload'; reason: string };

/**
 * Canonical settlement reconciliation. Deterministic + idempotent:
 *   1. validate provider identity
 *   2. normalize the webhook payload
 *   3. record the event append-only (a redelivery collides → duplicate)
 *   4. match the persisted checkout session
 *   5. apply a forward-only state transition (a stale event → no_transition)
 *
 * It performs NO downstream action — no wallet funding, no credit issuance, no
 * entitlement activation, no invoicing, no ledger write.
 */
export async function reconcileSettlementWebhook(
  args: { provider: SupportedProvider; payload: Record<string, unknown> },
  depsOverride?: Partial<SettlementOrchestratorDeps>,
): Promise<ReconcileSettlementResult> {
  const deps: SettlementOrchestratorDeps = { ...DEFAULT_DEPS, ...depsOverride };

  // 1. provider identity validation
  if (!KNOWN_PROVIDERS.includes(args.provider)) {
    return { ok: false, status: 'unknown_provider', reason: `unknown provider: ${String(args.provider)}` };
  }

  // 2. normalize
  const normalized = normalizeSettlementWebhook(args.provider, args.payload ?? {});
  if (!normalized.ok) {
    const fail = normalized as { ok: false; reason: string };
    return { ok: false, status: 'invalid_payload', reason: fail.reason };
  }
  const ev = normalized.event;

  // 4. (read) match the persisted checkout session — read BEFORE recording so
  //    the event row links to it.
  const session = await deps.findCheckoutSessionByProviderReference(args.provider, ev.sessionReference);
  const sessionState = (session?.settlementStatus as SettlementState | null) ?? null;

  // 3. append-only idempotency anchor. A redelivered webhook collides on
  //    UNIQUE(provider, provider_event_id) → recorded once, actioned once.
  const recorded = await deps.recordSettlementEvent({
    provider: args.provider,
    providerEventId: ev.providerEventId,
    sessionReference: ev.sessionReference,
    checkoutIdempotencyKey: session?.idempotencyKey ?? null,
    eventType: ev.eventType,
    normalizedStatus: ev.normalizedStatus,
    providerRawStatus: ev.providerRawStatus,
    payload: args.payload ?? {},
  });
  if (recorded.duplicate) {
    // Redelivered event — already recorded. NO transition, NO persist, NO
    // downstream action.
    return {
      ok: true, status: 'duplicate', replayed: true,
      settlement_state: sessionState, previous_state: sessionState,
    };
  }

  if (!session) {
    // Recorded for forensic completeness; nothing to reconcile.
    return { ok: true, status: 'unmatched', replayed: false, settlement_state: null, previous_state: null };
  }

  // 5. forward-only state transition
  const from: SettlementState = sessionState ?? 'created';
  const to = ev.normalizedStatus;
  if (!canTransition(from, to)) {
    // Stale / out-of-order / repeated → deterministic idempotent no-op.
    return { ok: true, status: 'no_transition', replayed: false, settlement_state: from, previous_state: from };
  }

  await deps.applySettlementTransition({
    idempotencyKey: session.idempotencyKey,
    settlementStatus: to,
    providerEventReference: ev.providerEventId,
    providerRawStatus: ev.providerRawStatus,
    settledAt: to === 'succeeded' ? new Date().toISOString() : null,
  });
  logger.info('settlement_state_transition', {
    provider: args.provider, from, to, // normalized states only — no pricing
  });

  return { ok: true, status: 'reconciled', replayed: false, settlement_state: to, previous_state: from };
}
