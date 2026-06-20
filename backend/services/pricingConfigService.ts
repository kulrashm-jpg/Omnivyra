/**
 * Pricing configuration — DB-backed FX rates, market overrides, and plan pricing
 * (Super-Admin managed). Reads from billing_fx_rates / billing_price_overrides /
 * billing_plan_pricing and assembles an `FxConfig` for the currency resolver.
 *
 * Fallback: if the tables/rows are absent (pre-migration), returns the code
 * defaults (DEFAULT_FX / commercialPlans) so nothing breaks. No hardcoded rates
 * once the tables are seeded.
 *
 * Charge currency is INR only (Razorpay). USD/EUR are display-only.
 */
import { supabase } from '../db/supabaseClient';
import { DEFAULT_FX, type FxConfig, type Currency } from '@/lib/billing/currency';

/** Assemble the live FxConfig (rates + market overrides). Falls back to defaults. */
export async function getFxConfig(): Promise<FxConfig> {
  try {
    const [{ data: rateRows }, { data: overrideRows }] = await Promise.all([
      supabase.from('billing_fx_rates').select('currency, rate, updated_at'),
      supabase.from('billing_price_overrides').select('sku, currency, amount'),
    ]);

    if (!rateRows || rateRows.length === 0) return DEFAULT_FX;

    const rates: Record<Currency, number> = { ...DEFAULT_FX.rates };
    let updatedAt: string | undefined;
    for (const r of rateRows as Array<{ currency: string; rate: number; updated_at?: string }>) {
      rates[r.currency as Currency] = Number(r.rate);
      if (r.updated_at && (!updatedAt || r.updated_at > updatedAt)) updatedAt = r.updated_at;
    }

    const overrides: NonNullable<FxConfig['overrides']> = {};
    for (const o of (overrideRows ?? []) as Array<{ sku: string; currency: string; amount: number }>) {
      (overrides[o.sku] ??= {})[o.currency as Currency] = Number(o.amount);
    }

    return { rates, overrides, updatedAt };
  } catch {
    return DEFAULT_FX; // tables absent (pre-migration) → safe default
  }
}

export interface PlanPricing {
  plan_key: string;
  founder_usd: number;
  regular_usd: number | null;
  active: boolean;
}

export async function getPlanPricing(): Promise<PlanPricing[]> {
  try {
    const { data } = await supabase
      .from('billing_plan_pricing')
      .select('plan_key, founder_usd, regular_usd, active');
    return (data ?? []) as PlanPricing[];
  } catch {
    return [];
  }
}

// ── Super-Admin setters ──────────────────────────────────────────────────────

export async function setFxRate(currency: Currency, rate: number, updatedBy?: string) {
  return supabase.from('billing_fx_rates').upsert({
    currency, rate, updated_by: updatedBy ?? null, updated_at: new Date().toISOString(),
  });
}

export async function setPriceOverride(sku: string, currency: Currency, amount: number | null, updatedBy?: string) {
  if (amount == null) {
    return supabase.from('billing_price_overrides').delete().eq('sku', sku).eq('currency', currency);
  }
  return supabase.from('billing_price_overrides').upsert({
    sku, currency, amount, updated_by: updatedBy ?? null, updated_at: new Date().toISOString(),
  });
}

export async function setPlanPricing(
  planKey: string,
  founderUsd: number,
  regularUsd: number | null,
  active = true,
  updatedBy?: string,
) {
  return supabase.from('billing_plan_pricing').upsert({
    plan_key: planKey, founder_usd: founderUsd, regular_usd: regularUsd, active,
    updated_by: updatedBy ?? null, updated_at: new Date().toISOString(),
  });
}
