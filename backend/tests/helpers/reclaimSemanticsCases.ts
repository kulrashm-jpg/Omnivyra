/**
 * ONE table of released-attempt reclaim semantics (05 2026-11-13: equivalence between two implementations must be
 * STRUCTURAL - a shared fixture executed against both - not a reviewer's reading). Each case lists the ledger state
 * of attempt slots 0..n for one request identity and the expected outcome.
 *   'settled'  = money moved for that slot (charged) -> must NEVER be re-run or charged again
 *   'released' = that slot failed and was NOT charged -> reusable; move to the next slot
 *   undefined  = the slot was never used
 * Executed by phase2RouteWiring.entryConsumption.test.ts (wirePhase2Route's loop) and to be executed by the
 * resolveHttpAttemptRoot suite (billingIdempotencyService) - both must agree on every row.
 */
export type SlotState = 'settled' | 'released' | undefined;
export interface ReclaimCase {
  name: string;
  slots: SlotState[];
  /** 'run:<n>' = run and charge in slot n; 'processed' = already charged, do not run; 'exhausted' = every slot released */
  expect: `run:${number}` | 'processed' | 'exhausted';
}
export const RECLAIM_CASES: ReclaimCase[] = [
  { name: 'fresh identity runs in slot 0', slots: [], expect: 'run:0' },
  { name: 'slot 0 charged -> already processed, never re-run', slots: ['settled'], expect: 'processed' },
  { name: 'slot 0 released -> runs in slot 1', slots: ['released'], expect: 'run:1' },
  { name: 'released, released -> runs in slot 2', slots: ['released', 'released'], expect: 'run:2' },
  { name: 'released then charged -> already processed (the retry was charged once)', slots: ['released', 'settled'], expect: 'processed' },
];
export const RECLAIM_CAP = 20;
export const EXHAUSTED_CASE: ReclaimCase = {
  name: `all ${RECLAIM_CAP} slots released -> exhausted`,
  slots: Array.from({ length: RECLAIM_CAP }, () => 'released' as const),
  expect: 'exhausted',
};
