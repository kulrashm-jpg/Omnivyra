/**
 * Subscription Projection Service — Phase E (scaffolding)
 *
 * Reads `billing_subscriptions` and projects the next renewal action.
 * Today's role: produce a forecast for the dashboard. Once Stripe is
 * integrated (Sprint 5+), the renewal cron will use this projection to
 * decide which subscriptions to renew and call createCredit() through
 * the orchestrator.
 *
 * This file is read-only — the renewal write path lives in a future
 * `subscriptionRenewalJob.ts` that we ship in Phase 6 of the audit roadmap.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export interface SubscriptionProjection {
  id:                 string;
  organizationId:     string;
  planId:             string | null;
  status:             string;
  currentPeriodStart: string;
  currentPeriodEnd:   string;
  trialEndsAt:        string | null;
  autoRenew:          boolean;
  cancelAtPeriodEnd:  boolean;
  daysUntilRenewal:   number;
  willAutoRenew:      boolean;
}

export async function projectOrgSubscriptions(orgId: string): Promise<SubscriptionProjection[]> {
  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('organization_id', orgId)
    .order('current_period_end', { ascending: true });

  if (error) {
    logger.warn('subscription_projection_failed', { orgId, message: error.message });
    return [];
  }

  const now = Date.now();
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => {
    const periodEnd = String(row.current_period_end);
    const periodEndMs = Date.parse(periodEnd);
    const days = Number.isFinite(periodEndMs)
      ? Math.max(0, Math.floor((periodEndMs - now) / (1000 * 60 * 60 * 24)))
      : 0;
    const autoRenew = Boolean(row.auto_renew);
    const cancelAtPeriodEnd = Boolean(row.cancel_at_period_end);
    return {
      id:                 String(row.id),
      organizationId:     String(row.organization_id),
      planId:             row.plan_id ? String(row.plan_id) : null,
      status:             String(row.status),
      currentPeriodStart: String(row.current_period_start),
      currentPeriodEnd:   periodEnd,
      trialEndsAt:        row.trial_ends_at ? String(row.trial_ends_at) : null,
      autoRenew,
      cancelAtPeriodEnd,
      daysUntilRenewal:   days,
      willAutoRenew:      autoRenew && !cancelAtPeriodEnd && row.status === 'active',
    };
  });
}

export async function listRenewalsDue(within: { days: number }): Promise<SubscriptionProjection[]> {
  const cutoff = new Date(Date.now() + within.days * 86400_000).toISOString();
  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .lte('current_period_end', cutoff)
    .in('status', ['active', 'past_due'])
    .eq('auto_renew', true)
    .eq('cancel_at_period_end', false)
    .order('current_period_end', { ascending: true })
    .limit(1000);

  if (error) {
    logger.error('renewals_due_query_failed', { message: error.message });
    return [];
  }
  const now = Date.now();
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    id:                 String(row.id),
    organizationId:     String(row.organization_id),
    planId:             row.plan_id ? String(row.plan_id) : null,
    status:             String(row.status),
    currentPeriodStart: String(row.current_period_start),
    currentPeriodEnd:   String(row.current_period_end),
    trialEndsAt:        row.trial_ends_at ? String(row.trial_ends_at) : null,
    autoRenew:          Boolean(row.auto_renew),
    cancelAtPeriodEnd:  Boolean(row.cancel_at_period_end),
    daysUntilRenewal:   Math.max(0, Math.floor((Date.parse(String(row.current_period_end)) - now) / 86400_000)),
    willAutoRenew:      true,
  }));
}
