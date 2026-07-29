/**
 * CI-C307 — Competitive Positioning (deterministic contributor). Consumes competitor REFERENCES
 * (the Competitor Intelligence platform remains the owner — no duplicate competitor ownership) →
 * competitive facet + graph edges (competes_with references) + a `market_authority` contribution.
 * Abstains without competitor references.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace, node, edge } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

const ENGINE = 'competitive';

export function runCompetitive(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const competitors = ctx.competitors ?? [];
  if (!competitors.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as CompanyEngineOutput;
  const company = node('company', ctx.key.companyId);
  const evidence: EvidenceRef[] = []; const edges: GraphEdge[] = [];
  for (const c of competitors) {
    const ev = mkEvidence(ENGINE, { label: 'competitor', value: c.name, source: c.source, observedAt: c.observedAt, kind: 'external' });
    evidence.push(ev);
    // REFERENCE the competitor node (owned by Competitor Intelligence) — never re-own it.
    edges.push(edge({ type: 'competes_with', from: company, to: node('competitor', c.name), evidence: [ev], confidence: 0.6, asOf: c.observedAt }));
  }
  out.evidence = evidence; out.edges = edges;
  out.facets.competitive = facet({ competitors: competitors.map((c) => c.name) }, evidence);
  // More named competitors ⇒ contested market; authority derives from differentiation elsewhere, so keep modest.
  const authority = clamp01(0.5 - Math.min(competitors.length, 5) * 0.04);
  out.contributions.push({ dimension: 'market_authority', contributor: ENGINE, method: 'deterministic', value: authority, confidence: clamp01(0.35 + 0.1 * Math.min(competitors.length, 3)), evidence, asOf: ctx.asOf });
  out.reasoning.push(reasoningTrace({ claim: 'competitive_pressure', conclusion: clamp01(Math.min(competitors.length, 5) / 5), because: evidence, confidence: 0.5, method: 'deterministic', assumptions: ['competitor references owned by Competitor Intelligence'], unknowns: ['relative positioning requires deeper signal'] }));
  return out;
}
