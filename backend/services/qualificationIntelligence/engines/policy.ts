/**
 * Q-C304 — Policy Intelligence Engine (deterministic contributor). Analyzes the policy APPLICATION:
 * satisfied / unmet / unknown policy coverage, policy strictness summary, applicability. Qualification
 * DESCRIBES the policy evaluation — it NEVER modifies the (immutable) policy. Abstains without a policy.
 */

import type { QualificationEngineOutput, QualificationIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runPolicy(ctx: QualificationIntelligenceContext): QualificationEngineOutput {
  const base = baselineOf(ctx);
  const policy = ctx.raw?.policy;
  const evalv = base?.facets.evaluation?.value;
  if (!base || !policy || !policy.criteria.length || !evalv) return emptyOutput('policy');
  const src = ctx.raw?.source ?? 'qualification_eval', at = ctx.asOf;

  const total = policy.criteria.length;
  const satisfiedCoverage = clamp01((evalv.satisfied?.length ?? 0) / total);
  const unmetCoverage = clamp01((evalv.unsatisfied?.length ?? 0) / total);
  const unknownCoverage = clamp01((evalv.unknown?.length ?? 0) / total);
  const mandatoryCount = policy.criteria.filter((c) => c.kind === 'mandatory').length;
  const strictness = clamp01(mandatoryCount / total);                  // stricter = more mandatory criteria
  const applicability = clamp01(1 - unknownCoverage);                  // how much of the policy is evaluable

  const ev: EvidenceRef[] = [
    mkEvidence('policy', { label: 'coverage', value: `sat=${(satisfiedCoverage).toFixed(2)}/unmet=${unmetCoverage.toFixed(2)}/unk=${unknownCoverage.toFixed(2)}`, source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('policy', { label: 'version', value: `${policy.policyId}@v${policy.policyVersion}`, source: src, observedAt: at, kind: 'structured' }),
  ];
  const o: QualificationEngineOutput = { ...emptyOutput('policy'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'completeness', contributor: 'policy', method: 'deterministic', value: applicability, confidence: clamp01(0.4 + 0.1 * Math.min(total, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'policy_application', conclusion: Number(satisfiedCoverage.toFixed(4)), because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`policy=${policy.policyId}@v${policy.policyVersion}`, `strictness=${strictness}, applicability=${applicability} (policy immutable — described, not modified)`], unknowns: unknownCoverage > 0 ? [`unknown policy coverage=${unknownCoverage}`] : [] }));
  return o;
}
