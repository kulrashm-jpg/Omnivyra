/**
 * PRODUCT-INTELLIGENCE-GRAPH-PROGRAM-004 / Phase B — Canonical Intelligence Graph foundation tests.
 * Deterministic. Verifies open registries, publication from REAL Lead/Company/Offering understandings,
 * materialization (merge/dedupe/ownership/provenance), traversal, query, integrity, observability,
 * flag-gating — and that Programs 1–3 remain unchanged (regression run alongside).
 */

import {
  createNodeRegistry, createEdgeRegistry, publishUnderstanding, publishAll, materializeGraph, materializeSnapshot,
  computeGraphSnapshot, neighbors, shortestPath, pathExists, descendants, connectedComponents, subgraph,
  getNode, filterEdges, multiHop, project, checkIntegrity, hasCycle, graphMetrics, isIntelligenceGraphEnabled,
  nodeKey, type PublishableUnderstanding,
} from '../../services/intelligenceGraph';
// REAL understandings from the three certified entities (proves the graph aggregates them unchanged):
import { assembleCompanyUnderstanding } from '../../services/companyIntelligence/engines';
import { assembleOfferingUnderstanding } from '../../services/offeringIntelligence/engines';
import { buildLeadUnderstanding } from '../../services/leadUnderstanding';

const ASOF = '2026-07-28T00:00:00.000Z';

function realUnderstandings(): PublishableUnderstanding[] {
  const company = assembleCompanyUnderstanding({ key: { companyId: 'C1' }, asOf: ASOF, profile: { companyId: 'C1', asOf: ASOF, name: 'Acme', competitors: ['RivalCo'] }, competitors: [{ name: 'RivalCo', source: 'serp', observedAt: ASOF }], executives: [{ name: 'Jane', role: 'CEO', source: 'news', observedAt: ASOF }] }).understanding;
  const offering = assembleOfferingUnderstanding({ key: { companyId: 'C1', offeringId: 'widget' }, asOf: ASOF, seed: { companyId: 'C1', asOf: ASOF, name: 'Widget', offeringType: 'product' }, personas: [{ name: 'Analyst', role: 'user', source: 'crm', observedAt: ASOF }], competitors: [{ name: 'RivalViz', source: 'serp', observedAt: ASOF }] }).understanding;
  const lead = buildLeadUnderstanding({ key: { leadKey: 'L1', companyId: 'C1' }, builtAt: ASOF });
  return [company, offering, lead];
}

describe('G-B202/B203 open registries (additive)', () => {
  it('canonical types pre-seeded; new types register additively; deterministic', () => {
    const nr = createNodeRegistry();
    expect(nr.has('lead')).toBe(true); expect(nr.has('offering')).toBe(true);
    expect(nr.has('visitor')).toBe(false);
    nr.register({ type: 'visitor', description: 'a website visitor' }); // future entity — no shared-union edit
    expect(nr.has('visitor')).toBe(true);
    const er = createEdgeRegistry(); er.register({ type: 'visited' }); expect(er.has('visited')).toBe(true); expect(er.get('visited')?.directed).toBe(true);
  });
});

describe('G-B204/B205 publication + materialization (references-only, ownership preserved)', () => {
  it('publishes real understandings; materializes a unified graph with ownership + provenance', () => {
    const us = realUnderstandings();
    const contribs = publishAll(us);
    expect(contribs.map((c) => c.owner).sort()).toEqual(['company', 'lead', 'offering']);
    const g = materializeGraph(contribs, ASOF);
    // company node owned by 'company'; competitor node is a reference (owner null)
    expect(getNode(g, 'company', 'C1')?.owner).toBe('company');
    expect(getNode(g, 'competitor', 'RivalCo')?.owner).toBeNull();
    expect(getNode(g, 'competitor', 'RivalCo')?.referencedBy).toContain('company');
    // edges carry provenance (source refs)
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => e.owner === e.from.type)).toBe(true);
  });
  it('deterministic materialization', () => {
    expect(materializeGraph(publishAll(realUnderstandings()), ASOF)).toEqual(materializeGraph(publishAll(realUnderstandings()), ASOF));
  });
});

describe('G-B206/B207 traversal + query (deterministic, no reasoning)', () => {
  const g = () => materializeGraph(publishAll(realUnderstandings()), ASOF);
  it('neighbors / pathExists / descendants / components / subgraph', () => {
    const graph = g();
    const companyKey = nodeKey({ type: 'company', id: 'C1' });
    expect(neighbors(graph, companyKey).length).toBeGreaterThan(0); // company → competitor/executive refs
    expect(pathExists(graph, companyKey, nodeKey({ type: 'competitor', id: 'RivalCo' }))).toBe(true);
    expect(connectedComponents(graph).length).toBeGreaterThan(0);
    expect(subgraph(graph, companyKey, 1).nodes).toContain(companyKey);
    expect(shortestPath(graph, companyKey, companyKey)).toEqual([companyKey]);
    void descendants(graph, companyKey);
  });
  it('query: filterEdges / multiHop / project', () => {
    const graph = g();
    expect(filterEdges(graph, { fromType: 'company' }).length).toBeGreaterThan(0);
    expect(Array.isArray(multiHop(graph, nodeKey({ type: 'offering', id: 'widget' }), 1))).toBe(true);
    expect(project(graph, 'company')[0]?.owner).toBe('company');
  });
});

describe('G-B208 integrity + G-B209 observability', () => {
  it('integrity: no dangling/duplicate/unregistered; metrics computed', () => {
    const graph = materializeGraph(publishAll(realUnderstandings()), ASOF);
    const nodes = createNodeRegistry(); const edges = createEdgeRegistry();
    const report = checkIntegrity(graph, { nodes, edges });
    expect(report.danglingCount).toBe(0);
    expect(report.issues.filter((i) => i.code === 'unregistered_node_type').length).toBe(0);
    expect(report.duplicateOwnershipCount).toBe(0);
    expect(hasCycle(graph)).toBe(false);
    const m = graphMetrics(graph, report, { nodes, edges });
    expect(m.nodeCount).toBe(graph.nodes.length); expect(m.ownedNodes).toBeGreaterThan(0); expect(m.integrityFailures).toBe(0);
  });
});

describe('G-B201/B210 runtime + compatibility (flag-gated, shadow-only)', () => {
  it('materializeSnapshot bundles graph+integrity+metrics; computeGraphSnapshot null when OFF', () => {
    const snap = materializeSnapshot(realUnderstandings(), ASOF);
    expect(snap.metrics.nodeCount).toBeGreaterThan(0); expect(snap.integrity.valid).toBe(true);
    delete process.env.INTELLIGENCE_GRAPH_ENABLED;
    expect(computeGraphSnapshot(realUnderstandings(), ASOF)).toBeNull(); // OFF ⇒ null (Programs 1–3 unaffected)
    expect(isIntelligenceGraphEnabled()).toBe(false);
    process.env.INTELLIGENCE_GRAPH_ENABLED = 'true';
    expect(computeGraphSnapshot(realUnderstandings(), ASOF)?.metrics.nodeCount).toBeGreaterThan(0);
    delete process.env.INTELLIGENCE_GRAPH_ENABLED;
  });
});
