/**
 * CI-C305 — Customer & Partner Intelligence (deterministic contributor). Customer segments /
 * strategic customers / concentration + ecosystem/channel/technology/reseller partners → customers +
 * partners facets + graph edges (references) + a `fit`/`market_authority` contribution. Evidence only
 * — no fabricated customers. Abstains without customers or partners.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace, node, edge } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

const ENGINE = 'customer_partner';

export function runCustomerPartner(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const customers = ctx.customers ?? []; const partners = ctx.partners ?? [];
  if (!customers.length && !partners.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as CompanyEngineOutput;
  const company = node('company', ctx.key.companyId);
  const evidence: EvidenceRef[] = []; const edges: GraphEdge[] = [];

  for (const c of customers) {
    const ev = mkEvidence(ENGINE, { label: `customer${c.strategic ? ':strategic' : ''}`, value: c.name, source: c.source, observedAt: c.observedAt, kind: 'structured' });
    evidence.push(ev); edges.push(edge({ type: 'engaged_with', from: company, to: node('customer', c.name), evidence: [ev], confidence: 0.6, asOf: c.observedAt }));
  }
  for (const p of partners) {
    const ev = mkEvidence(ENGINE, { label: `partner:${p.type ?? 'alliance'}`, value: p.name, source: p.source, observedAt: p.observedAt, kind: 'structured' });
    evidence.push(ev); edges.push(edge({ type: 'references', from: company, to: node('partner', p.name), evidence: [ev], confidence: 0.6, asOf: p.observedAt }));
  }
  out.evidence = evidence; out.edges = edges;
  if (customers.length) out.facets.customers = facet({ namedCustomers: customers.map((c) => c.name), segments: [...new Set(customers.map((c) => c.segment).filter(Boolean) as string[])] }, evidence.filter((e) => e.label.startsWith('customer')));
  if (partners.length) out.facets.partners = facet({ partners: partners.map((p) => p.name), channelTypes: [...new Set(partners.map((p) => p.type).filter(Boolean) as string[])] }, evidence.filter((e) => e.label.startsWith('partner')));

  const strategic = customers.filter((c) => c.strategic).length;
  const fit = clamp01(0.3 + 0.1 * Math.min(customers.length, 4) + 0.1 * strategic);
  const authority = clamp01(0.3 + 0.1 * Math.min(partners.length, 4) + (strategic ? 0.2 : 0));
  if (customers.length) out.contributions.push({ dimension: 'fit', contributor: ENGINE, method: 'deterministic', value: fit, confidence: clamp01(0.4 + 0.1 * customers.length), evidence, asOf: ctx.asOf });
  if (partners.length) out.contributions.push({ dimension: 'market_authority', contributor: ENGINE, method: 'deterministic', value: authority, confidence: clamp01(0.4 + 0.1 * partners.length), evidence, asOf: ctx.asOf });
  out.reasoning.push(reasoningTrace({ claim: 'ecosystem_strength', conclusion: clamp01((fit + authority) / 2), because: evidence, confidence: 0.55, method: 'deterministic', assumptions: [`${strategic} strategic customer(s)`], unknowns: [] }));
  return out;
}
