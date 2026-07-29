/**
 * CI-C304 — Executive Intelligence (deterministic contributor). Leadership / executive changes /
 * tenure / influence / founders / advisors → leadership facet + graph edges (references to executive
 * nodes) + a `market_authority` contribution. Every conclusion cites evidence. Abstains without execs.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace, node, edge } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

const ENGINE = 'executive';

export function runExecutive(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const execs = ctx.executives ?? [];
  if (!execs.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as CompanyEngineOutput;
  const company = node('company', ctx.key.companyId);
  const evidence: EvidenceRef[] = []; const edges: GraphEdge[] = [];
  for (const e of execs) {
    const ev = mkEvidence(ENGINE, { label: `executive:${e.role ?? 'exec'}${e.change ? `:${e.change}` : ''}`, value: e.name, source: e.source, observedAt: e.observedAt, kind: 'structured' });
    evidence.push(ev);
    edges.push(edge({ type: 'member_of', from: node('executive', e.name), to: company, evidence: [ev], confidence: 0.7, asOf: e.observedAt }));
  }
  out.evidence = evidence; out.edges = edges;
  out.facets.leadership = facet({ executives: execs.map((e) => e.name), keyRoles: execs.map((e) => e.role).filter(Boolean) as string[] }, evidence);
  const changes = execs.filter((e) => e.change).length;
  const authority = clamp01(0.3 + 0.1 * Math.min(execs.length, 4) + (execs.some((e) => e.influence) ? 0.2 : 0));
  out.contributions.push({ dimension: 'market_authority', contributor: ENGINE, method: 'deterministic', value: authority, confidence: clamp01(0.4 + 0.1 * Math.min(execs.length, 4)), evidence, asOf: ctx.asOf });
  out.reasoning.push(reasoningTrace({ claim: 'leadership_strength', conclusion: authority, because: evidence, confidence: 0.6, method: 'deterministic', assumptions: [`${changes} recent change(s)`], unknowns: execs.some((e) => e.tenure) ? [] : ['tenure unknown'] }));
  return out;
}
