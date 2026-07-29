/**
 * LI-C204 — Relationship Intelligence (deterministic contributor).
 * Builds graph edges (reports_to / influences / member_of) among people + the company node and a
 * relationship facet (stakeholders / buying committee). REFERENCES the Company graph node — never
 * duplicates organization topology (edges point at company/person ids owned elsewhere). Abstains
 * when no relationships.
 */

import type { EngineOutput, LeadIntelligenceContext, RawRelationship } from './engineTypes';
import { emptyOutput, mkEvidence, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { node, edge } from '../graph';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, GraphEdge, RelationshipValue } from '../types';

const ENGINE = 'relationship';

export function runRelationship(ctx: LeadIntelligenceContext): EngineOutput {
  const rels = ctx.relationships ?? [];
  if (!rels.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;

  const leadNode = node('lead', ctx.key.leadKey);
  const evidence: EvidenceRef[] = [];
  const edges: GraphEdge[] = [];

  for (const r of rels) {
    const ev = mkEvidence(ENGINE, { label: `relationship:${r.role ?? 'unknown'}`, value: r.personId, source: r.source, observedAt: r.observedAt, kind: 'structured' });
    evidence.push(ev);
    const person = node('team', r.personId);
    // influence/committee edge from the lead to the stakeholder (references only — no org topology copy)
    edges.push(edge({ type: r.role === 'blocker' ? 'influences' : 'engaged_with', from: leadNode, to: person, evidence: [ev], confidence: 0.6, asOf: r.observedAt }));
    if (r.reportsTo) edges.push(edge({ type: 'reports_to', from: person, to: node('team', r.reportsTo), evidence: [ev], confidence: 0.6, asOf: r.observedAt }));
  }
  // Reference the Company node (ownership stays with Company Understanding).
  if (ctx.companyId) edges.push(edge({ type: 'member_of', from: leadNode, to: node('company', ctx.companyId), evidence: evidence.slice(0, 1), confidence: 0.7, asOf: ctx.asOf }));
  out.edges = edges;
  out.evidence = evidence;

  const committee = rels.filter((r: RawRelationship) => r.role && r.role !== 'user').map((r) => `${r.personId}:${r.role}`);
  const relVal: RelationshipValue = { stakeholders: rels.map((r) => r.personId), buyingCommittee: committee };
  out.facets.relationship = facet(relVal, evidence);
  const coverage = clamp01(new Set(rels.map((r) => r.role)).size / 5); // committee breadth proxy
  out.reasoning.push(reasoningTrace({ claim: 'buying_committee_coverage', conclusion: coverage, because: evidence, confidence: clamp01(0.4 + 0.3 * coverage), method: 'deterministic', assumptions: ['edges reference company/person ids owned upstream'], unknowns: coverage < 1 ? ['committee incomplete'] : [] }));
  return out;
}
