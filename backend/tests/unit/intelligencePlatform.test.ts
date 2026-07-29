/**
 * PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase D — Platform Consumption API tests.
 * Deterministic. Proves a DOWNSTREAM consumer adopts the platform via the stable API ALONE (no graph /
 * cross-entity internals), inheriting canonical context + evidence + reasoning + explainability — while
 * OWNING NO semantics: entities unmodified, graph untouched, no duplicate model, flag-dark. Programs
 * 1–4 run in regression.
 */

import {
  openIntelligencePlatform, openIntelligencePlatformSnapshot, toCanonicalContext,
  isIntelligencePlatformEnabled, type CanonicalEntityUnderstanding, type PlatformSession,
} from '../../services/intelligencePlatform';
import { node, edge, mkEvidence } from '../../services/intelligence/canonical';
// REAL understandings from the three certified entities (proves adoption over real entities):
import { assembleCompanyUnderstanding } from '../../services/companyIntelligence/engines';
import { assembleOfferingUnderstanding } from '../../services/offeringIntelligence/engines';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';
const OLD = '2026-01-01T00:00:00.000Z';

function linkedUnderstandings(): CanonicalEntityUnderstanding[] {
  const company = assembleCompanyUnderstanding({ key: { companyId: 'C1' }, asOf: ASOF, profile: { companyId: 'C1', asOf: ASOF, name: 'Acme', competitors: ['RivalCo'] }, competitors: [{ name: 'RivalCo', source: 'serp', observedAt: ASOF }], executives: [{ name: 'Jane', role: 'CEO', source: 'news', observedAt: ASOF }] }).understanding;
  const offering = assembleOfferingUnderstanding({ key: { companyId: 'C1', offeringId: 'widget' }, asOf: ASOF, seed: { companyId: 'C1', asOf: ASOF, name: 'Widget', offeringType: 'product' }, personas: [{ name: 'Analyst', role: 'user', source: 'crm', observedAt: ASOF }], competitors: [{ name: 'RivalViz', source: 'serp', observedAt: ASOF }] }).understanding;
  const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF, edges: [] });
  const ev = (label: string, at = ASOF) => [mkEvidence('link', { label, source: 'crm', observedAt: at })];
  const linkedLead: CanonicalEntityUnderstanding = { ...lead, graph: { root: lead.graph.root, edges: [
    edge({ type: 'belongs_to', from: node('lead', 'L1'), to: node('company', 'C1'), evidence: ev('lead_at_company') }),
    edge({ type: 'engaged_with', from: node('lead', 'L1'), to: node('offering', 'widget'), evidence: ev('lead_viewed_offering', OLD) }),
  ] } };
  const linkedOffering: CanonicalEntityUnderstanding = { ...offering, graph: { root: offering.graph.root, edges: [
    ...offering.graph.edges, edge({ type: 'belongs_to', from: node('offering', 'widget'), to: node('company', 'C1'), evidence: ev('offering_of_company') }),
  ] } };
  return [linkedLead, company, linkedOffering];
}

describe('G-D403 Platform Consumption API — downstream adoption via the seam only', () => {
  it('a future consumer opens a session and reads canonical context without touching internals', () => {
    const session: PlatformSession = openIntelligencePlatform(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    const ctx = session.context();
    expect(ctx.focus.key).toBe('lead:L1');
    expect(ctx.entities.map((e) => e.type).sort()).toEqual(['company', 'lead', 'offering']);
    // canonical CONTEXT projections (not entity projections) — no duplicate ownership
    expect(ctx.contexts.map((c) => c.name).sort()).toEqual(['account_context', 'buying_context', 'offering_context', 'relationship_context']);
    expect(ctx.insights.length).toBe(4);
    expect(ctx.evidenceCount).toBeGreaterThan(0);
  });
  it('exposes traversal / evidence / reasoning / relationships without graph internals', () => {
    const s = openIntelligencePlatform(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    expect(s.traverse('lead:L1', 'company:C1')).toEqual(['lead:L1', 'company:C1']);
    expect(s.traverse('lead:L1', 'nonexistent:Z')).toBeNull();
    expect(s.evidence().length).toBeGreaterThan(0);
    expect(s.reasoning().length).toBe(4);
    expect(s.relationships().length).toBeGreaterThan(0);
  });
});

describe('G-D406 explainability continuity (inherited automatically)', () => {
  it('every derived conclusion preserves entities / graph path / evidence / reasoning / uncertainty', () => {
    const s = openIntelligencePlatform(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 });
    const buying = s.explain().find((e) => e.claim.includes('buying'))!;
    expect(buying.whichEntities.length).toBe(3);        // originating entities
    expect(buying.whichTraversal).toContain('lead:L1'); // graph path
    expect(buying.whichEvidence.length).toBeGreaterThan(0); // evidence chain
    expect(buying.conclusion).toBe('buying_context_formed'); // reasoning trace conclusion
    expect(buying.uncertainty).toBeCloseTo(1 - buying.confidence, 5); // uncertainty
  });
});

describe('G-D404 compatibility — entities/graph untouched; no duplicate model', () => {
  it('opening a session mutates no input understanding', () => {
    const us = linkedUnderstandings();
    const before = us.map((u) => u.graph.edges.length);
    openIntelligencePlatform(us, ASOF, { focusKey: 'lead:L1', depth: 2 }).context();
    expect(us.map((u) => u.graph.edges.length)).toEqual(before); // graph immutable, no write-back
  });
  it('canonical context carries no entity projection (references only)', () => {
    const ctx = openIntelligencePlatform(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 }).context();
    // entities are identity refs only — no facets/score/projection leaked
    expect(Object.keys(ctx.entities[0]).sort()).toEqual(['id', 'key', 'type']);
  });
});

describe('G-D407 operational readiness — flag-gated, deterministic, rollback', () => {
  it('snapshot null when OFF (default), session when ON', () => {
    delete process.env.INTELLIGENCE_PLATFORM_ENABLED;
    expect(isIntelligencePlatformEnabled()).toBe(false);
    expect(openIntelligencePlatformSnapshot(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1' })).toBeNull();
    process.env.INTELLIGENCE_PLATFORM_ENABLED = 'true';
    expect(openIntelligencePlatformSnapshot(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 })?.context().insights.length).toBe(4);
    delete process.env.INTELLIGENCE_PLATFORM_ENABLED;
  });
  it('deterministic canonical context across repeated opens', () => {
    const a = openIntelligencePlatform(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 }).context();
    const b = openIntelligencePlatform(linkedUnderstandings(), ASOF, { focusKey: 'lead:L1', depth: 2 }).context();
    expect(a).toEqual(b);
  });
});
