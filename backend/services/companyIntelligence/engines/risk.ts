/**
 * CI-C308 — Risk Intelligence (deterministic contributor). Operational / financial / technology /
 * compliance / hiring / execution / market / reputational risks → risk facet + a `risk` contribution.
 * Every risk carries evidence + confidence + impact + uncertainty. Abstains without risk evidence.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const ENGINE = 'risk';
const IMPACT: Record<string, number> = { low: 0.25, medium: 0.6, high: 0.9 };

export function runRisk(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const risks = ctx.risks ?? [];
  if (!risks.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as CompanyEngineOutput;
  const evidence: EvidenceRef[] = risks.map((r) => mkEvidence(ENGINE, { label: `risk:${r.type}`, value: r.detail ?? r.type, source: r.source, observedAt: r.observedAt, kind: 'inferred', weight: IMPACT[r.impact ?? 'medium'] }));
  out.evidence = evidence;
  out.facets.risk = facet({ risks: risks.map((r) => `${r.type}${r.impact ? `:${r.impact}` : ''}`), complianceConcerns: risks.filter((r) => /complian|regulat/i.test(r.type)).map((r) => r.type) }, evidence);

  const level = clamp01(risks.reduce((a, r) => a + IMPACT[r.impact ?? 'medium'], 0) / risks.length);
  const confidence = clamp01(0.4 + 0.1 * Math.min(risks.length, 4));
  out.contributions.push({ dimension: 'risk', contributor: ENGINE, method: 'deterministic', value: level, confidence, evidence, asOf: ctx.asOf });
  out.reasoning.push(reasoningTrace({ claim: 'risk_level', conclusion: level, because: evidence, confidence, method: 'deterministic', assumptions: ['mean impact of stated risks'], unknowns: risks.some((r) => !r.impact) ? ['some impacts unspecified'] : [] }));
  return out;
}
