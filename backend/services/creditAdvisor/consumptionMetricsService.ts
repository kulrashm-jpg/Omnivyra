/**
 * Credit Advisor — Phase 2: Consumption Analytics.
 *
 * Computes daily / weekly / monthly consumption + burn rates for an org by
 * aggregating the existing `credit_usage_log` daily-grain table (the same
 * source `/api/credits/usage` reads) and the `organization_credits` wallet.
 *
 * READ-ONLY: only SELECTs. No writes anywhere in this file.
 */

import { supabase } from '@/backend/db/supabaseClient';
import { computeAvailable } from '@/backend/services/creditPriorityService';
import type { ConsumptionMetrics, TrendDirection, WalletOverview } from './creditAdvisorTypes';

const DAY_MS = 86_400_000;

export interface ConsumptionRow {
  action: string;
  user_id: string | null;
  credits: number;
  created_at: string;
}

/**
 * Load raw per-event consumption rows for the window [now-days, now].
 * Shared by metrics + attribution so the table is read once per request.
 */
export async function loadConsumptionRows(
  orgId: string,
  days: number,
): Promise<ConsumptionRow[]> {
  const from = new Date(Date.now() - days * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('credit_usage_log')
    .select('action, user_id, credits_used, created_at')
    .eq('organization_id', orgId)
    .gte('created_at', from)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    action: r.action ?? 'unknown',
    user_id: r.user_id ?? null,
    credits: Number(r.credits_used ?? 0),
    created_at: r.created_at as string,
  }));
}

/**
 * Read the wallet overview (allocated / consumed / remaining) WITHOUT writing.
 * Uses a single SELECT against organization_credits (no self-heal path).
 */
export async function getWalletOverview(orgId: string): Promise<WalletOverview> {
  const { data, error } = await supabase
    .from('organization_credits')
    .select(
      'free_balance, paid_balance, incentive_balance, reserved_free, reserved_paid, reserved_incentive, lifetime_purchased, lifetime_consumed, credit_rate_usd',
    )
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      remaining: 0,
      allocated: 0,
      consumed_lifetime: 0,
      free: 0,
      paid: 0,
      incentive: 0,
      reserved: 0,
      credit_rate_usd: 0,
      missing: true,
    };
  }

  const d = data as any;
  const wallet = {
    free_balance: Number(d.free_balance ?? 0),
    paid_balance: Number(d.paid_balance ?? 0),
    incentive_balance: Number(d.incentive_balance ?? 0),
    reserved_free: Number(d.reserved_free ?? 0),
    reserved_paid: Number(d.reserved_paid ?? 0),
    reserved_incentive: Number(d.reserved_incentive ?? 0),
  };
  const available = computeAvailable(wallet);

  return {
    remaining: available.total,
    allocated: Number(d.lifetime_purchased ?? 0),
    consumed_lifetime: Number(d.lifetime_consumed ?? 0),
    free: wallet.free_balance,
    paid: wallet.paid_balance,
    incentive: wallet.incentive_balance,
    reserved: wallet.reserved_free + wallet.reserved_paid + wallet.reserved_incentive,
    credit_rate_usd: Number(d.credit_rate_usd ?? 0),
    missing: false,
  };
}

function sumInWindow(rows: ConsumptionRow[], sinceMs: number): number {
  let total = 0;
  for (const r of rows) {
    if (new Date(r.created_at).getTime() >= sinceMs) total += r.credits;
  }
  return total;
}

function trendOf(recent: number, baseline: number): TrendDirection {
  if (baseline <= 0) return recent > 0 ? 'up' : 'flat';
  const delta = (recent - baseline) / baseline;
  if (delta > 0.1) return 'up';
  if (delta < -0.1) return 'down';
  return 'flat';
}

/**
 * Compute the full consumption-metrics object for an org.
 * `rows` may be passed in to avoid re-querying (attribution reuse).
 */
export async function computeConsumptionMetrics(
  orgId: string,
  days = 30,
  prefetched?: { rows?: ConsumptionRow[]; overview?: WalletOverview },
): Promise<ConsumptionMetrics> {
  const rows = prefetched?.rows ?? (await loadConsumptionRows(orgId, days));
  const overview = prefetched?.overview ?? (await getWalletOverview(orgId));

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const credits_used_today = sumInWindow(rows, startOfToday.getTime());
  const credits_used_3d = sumInWindow(rows, now - 3 * DAY_MS);
  const credits_used_7d = sumInWindow(rows, now - 7 * DAY_MS);
  const credits_used_30d = sumInWindow(rows, now - 30 * DAY_MS);

  const daily_burn_rate = credits_used_30d / 30;
  const recent_daily_burn_rate = credits_used_7d / 7;

  // Daily series (oldest → newest), zero-filled.
  const dailyMap: Record<string, number> = {};
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    dailyMap[day] = (dailyMap[day] ?? 0) + r.credits;
  }
  const start = new Date(now - days * DAY_MS);
  const daily: Array<{ date: string; credits: number }> = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    daily.push({ date, credits: dailyMap[date] ?? 0 });
  }

  return {
    credits_used_today,
    credits_used_3d,
    credits_used_7d,
    credits_used_30d,
    credits_remaining: overview.remaining,
    daily_burn_rate,
    weekly_burn_rate: daily_burn_rate * 7,
    monthly_burn_rate: daily_burn_rate * 30,
    recent_daily_burn_rate,
    burn_trend: trendOf(recent_daily_burn_rate, daily_burn_rate),
    daily,
    window_days: days,
    events: rows.length,
  };
}
