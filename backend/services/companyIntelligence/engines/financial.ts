/**
 * CI-C306 — Financial & Funding Intelligence (deterministic contributor). Funding history / stage /
 * valuation / revenue band / profitability / runway → financial + funding facets + `maturity` and
 * (inverse) `risk` contributions. Every inference exposes assumptions + uncertainty + evidence.
 * Abstains without financial evidence.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const ENGINE = 'financial';
const STAGE_RANK: Record<string, number> = { 'pre-seed': 0.1, seed: 0.25, 'series a': 0.4, 'series b': 0.6, 'series c': 0.75, 'series d': 0.85, growth: 0.9, public: 1, bootstrapped: 0.5 };
const ord = (v?: string): number => { const s = (v ?? '').toLowerCase(); if (/high|strong|profitable|positive/.test(s)) return 1; if (/medium|break.?even|moderate/.test(s)) return 0.6; if (/low|negative|burn|short/.test(s)) return 0.25; return 0.5; };

export function runFinancial(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const f = ctx.financial;
  if (!f) return emptyOutput(ENGINE);
  const src = f.source ?? 'financial_intelligence'; const at = f.observedAt ?? ctx.asOf;
  const evidence: EvidenceRef[] = [];
  const add = (label: string, v?: string) => { if (v) evidence.push(mkEvidence(ENGINE, { label, value: v, source: src, observedAt: at, kind: 'external' })); };
  add('fin:funding_stage', f.fundingStage); add('fin:total_raised', f.totalRaised); add('fin:valuation', f.valuation);
  add('fin:revenue_band', f.revenueBand); add('fin:profitability', f.profitability); add('fin:runway', f.runway);
  if (!evidence.length) return emptyOutput(ENGINE);

  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence, edges: [], reasoning: [] } as CompanyEngineOutput;
  out.facets.funding = facet({ stage: f.fundingStage, totalRaised: f.totalRaised }, evidence.filter((e) => /funding|total_raised|valuation/.test(e.label)));
  out.facets.financial = facet({ revenueBand: f.revenueBand, profitability: f.profitability }, evidence.filter((e) => /revenue|profitability/.test(e.label)));

  const stage = STAGE_RANK[(f.fundingStage ?? '').toLowerCase()] ?? 0.5;
  const maturity = clamp01(0.5 * stage + 0.5 * ord(f.revenueBand));
  const stability = clamp01(0.5 * ord(f.profitability) + 0.5 * ord(f.runway)); // higher = healthier
  const conf = clamp01(0.4 + 0.1 * Math.min(evidence.length, 4));
  out.contributions.push({ dimension: 'maturity', contributor: ENGINE, method: 'deterministic', value: maturity, confidence: conf, evidence, asOf: at });
  out.contributions.push({ dimension: 'risk', contributor: ENGINE, method: 'deterministic', value: clamp01(1 - stability), confidence: conf, evidence, asOf: at });
  out.reasoning.push(reasoningTrace({ claim: 'financial_health', conclusion: stability, because: evidence, confidence: conf, method: 'deterministic', assumptions: ['ordinal mapping of stage/revenue/profitability/runway'], unknowns: [...(f.runway ? [] : ['runway unknown']), ...(f.profitability ? [] : ['profitability unknown'])] }));
  return out;
}
