/**
 * Q-C301 — Criteria Intelligence Engine (deterministic contributor). Analyzes the Phase-B evaluation
 * against the (immutable) policy criteria: mandatory/required status, optional contribution, criteria
 * completeness, unmet critical criteria. Policy-backed; reuses the baseline (no re-derivation). Abstains
 * without criteria.
 */

import type { QualificationEngineOutput, QualificationIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runCriteria(ctx: QualificationIntelligenceContext): QualificationEngineOutput {
  const base = baselineOf(ctx);
  const criteria = ctx.raw?.policy.criteria ?? [];
  const evalv = base?.facets.evaluation?.value;
  if (!base || !criteria.length || !evalv) return emptyOutput('criteria');
  const src = ctx.raw?.source ?? 'qualification_eval', at = ctx.asOf;

  const satisfied = new Set(evalv.satisfied ?? []);
  const unsatisfied = new Set(evalv.unsatisfied ?? []);
  const reqMand = criteria.filter((c) => c.kind === 'mandatory' || c.kind === 'required');
  const optional = criteria.filter((c) => c.kind === 'optional');
  const unmetCritical = reqMand.filter((c) => unsatisfied.has(c.id)).map((c) => c.id);
  const fit = reqMand.length ? clamp01(reqMand.filter((c) => satisfied.has(c.id)).length / reqMand.length) : 0.5;
  const optionalContribution = optional.length ? clamp01(optional.filter((c) => satisfied.has(c.id)).length / optional.length) : 0;
  const completeness = clamp01(evalv.completeness ?? 0);

  const ev: EvidenceRef[] = [
    mkEvidence('criteria', { label: 'fit', value: Number(fit.toFixed(4)), source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('criteria', { label: 'unmet_critical', value: unmetCritical.join(',') || 'none', source: src, observedAt: at, kind: 'inferred' }),
  ];
  const o: QualificationEngineOutput = { ...emptyOutput('criteria'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'fit', contributor: 'criteria', method: 'deterministic', value: fit, confidence: clamp01(0.45 + 0.1 * Math.min(reqMand.length, 4)), evidence: ev, asOf: at });
  o.contributions.push({ dimension: 'completeness', contributor: 'criteria', method: 'deterministic', value: completeness, confidence: clamp01(0.4 + 0.1 * Math.min(criteria.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'criteria_status', conclusion: Number(fit.toFixed(4)), because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`req+mand satisfied ratio=${fit}, optional=${optionalContribution}, completeness=${completeness}`], unknowns: unmetCritical.length ? [`unmet critical: ${unmetCritical.join(', ')}`] : [] }));
  return o;
}
