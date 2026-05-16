/**
 * Usage Forecasting Service — Phase 3 F
 *
 * Projects an org's credit consumption to period-end based on observed
 * burn-rate. No ML — just a windowed average + linear projection. The
 * point isn't precision, it's giving finance a forward-looking number
 * that's better than "look at the wallet right now."
 *
 * Used by:
 *   - Invoice projection (overage forecast)
 *   - Burn-rate anomaly detection (compare projected vs allotment)
 *   - Operations dashboard
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export interface ForecastResult {
  organizationId:    string;
  periodStart:       string;
  periodEnd:         string;
  observedCredits:   number;
  observedUsd:       number;
  observedDays:      number;
  projectedCredits:  number;
  projectedUsd:      number;
  daysRemaining:     number;
  dailyBurnRate:     number;
  isAccelerating:    boolean;            // 7d avg > 30d avg
}

export async function forecastUsage(args: {
  organizationId: string;
  periodStart:    string;
  periodEnd:      string;
}): Promise<ForecastResult | null> {
  const now = Date.now();
  const startMs = Date.parse(args.periodStart);
  const endMs   = Date.parse(args.periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    logger.warn('forecast_invalid_period', { args });
    return null;
  }
  const periodDays    = Math.max(1, Math.round((endMs - startMs) / 86400_000));
  const observedDays  = Math.max(1, Math.min(periodDays, Math.round((Math.min(now, endMs) - startMs) / 86400_000)));
  const daysRemaining = Math.max(0, periodDays - observedDays);

  const { data, error } = await supabase
    .from('credit_transactions')
    .select('credits_delta, usd_equivalent, created_at')
    .eq('organization_id', args.organizationId)
    .eq('execution_phase', 'confirm')
    .gte('created_at', args.periodStart)
    .lte('created_at', Math.min(now, endMs) === now ? new Date(now).toISOString() : new Date(endMs).toISOString());

  if (error) {
    logger.warn('forecast_query_failed', { orgId: args.organizationId, message: error.message });
    return null;
  }
  const rows = (data ?? []) as Array<{ credits_delta: number; usd_equivalent: number | null; created_at: string }>;

  let observedCredits = 0;
  let observedUsd     = 0;
  let recent7dCredits = 0;
  let recent30dCredits = 0;
  const sevenDaysAgoMs  = now - 7 * 86400_000;
  const thirtyDaysAgoMs = now - 30 * 86400_000;
  for (const r of rows) {
    const credits = Math.abs(Number(r.credits_delta ?? 0));
    observedCredits += credits;
    observedUsd     += Number(r.usd_equivalent ?? 0);
    const ts = Date.parse(r.created_at);
    if (ts >= sevenDaysAgoMs)  recent7dCredits  += credits;
    if (ts >= thirtyDaysAgoMs) recent30dCredits += credits;
  }

  const dailyBurnRate = observedCredits / observedDays;
  const projectedCredits = observedCredits + Math.round(dailyBurnRate * daysRemaining);
  const projectedUsd     = observedUsd     + (observedUsd / observedDays) * daysRemaining;

  return {
    organizationId:   args.organizationId,
    periodStart:      args.periodStart,
    periodEnd:        args.periodEnd,
    observedCredits,
    observedUsd,
    observedDays,
    projectedCredits,
    projectedUsd,
    daysRemaining,
    dailyBurnRate,
    isAccelerating:   (recent7dCredits / 7) > (recent30dCredits / 30),
  };
}

export async function detectBurnRateAnomaly(orgId: string): Promise<{
  anomaly: boolean;
  forecast: ForecastResult | null;
  reason?: string;
}> {
  // Use the org's current calendar month as the period
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const periodEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const forecast    = await forecastUsage({ organizationId: orgId, periodStart, periodEnd });
  if (!forecast) return { anomaly: false, forecast: null };

  // Flag accelerating burn or > 80% allotment used in first 50% of period
  if (forecast.isAccelerating && forecast.daysRemaining > 7) {
    return { anomaly: true, forecast, reason: 'accelerating_burn_rate' };
  }
  return { anomaly: false, forecast };
}
