/**
 * subscriptionCreditExpiryService.ts
 *
 * Expire SUBSCRIPTION-issued credits (the `free` / plan pool) when subscription entitlement ends
 * (state EXPIRED or CANCELED). Unlike the top-up lock (a derived availability gate), subscription
 * credits are ACTUALLY removed — policy: "not restored after expiry; replaced by newly allocated
 * subscription credits on renewal". Renewal grants fresh credits via subscriptionAllocationService
 * (new period idempotency key), so the expired balance is never resurrected.
 *
 * Removal uses the existing atomic `apply_credit_reservation` phase='expire' RPC, which touches
 * ONLY free_balance — the DB function RAISES if paid/incentive amounts are non-zero, so paid
 * (top-up) and incentive balances are structurally preserved. Ledger history is appended (an
 * expiry transaction), never deleted.
 *
 * Bucket note: `free` is the plan/subscription pool by system convention (consumed first).
 * Onboarding/admin free grants share this bucket and have their own time-based expiry; precise
 * per-source separation would require ledger-derived sub-balances (out of scope). This expires the
 * free pool for a TERMINATED subscription only.
 *
 * Scope guard: no notifications, emails, or UI.
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { SYSTEM_USER_ID } from './auditActorService';
import { resolveTopupEntitlement, type TopupEntitlement } from './subscriptionStateResolver';

export interface ExpiryDeps {
  db: { from: (table: string) => any };
  rpc: (args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  now?: () => number;
  performedBy?: string;
}

export interface SubscriptionExpiryResult {
  expired: number;
  state: TopupEntitlement['state'];
  reason?: 'not_terminated' | 'no_free_balance' | 'already_expired' | string;
}

/** Default prod deps (module supabase). */
export function defaultExpiryDeps(): ExpiryDeps {
  return {
    db: supabase as any,
    rpc: (args) => supabase.rpc('apply_credit_reservation', args) as any,
  };
}

/**
 * Expire the subscription (free) pool for one org IFF its subscription is terminated
 * (EXPIRED/CANCELED). Idempotent per org per day. Returns credits expired (0 if not eligible).
 */
export async function expireSubscriptionCreditsForOrg(orgId: string, deps: ExpiryDeps = defaultExpiryDeps()): Promise<SubscriptionExpiryResult> {
  const nowMs = deps.now ? deps.now() : Date.now();

  // Only terminated subscriptions expire credits. NO_SUBSCRIPTION / ACTIVE / TRIALING / GRACE /
  // PAST_DUE → never (legacy orgs and entitled orgs keep their free pool).
  const { state } = await resolveTopupEntitlement(orgId, { db: deps.db, now: () => nowMs });
  if (state !== 'EXPIRED' && state !== 'CANCELED') return { expired: 0, state, reason: 'not_terminated' };

  const walletRes = await deps.db
    .from('organization_credits')
    .select('free_balance, paid_balance, incentive_balance')
    .eq('organization_id', orgId)
    .maybeSingle();
  const free = walletRes?.data?.free_balance ?? 0;
  if (free <= 0) return { expired: 0, state, reason: 'no_free_balance' };

  // Cap at the SUBSCRIPTION-issued portion so signup credits (also `free`, but governed by their
  // own 30-day validity) are not wrongly expired by a subscription ending. `free` is a pooled
  // bucket (signup + subscription), so this caps damage at the most recent subscription allocation
  // — precise per-grant separation would need ledger-FIFO tracking (documented limitation).
  const allocRes = await deps.db
    .from('credit_transactions')
    .select('credits_delta, free_delta')
    .eq('organization_id', orgId)
    .eq('reference_type', 'subscription_allocation')
    .order('created_at', { ascending: false })
    .limit(1);
  const lastAlloc = (allocRes?.data ?? [])[0];
  const subscriptionAllocated = Math.max(0, Number(lastAlloc?.free_delta ?? lastAlloc?.credits_delta ?? 0));
  const toExpire = Math.min(free, subscriptionAllocated);
  if (toExpire <= 0) return { expired: 0, state, reason: subscriptionAllocated <= 0 ? 'no_subscription_credits' : 'no_free_balance' };

  const dayKey = new Date(nowMs).toISOString().slice(0, 10);
  const idempotencyKey = createHash('sha256').update(`expire:subscription:${orgId}:${dayKey}`).digest('hex').slice(0, 32);

  const existing = await deps.db.from('credit_transactions').select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing?.data) return { expired: 0, state, reason: 'already_expired' };

  const { error } = await deps.rpc({
    p_org_id: orgId,
    p_phase: 'expire',
    p_free_amount: toExpire,
    p_incentive_amount: 0,   // preserve incentive
    p_paid_amount: 0,        // preserve paid (top-up) — DB raises if non-zero
    p_idempotency_key: idempotencyKey,
    p_reference_type: 'subscription_expiry',
    p_reference_id: null,
    p_note: `Subscription credit expiry (${state}, ${dayKey})`,
    p_performed_by: deps.performedBy ?? SYSTEM_USER_ID,
    p_parent_id: null,
  });
  if (error) return { expired: 0, state, reason: `rpc_error:${error.message}` };
  return { expired: toExpire, state };
}

export interface ExpirySweepSummary { processed: number; expired: number; total_credits: number }

/**
 * Sweep: expire the free pool for every org whose subscription is terminated and still holds free
 * credits. Daily-cron candidate (alongside markExpiredSubscriptions). Read-then-expire.
 */
export async function runSubscriptionCreditExpirySweep(deps: ExpiryDeps = defaultExpiryDeps()): Promise<ExpirySweepSummary> {
  // Candidate orgs: those with a billing_subscriptions row (the resolver decides terminal state).
  const subs = await deps.db.from('billing_subscriptions').select('organization_id');
  const orgIds: string[] = Array.from(new Set((subs?.data ?? []).map((r: any) => r.organization_id)));
  let expired = 0, total = 0;
  for (const orgId of orgIds) {
    const r = await expireSubscriptionCreditsForOrg(orgId, deps);
    if (r.expired > 0) { expired += 1; total += r.expired; }
  }
  return { processed: orgIds.length, expired, total_credits: total };
}
