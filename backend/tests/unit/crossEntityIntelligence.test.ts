/**
 * PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase C — Cross-Entity Intelligence tests.
 * Deterministic. Proves the layer CONSUMES the REAL Lead/Company/Offering understandings + the Phase-B
 * graph, reasons across them (grounded / abstaining), derives relationship intelligence + context
 * projections + explanations — while OWNING NO semantics: graph immutable, entities unmodified,
 * references-only preserved, no re-scoring/re-projection, flag-dark. Programs 1–3 run in regression.
 */

import {
  assembleCrossEntityContext, resolveNeighborhood, fuseCrossEntityEvidence, reasonAcrossEntities,
  assessRelationships, projectContext, explainAll, computeCrossEntityIntelligence, computeCrossEntitySnapshot,
  isCrossEntityIntelligenceEnabled, evidenceOf, type CanonicalEntityUnderstanding,
} from '../../services/crossEntityIntelligence';
import { node, edge, mkEvidence } from '../../services/intelligence/canonical';
import { validateReasoning } from '../../services/intelligence/canonical';
// REAL understandings from the three certified entities (proves the layer consumes them unchanged):
import { assembleCompanyUnderstanding } from '../../services/companyIntelligence/engines';
import { assembleOfferingUnderstanding } from '../../services/offeringIntelligence/engines';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';
const OLD = '2026-01-01T00:00:00.000Z';

/** REAL understandings, then LINKED (references-only connecting edges an entity would itself emit). */
function linkedUnderstandings(): CanonicalEntityUnderstanding[] {
  const company = assembleCompanyUnderstanding({ key: { companyId: 'C1' }, asOf: ASOF, profile: { companyId: 'C1', asOf: ASOF, name: 'Acme', competitors: ['RivalCo'] }, competitors: [{ name: 'RivalCo', source: 'serp', observedAt: ASOF }], executives: [{ name: 'Jane', role: 'CEO', source: 'news', observedAt: ASOF }] }).understanding;
  const offering = assembleOfferingUnderstanding({ key: { companyId: 'C1', offeringId: 'widget' }, asOf: ASOF, seed: { companyId: 'C1', asOf: ASOF, name: 'Widget', offeringType: 'product' }, personas: [{ name: 'Analyst', role: 'user', source: 'crm', observedAt: ASOF }], competitors: [{ name: 'RivalViz', source: 'serp', observedAt: ASOF }] }).understanding;
  const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF });

  const ev = (label: string, at = ASOF) => [mkEvidence('link', { label, source: 'crm', observedAt: at })];
  // Non-mutating: append references-only edges (exactly what an entity emits) so the graph interconnects.
  const linkedLead: CanonicalEntityUnderstanding = { ...lead, graph: { root: lead.graph.root, edges: [
    edge({ type: 'belongs_to', from: node('lead', 'L1'), to: node('company', 'C1'), evidence: ev('lead_at_company') }),
    edge({ type: 'engaged_with', from: node('lead', 'L1'), to: node('offering', 'widget'), evidence: ev('lead_viewed_offering', OLD) }),
  ] } };
  const linkedOffering: CanonicalEntityUnderstanding = { ...offering, graph: { root: offering.graph.root, edges: [
    ...offering.graph.edges,
    edge({ type: 'belongs_to', from: node('offering', 'widget'), to: node('company', 'C1'), evidence: ev('offering_of_company') }),
  ] } };
  return [linkedLead, company, linkedOffering];
}

describe('G-C301/302 context assembly + multi-hop resolution', () => {
  it('assembles a connected cross-entity context spanning lead → company + offering', () => {
    const ctx = assembleCrossEntityContext(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    expect(ctx.focus.key).toBe('lead:L1');
    expect(ctx.entities.map((e) => e.type).sort()).toEqual(['company', 'lead', 'offering']);
    expect(ctx.evidence.length).toBeGreaterThan(0);
    expect(ctx.neighborhood.hopsOf['lead:L1']).toBe(0);
  });
  it('resolver: depth-limited, deterministic, cycle-safe, provenance preserved', () => {
    const ctx = assembleCrossEntityContext(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 1 });
    const nb = resolveNeighborhood(ctx.graph, 'lead:L1', { depth: 1 });
    expect(nb.nodes.find((n) => n.key === 'company:C1')).toBeTruthy(); // hop 1
    expect(nb.provenance.length).toBeGreaterThan(0);
    // cycle protection: even with a back-edge the walk terminates and dedupes
    expect(resolveNeighborhood(ctx.graph, 'lead:L1', { depth: 10 }).nodes.length).toBe(new Set(resolveNeighborhood(ctx.graph, 'lead:L1', { depth: 10 }).nodes.map((n) => n.key)).size);
  });
});

describe('G-C303 evidence fusion (reuses shared fuseEvidence; derives inferred evidence)', () => {
  it('fuses multi-entity evidence and emits inferred contributions', () => {
    const ctx = assembleCrossEntityContext(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    const f = fuseCrossEntityEvidence(ctx);
    expect(f.fused.length).toBeGreaterThan(0);
    expect(f.confidence).toBeGreaterThanOrEqual(0);
    expect(f.derived.every((e) => e.kind === 'inferred')).toBe(true); // derived, never fabricated as observed
    expect(f.derived.length).toBeGreaterThan(0);
  });
});

describe('G-C304 cross-entity reasoning (grounded + abstaining)', () => {
  it('produces grounded insights across lead/company/offering, all valid canonical traces', () => {
    const ctx = assembleCrossEntityContext(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    const insights = reasonAcrossEntities(ctx);
    const kinds = insights.map((i) => i.kind);
    expect(kinds).toEqual(['buying_context', 'interest', 'portfolio', 'qualification']); // sorted, all applicable
    const buying = insights.find((i) => i.kind === 'buying_context')!;
    expect(buying.abstained).toBe(false);
    expect(buying.trace.conclusion).toBe('buying_context_formed');
    expect(buying.trace.because.length).toBeGreaterThan(0);        // references canonical evidence
    expect(insights.every((i) => validateReasoning(i.trace).valid)).toBe(true);
  });
  it('ABSTAINS (conclusion null + unknown) when entities present but evidence absent', () => {
    const bareLead: CanonicalEntityUnderstanding = { graph: { root: node('lead', 'LX'), edges: [edge({ type: 'belongs_to', from: node('lead', 'LX'), to: node('company', 'CX') })] }, reasoning: [], contradictions: [], builtAt: ASOF };
    const bareCompany: CanonicalEntityUnderstanding = { graph: { root: node('company', 'CX'), edges: [] }, reasoning: [], contradictions: [], builtAt: ASOF };
    const ctx = assembleCrossEntityContext([bareLead, bareCompany], ASOF, { focusKey: 'lead:LX', depth: 2 });
    const qual = reasonAcrossEntities(ctx).find((i) => i.kind === 'qualification')!;
    expect(qual.abstained).toBe(true);
    expect(qual.trace.conclusion).toBeNull();
    expect(qual.trace.unknowns).toContain('insufficient_cross_entity_evidence');
    expect(validateReasoning(qual.trace).valid).toBe(true);        // valid abstention
  });
});

describe('G-C305 relationship intelligence (derived; graph unchanged)', () => {
  it('derives strength/recency/dependency without mutating the graph', () => {
    const us = linkedUnderstandings();
    const before = us.map((u) => u.graph.edges.length);
    const ctx = assembleCrossEntityContext(us, ASOF, { focusKey: 'lead:L1', depth: 2 });
    const rels = assessRelationships(ctx);
    expect(rels.length).toBeGreaterThan(0);
    expect(rels.every((r) => r.strength >= 0 && r.strength <= 1)).toBe(true);
    const belongs = rels.find((r) => r.type === 'belongs_to')!;
    expect(belongs.dependency).toBe(true);
    const engaged = rels.find((r) => r.type === 'engaged_with')!;
    expect(engaged.recency).not.toBeNull();
    expect(engaged.recency!).toBeLessThan(1);                       // older observation ⇒ decayed
    expect(us.map((u) => u.graph.edges.length)).toEqual(before);    // GRAPH IMMUTABLE — nothing written back
  });
});

describe('G-C306/307 projections + explainability', () => {
  it('projects buying/account/offering/relationship contexts (no entity re-projection)', () => {
    const ctx = assembleCrossEntityContext(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    const insights = reasonAcrossEntities(ctx);
    const rels = assessRelationships(ctx);
    const projections = projectContext(ctx, insights, rels);
    expect(projections.map((p) => p.name).sort()).toEqual(['account_context', 'buying_context', 'offering_context', 'relationship_context']);
    expect(projections.every((p) => p.focus === 'lead:L1' && p.projectedAt === ASOF)).toBe(true);
  });
  it('explains each conclusion: entities, evidence, relationships, traversal, uncertainty', () => {
    const ctx = assembleCrossEntityContext(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    const insights = reasonAcrossEntities(ctx);
    const rels = assessRelationships(ctx);
    const ex = explainAll(insights, ctx, rels).find((e) => e.claim.includes('buying'))!;
    expect(ex.whichEntities.length).toBe(3);
    expect(ex.whichEvidence.length).toBeGreaterThan(0);
    expect(ex.whichTraversal).toContain('lead:L1');
    expect(ex.uncertainty).toBeCloseTo(1 - ex.confidence, 5);
  });
});

describe('runtime + flag-gating (shadow-only) + determinism', () => {
  it('deterministic full result; entities unmodified', () => {
    const a = computeCrossEntityIntelligence(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    const b = computeCrossEntityIntelligence(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    expect(a).toEqual(b);
    expect(a.insights.length).toBe(4);
  });
  it('computeCrossEntitySnapshot null when OFF (default), computes when ON', () => {
    delete process.env.CROSS_ENTITY_INTELLIGENCE_ENABLED;
    expect(isCrossEntityIntelligenceEnabled()).toBe(false);
    expect(computeCrossEntitySnapshot(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1' })).toBeNull();
    process.env.CROSS_ENTITY_INTELLIGENCE_ENABLED = 'true';
    expect(computeCrossEntitySnapshot(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 })?.insights.length).toBe(4);
    delete process.env.CROSS_ENTITY_INTELLIGENCE_ENABLED;
  });
  it('evidenceOf reads canonical evidence only (references-only consumption)', () => {
    const [lead] = linkedUnderstandings();
    expect(evidenceOf(lead).length).toBeGreaterThan(0);
  });
});
