// Frame sufficiency (CPG_U1_PROTOCOL_004 §5.7.2). One complete frame must exist before the development commitment,
// large enough for the MAXIMUM held-out requirement over every permitted pilot outcome. The maximum is not typed in:
// it is derived by evaluating the frozen sizing rule (lib/sizing.mjs) on every permitted pilot result, so the
// minimum can never drift from the rule it protects.
import { DEVELOPMENT_QUOTA, OUTCOME_CLASSES, POOL_MULTIPLIER } from './schema.mjs';
import { heldOutQuotas } from './sizing.mjs';
import { assertUnique } from './select.mjs';

/** Every permitted pilot: 6 development fill-expected companies × fills ∈ {0,1,2,3} → 4^6 = 4096 outcomes. */
export function enumeratePilotOutcomes() {
  const ids = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
  const idSet = new Set(ids);
  const max = Object.fromEntries(OUTCOME_CLASSES.map((c) => [c, 0]));
  let outcomes = 0; let halts = 0; let refused = 0;
  for (let n = 0; n < 4 ** ids.length; n++) {
    outcomes++;
    const results = ids.map((id, i) => ({ candidate_id: id, fills: Math.floor(n / 4 ** i) % 4 }));
    const r = heldOutQuotas({ results }, idSet);
    if (!r.ok) { if (r.halt) halts++; else refused++; continue; }
    for (const c of OUTCOME_CLASSES) max[c] = Math.max(max[c], r.quotas[c]);
  }
  return { outcomes, halts, refused, maxQuotas: max };
}

const PILOT = enumeratePilotOutcomes();
/** Maximum held-out quota per class over all permitted pilot outcomes. */
export const MAX_HELD_OUT_QUOTAS = Object.freeze({ ...PILOT.maxQuotas });

/**
 * E_c ≥ POOL_MULTIPLIER × Qmax_c + DEV_c. The development draw removes at most DEV_c rows of class c (exact quota), so
 * the held-out pool (eligible, admissible, not development) is then ≥ POOL_MULTIPLIER × Qmax_c ≥ POOL_MULTIPLIER × quota_c.
 */
export const FRAME_MINIMUM = Object.freeze(Object.fromEntries(
  OUTCOME_CLASSES.map((c) => [c, POOL_MULTIPLIER * MAX_HELD_OUT_QUOTAS[c] + DEVELOPMENT_QUOTA[c]]),
));

/**
 * @param admissible rows with no exclusion (after checkFrameRow)
 * @param ineligible Set of held-out-ineligible candidate_ids (scan + registry + attestations)
 */
export function frameSufficiency(admissible, ineligible) {
  assertUnique(admissible);
  const counts = {}; const shortfall = [];
  for (const c of OUTCOME_CLASSES) {
    const have = admissible.filter((r) => r.expected_outcome_class === c && !ineligible.has(r.candidate_id)).length;
    counts[c] = have;
    if (have < FRAME_MINIMUM[c]) shortfall.push({ class: c, eligible_admissible: have, required: FRAME_MINIMUM[c] });
  }
  return { ok: shortfall.length === 0, counts, required: { ...FRAME_MINIMUM }, shortfall };
}
