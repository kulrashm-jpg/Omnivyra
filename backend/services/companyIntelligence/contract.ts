/**
 * COMPANY-INTELLIGENCE-PROGRAM-002 / Phase 2 — Canonical Company Contract.
 *
 * The FROZEN, stable contract every company-aware domain MUST consume rather than redefine,
 * re-project, re-score, re-persist or re-derive. It names the company facet surface, the score
 * dimensions, the references-only graph publication, the projection and the platform surface;
 * declares governance rules and migration prohibitions; and validates that a produced understanding
 * conforms.
 *
 * It introduces NO new intelligence — a contract descriptor plus a conformance validator only.
 *
 * ─── THE SOURCE-TRUST INVARIANT IS PART OF THE CONTRACT ────────────────────────────────────────────
 * WS-4F established that an enrichment vendor emitting evidence under a system name absent from
 * `COMPANY_SOURCE_WEIGHTS` is silently fused at the 0.5 fallback, discarding the per-vendor
 * calibration the adapters document. That failure was invisible: nothing threw and nothing warned.
 * It is recorded here as a governance rule so it is reviewed rather than rediscovered, and it is
 * machine-checked in `validateProviderCompatibility`.
 */

import type { CompanyUnderstanding } from './types';
import { COMPANY_FACET_NAMES, COMPANY_SCORE_DIMENSIONS } from './types';
import { COMPANY_MODEL_VERSION } from './builder';

export const COMPANY_CONTRACT_VERSION = 1;

/** Edge types Company publishes — references-only, from the company root. No reasoning edges. */
export const COMPANY_PUBLISHED_EDGE_TYPES = [
  'belongs_to', 'competes_with', 'engaged_with', 'references', 'member_of',
] as const;

/** The FROZEN canonical Company contract. Downstream programs consume this; they never redefine it. */
export const COMPANY_CANONICAL_CONTRACT = Object.freeze({
  contractVersion: COMPANY_CONTRACT_VERSION,
  modelVersion: COMPANY_MODEL_VERSION,
  entity: 'company' as const,
  graphRootType: 'company' as const,
  identityKeyFields: Object.freeze(['companyId'] as const),
  tenantScoped: true as const,
  facets: Object.freeze([...COMPANY_FACET_NAMES]),
  scoreDimensions: Object.freeze([...COMPANY_SCORE_DIMENSIONS]),
  publishedEdgeTypes: Object.freeze([...COMPANY_PUBLISHED_EDGE_TYPES]),
  projectionFields: Object.freeze([
    'key', 'version', 'worldView', 'identity', 'scores', 'overallScore',
    'confidence', 'facetConfidence', 'topContradictions', 'projectedAt',
  ]),
  interpretationSource: 'observed_evidence' as const,
  orderingSource: 'evidence_chronology' as const,
  platformSurface: Object.freeze(['graph', 'reasoning', 'contradictions', 'builtAt']),
  sharedPrimitives: Object.freeze([
    'Facet', 'EvidenceRef', 'ReasoningTrace', 'fuseEvidence', 'detectEvidenceContradictions', 'combineScoresFor',
  ]),
});

/** Governance rules future architectural reviews MUST enforce for any company-aware module. */
export const COMPANY_GOVERNANCE_RULES = Object.freeze([
  'Company Understanding is the sole canonical owner of company semantics',
  'Identity originates from EVIDENCE — never from a keyword classifier echoing a stored field',
  'Every enrichment provider must be NAMED in COMPANY_SOURCE_WEIGHTS; an unnamed system is fused at the 0.5 fallback and its calibration is silently discarded (WS-4F)',
  'Provider registration is CALLER-DRIVEN — a module import must never make external egress reachable',
  'An unconfigured provider is never called; no_credential is an operator task, not a request',
  'Providers never fabricate: absent credentials, absent coverage and failure are all `unavailable` with distinguishable reasons',
  'Graph publication is references-only (company owns only its own root node); NO reasoning edges',
  'Reuse the shared Facet / EvidenceRef / ReasoningTrace / fuseEvidence / detectEvidenceContradictions primitives',
  'Reuse the shared scoring (combineScoresFor; no new scoring framework)',
  'Abstain when evidence is absent — a facet abstains rather than fabricating a value',
  'Consume the frozen Company contract via the production facade (no downstream customization)',
]);

/** Migration prohibitions for future company-aware modules. */
export const COMPANY_MIGRATION_PROHIBITIONS = Object.freeze([
  'duplicate company model',
  'duplicate company projection',
  'duplicate company scoring',
  'duplicate company persistence',
  'duplicate enrichment provider contract',
  'duplicate source-trust policy',
  'parallel company graph / reasoning-edge model',
  'import-time provider registration',
]);

export interface CompanyContractConformance { conforms: boolean; issues: string[]; }

/** Verify a produced Company Understanding conforms to the frozen canonical contract. */
export function validateCompanyContract(u: CompanyUnderstanding): CompanyContractConformance {
  const issues: string[] = [];

  if (u.version !== COMPANY_CANONICAL_CONTRACT.modelVersion) {
    issues.push(`model version ${u.version} ≠ ${COMPANY_CANONICAL_CONTRACT.modelVersion}`);
  }
  for (const f of COMPANY_CANONICAL_CONTRACT.facets) if (!(f in u.facets)) issues.push(`missing facet: ${f}`);
  for (const d of COMPANY_CANONICAL_CONTRACT.scoreDimensions) if (!(d in u.score.dimensions)) issues.push(`missing score dimension: ${d}`);

  for (const k of COMPANY_CANONICAL_CONTRACT.identityKeyFields) {
    if (!(k in u.key) || !String((u.key as unknown as Record<string, unknown>)[k] ?? '').trim()) issues.push(`identity key missing ${k}`);
  }

  if (u.graph.root.type !== COMPANY_CANONICAL_CONTRACT.graphRootType) issues.push(`graph root ${u.graph.root.type} ≠ company`);
  if (!u.graph.edges.every((e) => e.from.type === 'company')) issues.push('graph publication not references-only (an edge does not originate from company)');

  return { conforms: issues.length === 0, issues };
}
