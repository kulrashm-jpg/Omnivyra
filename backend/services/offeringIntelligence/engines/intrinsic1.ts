/**
 * OI-C301..304 — Intrinsic Offering Intelligence (Layer 1): Feature / Pricing / Packaging /
 * Positioning. Deterministic contributors — each emits offering facets + score contributions +
 * reasoning + evidence, abstaining without input. Evidence only; no fabrication.
 */

import type { OfferingEngineOutput, OfferingIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

// ── OI-C301 Feature Intelligence ────────────────────────────────────────────────────────────────
export function runFeature(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const f = ctx.features; if (!f) return emptyOutput('feature', 'intrinsic');
  const src = f.source ?? 'feature_intelligence', at = f.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, a?: string[]) => { if (a?.length) ev.push(mkEvidence('feature', { label: l, value: a.join('; '), source: src, observedAt: at, kind: 'structured' })); };
  add('feature:features', f.features); add('feature:modules', f.modules); add('feature:editions', f.editions); add('feature:dependencies', f.dependencies);
  if (!ev.length) return emptyOutput('feature', 'intrinsic');
  const o = { ...emptyOutput('feature', 'intrinsic'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.features = facet({ features: [...(f.features ?? []), ...(f.modules ?? [])] }, ev);
  const breadth = clamp01(((f.features?.length ?? 0) + (f.modules?.length ?? 0) + (f.editions?.length ?? 0)) / 12);
  o.contributions.push({ dimension: 'differentiation', contributor: 'feature', method: 'deterministic', value: breadth, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.contributions.push({ dimension: 'maturity', contributor: 'feature', method: 'deterministic', value: clamp01(breadth * (f.editions?.length ? 1 : 0.8)), confidence: 0.5, evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'feature_breadth', conclusion: breadth, because: ev, confidence: 0.6, method: 'deterministic', assumptions: ['breadth of features/modules/editions'], unknowns: [] }));
  return o;
}

// ── OI-C302 Pricing Intelligence ────────────────────────────────────────────────────────────────
export function runPricing(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const p = ctx.pricing; if (!p) return emptyOutput('pricing', 'intrinsic');
  const src = p.source ?? 'pricing_intelligence', at = p.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v?: string | boolean | string[]) => { const s = Array.isArray(v) ? v.join('; ') : v; if (s != null && s !== '' && s !== false) ev.push(mkEvidence('pricing', { label: l, value: s === true ? 'yes' : String(s), source: src, observedAt: at, kind: 'external' })); };
  add('pricing:model', p.model); add('pricing:billing', p.billing); add('pricing:plans', p.plans); add('pricing:usage', p.usageBased); add('pricing:enterprise', p.enterprise); add('pricing:freemium', p.freemium); add('pricing:trials', p.trials); add('pricing:discounting', p.discounting);
  if (!ev.length) return emptyOutput('pricing', 'intrinsic');
  const o = { ...emptyOutput('pricing', 'intrinsic'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.pricing = facet({ model: p.model, plans: p.plans }, ev);
  // Pricing flexibility/maturity: more monetization modes ⇒ more mature commercial motion.
  const modes = [p.usageBased, p.enterprise, p.freemium, p.trials, (p.plans?.length ?? 0) > 1].filter(Boolean).length;
  const maturity = clamp01(0.3 + 0.14 * modes);
  o.contributions.push({ dimension: 'maturity', contributor: 'pricing', method: 'deterministic', value: maturity, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'pricing_maturity', conclusion: maturity, because: ev, confidence: 0.55, method: 'deterministic', assumptions: [`${modes} monetization mode(s)`], unknowns: p.discounting ? [] : ['discounting policy unknown'] }));
  return o;
}

// ── OI-C303 Packaging Intelligence ──────────────────────────────────────────────────────────────
export function runPackaging(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const p = ctx.packaging; if (!p) return emptyOutput('packaging', 'intrinsic');
  const src = p.source ?? 'packaging_intelligence', at = p.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, a?: string[]) => { if (a?.length) ev.push(mkEvidence('packaging', { label: l, value: a.join('; '), source: src, observedAt: at, kind: 'structured' })); };
  add('packaging:plans', p.plans); add('packaging:bundles', p.bundles); add('packaging:editions', p.editions); add('packaging:upgrade_paths', p.upgradePaths); add('packaging:feature_gating', p.featureGating);
  if (!ev.length) return emptyOutput('packaging', 'intrinsic');
  const o = { ...emptyOutput('packaging', 'intrinsic'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.packaging = facet({ packages: [...(p.plans ?? []), ...(p.bundles ?? []), ...(p.editions ?? [])] }, ev);
  const maturity = clamp01(0.3 + 0.15 * [p.plans?.length, p.bundles?.length, p.upgradePaths?.length, p.featureGating?.length].filter((x) => (x ?? 0) > 0).length);
  o.contributions.push({ dimension: 'maturity', contributor: 'packaging', method: 'deterministic', value: maturity, confidence: 0.5, evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'packaging_strategy', conclusion: maturity, because: ev, confidence: 0.55, method: 'deterministic', assumptions: ['plans+bundles+upgrade paths+gating'], unknowns: [] }));
  return o;
}

// ── OI-C304 Positioning Intelligence ────────────────────────────────────────────────────────────
export function runPositioning(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const p = ctx.positioning; if (!p) return emptyOutput('positioning', 'intrinsic');
  const src = p.source ?? 'positioning_intelligence', at = p.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v?: string | string[], k: 'structured' | 'inferred' = 'inferred') => { const s = Array.isArray(v) ? v.join('; ') : v; if (s) ev.push(mkEvidence('positioning', { label: l, value: s, source: src, observedAt: at, kind: k })); };
  add('positioning:statement', p.statement); add('positioning:messaging', p.messaging); add('positioning:value_prop', p.valueProposition); add('positioning:category', p.category, 'structured'); add('positioning:differentiation', p.differentiation);
  if (!ev.length) return emptyOutput('positioning', 'intrinsic');
  const o = { ...emptyOutput('positioning', 'intrinsic'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.positioning = facet({ statement: p.statement, segment: p.category }, ev.filter((e) => /statement|category/.test(e.label)));
  if (p.valueProposition) o.facets.valueProposition = facet({ statement: p.valueProposition }, ev.filter((e) => e.label === 'positioning:value_prop'));
  if (p.differentiation?.length) o.facets.differentiators = facet({ differentiators: p.differentiation }, ev.filter((e) => e.label === 'positioning:differentiation'));
  const diff = clamp01((p.differentiation?.length ? 0.5 : 0.2) + (p.statement ? 0.3 : 0) + (p.valueProposition ? 0.2 : 0));
  o.contributions.push({ dimension: 'differentiation', contributor: 'positioning', method: 'deterministic', value: diff, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'strategic_positioning', conclusion: diff, because: ev, confidence: 0.6, method: 'deterministic', assumptions: ['differentiation + statement + value prop'], unknowns: [] }));
  return o;
}
