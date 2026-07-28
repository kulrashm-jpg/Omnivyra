/**
 * Q-C306 — Evaluation Intelligence Engine (deterministic synthesis contributor). Produces a richer
 * DESCRIPTIVE evaluation summary combining qualification state + criteria analysis + policy analysis +
 * confidence + uncertainty + evidence + context — as one grounded reasoning trace. It synthesizes; it
 * does not predict, recommend, progress workflows, or decide. Abstains when the baseline abstains.
 */

import type { QualificationEngineOutput, QualificationIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { reasoningTrace, clamp01 } from '../../intelligence/canonical';

export function runEvaluation(ctx: QualificationIntelligenceContext): QualificationEngineOutput {
  const base = baselineOf(ctx);
  const status = base?.facets.state?.value?.status;
  const conf = base?.facets.confidence?.value;
  const evalv = base?.facets.evaluation?.value;
  const policy = ctx.raw?.policy;
  const stateEv = base?.facets.state?.evidence ?? [];
  if (!base || !status || !stateEv.length) return emptyOutput('evaluation');

  const upstream = [ctx.upstream?.visitorRef && 'visitor', ctx.upstream?.journeyRef && 'journey', ctx.upstream?.intentRef && 'intent', ctx.upstream?.leadRef && 'lead', ctx.upstream?.companyRef && 'company', ctx.upstream?.offeringRef && 'offering'].filter(Boolean);

  const o: QualificationEngineOutput = { ...emptyOutput('evaluation'), abstained: false, evidence: [] };
  o.reasoning.push(reasoningTrace({
    claim: 'evaluation_summary',
    conclusion: status,
    because: stateEv,
    confidence: clamp01(conf?.confidence ?? 0),
    method: 'deterministic',
    assumptions: [
      `state=${status}`,
      policy ? `policy=${policy.policyId}@v${policy.policyVersion}` : 'no policy',
      `satisfied=${evalv?.satisfied?.length ?? 0}, unsatisfied=${evalv?.unsatisfied?.length ?? 0}, unknown=${evalv?.unknown?.length ?? 0}`,
      `uncertainty=${conf?.uncertainty ?? 1}`,
      upstream.length ? `context=[${upstream.join(', ')}]` : 'no upstream context referenced',
      'descriptive policy evaluation of current evidence — no prediction/recommendation/workflow',
    ],
    unknowns: [],
  }));
  return o;
}
