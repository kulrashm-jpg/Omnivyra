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

export type PlanResolutionSource = 'metadata' | 'price_map' | 'legacy_plan_key' | 'unmapped_price' | 'none';
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
    if (r?.data?.id) return { planId: r.data.id, source: 'metadata', priceId };
  }

  // B — Stripe price_id → provider_price_id mapping.
  if (priceId) {
    const r = await deps.db.from('pricing_plans').select('id').eq('provider_price_id', priceId).maybeSingle();
    if (r?.data?.id) return { planId: r.data.id, source: 'price_map', priceId };
  }

  // C — legacy fallback: metadata.plan_key → active pricing_plans row.
  const planKey = typeof meta.plan_key === 'string' ? meta.plan_key : null;
  if (planKey) {
    const r = await deps.db.from('pricing_plans').select('id').eq('plan_key', planKey).eq('is_active', true).maybeSingle();
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

// The unordered upsertBillingSubscription was REMOVED with the event-ordering fix: every subscription ledger write
// goes through applyOrderedSubscriptionWrite, so no caller can re-introduce a write that ignores provider-event order.

// ── Event ordering (BLOCKING money fix, e9 2026-11-13) ──────────────────────────────────────────
// Stripe does not deliver events in order and may redeliver. The ledger used to upsert every event, so a
// stale 'active' arriving after a newer 'canceled' re-activated a cancelled subscription (unpaid service).
// Now each row remembers the provider event it last applied (metadata.stripe_last_event = { id, created }; no
// migration: billing_subscriptions.metadata is jsonb NOT NULL) and an event is applied ONLY if it is newer:
//   created (Stripe's epoch seconds) greater -> newer; smaller -> STALE (logged + counted, never applied);
//   equal created with a different id -> deterministic tie-break on the id (lexicographically greater wins);
//   same id -> duplicate, a no-op.
// The write is a compare-and-set on the event id it read, so two concurrent deliveries cannot both win; a lost
// race re-reads and re-decides (bounded).
export interface ProviderEventRef { id: string; created: number }
export type EventOrder = 'newer' | 'stale' | 'duplicate';

export function compareProviderEvents(incoming: ProviderEventRef, stored: ProviderEventRef | null | undefined): EventOrder {
  if (!stored || typeof stored.id !== 'string' || typeof stored.created !== 'number') return 'newer';
  if (incoming.id === stored.id) return 'duplicate';
  if (incoming.created > stored.created) return 'newer';
  if (incoming.created < stored.created) return 'stale';
  return incoming.id > stored.id ? 'newer' : 'stale';
}

let staleSubscriptionEventsSkipped = 0;
/** Count of stale provider events refused since process start (observability). */
export function getStaleSubscriptionEventsSkipped(): number { return staleSubscriptionEventsSkipped; }

const MAX_ORDERED_WRITE_ATTEMPTS = 3;

/**
 * Event-ordered ledger write: applies input only if `event` is newer than the event the row last applied.
 * Returns ok:true for applied, duplicate and stale (the last two with `skipped`); ok:false only on a read/write
 * failure or persistent contention.
 */
export async function applyOrderedSubscriptionWrite(
  input: SubscriptionUpsertInput,
  event: ProviderEventRef,
  deps: BillingSubDeps,
): Promise<{ ok: boolean; skipped?: 'stale_event' | 'duplicate_event'; error?: string }> {
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
  const evt: ProviderEventRef = { id: event.id, created: event.created };
  for (let attempt = 0; attempt < MAX_ORDERED_WRITE_ATTEMPTS; attempt++) {
    const { data: existing, error: readError } = await deps.db
      .from('billing_subscriptions')
      .select('id, metadata')
      .eq('provider', input.provider)
      .eq('provider_subscription_id', input.providerSubscriptionId)
      .maybeSingle();
    if (readError) return { ok: false, error: readError.message };

    if (!existing) {
      const { error } = await deps.db.from('billing_subscriptions').insert({ ...row, metadata: { stripe_last_event: evt } });
      if (!error) return { ok: true };
      if ((error as { code?: string }).code === '23505') continue; // a concurrent delivery created it: re-decide
      return { ok: false, error: error.message };
    }

    const current = existing as { id: string; metadata?: Record<string, unknown> | null };
    const metadata = (current.metadata && typeof current.metadata === 'object') ? current.metadata : {};
    const stored = (metadata as { stripe_last_event?: ProviderEventRef }).stripe_last_event ?? null;
    const order = compareProviderEvents(evt, stored);
    if (order === 'duplicate') return { ok: true, skipped: 'duplicate_event' };
    if (order === 'stale') {
      staleSubscriptionEventsSkipped += 1;
      console.warn('[billingSubscription] stale provider event refused (not applied)', {
        provider_subscription_id: input.providerSubscriptionId, event_id: evt.id, event_created: evt.created,
        applied_event_id: stored?.id, applied_event_created: stored?.created, refused_status: input.status,
      });
      return { ok: true, skipped: 'stale_event' };
    }

    let update = deps.db
      .from('billing_subscriptions')
      .update({ ...row, metadata: { ...metadata, stripe_last_event: evt } })
      .eq('id', current.id);
    update = stored?.id
      ? update.eq('metadata->stripe_last_event->>id', stored.id)
      : update.is('metadata->stripe_last_event', null);
    const { data: written, error: writeError } = await update.select('id');
    if (writeError) return { ok: false, error: writeError.message };
    if (Array.isArray(written) && written.length === 1) return { ok: true };
    // 0 rows: another delivery applied an event between our read and write. Re-read and re-decide.
  }
  return { ok: false, error: 'subscription_event_contention' };
}

/** Apply a Stripe customer.subscription.* event to the ledger, in provider-event order. Best-effort; returns outcome. */
export async function applyStripeSubscriptionEvent(
  eventType: string,
  obj: StripeSubscriptionObject,
  organizationId: string | null,
  deps: BillingSubDeps,
  event?: ProviderEventRef,
): Promise<{ applied: boolean; reason?: string; status?: LedgerSubStatus; planId?: string | null; planSource?: PlanResolutionSource }> {
  if (!organizationId) return { applied: false, reason: 'no_org' };
  // Fail closed: without the provider event's identity and time the order cannot be decided, so nothing is written.
  if (!event || typeof event.id !== 'string' || !event.id || typeof event.created !== 'number' || !Number.isFinite(event.created)) {
    return { applied: false, reason: 'missing_event_ref' };
  }
  const resolution = await resolvePlanId(obj, deps);                 // deterministic, fail-closed
  const input = buildUpsertFromStripeSubscription(eventType, obj, organizationId, resolution.planId);
  if (!input) return { applied: false, reason: 'incomplete_event' };
  const res = await applyOrderedSubscriptionWrite(input, event, deps);
  if (!res.ok) return { applied: false, reason: res.error };
  if (res.skipped) return { applied: false, reason: res.skipped };
  return { applied: true, status: input.status, planId: input.planId, planSource: resolution.source };
}

/**
 * Expiry / renewal sweep: any active/trialing/past_due subscription whose period (+grace) has
 * passed without a renewal event advancing it transitions to EXPIRED. Renewal itself is
 * event-driven (a customer.subscription.updated upsert advances the period); this sweep handles
 * the lapse case. Returns count expired.
 */
export async function markExpiredSubscriptions(deps: BillingSubDeps, graceDays = SUBSCRIPTION_GRACE_DAYS): Promise<{ expired: number; ids: string[] }> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const cutoffIso = new Date(nowMs - graceDays * 86_400_000).toISOString();
  // current_period_end + grace < now  ⇔  current_period_end < now - grace
  const { data, error } = await deps.db
    .from('billing_subscriptions')
    .select('id, current_period_end, status')
    .in('status', ['active', 'trialing', 'past_due'])
    .lt('current_period_end', cutoffIso);
  if (error || !data) return { expired: 0, ids: [] };
  const ids: string[] = (data as any[]).map((r) => r.id);
  if (ids.length === 0) return { expired: 0, ids: [] };
  const nowIso = new Date(nowMs).toISOString();
  await deps.db.from('billing_subscriptions').update({ status: 'expired', updated_at: nowIso }).in('id', ids);
  return { expired: ids.length, ids };
}
