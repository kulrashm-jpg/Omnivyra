// Held-out sizing rule (candidate-002 §5.6). Deterministic function of the
// development pilot; frozen before the pilot runs, applied before held-out is drawn.
import { DEVELOPMENT_QUOTA, HELD_OUT_BASE } from './schema.mjs';

/**
 * [NORMATIVE]
 *  MIN_FILLS — EFR assessability floor. θ_EFR = 0.05, so with fewer than 20 fills a single
 *              erroneous fill already exceeds the threshold: EFR cannot be evaluated at its
 *              own resolution. Arithmetically derived from θ_EFR (1 / 0.05).
 *  SAFETY    — the pilot runs on development companies, which are disproportionately
 *              well-known (contaminated) firms and are expected to yield MORE fills than
 *              held-out firms; 1.5 inflates the target to offset that optimistic bias.
 *  CAP       — feasibility ceiling on held-out fill-expected companies (reference-truth
 *              workload). REQUIRES HUMAN APPROVAL as a resourcing commitment.
 */
export const SIZING = Object.freeze({ MIN_FILLS: 20, SAFETY: 1.5, CAP_FILL_EXPECTED: 60 });

/**
 * @param pilot { results: [{ candidate_id, fills }] } — one entry per development fill-expected company.
 * @param devFillExpectedIds  Set of development fill-expected candidate_ids (from the development manifest).
 * @returns {{ ok:true, quotas, yield_per_company, raw_fill_expected, capped } | { ok:false, error }}
 */
export function heldOutQuotas(pilot, devFillExpectedIds) {
  if (!pilot || !Array.isArray(pilot.results)) return { ok: false, error: 'pilot.results must be an array' };
  const seen = new Set();
  for (const r of pilot.results) {
    if (!devFillExpectedIds.has(r.candidate_id)) return { ok: false, error: `pilot result for ${r.candidate_id} is not a development fill-expected company` };
    if (seen.has(r.candidate_id)) return { ok: false, error: `duplicate pilot result for ${r.candidate_id}` };
    if (!Number.isInteger(r.fills) || r.fills < 0 || r.fills > 3) return { ok: false, error: `fills for ${r.candidate_id} must be an integer 0-3` };
    seen.add(r.candidate_id);
  }
  if (seen.size !== DEVELOPMENT_QUOTA['fill-expected'] || seen.size !== devFillExpectedIds.size) {
    return { ok: false, error: `pilot must cover exactly the ${DEVELOPMENT_QUOTA['fill-expected']} development fill-expected companies` };
  }
  const total = pilot.results.reduce((s, r) => s + r.fills, 0);
  if (total === 0) {
    return { ok: false, halt: true, error: 'HALT: CPG produced zero fills across every development fill-expected company — EFR could never be assessed; held-out must not be drawn' };
  }
  const yieldPerCompany = total / seen.size;
  const raw = Math.ceil((SIZING.MIN_FILLS * SIZING.SAFETY) / yieldPerCompany);
  const fill = Math.min(SIZING.CAP_FILL_EXPECTED, Math.max(HELD_OUT_BASE['fill-expected'], raw));
  const quotas = {
    'fill-expected': fill,
    'abstention-expected': Math.max(HELD_OUT_BASE['abstention-expected'], Math.ceil((fill * HELD_OUT_BASE['abstention-expected']) / HELD_OUT_BASE['fill-expected'])),
    'identity-hazard': Math.max(HELD_OUT_BASE['identity-hazard'], Math.ceil((fill * HELD_OUT_BASE['identity-hazard']) / HELD_OUT_BASE['fill-expected'])),
  };
  return { ok: true, quotas, pilot_total_fills: total, yield_per_company: yieldPerCompany, raw_fill_expected: raw, capped: raw > SIZING.CAP_FILL_EXPECTED };
}
