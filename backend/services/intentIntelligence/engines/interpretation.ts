/**
 * I-C306 — Interpretation Intelligence Engine (deterministic synthesis contributor). Produces a richer
 * DESCRIPTIVE interpretation summary combining objective + competing objectives + confidence +
 * uncertainty + conflict + context — as one grounded reasoning trace. It synthesizes; it does not
 * predict, recommend, or resolve. Abstains when the baseline abstains.
 */

import type { IntentEngineOutput, IntentIntelligenceContext } from './engineTypes';
import { emptyOutput, baselineOf } from './engineTypes';
import { reasoningTrace, clamp01 } from '../../intelligence/canonical';

export function runInterpretation(ctx: IntentIntelligenceContext): IntentEngineOutput {
  const base = baselineOf(ctx);
  const primary = base?.facets.primaryIntent?.value?.objective;
  const conf = base?.facets.confidence?.value;
  const candidates = base?.facets.competingIntents?.value?.candidates ?? [];
  const primaryEv = base?.facets.primaryIntent?.evidence ?? [];
  if (!base || !primary || !primaryEv.length) return emptyOutput('interpretation');

  const competing = candidates.filter((c) => c.objective !== primary).map((c) => c.objective);
  const upstream = [ctx.upstream?.visitorRef && 'visitor', ctx.upstream?.journeyRef && 'journey', ctx.upstream?.leadRef && 'lead', ctx.upstream?.companyRef && 'company', ctx.upstream?.offeringRef && 'offering'].filter(Boolean);

  const o: IntentEngineOutput = { ...emptyOutput('interpretation'), abstained: false, evidence: [] };
  o.reasoning.push(reasoningTrace({
    claim: 'interpretation_summary',
    conclusion: primary,
    because: primaryEv,
    confidence: clamp01(conf?.confidence ?? 0),
    method: 'deterministic',
    assumptions: [
      `primary=${primary}`,
      competing.length ? `competing=[${competing.join(', ')}]` : 'no competing objectives',
      `uncertainty=${conf?.uncertainty ?? 1}`,
      upstream.length ? `context=[${upstream.join(', ')}]` : 'no upstream context referenced',
      'descriptive interpretation of observed evidence — no prediction/recommendation',
    ],
    unknowns: [],
  }));
  return o;
}
