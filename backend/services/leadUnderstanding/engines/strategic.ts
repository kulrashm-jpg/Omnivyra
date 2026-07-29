/**
 * LI-D305 — Strategic Lead Intelligence (deterministic synthesis contributor).
 * Generates analyst-grade strategic insight (executive priorities, likely initiatives, transformation
 * programs, competitive pressure, modernization) from strategic inputs + buying signals — every
 * conclusion is evidence-backed. Emits buying facet enrichment + strategic reasoning traces. Abstains
 * when neither strategic inputs nor signals are present.
 */

import type { EngineOutput, LeadIntelligenceContext } from './engineTypes';
import { emptyOutput, mkEvidence, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, BuyingValue, ReasoningTrace } from '../types';

const ENGINE = 'strategic';

export function runStrategic(ctx: LeadIntelligenceContext): EngineOutput {
  const s = ctx.strategicInputs;
  const signals = ctx.signals ?? [];
  if (!s && !signals.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;

  const src = s?.source ?? 'strategic_analysis';
  const at = s?.observedAt ?? ctx.asOf;
  const evidence: EvidenceRef[] = [];
  const push = (label: string, arr?: string[]) => { if (arr?.length) evidence.push(mkEvidence(ENGINE, { label, value: arr.join('; '), source: src, observedAt: at, kind: 'inferred' })); };
  push('strategic:initiatives', s?.initiatives);
  push('strategic:transformation', s?.transformation);
  push('strategic:growth', s?.growthStrategy);
  push('strategic:market_expansion', s?.marketExpansion);
  // Signals corroborate strategy (e.g. hiring/funding ⇒ growth; tech_migration ⇒ modernization).
  const sigEv = signals.filter((x) => ['funding', 'hiring', 'expansion', 'tech_migration', 'acquisition', 'exec_change'].includes(x.type))
    .map((x) => mkEvidence(ENGINE, { label: `strategic_signal:${x.type}`, value: x.detail ?? x.type, source: x.source, observedAt: x.observedAt, kind: 'external' }));
  evidence.push(...sigEv);
  if (!evidence.length) return emptyOutput(ENGINE);
  out.evidence = evidence;
  out.abstained = false;

  const initiatives = [...(s?.initiatives ?? []), ...(s?.transformation ?? [])];
  const buyingVal: BuyingValue = { initiatives: initiatives.length ? initiatives : signals.map((x) => x.type), painPoints: s?.transformation };
  out.facets.buying = facet(buyingVal, evidence, { assumptions: ['strategy inferred from stated inputs + corroborating signals'] });

  const traces: ReasoningTrace[] = [];
  const growthSignals = signals.filter((x) => ['funding', 'hiring', 'expansion'].includes(x.type));
  const modernization = signals.filter((x) => ['tech_migration', 'tech_adoption'].includes(x.type));
  if (s?.initiatives?.length) traces.push(reasoningTrace({ claim: 'likely_initiatives', conclusion: s.initiatives[0], because: evidence.filter((e) => e.label === 'strategic:initiatives'), confidence: 0.6, method: 'deterministic' }));
  if (growthSignals.length) traces.push(reasoningTrace({ claim: 'growth_strategy', conclusion: 'expansion', because: sigEv.filter((e) => /funding|hiring|expansion/.test(e.label)), confidence: clamp01(0.5 + 0.1 * growthSignals.length), method: 'deterministic' }));
  if (modernization.length) traces.push(reasoningTrace({ claim: 'technology_modernization', conclusion: 'indicated', because: sigEv.filter((e) => /migration|adoption/.test(e.label)), confidence: 0.55, method: 'deterministic' }));
  out.reasoning = traces.length ? traces : [reasoningTrace({ claim: 'strategic_context', conclusion: 'partial', because: evidence, confidence: 0.5, method: 'deterministic', unknowns: ['limited strategic evidence'] })];
  return out;
}
