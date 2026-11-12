/**
 * billingSubscriptionService.ts
 *
 * Lifecycle WRITE-path for `billing_subscriptions` — makes it the authoritative subscription
 * ledger the canonical resolver ([[subscriptionStateResolver]]) reads. Populated from billing
 * events (Stripe subscription webhooks) and maintained by an expiry sweep.
 *
 * Scope guard: this ONLY writes the subscription ledger + provides an expiry sweep. It does NOT
 * lock top-up credits, change credit expiry, send notifications, or alter UI.
 *
 * Pure helpers (status mapping, upsert-input building) are testable; the async writers take an
 * injectable supabase-like client.
 */

export type LedgerSubStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired';

export const SUBSCRIPTION_GRACE_DAYS = 3;

/** Map a provider (Stripe) status string → our `billing_subscriptions.status` enum. */
export function mapStripeStatus(stripeStatus: string | null | undefined): LedgerSubStatus {
  switch (String(stripeStatus ?? '').toLowerCase()) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete': return 'past_due';
    case 'paused': return 'paused';
    case 'canceled':
    case 'cancelled': return 'canceled';
    case 'incomplete_expired': return 'expired';
    default: return 'active';
  }
}

const unixToIso = (s: number | null | undefined): string | null =>
  typeof s === 'number' && Number.isFinite(s) ? new Date(s * 1000).toISOString() : null;

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface SubscriptionUpsertInput {
  organizationId: string;
  provider: string;                 // 'stripe' | 'razorpay' | …
  providerSubscriptionId: string;
  planId: string | null;
  status: LedgerSubStatus;
  currentPeriodStart: string;       // ISO (NOT NULL in schema)
  currentPeriodEnd: string;         // ISO (NOT NULL in schema)
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  autoRenew: boolean;
}

/** Shape of a Stripe customer.subscription.* event object (the fields we use). */
export interface StripeSubscriptionObject {
  id?: string;
  status?: string;
  current_period_start?: number;
  current_period_end?: number;
  trial_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, unknown> | null;
  plan?: { id?: string } | null;
  items?: { data?: Array<{ price?: { id?: string } }> } | null;
}

/** PURE: extract the Stripe price id from a subscription object. */
export function extractPriceId(obj: StripeSubscriptionObject): string | null {
  return obj.plan?.id ?? obj.items?.data?.[0]?.price?.id ?? null;
}

export type PlanResolutionSource = 'metadata' | 'price_map' | 'legacy_plan_key' | 'unmapped_price' | 'none' | 'read_failed';
export interface PlanResolution { planId: string | null; source: PlanResolutionSource; priceId: string | null; }

/**
 * Deterministic plan resolution. Priority: (A) explicit metadata.plan_id uuid → (B) Stripe
 * price_id → pricing_plans.provider_price_id → (C) legacy metadata.plan_key → active plan.
 * FAILS CLOSED: if a price_id is present but unmapped → planId null (`unmapped_price`); if nothing
 * resolves → null (`none`). Never guesses a default plan.
 */
export async function resolvePlanId(obj: StripeSubscriptionObject, deps: BillingSubDeps): Promise<PlanResolution> {
  const priceId = extractPriceId(obj);
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;

  // A — explicit metadata.plan_id (authoritative). Verify it is a real plan.
  const metaPlanId = meta.plan_id;
  if (isUuid(metaPlanId)) {
    const r = await deps.db.from('pricing_plans').select('id').eq('id', metaPlanId).maybeSingle();
    // A failed read is not "unmapped" / "none": report it as what it is
    // (planId null, source read_failed) - the subscription is still recorded,
    // and the plan mapping is visibly unresolved rather than silently absent.
    if (r?.error) { console.error('[billingSubscription] plan read failed (metadata):', r.error.message); return { planId: null, source: 'read_failed', priceId }; }
    if (r?.data?.id) return { planId: r.data.id, source: 'metadata', priceId };
  }

  // B — Stripe price_id → provider_price_id mapping.
  if (priceId) {
    const r = await deps.db.from('pricing_plans').select('id').eq('provider_price_id', priceId).maybeSingle();
    if (r?.error) { console.error('[billingSubscription] plan read failed (price_map):', r.error.message); return { planId: null, source: 'read_failed', priceId }; }
    if (r?.data?.id) return { planId: r.data.id, source: 'price_map', priceId };
  }

  // C — legacy fallback: metadata.plan_key → active pricing_plans row.
  const planKey = typeof meta.plan_key === 'string' ? meta.plan_key : null;
  if (planKey) {
    const r = await deps.db.from('pricing_plans').select('id').eq('plan_key', planKey).eq('is_active', true).maybeSingle();
    if (r?.error) { console.error('[billingSubscription] plan read failed (legacy_plan_key):', r.error.message); return { planId: null, source: 'read_failed', priceId }; }
    if (r?.data?.id) return { planId: r.data.id, source: 'legacy_plan_key', priceId };
  }

  // Fail closed: known-but-unmapped price vs nothing at all.
  return { planId: null, source: priceId ? 'unmapped_price' : 'none', priceId };
}

/**
 * PURE: build an upsert input from a Stripe subscription event object + resolved org. Returns
 * null if the event lacks the minimum identity/period fields. `customer.subscription.deleted`
 * forces CANCELED regardless of the object status. `resolvedPlanId` (from `resolvePlanId`) wins
 * when provided; otherwise falls back to a metadata.plan_id uuid (legacy/direct-caller path).
 */
export function buildUpsertFromStripeSubscription(
  eventType: string,
  obj: StripeSubscriptionObject,
  organizationId: string,
  resolvedPlanId?: string | null,
): SubscriptionUpsertInput | null {
  const providerSubscriptionId = obj.id;
  const start = unixToIso(obj.current_period_start);
  const end = unixToIso(obj.current_period_end);
  if (!providerSubscriptionId || !start || !end) return null;

  const status: LedgerSubStatus = eventType === 'customer.subscription.deleted'
    ? 'canceled'
    : mapStripeStatus(obj.status);

  const metaPlan = (obj.metadata && (obj.metadata as any).plan_id) ?? null;
  const planId = resolvedPlanId !== undefined ? resolvedPlanId : (isUuid(metaPlan) ? metaPlan : null);

  return {
    organizationId,
    provider: 'stripe',
    providerSubscriptionId,
    planId,
    status,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    trialEndsAt: unixToIso(obj.trial_end),
    cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
    autoRenew: !obj.cancel_at_period_end,
  };
}

export interface BillingSubDeps {
  db: { from: (table: string) => any };
  now?: () => number;
}

/** Upsert a subscription row (conflict on provider+provider_subscription_id). Idempotent. */
export async function upsertBillingSubscription(input: SubscriptionUpsertInput, deps: BillingSubDeps): Promise<{ ok: boolean; error?: string }> {
  const nowIso = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const row = {
    organization_id: input.organizationId,
    provider: input.provider,
    provider_subscription_id: input.providerSubscriptionId,
    plan_id: input.planId,
    status: input.status,
    current_period_start: input.currentPeriodStart,
    current_period_end: input.currentPeriodEnd,
    trial_ends_at: input.trialEndsAt,
    cancel_at_period_end: input.cancelAtPeriodEnd,
    auto_renew: input.autoRenew,
    updated_at: nowIso,
  };
  const { error } = await deps.db
    .from('billing_subscriptions')
    .upsert(row, { onConflict: 'provider,provider_subscription_id' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Apply a Stripe customer.subscription.* event to the ledger. Best-effort; returns outcome. */
export async function applyStripeSubscriptionEvent(
  eventType: string,
  obj: StripeSubscriptionObject,
  organizationId: string | null,
  deps: BillingSubDeps,
): Promise<{ applied: boolean; reason?: string; status?: LedgerSubStatus; planId?: string | null; planSource?: PlanResolutionSource }> {
  if (!organizationId) return { applied: false, reason: 'no_org' };
  const resolution = await resolvePlanId(obj, deps);                 // deterministic, fail-closed
  const input = buildUpsertFromStripeSubscription(eventType, obj, organizationId, resolution.planId);
  if (!input) return { applied: false, reason: 'incomplete_event' };
  const res = await upsertBillingSubscription(input, deps);
  return res.ok
    ? { applied: true, status: input.status, planId: input.planId, planSource: resolution.source }
    : { applied: false, reason: res.error };
}

/**
 * Expiry / renewal sweep: any active/trialing/past_due subscription whose period (+grace) has
 * passed without a renewal event advancing it transitions to EXPIRED. Renewal itself is
 * event-driven (a customer.subscription.updated upsert advances the period); this sweep handles
 * the lapse case. Returns count expired.
 */
/** Rows per sweep batch: bounds the `.in('id', ...)` URL (PostgREST 414 on a mass lapse). */
export const EXPIRY_SWEEP_BATCH = 200;
/** Batches per run; the next run continues (the read is the remaining work). */
export const EXPIRY_SWEEP_MAX_BATCHES = 50;

export async function markExpiredSubscriptions(deps: BillingSubDeps, graceDays = SUBSCRIPTION_GRACE_DAYS): Promise<{ expired: number; ids: string[] }> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const cutoffIso = new Date(nowMs - graceDays * 86_400_000).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const expiredIds: string[] = [];
  // BATCHED (05, 2026-11-12): the read was unbounded and every id went into ONE
  // `.in('id', ...)` URL - a mass lapse (pricing change, provider outage,
  // backfill) could fail the whole sweep with a 414. Expired rows leave the
  // predicate, so each read returns the remaining work; a short batch, or a
  // batch that updated nothing (lost every CAS), ends the run.
  for (let batch = 0; batch < EXPIRY_SWEEP_MAX_BATCHES; batch++) {
    // current_period_end + grace < now  <=>  current_period_end < now - grace
    const { data, error } = await deps.db
      .from('billing_subscriptions')
      .select('id, current_period_end, status')
      .in('status', ['active', 'trialing', 'past_due'])
      .lt('current_period_end', cutoffIso)
      .limit(EXPIRY_SWEEP_BATCH);
    // A failed read is not "nothing to expire", and an unread update is not
    // "expired": throw so the cron reports the failure instead of a false count.
    if (error) throw new Error(`[billingSubscription] expiry candidates read failed: ${error.message}`);
    const ids: string[] = ((data ?? []) as any[]).map((r) => r.id);
    if (ids.length === 0) break;
    // CLASS 2 (2026-11-12): the update RE-STATES the expiry predicate (status +
    // period) instead of trusting the read. A Stripe renewal that advanced
    // current_period_end (or a status change) between the read and this write
    // used to be overwritten to 'expired' - and an expired subscription feeds the
    // credit-expiry sweep (drains the paying org's allocation) and blocks the
    // next allocation. Only rows STILL lapsed are expired, and the count is the
    // rows actually updated.
    const { data: updated, error: updErr } = await deps.db.from('billing_subscriptions')
      .update({ status: 'expired', updated_at: nowIso })
      .in('id', ids)
      .in('status', ['active', 'trialing', 'past_due'])
      .lt('current_period_end', cutoffIso)
      .select('id');
    if (updErr) throw new Error(`[billingSubscription] expiry update failed for ${ids.length} subscription(s): ${updErr.message}`);
    const batchIds = ((updated ?? []) as Array<{ id: string }>).map((r) => r.id);
    expiredIds.push(...batchIds);
    if (ids.length < EXPIRY_SWEEP_BATCH || batchIds.length === 0) break;
  }
  return { expired: expiredIds.length, ids: expiredIds };
}
