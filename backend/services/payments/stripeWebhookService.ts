/**
 * Stripe webhook ingestion service — runtime layer.
 *
 * Mirrors the existing Razorpay staging service surface:
 *  - signature verification (Stripe's t=...,v1=... HMAC scheme with timestamp tolerance)
 *  - idempotent event recording into `payment_provider_events`
 *  - deterministic side-effect routing (completePurchase / failPurchase /
 *    payment_transactions insert / record-only for refund+dispute+subscription)
 *
 * STRICT CONSTRAINTS preserved:
 *  - No financial-core rewrites — reuses `recordPaymentProviderEvent`,
 *    `completePurchase`, `failPurchase` from `purchaseService`.
 *  - No settlement RPC change.
 *  - No mutable financial history. `payment_transactions` rows are insert-only
 *    (immutability trigger). Refund/dispute events are recorded in
 *    `payment_provider_events` ONLY; the reconciler (7F) handles the
 *    compensating financial delta deterministically.
 *  - Append-only event lineage — every webhook is recorded once, idempotently.
 *  - No speculative attribution — organization_id is derived in this strict
 *    precedence:
 *       1. matching `credit_purchases.provider_event_id` (payment_intent id
 *          or charge id) — authoritative
 *       2. `event.data.object.metadata.organization_id` (we set this in the
 *          checkout flow) — authoritative
 *       3. NULL — record the event, do NOT insert payment_transactions
 *
 * Pure helpers (signature verification, routing classification) are exported
 * separately for unit-testing without DB.
 */

import crypto from 'crypto';

// ── Stripe event shapes (minimal subset we consume) ─────────────────────────

export interface StripeEventObject {
  id: string;
  amount?: number;             // cents
  amount_paid?: number;        // cents (invoice)
  amount_due?: number;         // cents (invoice)
  amount_refunded?: number;    // cents (charge.refunded)
  amount_captured?: number;    // cents (charge.succeeded)
  amount_received?: number;    // cents (payment_intent.succeeded)
  application_fee_amount?: number; // cents
  currency?: string;
  payment_intent?: string;
  charge?: string;
  invoice?: string;
  subscription?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
  // Subscription event payloads carry these:
  current_period_start?: number;
  current_period_end?: number;
  trial_end?: number;
  cancel_at_period_end?: boolean;
  plan?: { id?: string } | null;
  items?: { data?: Array<{ price?: { id?: string } }> } | null;
}

export interface StripeEventPayload {
  id: string;                  // evt_xxx
  type: string;                // charge.succeeded, etc.
  created: number;             // epoch seconds
  data: { object: StripeEventObject };
  livemode?: boolean;
}

export type StripeWebhookOutcome =
  | { status: 'processed'; eventId: string; eventType: string; purchaseId?: string; creditsGranted?: number; paymentRecorded?: boolean; organizationId?: string | null }
  | { status: 'duplicate'; eventId: string; eventType: string }
  | { status: 'ignored'; eventId: string; eventType: string; reason: string }
  | { status: 'failed'; eventId?: string; eventType?: string; reason: string };

// ── Signature verification (pure) ───────────────────────────────────────────

export interface VerifySignatureArgs {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  toleranceSeconds?: number;
  /** Override for deterministic testing; defaults to current epoch seconds. */
  nowEpochSeconds?: number;
}

export type VerifySignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: string };

export function verifyStripeWebhookSignature(args: VerifySignatureArgs): VerifySignatureResult {
  const header = String(args.signatureHeader || '');
  if (!header) return { ok: false, reason: 'missing_signature_header' };
  const parts = header.split(',').map(s => s.trim()).filter(Boolean);
  const tPart = parts.find(p => p.startsWith('t='));
  const v1Parts = parts.filter(p => p.startsWith('v1='));
  if (!tPart || v1Parts.length === 0) return { ok: false, reason: 'missing_signature_fields' };
  const t = Number(tPart.slice(2));
  if (!Number.isFinite(t) || t <= 0) return { ok: false, reason: 'invalid_timestamp' };
  const now = args.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = args.toleranceSeconds ?? 300;
  if (Math.abs(now - t) > tolerance) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expectedHex = crypto
    .createHmac('sha256', args.secret)
    .update(`${t}.${args.rawBody}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  for (const sigPart of v1Parts) {
    const v1 = sigPart.slice(3).trim();
    if (!v1) continue;
    let actualBuf: Buffer;
    try { actualBuf = Buffer.from(v1, 'hex'); } catch { continue; }
    if (actualBuf.length !== expectedBuf.length) continue;
    if (crypto.timingSafeEqual(actualBuf, expectedBuf)) return { ok: true, timestamp: t };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

// ── Routing classification (pure) ───────────────────────────────────────────

export type RoutingAction =
  | 'complete_purchase'   // charge.succeeded, payment_intent.succeeded, invoice.paid
  | 'fail_purchase'       // invoice.payment_failed, payment_intent.payment_failed
  | 'record_refund'       // charge.refunded
  | 'record_dispute'      // charge.dispute.created, charge.dispute.closed
  | 'record_subscription' // customer.subscription.*
  | 'record_only'         // anything else we accept but do not act on
  | 'unsupported';        // unknown event type — ignored

export function classifyStripeEvent(eventType: string): RoutingAction {
  switch (eventType) {
    case 'charge.succeeded':
    case 'payment_intent.succeeded':
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return 'complete_purchase';
    case 'invoice.payment_failed':
    case 'payment_intent.payment_failed':
      return 'fail_purchase';
    case 'charge.refunded':
      return 'record_refund';
    case 'charge.dispute.created':
    case 'charge.dispute.closed':
      return 'record_dispute';
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return 'record_subscription';
    default:
      return 'unsupported';
  }
}

function centsToUsd(cents: unknown): number {
  const n = typeof cents === 'string' ? Number(cents) : cents;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

/**
 * Pick organization_id from `metadata.organization_id` (or aliases). Never
 * infers from any other field — returning null is the honest answer when the
 * checkout flow did not stamp the metadata.
 */
export function organizationIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const candidates = [m.organization_id, m.org_id, m.company_id, m.organizationId];
  for (const v of candidates) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// ── Dependency-injected service (DB-side; testable with mocks) ──────────────

export interface PurchaseLookup {
  id: string;
  organization_id: string;
  status: string;
  fulfillment_status?: string | null;
}

export interface RecordPaymentTransactionInput {
  organizationId: string;
  providerTransactionId: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  status: 'succeeded';
  occurredAt: string;
  paymentIntentId?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  metadata: Record<string, unknown>;
}

export interface StripeWebhookDeps {
  recordEvent: (input: {
    providerEventId: string;
    eventType: string;
    purchaseId?: string | null;
    organizationId?: string | null;
    payload: Record<string, unknown>;
  }) => Promise<{ id: string | null; duplicate: boolean; processingStatus?: string | null }>;

  findPurchaseByProviderEventId: (providerEventId: string) => Promise<PurchaseLookup | null>;
  completePurchase: (purchaseId: string, referenceId: string) => Promise<{ success: boolean; reason?: string; purchaseId?: string; creditsGranted?: number }>;
  failPurchase: (purchaseId: string, referenceId: string) => Promise<void>;

  recordPaymentTransaction?: (input: RecordPaymentTransactionInput) => Promise<{ inserted: boolean; duplicate: boolean }>;

  /** Subscription lifecycle write-path — populates billing_subscriptions from sub events. Best-effort. */
  applySubscriptionEvent?: (eventType: string, obj: StripeEventObject, organizationId: string | null) => Promise<{ applied: boolean; reason?: string }>;

  markEvent?: (eventId: string, status: 'processed' | 'duplicate' | 'failed' | 'ignored', error?: string) => Promise<void>;
}

/**
 * Resolve a Stripe event to a (purchase, organization_id) pair without
 * speculating. Returns null org_id when neither source yields one.
 */
async function resolveOrgAndPurchase(
  obj: StripeEventObject,
  deps: StripeWebhookDeps,
): Promise<{ purchase: PurchaseLookup | null; organizationId: string | null }> {
  // Charge / payment_intent / invoice ids in precedence — same precedence
  // the matcher uses, so runtime + reconciliation see the same picture.
  const candidates: string[] = [];
  if (typeof obj.payment_intent === 'string') candidates.push(obj.payment_intent);
  if (typeof obj.id === 'string') candidates.push(obj.id);
  if (typeof obj.charge === 'string') candidates.push(obj.charge);
  if (typeof obj.invoice === 'string') candidates.push(obj.invoice);

  for (const id of candidates) {
    const p = await deps.findPurchaseByProviderEventId(id);
    if (p) return { purchase: p, organizationId: p.organization_id };
  }
  return { purchase: null, organizationId: organizationIdFromMetadata(obj.metadata) };
}

/**
 * Process a single verified Stripe event. Idempotent across replays of the
 * same `evt.id`. Returns a deterministic outcome — never throws on routing
 * errors; only throws on DB failures the caller should retry.
 */
export async function processStripeWebhookEvent(
  evt: StripeEventPayload,
  deps: StripeWebhookDeps,
): Promise<StripeWebhookOutcome> {
  if (!evt || typeof evt !== 'object' || !evt.id || !evt.type) {
    return { status: 'failed', reason: 'invalid_event' };
  }
  const action = classifyStripeEvent(evt.type);
  const obj = (evt.data && evt.data.object) || ({} as StripeEventObject);

  // Pre-resolve attribution so the event log records org_id even on unsupported types.
  const resolved = await resolveOrgAndPurchase(obj, deps);

  // 1) Append-only event ingestion (idempotent via UNIQUE(provider, provider_event_id)).
  const recorded = await deps.recordEvent({
    providerEventId: evt.id,
    eventType: evt.type,
    purchaseId: resolved.purchase?.id ?? null,
    organizationId: resolved.organizationId,
    payload: evt as unknown as Record<string, unknown>,
  });
  if (recorded.duplicate) {
    return { status: 'duplicate', eventId: evt.id, eventType: evt.type };
  }

  // 2) Side-effect routing — every path returns deterministically.
  if (action === 'unsupported') {
    await markIgnored(deps, recorded.id, `unsupported_event_type:${evt.type}`);
    return { status: 'ignored', eventId: evt.id, eventType: evt.type, reason: 'unsupported_event_type' };
  }

  if (action === 'record_refund' || action === 'record_dispute' || action === 'record_subscription') {
    // Append-only: we record into payment_provider_events (already done).
    // No payment_transactions write; reconciler (7F) emits compensating
    // adjustment rows from Stripe's balance_transactions export.
    //
    // Subscription lifecycle write-path: maintain billing_subscriptions as the authoritative
    // ledger. Best-effort — a failure here never breaks webhook processing (the event is
    // already durably recorded above and can be replayed/reconciled).
    if (action === 'record_subscription' && deps.applySubscriptionEvent) {
      try {
        await deps.applySubscriptionEvent(evt.type, obj, resolved.organizationId);
      } catch {
        /* best-effort: ledger upsert failure must not fail the webhook */
      }
    }
    await markProcessed(deps, recorded.id);
    return {
      status: 'processed',
      eventId: evt.id,
      eventType: evt.type,
      organizationId: resolved.organizationId,
      paymentRecorded: false,
    };
  }

  if (action === 'fail_purchase') {
    if (resolved.purchase) {
      await deps.failPurchase(resolved.purchase.id, evt.id);
      await markProcessed(deps, recorded.id);
      return {
        status: 'processed',
        eventId: evt.id, eventType: evt.type,
        organizationId: resolved.organizationId,
        purchaseId: resolved.purchase.id,
        paymentRecorded: false,
      };
    }
    // No internal purchase to fail — recorded for audit.
    await markIgnored(deps, recorded.id, 'no_matching_purchase');
    return { status: 'ignored', eventId: evt.id, eventType: evt.type, reason: 'no_matching_purchase' };
  }

  // complete_purchase path: try to settle the matching purchase + write a
  // payment_transactions row (insert-only).
  let creditsGranted: number | undefined;
  if (resolved.purchase) {
    const result = await deps.completePurchase(resolved.purchase.id, evt.id);
    if (result.success) creditsGranted = result.creditsGranted;
  }

  // Insert payment_transactions row ONLY when we have a confirmed org_id and
  // the income event carries a positive amount. Idempotent via
  // UNIQUE(provider, provider_transaction_id) at the DB level.
  let paymentRecorded = false;
  const orgId = resolved.organizationId;
  if (orgId && deps.recordPaymentTransaction) {
    const amount = centsToUsd(obj.amount_received ?? obj.amount_captured ?? obj.amount_paid ?? obj.amount);
    const fee    = centsToUsd(obj.application_fee_amount);
    if (amount > 0) {
      try {
        const r = await deps.recordPaymentTransaction({
          organizationId: orgId,
          providerTransactionId: obj.id,
          amount,
          fee,
          net: amount - fee,
          currency: (obj.currency || 'usd').toUpperCase(),
          status: 'succeeded',
          occurredAt: new Date(evt.created * 1000).toISOString(),
          paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : null,
          invoiceId:       typeof obj.invoice         === 'string' ? obj.invoice         : null,
          subscriptionId:  typeof obj.subscription    === 'string' ? obj.subscription    : null,
          metadata: { stripe_event_id: evt.id, stripe_event_type: evt.type },
        });
        paymentRecorded = r.inserted;
      } catch (err) {
        // Recording the payment transaction is best-effort — the event itself
        // is already durable and the credit grant is idempotent. We mark the
        // event processed so retries do not double-credit.
        // eslint-disable-next-line no-console
        console.warn('[stripeWebhookService] payment_transactions insert failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  await markProcessed(deps, recorded.id);
  return {
    status: 'processed',
    eventId: evt.id,
    eventType: evt.type,
    organizationId: orgId,
    purchaseId: resolved.purchase?.id,
    creditsGranted,
    paymentRecorded,
  };
}

async function markProcessed(deps: StripeWebhookDeps, id: string | null): Promise<void> {
  if (deps.markEvent && id) await deps.markEvent(id, 'processed');
}
async function markIgnored(deps: StripeWebhookDeps, id: string | null, reason: string): Promise<void> {
  if (deps.markEvent && id) await deps.markEvent(id, 'ignored', reason);
}
