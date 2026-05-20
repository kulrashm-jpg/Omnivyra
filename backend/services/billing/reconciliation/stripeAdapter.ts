/**
 * Stripe event/export normalizer — PURE, DETERMINISTIC.
 *
 * Normalizes Stripe-shaped payloads into a single internal event shape so
 * the matcher (stripeMatcher.ts) can reconcile against our internal
 * credit_purchases / payment_transactions records without knowing the
 * source format. NEVER throws on a malformed event — skips and reports
 * it in `warnings` so the orchestrator records a meaningful anomaly.
 *
 * Two well-defined operator-supplied shapes:
 *
 *   (A) Balance-transaction export — the documented Stripe Balance API
 *       export shape, one row per balance transaction:
 *       `{ balance_transactions: [{ id, type, source, amount, fee, net,
 *       currency, created, available_on, status, description?, metadata? }] }`.
 *       `type` ∈ ('charge','refund','payment','adjustment','payout','stripe_fee',
 *       'application_fee','dispute'). Amounts are in cents (Stripe convention)
 *       and converted to USD dollars here for downstream determinism.
 *
 *   (B) Webhook event log shape — operator log of Stripe events:
 *       `{ events: [{ id, type, created, data: { object: { id, amount,
 *       application_fee_amount?, charges?, payment_intent?, invoice?,
 *       subscription?, status?, refunded?, amount_refunded?, metadata? } } }] }`.
 *       Covers `charge.succeeded`, `charge.refunded`, `payment_intent.succeeded`,
 *       `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`,
 *       `customer.subscription.updated`, `customer.subscription.deleted`,
 *       `charge.dispute.created`, `charge.dispute.closed`.
 *
 * NO speculative attribution: organization_id is taken ONLY from
 * `metadata.organization_id` (which our checkout flow sets). When missing
 * the event is normalized with `organization_id: null` and the matcher
 * surfaces it as a platform-level row.
 *
 * Amount normalization: Stripe quotes amounts in the smallest currency
 * unit (cents for USD). This adapter converts to USD dollars as numeric
 * with `amount_cents / 100`. Currencies other than USD are preserved on
 * the event but the matcher ONLY operates on USD-denominated rows; the
 * orchestrator should record but skip non-USD rows in the variance
 * computation (deferred to caller policy).
 */

export const STRIPE_ADAPTER_VERSION_BALANCE = 'stripe_balance_v1';
export const STRIPE_ADAPTER_VERSION_WEBHOOK = 'stripe_webhook_v1';

export type StripeEventKind =
  | 'charge'
  | 'refund'
  | 'invoice'
  | 'subscription'
  | 'dispute'
  | 'fee'
  | 'payout';

export type StripeEventStatus =
  | 'succeeded'
  | 'pending'
  | 'failed'
  | 'refunded'
  | 'partially_refunded'
  | 'disputed'
  | 'recorded';

export interface StripeNormalizedEvent {
  /** Stable Stripe-side id: ch_xxx, re_xxx, in_xxx, sub_xxx, py_xxx, etc. */
  stripe_id: string;
  stripe_type: StripeEventKind;
  occurred_at: string; // ISO timestamp
  /** From metadata.organization_id when present; else null (no inference). */
  organization_id: string | null;
  gross_amount_usd: number;
  fee_amount_usd: number;
  /** Computed as gross - fee unless caller supplied an explicit net. */
  net_amount_usd: number;
  currency: string;
  payment_intent_id: string | null;
  charge_id: string | null;
  invoice_id: string | null;
  subscription_id: string | null;
  status: StripeEventStatus;
  refunded_amount_usd: number;
  /** Stripe webhook event id (evt_xxx) when applicable; else null. */
  raw_event_id: string | null;
  metadata: Record<string, unknown>;
}

export interface StripeNormalizeResult {
  adapter_version: string;
  events: StripeNormalizedEvent[];
  warnings: string[];
}

function asNumber(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Cents → dollars; defensive against null/undefined/string-encoded. */
function centsToUsd(cents: unknown): number {
  const v = asNumber(cents);
  return Math.round(v) / 100;
}

function isoFromEpochOrIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string' && value.length >= 10) {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

function readOrgIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const candidates = [m.organization_id, m.org_id, m.company_id, m.organizationId];
  for (const v of candidates) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function balanceTypeToKind(type: unknown): StripeEventKind | null {
  const t = String(type ?? '').toLowerCase();
  if (t === 'charge' || t === 'payment')                          return 'charge';
  if (t === 'refund' || t === 'payment_refund')                   return 'refund';
  if (t === 'stripe_fee' || t === 'application_fee')              return 'fee';
  if (t === 'dispute' || t === 'adjustment')                      return 'dispute';
  if (t === 'payout' || t === 'transfer')                         return 'payout';
  return null;
}

/** (A) Stripe balance_transactions export → normalized events. */
export function normalizeStripeBalanceExport(args: {
  payload: unknown;
}): StripeNormalizeResult {
  const warnings: string[] = [];
  const events: StripeNormalizedEvent[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const rows = Array.isArray(env.balance_transactions) ? env.balance_transactions
             : (Array.isArray(env.data)                 ? env.data
             : (Array.isArray(args.payload)             ? (args.payload as unknown[])
             : []));

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;

    const stripeId = String(row.id ?? '').trim();
    if (!stripeId) { warnings.push('balance row missing id'); continue; }

    const kind = balanceTypeToKind(row.type);
    if (!kind) { warnings.push(`balance row ${stripeId} unrecognized type: ${String(row.type)}`); continue; }

    const occurred = isoFromEpochOrIso(row.created);
    if (!occurred) { warnings.push(`balance row ${stripeId} missing created timestamp`); continue; }

    const gross = centsToUsd(row.amount);
    const fee   = centsToUsd(row.fee);
    const net   = (row.net != null) ? centsToUsd(row.net) : gross - fee;

    const source = row.source && typeof row.source === 'object' ? row.source as Record<string, unknown> : {};
    const sourceId = typeof row.source === 'string' ? row.source : (typeof source.id === 'string' ? source.id : null);

    // Refunds + disputes carry signed amounts in Stripe (negative for refund/dispute).
    let status: StripeEventStatus = 'succeeded';
    let refundedAmount = 0;
    if (kind === 'refund') {
      status = 'refunded';
      refundedAmount = Math.abs(gross);
    } else if (kind === 'dispute') {
      status = 'disputed';
      refundedAmount = Math.abs(gross);
    } else if (kind === 'fee') {
      status = 'recorded';
    }

    events.push({
      stripe_id: stripeId,
      stripe_type: kind,
      occurred_at: occurred,
      organization_id: readOrgIdFromMetadata(row.metadata),
      gross_amount_usd: gross,
      fee_amount_usd:   fee,
      net_amount_usd:   net,
      currency: String(row.currency ?? 'usd').toUpperCase(),
      payment_intent_id: kind === 'charge' && typeof source.payment_intent === 'string' ? source.payment_intent : null,
      charge_id:        (kind === 'charge' || kind === 'refund' || kind === 'dispute') ? sourceId : null,
      invoice_id:       typeof source.invoice === 'string' ? source.invoice : null,
      subscription_id:  typeof source.subscription === 'string' ? source.subscription : null,
      status,
      refunded_amount_usd: refundedAmount,
      raw_event_id: null,
      metadata: (row.metadata && typeof row.metadata === 'object') ? row.metadata as Record<string, unknown> : {},
    });
  }

  return { adapter_version: STRIPE_ADAPTER_VERSION_BALANCE, events: stableSorted(events), warnings };
}

/** (B) Stripe webhook event log → normalized events. */
export function normalizeStripeWebhookLog(args: {
  payload: unknown;
}): StripeNormalizeResult {
  const warnings: string[] = [];
  const events: StripeNormalizedEvent[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const rows = Array.isArray(env.events) ? env.events : [];

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const evt = raw as Record<string, unknown>;

    const evtId = String(evt.id ?? '').trim();
    const type = String(evt.type ?? '').trim();
    if (!evtId || !type) { warnings.push('webhook event missing id/type'); continue; }

    const occurred = isoFromEpochOrIso(evt.created);
    if (!occurred) { warnings.push(`webhook ${evtId} (${type}) missing created`); continue; }

    const data = evt.data && typeof evt.data === 'object' ? evt.data as Record<string, unknown> : {};
    const obj  = data.object && typeof data.object === 'object' ? data.object as Record<string, unknown> : {};
    const objectId = String(obj.id ?? '').trim();
    if (!objectId) { warnings.push(`webhook ${evtId} (${type}) missing data.object.id`); continue; }

    const orgId = readOrgIdFromMetadata(obj.metadata);
    const currency = String(obj.currency ?? 'usd').toUpperCase();

    const pushChargeLike = (kind: StripeEventKind, gross: number, fee: number, status: StripeEventStatus, extra: Partial<StripeNormalizedEvent> = {}) => {
      events.push({
        stripe_id: objectId,
        stripe_type: kind,
        occurred_at: occurred,
        organization_id: orgId,
        gross_amount_usd: gross,
        fee_amount_usd:   fee,
        net_amount_usd:   gross - fee,
        currency,
        payment_intent_id: typeof obj.payment_intent === 'string' ? obj.payment_intent : null,
        charge_id:         (kind === 'charge' || kind === 'refund' || kind === 'dispute') ? objectId : null,
        invoice_id:        typeof obj.invoice === 'string' ? obj.invoice : null,
        subscription_id:   typeof obj.subscription === 'string' ? obj.subscription : null,
        status,
        refunded_amount_usd: kind === 'refund' || kind === 'dispute' ? Math.abs(gross) : 0,
        raw_event_id: evtId,
        metadata: (obj.metadata && typeof obj.metadata === 'object') ? obj.metadata as Record<string, unknown> : {},
        ...extra,
      });
    };

    switch (type) {
      case 'charge.succeeded':
      case 'payment_intent.succeeded': {
        const gross = centsToUsd(obj.amount ?? obj.amount_captured ?? obj.amount_received);
        const fee   = centsToUsd(obj.application_fee_amount);
        pushChargeLike('charge', gross, fee, 'succeeded');
        break;
      }
      case 'charge.refunded': {
        const refunded = centsToUsd(obj.amount_refunded);
        const amount   = centsToUsd(obj.amount);
        const fully    = amount === refunded;
        pushChargeLike('refund', refunded, 0, fully ? 'refunded' : 'partially_refunded', {
          refunded_amount_usd: refunded,
        });
        break;
      }
      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        const gross = centsToUsd(obj.amount);
        pushChargeLike('dispute', gross, 0, 'disputed');
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const gross = centsToUsd(obj.amount_paid ?? obj.amount_due ?? obj.total);
        pushChargeLike('invoice', gross, 0, 'succeeded');
        break;
      }
      case 'invoice.payment_failed': {
        pushChargeLike('invoice', centsToUsd(obj.amount_due ?? obj.total), 0, 'failed');
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        pushChargeLike('subscription', 0, 0, 'recorded', {
          subscription_id: objectId,
        });
        break;
      }
      default:
        // Unknown event types are skipped silently — operator can extend later.
        warnings.push(`webhook ${evtId} skipped: unhandled type ${type}`);
        continue;
    }
  }

  return { adapter_version: STRIPE_ADAPTER_VERSION_WEBHOOK, events: stableSorted(events), warnings };
}

function stableSorted(arr: StripeNormalizedEvent[]): StripeNormalizedEvent[] {
  return [...arr].sort((a, b) => {
    const c = a.occurred_at.localeCompare(b.occurred_at); if (c) return c;
    const d = a.stripe_type.localeCompare(b.stripe_type); if (d) return d;
    return a.stripe_id.localeCompare(b.stripe_id);
  });
}
