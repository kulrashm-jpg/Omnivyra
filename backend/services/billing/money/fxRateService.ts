/**
 * FX Rate Service — Phase 3 E
 *
 * Reads currency_exchange_rates and produces a rational scalar suitable
 * for `Money.convert()`. NEVER returns a float.
 *
 * Provider abstraction: the DB row carries `provider`; callers can ignore
 * which provider was used (ECB / openexchangerates / static) but the
 * provider name is persisted on every transaction snapshot for audit.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import type { RoundingMode } from './Money';

export interface FxRate {
  source:       string;
  target:       string;
  /** Exact rate as a rational; consumers use this to feed Money.convert(). */
  rate:         { num: bigint; denom: bigint };
  /** Display-friendly decimal string for logs/audit. NEVER for arithmetic. */
  rateDisplay:  string;
  provider:     string;
  snapshotId:   string | null;
  effectiveAt:  string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { rate: FxRate; expiresAt: number }>();

function cacheKey(source: string, target: string, asOf: string | undefined): string {
  return `${source.toUpperCase()}::${target.toUpperCase()}::${asOf ?? 'now'}`;
}

export async function getFxRate(source: string, target: string, asOf?: string | Date): Promise<FxRate | null> {
  const src = source.toUpperCase();
  const tgt = target.toUpperCase();
  if (src === tgt) {
    return {
      source: src, target: tgt,
      rate: { num: 1n, denom: 1n }, rateDisplay: '1', provider: 'identity', snapshotId: null,
      effectiveAt: new Date().toISOString(),
    };
  }

  const asOfIso = asOf instanceof Date ? asOf.toISOString() : (asOf ?? new Date().toISOString());
  const key = cacheKey(src, tgt, asOf ? asOfIso : undefined);
  if (!asOf) {
    const c = cache.get(key);
    if (c && c.expiresAt > Date.now()) return c.rate;
  }

  const { data, error } = await supabase.rpc('lookup_fx_rate', {
    p_source: src,
    p_target: tgt,
    p_as_of:  asOfIso,
  });
  if (error) {
    logger.warn('fx_rate_lookup_failed', { src, tgt, message: error.message });
    return null;
  }
  if (!data) return null;

  const row = data as { id?: string; rate: number | string; provider: string; snapshot_id?: string | null; effective_at: string };
  const rateStr = String(row.rate);
  const rational = decimalStringToRational(rateStr);
  const rate: FxRate = {
    source: src, target: tgt,
    rate: rational, rateDisplay: rateStr,
    provider: row.provider, snapshotId: row.snapshot_id ?? null,
    effectiveAt: row.effective_at,
  };
  if (!asOf) {
    cache.set(key, { rate, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return rate;
}

/**
 * Insert a fresh rate. Caller (typically a daily cron) supplies provider
 * + snapshot. Rate values must come as decimal strings to preserve
 * precision; we never accept JS floats here.
 */
export async function recordFxRate(args: {
  source:       string;
  target:       string;
  rateDecimal:  string;
  provider:     string;
  snapshotId?:  string;
  effectiveAt?: string;
  metadata?:    Record<string, unknown>;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  // Validate rate string
  if (!/^\d+(\.\d+)?$/.test(args.rateDecimal.trim())) {
    return { ok: false, error: `invalid rateDecimal: ${args.rateDecimal}` };
  }

  const { data, error } = await supabase
    .from('currency_exchange_rates')
    .insert({
      source_currency: args.source.toUpperCase(),
      target_currency: args.target.toUpperCase(),
      rate:            args.rateDecimal,
      provider:        args.provider,
      snapshot_id:     args.snapshotId ?? null,
      effective_at:    args.effectiveAt ?? new Date().toISOString(),
      metadata:        args.metadata ?? {},
    })
    .select('id')
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id?: string } | null)?.id };
}

export function invalidateFxCache(): void {
  cache.clear();
}

function decimalStringToRational(value: string): { num: bigint; denom: bigint } {
  const s = String(value).trim();
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) {
    throw new Error(`FX rate is not a decimal string: ${value}`);
  }
  // Postgres numeric returns plain decimal — no scientific notation in
  // practice, but handle defensively.
  const negative = s.startsWith('-');
  const abs = negative ? s.slice(1) : s;
  const [mantissa, expPart] = abs.toLowerCase().split('e');
  const exp = expPart ? Number(expPart) : 0;
  const [whole, frac = ''] = mantissa.split('.');
  let num = BigInt(`${whole}${frac}`);
  let denomExp = frac.length - exp;
  let denom = 1n;
  if (denomExp > 0) {
    for (let i = 0; i < denomExp; i++) denom *= 10n;
  } else if (denomExp < 0) {
    for (let i = 0; i < -denomExp; i++) num *= 10n;
  }
  if (negative) num = -num;
  return { num, denom };
}
