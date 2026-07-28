/**
 * OI-C305..308,C312 — Market Offering Intelligence (Layer 2): Market-Fit / Persona / Adoption /
 * Lifecycle / Competitive Mapping. How the market perceives + adopts the offering. Deterministic
 * contributors. Persona + Competitive REFERENCE graph nodes owned elsewhere (no re-ownership).
 */

import type { OfferingEngineOutput, OfferingIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace, node, edge } from '../../intelligence/canonical';
import type { EvidenceRef, GraphEdge } from '../../intelligence/canonical';

const ord = (v?: string): number => { const s = (v ?? '').toLowerCase(); if (/high|strong|excellent|growing/.test(s)) return 1; if (/medium|moderate|steady/.test(s)) return 0.6; if (/low|weak|declining/.test(s)) return 0.25; return 0.5; };

// ── OI-C305 Market Fit ──────────────────────────────────────────────────────────────────────────
export function runMarketFit(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const m = ctx.marketFit; if (!m) return emptyOutput('market_fit', 'market');
  const src = m.source ?? 'market_fit_intelligence', at = m.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v?: string | string[]) => { const s = Array.isArray(v) ? v.join('; ') : v; if (s) ev.push(mkEvidence('market_fit', { label: l, value: s, source: src, observedAt: at, kind: 'inferred' })); };
  add('fit:icp', m.icpFit); add('fit:size', m.sizeFit); add('fit:industry', m.industryFit); add('fit:geo', m.geoFit); add('fit:usecase', m.useCaseFit); add('fit:deployment', m.deploymentFit);
  if (!ev.length) return emptyOutput('market_fit', 'market');
  const o = { ...emptyOutput('market_fit', 'market'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.icpAlignment = facet({ fit: m.icpFit, segments: [...(m.industryFit ?? []), ...(m.useCaseFit ?? [])] }, ev);
  const dims = [ord(m.icpFit), ord(m.sizeFit), m.industryFit?.length ? 0.7 : 0.4, m.useCaseFit?.length ? 0.7 : 0.4].filter((_, i) => i < 4);
  const fit = clamp01(dims.reduce((a, b) => a + b, 0) / dims.length);
  o.contributions.push({ dimension: 'market_fit', contributor: 'market_fit', method: 'deterministic', value: fit, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'market_fit', conclusion: fit, because: ev, confidence: 0.6, method: 'deterministic', assumptions: ['icp+size+industry+usecase fit'], unknowns: [] }));
  return o;
}

// ── OI-C306 Persona (references persona nodes; never owns persona semantics) ─────────────────────
export function runPersona(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const ps = ctx.personas ?? []; if (!ps.length) return emptyOutput('persona', 'market');
  const o = { ...emptyOutput('persona', 'market'), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as OfferingEngineOutput;
  const offering = node('offering', ctx.key.offeringId);
  const ev: EvidenceRef[] = []; const edges: GraphEdge[] = [];
  for (const p of ps) { const e = mkEvidence('persona', { label: `persona:${p.role ?? 'user'}`, value: p.name, source: p.source, observedAt: p.observedAt, kind: 'structured' }); ev.push(e); edges.push(edge({ type: 'serves_persona', from: offering, to: node('persona', p.name), evidence: [e], confidence: 0.6, asOf: p.observedAt })); }
  o.evidence = ev; o.edges = edges;
  o.facets.personas = facet({ personas: ps.map((p) => p.name) }, ev);
  const fit = clamp01(0.3 + 0.1 * Math.min(new Set(ps.map((p) => p.role)).size, 4) + (ps.some((p) => p.role === 'decision_maker') ? 0.2 : 0));
  o.contributions.push({ dimension: 'market_fit', contributor: 'persona', method: 'deterministic', value: fit, confidence: clamp01(0.4 + 0.1 * ps.length), evidence: ev, asOf: ctx.asOf });
  o.reasoning.push(reasoningTrace({ claim: 'buying_committee_coverage', conclusion: fit, because: ev, confidence: 0.55, method: 'deterministic', assumptions: ['personas reference nodes owned upstream'], unknowns: [] }));
  return o;
}

// ── OI-C307 Adoption ────────────────────────────────────────────────────────────────────────────
export function runAdoption(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const a = ctx.adoption; if (!a) return emptyOutput('adoption', 'market');
  const src = a.source ?? 'adoption_intelligence', at = a.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const add = (l: string, v?: string) => { if (v) ev.push(mkEvidence('adoption', { label: l, value: v, source: src, observedAt: at, kind: 'observed' })); };
  add('adoption:customers', a.customers); add('adoption:traction', a.traction); add('adoption:deployment', a.deploymentMaturity); add('adoption:retention', a.retention); add('adoption:expansion', a.expansion); add('adoption:momentum', a.usageMomentum);
  if (!ev.length) return emptyOutput('adoption', 'market');
  const o = { ...emptyOutput('adoption', 'market'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.adoption = facet({ level: a.traction, usage: [a.usageMomentum, a.deploymentMaturity].filter(Boolean) as string[] }, ev);
  const level = clamp01((ord(a.traction) + ord(a.retention) + ord(a.usageMomentum)) / 3);
  o.contributions.push({ dimension: 'adoption', contributor: 'adoption', method: 'deterministic', value: level, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'adoption_level', conclusion: level, because: ev, confidence: 0.6, method: 'deterministic', assumptions: ['traction+retention+momentum'], unknowns: a.expansion ? [] : ['expansion signal unknown'] }));
  return o;
}

// ── OI-C308 Lifecycle ───────────────────────────────────────────────────────────────────────────
const STAGE_MATURITY: Record<string, number> = { introduction: 0.25, growth: 0.6, maturity: 0.9, decline: 0.5 };
export function runLifecycle(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const l = ctx.lifecycle; if (!l) return emptyOutput('lifecycle', 'market');
  const src = l.source ?? 'lifecycle_intelligence', at = l.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  if (l.stage) ev.push(mkEvidence('lifecycle', { label: 'lifecycle:stage', value: l.stage, source: src, observedAt: at, kind: 'inferred' }));
  if (l.roadmap?.length) ev.push(mkEvidence('lifecycle', { label: 'lifecycle:roadmap', value: l.roadmap.join('; '), source: src, observedAt: at, kind: 'structured' }));
  if (l.releaseCadence) ev.push(mkEvidence('lifecycle', { label: 'lifecycle:cadence', value: l.releaseCadence, source: src, observedAt: at, kind: 'observed' }));
  if (!ev.length) return emptyOutput('lifecycle', 'market');
  const o = { ...emptyOutput('lifecycle', 'market'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  o.facets.lifecycle = facet({ stage: l.stage }, ev.filter((e) => e.label === 'lifecycle:stage'));
  if (l.roadmap?.length) o.facets.roadmap = facet({ signals: l.roadmap }, ev.filter((e) => e.label === 'lifecycle:roadmap'));
  const maturity = clamp01(STAGE_MATURITY[l.stage ?? ''] ?? 0.5);
  o.contributions.push({ dimension: 'maturity', contributor: 'lifecycle', method: 'deterministic', value: maturity, confidence: l.stage ? 0.6 : 0.4, evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'lifecycle_stage', conclusion: l.stage ?? 'indicated', because: ev, confidence: 0.55, method: 'deterministic', assumptions: [`stage→maturity map`], unknowns: l.releaseCadence ? [] : ['release cadence unknown'] }));
  return o;
}

// ── OI-C312 Competitive Mapping (references competitor nodes; no re-ownership) ───────────────────
export function runCompetitive(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const cs = ctx.competitors ?? []; if (!cs.length) return emptyOutput('competitive', 'market');
  const o = { ...emptyOutput('competitive', 'market'), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as OfferingEngineOutput;
  const offering = node('offering', ctx.key.offeringId);
  const ev: EvidenceRef[] = []; const edges: GraphEdge[] = [];
  for (const c of cs) { const e = mkEvidence('competitive', { label: 'competing_offering', value: c.name, source: c.source, observedAt: c.observedAt, kind: 'external' }); ev.push(e); edges.push(edge({ type: 'competes_with', from: offering, to: node('offering', c.name), evidence: [e], confidence: 0.6, asOf: c.observedAt })); }
  o.evidence = ev; o.edges = edges;
  // Differentiation is INVERSELY related to overlap breadth (more overlap ⇒ less differentiated).
  const overlap = clamp01(cs.reduce((a, c) => a + (c.overlap?.length ?? 0), 0) / Math.max(1, cs.length) / 5);
  const diff = clamp01(0.6 - overlap * 0.4);
  o.contributions.push({ dimension: 'differentiation', contributor: 'competitive', method: 'deterministic', value: diff, confidence: clamp01(0.35 + 0.1 * Math.min(cs.length, 3)), evidence: ev, asOf: ctx.asOf });
  o.reasoning.push(reasoningTrace({ claim: 'substitution_risk', conclusion: overlap, because: ev, confidence: 0.5, method: 'deterministic', assumptions: ['competitor offerings owned by Competitor Intelligence'], unknowns: ['deep capability overlap needs richer signal'] }));
  return o;
}
