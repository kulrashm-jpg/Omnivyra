/**
 * V-C305 — Cross-Understanding Validation (pure, structural). Verifies the ownership boundaries hold
 * for a Visitor Understanding: references-only (external entities appear only as graph node references,
 * never re-owned), graph integrity (root is the visitor; no self-loops; edges reference outward), and
 * zero duplicate semantics (visitor facets are the visitor domain — they never re-own lead/company/
 * offering identity). Report only; graph immutability is inherent (read-only).
 */

import type { VisitorUnderstanding } from '../types';
import type { GraphNodeType } from '../../intelligence/canonical';

// Node types owned by OTHER understandings — must appear only as references (edge targets), never as the visitor root.
const EXTERNAL_OWNERS: GraphNodeType[] = ['lead', 'company', 'offering', 'competitor', 'campaign', 'content', 'persona', 'customer', 'partner'];

export interface VisitorCrossUnderstandingReport {
  visitorId: string;
  rootIsVisitor: boolean;
  referencesOnly: boolean;         // every edge originates from the visitor root (nothing re-owned)
  noSelfLoops: boolean;
  ownsNoForeignNode: boolean;      // no edge terminates at another visitor-owned node (visitor owns only its root)
  externalReferenceCount: number;
  duplicateSemantics: boolean;     // visitor identity must not carry a foreign entity's id as owned data
  consistent: boolean;
}

export function validateVisitorCrossUnderstanding(u: VisitorUnderstanding): VisitorCrossUnderstandingReport {
  const rootIsVisitor = u.graph.root.type === 'visitor' && u.graph.root.id === u.key.visitorId;
  const noSelfLoops = u.graph.edges.every((e) => !(e.from.type === e.to.type && e.from.id === e.to.id));
  const referencesOnly = u.graph.edges.every((e) => e.from.type === 'visitor');
  const ownsNoForeignNode = u.graph.edges.every((e) => e.to.type !== 'visitor' || e.to.id === u.key.visitorId);
  const externalReferenceCount = u.graph.edges.filter((e) => EXTERNAL_OWNERS.includes(e.to.type)).length;
  const leadRef = u.facets.identity.value?.leadRef ?? '';
  const duplicateSemantics = leadRef !== '' && leadRef === u.key.visitorId; // visitor identity ≠ the lead it references
  const consistent = rootIsVisitor && noSelfLoops && referencesOnly && ownsNoForeignNode && !duplicateSemantics;
  return { visitorId: u.key.visitorId, rootIsVisitor, referencesOnly, noSelfLoops, ownsNoForeignNode, externalReferenceCount, duplicateSemantics, consistent };
}
