/**
 * OI-C309..311 — Intrinsic Offering Intelligence (Layer 1): Integration / Compliance / Category &
 * Capability. Deterministic contributors. Category & Capability adopts the certified-shadow resolver
 * concept (deterministic, evidence-first). Abstain-safe.
 */

import type { OfferingEngineOutput, OfferingIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

// ── OI-C309 Integration Intelligence ────────────────────────────────────────────────────────────
export function runIntegration(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const i = ctx.integrations; if (!i) return emptyOutput('integration', 'intrinsic');
  const src = i.source ?? 'integration_intelligence', at = i.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v?: string | string[]) => { const s = Array.isArray(v) ? v.join('; ') : v; if (s) ev.push(mkEvidence('integration', { label: l, value: s, source: src, observedAt: at, kind: 'structured' })); };
  add('integration:apis', i.apis); add('integration:integrations', i.integrations); add('integration:marketplaces', i.marketplaces); add('integration:partner', i.partnerIntegrations); add('integration:extensibility', i.extensibility);
  if (!ev.length) return emptyOutput('integration', 'intrinsic');
  const o = { ...emptyOutput('integration', 'intrinsic'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.integrations = facet({ integrations: [...(i.integrations ?? []), ...(i.apis ?? [])] }, ev);
  const breadth = clamp01(((i.integrations?.length ?? 0) + (i.apis?.length ?? 0) + (i.marketplaces?.length ?? 0)) / 10);
  o.contributions.push({ dimension: 'differentiation', contributor: 'integration', method: 'deterministic', value: breadth, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.contributions.push({ dimension: 'maturity', contributor: 'integration', method: 'deterministic', value: clamp01(breadth * (i.marketplaces?.length ? 1 : 0.85)), confidence: 0.5, evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'integration_ecosystem', conclusion: breadth, because: ev, confidence: 0.55, method: 'deterministic', assumptions: ['apis+integrations+marketplaces breadth'], unknowns: [] }));
  return o;
}

// ── OI-C310 Compliance Intelligence ─────────────────────────────────────────────────────────────
export function runCompliance(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const c = ctx.compliance; if (!c) return emptyOutput('compliance', 'intrinsic');
  const src = c.source ?? 'compliance_intelligence', at = c.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v?: string | string[]) => { const s = Array.isArray(v) ? v.join('; ') : v; if (s) ev.push(mkEvidence('compliance', { label: l, value: s, source: src, observedAt: at, kind: 'external' })); };
  add('compliance:certifications', c.certifications); add('compliance:standards', c.standards); add('compliance:security', c.security); add('compliance:privacy', c.privacy);
  if (!ev.length) return emptyOutput('compliance', 'intrinsic');
  const o = { ...emptyOutput('compliance', 'intrinsic'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.compliance = facet({ standards: [...(c.certifications ?? []), ...(c.standards ?? [])] }, ev);
  const maturity = clamp01(((c.certifications?.length ?? 0) + (c.standards?.length ?? 0)) / 6 + (c.security ? 0.2 : 0));
  o.contributions.push({ dimension: 'maturity', contributor: 'compliance', method: 'deterministic', value: maturity, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'enterprise_compliance', conclusion: maturity, because: ev, confidence: 0.6, method: 'deterministic', assumptions: ['certifications+standards+security posture'], unknowns: c.privacy ? [] : ['privacy posture unknown'] }));
  return o;
}

// ── OI-C311 Category & Capability Intelligence ──────────────────────────────────────────────────
export function runCategoryCapability(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const c = ctx.categoryCapability; if (!c) return emptyOutput('category_capability', 'intrinsic');
  const src = c.source ?? 'category_intelligence', at = c.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v?: string | string[]) => { const s = Array.isArray(v) ? v.join('; ') : v; if (s) ev.push(mkEvidence('category_capability', { label: l, value: s, source: src, observedAt: at, kind: 'structured' })); };
  add('category:primary', c.primaryCategory); add('category:secondary', c.secondaryCategories); add('category:capabilities', c.capabilities); add('category:adjacents', c.adjacents); add('category:substitutes', c.substitutes); add('category:complements', c.complements);
  if (!ev.length) return emptyOutput('category_capability', 'intrinsic');
  const o = { ...emptyOutput('category_capability', 'intrinsic'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  if (c.primaryCategory) o.facets.category = facet({ category: c.primaryCategory }, ev.filter((e) => /primary|secondary/.test(e.label)));
  if (c.capabilities?.length) o.facets.capabilities = facet({ capabilities: c.capabilities }, ev.filter((e) => e.label === 'category:capabilities'));
  const diff = clamp01((c.capabilities?.length ? 0.5 : 0.2) + (c.primaryCategory ? 0.3 : 0));
  o.contributions.push({ dimension: 'differentiation', contributor: 'category_capability', method: 'deterministic', value: diff, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'category_placement', conclusion: c.primaryCategory ?? 'indicated', because: ev, confidence: 0.6, method: 'deterministic', assumptions: ['exact category + capabilities (adopted resolver concept)'], unknowns: [] }));
  return o;
}
