/**
 * The credit_transactions execution_phase vocabulary that READERS depend on -
 * one definition, so no reader can drift from the writers again.
 *
 * MONEY (e9, 2026-11-12, BLOCKING): a token-priced settlement is written by
 * apply_credit_partial_confirm(_guarded) with execution_phase 'confirm_partial'.
 * Every reader that counted consumption with execution_phase = 'confirm' missed
 * those charges (usage, invoices, forecasts, exports, alerts, summaries).
 *
 *  - CONSUMPTION_PHASES: rows whose (negative) deltas are credits CONSUMED.
 *  - SETTLEMENT_PHASES:  rows that settle (close) a HOLD.
 *  - A guarded partial confirm also writes the unused hold as its own
 *    'release' row keyed `<confirm key>:remainder` (20270217000023). It is a
 *    release, never consumption, and it belongs to its partial confirm.
 */
export const CONSUMPTION_PHASES = ['confirm', 'confirm_partial'] as const;
export const SETTLEMENT_PHASES = ['confirm', 'release', 'confirm_partial'] as const;
export const REMAINDER_KEY_SUFFIX = ':remainder';

export type ConsumptionPhase = (typeof CONSUMPTION_PHASES)[number];

export function isConsumptionPhase(phase: string | null | undefined): phase is ConsumptionPhase {
  return phase === 'confirm' || phase === 'confirm_partial';
}

export function isRemainderKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.endsWith(REMAINDER_KEY_SUFFIX);
}
