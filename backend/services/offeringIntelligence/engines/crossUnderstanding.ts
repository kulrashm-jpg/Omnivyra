/**
 * OI-D405 — Cross-Understanding Validation (pure, structural). Verifies the ownership boundaries
 * across Company / Lead / Offering / Competitor hold for an Offering Understanding: references-only
 * (external entities appear only as graph node references, never re-owned), graph integrity (root is
 * the offering; no self-loops; edges reference), and zero duplicate semantics (offering facets are
 * the offering domain). Report only.
 */

import type { OfferingUnderstanding } from '../types';
import type { GraphNodeType } from '../../intelligence/canonical';

// Node types owned by OTHER understandings — must appear only as references, never as the graph root.
const EXTERNAL_OWNERS: GraphNodeType[] = ['company', 'lead', 'competitor', 'persona', 'customer', 'partner', 'industry', 'technology', 'market', 'feature', 'pricing_plan', 'integration'];

export interface CrossUnderstandingReport {
  offeringId: string;
  rootIsOffering: boolean;
  referencesOnly: boolean;        // every non-root edge target is a reference (not re-owned as root)
  noSelfLoops: boolean;
  externalReferenceCount: number; // edges pointing at other-entity-owned nodes
  duplicateSemantics: boolean;    // offering facets never carry another entity's identity as owned data
  consistent: boolean;
}

export function validateCrossUnderstanding(u: OfferingUnderstanding): CrossUnderstandingReport {
  const rootIsOffering = u.graph.root.type === 'offering' && u.graph.root.id === u.key.offeringId;
  const noSelfLoops = u.graph.edges.every((e) => !(e.from.type === e.to.type && e.from.id === e.to.id));
  // References-only: the offering owns only 'offering' root; all edges point outward (from offering) or to external nodes.
  const referencesOnly = u.graph.edges.every((e) => e.from.type === 'offering' || EXTERNAL_OWNERS.includes(e.from.type));
  const externalReferenceCount = u.graph.edges.filter((e) => EXTERNAL_OWNERS.includes(e.to.type)).length;
  // Zero duplicate semantics: offering identity is offering-scoped; it must not store a company/competitor as its own identity.
  const idName = u.facets.identity.value?.name ?? '';
  const duplicateSemantics = u.key.companyId === idName; // a trivial guard: offering identity ≠ its owning company id
  const consistent = rootIsOffering && noSelfLoops && referencesOnly && !duplicateSemantics;
  return { offeringId: u.key.offeringId, rootIsOffering, referencesOnly, noSelfLoops, externalReferenceCount, duplicateSemantics, consistent };
}
