/**
 * Currency Normalization Service — Phase C (future multi-currency hooks)
 *
 * The audit's [payment-readiness §7] flags multi-currency as PARTIAL: stored
 * but not converted. This service is the seam for the future FX engine:
 *
 *   - Normalize an arbitrary (amount, currency) pair to USD for ledger storage.
 *   - Persist the FX rate used so the operation is auditable.
 *
 * Today it returns identity for USD and is a no-op for other currencies that
 * arrive at this layer (callers must convert at the gateway boundary). When
 * the FX engine ships (currency_exchange_rates table + daily cron, see audit
 * §7.3), this service will gain a working `normalizeToUsd()` implementation
 * without any callsite changes.
 */

export interface MoneyAmount {
  amount:   number;     // can be fractional; ledger snaps to credits at conversion
  currency: string;     // ISO 4217
}

export interface FxSnapshot {
  baseCurrency:  string;
  quoteCurrency: string;
  rate:          number;
  source:        string;
  snapshotAt:    string;
}

/** Returns the same value for USD; throws for non-USD until FX engine ships. */
export function normalizeToUsd(money: MoneyAmount): { usd: number; fx: FxSnapshot | null } {
  const c = money.currency.toUpperCase();
  if (c === 'USD') {
    return { usd: money.amount, fx: null };
  }
  // Future: lookup currency_exchange_rates(base='USD', quote=c).
  // Today: refuse to silently fabricate a rate.
  throw new Error(`[currencyNormalization] FX engine not yet implemented for ${c}. ` +
    `Convert upstream or USD-quote at the gateway.`);
}

/**
 * Build an FX snapshot row payload for a future ledger column. Returns null
 * for USD (no FX); returns an unsigned snapshot for non-USD.
 *
 * Stable signature so callers don't need to migrate when the FX engine lands.
 */
export function captureFxSnapshot(money: MoneyAmount): FxSnapshot | null {
  if (money.currency.toUpperCase() === 'USD') return null;
  throw new Error(`[currencyNormalization] captureFxSnapshot pending FX engine for ${money.currency}`);
}
