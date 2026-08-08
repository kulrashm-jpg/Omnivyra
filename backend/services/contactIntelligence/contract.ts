/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 5 — Canonical Contact Contract.
 *
 * The FROZEN, stable contract every future contact-aware domain (Lead / Journey / Intent /
 * Qualification / CRM / Outreach) MUST consume rather than redefine, re-project, re-score, re-persist
 * or re-derive. It names the contact facet surface, the descriptive score dimensions, the
 * references-only graph publication, the projection, and the platform surface; declares the governance
 * rules and migration prohibitions; and validates that a produced understanding conforms.
 *
 * It introduces NO new intelligence — a contract descriptor plus a conformance validator only.
 *
 * ─── THE IDENTITY RULES ARE PART OF THE CONTRACT ───────────────────────────────────────────────────
 * The WS-5E decision is encoded here as governance, not left in a document: `unified_persons` is the
 * sole Canonical Person, `contacts` is the Canonical Platform Person, `engagement_authors` is a
 * projection, and platform-person identity is TENANT-SCOPED. A consumer that reads this contract
 * cannot accidentally build a global contact identity, because the key it is handed carries a tenant.
 */

import type { ContactUnderstanding } from './types';
import { CONTACT_FACET_NAMES, CONTACT_SCORE_DIMENSIONS } from './types';
import { CONTACT_MODEL_VERSION } from './builder';

export const CONTACT_CONTRACT_VERSION = 1;

/** Edge types Contact publishes — references-only, from the contact root. No reasoning edges. */
export const CONTACT_PUBLISHED_EDGE_TYPES = ['contact_of', 'works_at'] as const;

/** The FROZEN canonical Contact contract. Downstream programs consume this; they never redefine it. */
export const CONTACT_CANONICAL_CONTRACT = Object.freeze({
  contractVersion: CONTACT_CONTRACT_VERSION,
  modelVersion: CONTACT_MODEL_VERSION,
  entity: 'contact' as const,
  graphRootType: 'contact' as const,
  identityKeyFields: Object.freeze(['companyId', 'contactId'] as const),
  tenantScoped: true as const,
  canonicalPerson: 'unified_persons' as const,
  canonicalPlatformPerson: 'contacts' as const,
  facets: Object.freeze([...CONTACT_FACET_NAMES]),
  scoreDimensions: Object.freeze([...CONTACT_SCORE_DIMENSIONS]),
  publishedEdgeTypes: Object.freeze([...CONTACT_PUBLISHED_EDGE_TYPES]),
  projectionFields: Object.freeze([
    'key', 'version', 'identity', 'profile', 'unifiedPersonId', 'reachable', 'channels',
    'scores', 'overallScore', 'confidence', 'facetConfidence', 'topContradictions', 'projectedAt',
  ]),
  interpretationSource: 'observed_evidence' as const,   // descriptive over observed evidence — never a forecast
  orderingSource: 'evidence_chronology' as const,       // chronology from EvidenceRef.observedAt
  platformSurface: Object.freeze(['graph', 'reasoning', 'contradictions', 'builtAt']),
  sharedPrimitives: Object.freeze([
    'Facet', 'EvidenceRef', 'ReasoningTrace', 'detectEvidenceContradictions', 'combineScoresFor', 'facetConfidenceFromEvidence',
  ]),
});

/** Governance rules future architectural reviews MUST enforce for any contact-aware module. */
export const CONTACT_GOVERNANCE_RULES = Object.freeze([
  'unified_persons is the sole Canonical Person — Contact never owns person identity, only references it',
  'contacts is the Canonical Platform Person; engagement_authors is a projection, never an authority',
  'Platform-person identity is TENANT-SCOPED — the key is { companyId, contactId } and the tenant is part of the identity, not a filter',
  'Contact Understanding is the sole canonical owner of platform-person semantics',
  'Description is over observed evidence — never a prediction or a propensity',
  'Graph publication is references-only (contact owns only its own root node); NO reasoning edges',
  'Reuse the shared EvidenceRef / Facet / ReasoningTrace / detectEvidenceContradictions primitives',
  'Reuse the shared scoring (combineScoresFor; no new scoring or inference framework)',
  'Abstain when evidence is absent — a score dimension reports null, never 0',
  'Provenance is per-observation; a fact is attributed to the system that observed it',
  'Consume the frozen Contact contract via the production facade (no downstream customization)',
]);

/** Migration prohibitions for future contact-aware modules. */
export const CONTACT_MIGRATION_PROHIBITIONS = Object.freeze([
  'duplicate contact model',
  'duplicate platform-person identity store',
  'duplicate contact projection',
  'duplicate contact scoring',
  'duplicate contact persistence',
  'duplicate contact evidence assembly',
  'parallel contact graph / reasoning-edge model',
  'global (non-tenant-scoped) contact identity',
]);

export interface ContactContractConformance { conforms: boolean; issues: string[]; }

/** Verify a produced Contact Understanding conforms to the frozen canonical contract. */
export function validateContactContract(u: ContactUnderstanding): ContactContractConformance {
  const issues: string[] = [];

  if (u.version !== CONTACT_CANONICAL_CONTRACT.modelVersion) {
    issues.push(`model version ${u.version} ≠ ${CONTACT_CANONICAL_CONTRACT.modelVersion}`);
  }
  for (const f of CONTACT_CANONICAL_CONTRACT.facets) if (!(f in u.facets)) issues.push(`missing facet: ${f}`);
  for (const d of CONTACT_CANONICAL_CONTRACT.scoreDimensions) if (!(d in u.score.dimensions)) issues.push(`missing score dimension: ${d}`);

  // Tenancy is a conformance property, not a convention — a contact without a tenant is not a contact.
  for (const k of CONTACT_CANONICAL_CONTRACT.identityKeyFields) {
    if (!(k in u.key) || !String((u.key as unknown as Record<string, unknown>)[k] ?? '').trim()) issues.push(`identity key missing ${k}`);
  }

  if (u.graph.root.type !== CONTACT_CANONICAL_CONTRACT.graphRootType) issues.push(`graph root ${u.graph.root.type} ≠ contact`);
  if (!u.graph.edges.every((e) => e.from.type === 'contact')) issues.push('graph publication not references-only (an edge does not originate from contact)');
  const allowed = new Set<string>(CONTACT_CANONICAL_CONTRACT.publishedEdgeTypes);
  for (const e of u.graph.edges) if (!allowed.has(e.type)) issues.push(`unpublished edge type: ${e.type} (understanding must not leak into the graph — no reasoning edges)`);

  return { conforms: issues.length === 0, issues };
}
