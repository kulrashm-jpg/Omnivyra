/**
 * THE credit_transactions.execution_phase vocabulary - one dependency-free module for server AND client code (e9/05
 * ruling 2026-11-13: no local copies; creditPhaseVocabularyNoLocalCopies.test.ts fails on any 'confirm_partial' literal
 * outside this file).
 *
 * Verified against the LIVE prod function bodies (virality-83's C100 extraction, 2026-11-13):
 *   - apply_credit_reservation (20260322 body, md5 ad5383bf) writes hold / confirm / release / grant / expire /
 *     expire_incentive;
 *   - apply_credit_partial_confirm (hand-applied, md5 ff208f60) writes ONE 'confirm_partial' row per token-priced
 *     settle and returns the unused remainder to the wallet inside the same UPDATE (no release row).
 * So credits USED = 'confirm' (fixed-cost) + 'confirm_partial' (token-priced). A reader filtering on 'confirm' alone
 * misses every token-priced charge.
 */

/** Phases that CHARGE a hold: credits used. */
export const CONFIRM_PHASES: readonly string[] = Object.freeze(['confirm', 'confirm_partial']);

/** Phases that settle (terminate) a hold. */
export const SETTLE_PHASES: readonly string[] = Object.freeze([...CONFIRM_PHASES, 'release']);

/** Phases prod writes that never settle a hold. */
export const NON_SETTLE_PHASES: readonly string[] = Object.freeze(['hold', 'grant', 'expire', 'expire_incentive']);

export function isConfirmPhase(phase: string | null | undefined): boolean {
  return !!phase && CONFIRM_PHASES.includes(phase);
}

/**
 * Customer-facing label for a ledger row's phase. Internal phase names (e.g. 'confirm_partial') are never shown to
 * customers; an unknown phase renders as 'Other', never as the raw string.
 */
export function customerLedgerPhaseLabel(phase: string | null | undefined): string {
  if (isConfirmPhase(phase)) return 'Used';
  switch (phase) {
    case 'hold': return 'Reserved';
    case 'release': return 'Released';
    case 'grant': return 'Added';
    case 'expire':
    case 'expire_incentive': return 'Expired';
    default: return 'Other';
  }
}
