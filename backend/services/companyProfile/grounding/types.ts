/**
 * CPG-001 — Company Profile Grounding: shared contracts.
 *
 * WHAT ALREADY EXISTED (reused, not duplicated)
 * ---------------------------------------------
 *  • `companyProfile/enrichmentProvenance.ts` — `FieldProvenance`
 *    {source, confidence, discoveredAt, lastVerified, verificationStatus,
 *    fieldOrigin}. LIVE, consumed by `pages/api/onboarding/company-provenance.ts`.
 *  • `company_profiles.user_locked_fields` — the existing no-silent-overwrite
 *    mechanism. This layer STRENGTHENS it; it does not replace it.
 *  • `companyIntelligence/providers/contract.ts` — provider results are
 *    `measured` or `unavailable(reason)`; adapters NEVER fabricate.
 *  • `lib/security/safeFetch` — the only permitted egress seam (HARDEN-005).
 *  • `context/freshness.ts` — `computeFreshness`.
 *
 * WHAT WAS MISSING (this module)
 * ------------------------------
 * The existing provenance records WHERE a value came from ('website_crawl'),
 * but not WHICH DOCUMENT, not whether an external source refers to the same
 * company, not whether the user's claim and the public record disagree, and not
 * what to do when they do. A user cannot currently answer "why does Omnivyra
 * believe this about my company?" by following a link, because no link is
 * stored.
 *
 * This module adds the claim-level chain:
 *   user claim → evidence → entity match → authority → corroboration →
 *   freshness → status → confidence → materiality → confirmation → effective value
 *
 * PURITY: every function here is pure and deterministic. No clock (`asOf` is
 * injected), no RNG, no I/O, no database, no network. Persistence and egress
 * belong to the existing seams, not here.
 */

import type { DomainAlias, IdentityClass, IdentityEvidence, IdentitySignal, RegistryIdentity } from './identityTypes';

// CPG-009/010/011 identity contracts live in ./identityTypes; re-exported so importers are unchanged.
export type {
  DomainAlias, DomainAssociation, IdentityClass, IdentityEvidence, IdentitySignal, RegistryIdentity, RegistryRelationship, RegistryScheme,
} from './identityTypes';

/** DT-prompt §6 status vocabulary. Exactly these, no synonyms. */
export type ClaimStatus =
  | 'USER_PROVIDED'      // user asserted it; no external evidence yet
  | 'PUBLICLY_VERIFIED'  // corroborated by >=2 independent sources, or 1 Tier-1
  | 'PUBLICLY_REPORTED'  // supported by external evidence below the verified bar
  | 'CONFLICTING'        // user claim and external evidence materially disagree
  | 'UNVERIFIED'         // asserted but unsupported, or entity match failed
  | 'SYNTHESIZED';       // Omnivyra interpretation — never an external fact

/** §8 — evidentiary class. These must never be displayed as equivalent. */
export type ClaimKind =
  | 'FACT'                // directly supported by an identifiable source
  | 'SOURCE_DERIVED_FACT' // structured representation derived from a source
  | 'SYNTHESIS'           // Omnivyra interpretation
  | 'RECOMMENDATION';     // downstream intelligence conclusion

/** §3 — deterministic source-authority tiers. */
export type SourceTier = 1 | 2 | 3 | 4;

export type SourceType =
  | 'company_website' | 'company_press' | 'regulatory_filing' | 'corporate_registry'
  | 'business_intelligence' | 'editorial' | 'aggregator' | 'user' | 'omnivyra_synthesis';

/**
 * CPG-010 §3 — what kind of document a source publishes (description, not
 * authority). See acquisition/sourceRegistry.ts for the per-kind rules.
 */
export type SourceKind =
  | 'corporate_registry' | 'regulatory_filing' | 'company_owned' | 'financial_database'
  | 'news_media' | 'knowledge_graph' | 'other';

/**
 * CPG-010 — how the resolver attributed ONE claim to a source: computed once,
 * in `resolve()`, and persisted as computed (persistence no longer re-derives
 * it without the established aliases).
 */
export interface SourceAttribution {
  sourceId: string;
  sourceKind: SourceKind;
  tier: SourceTier;
  family: string;
  authority: 'authoritative' | 'weak' | 'unrated' | 'never';
  /** The measure the claim states, when the field has measures (funding, revenue). */
  measure: string | null;
  /**
   * Why the document's host / entity is associated with the company, when that
   * rests on an explicit association (§8): an established alias host (IR link …)
   * or a registry identity's domain association. Null otherwise.
   */
  domainAssociation: { domain: string; reason: string; source: string } | null;
}

/** §5 — how confidently a source was matched to THIS company. */
export type EntityMatchStatus = 'exact' | 'strong' | 'weak' | 'mismatch' | 'unresolved';

/** §7 — freshness of the underlying document. */
export type EvidenceFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';

/** §12 — lifecycle of a user's response to a discrepancy. */
export type ConfirmationStatus =
  | 'NOT_REQUIRED'
  | 'PENDING_USER_CONFIRMATION'
  | 'USER_CONFIRMED_OWN_VALUE'
  | 'USER_ACCEPTED_PUBLIC_VALUE'
  | 'USER_CONFIRMED_CORRECTION'
  | 'PUBLIC_SOURCE_MARKED_STALE'
  | 'USER_SUPPLIED_ALTERNATIVE_SOURCE'
  | 'DEFERRED';

/**
 * One externally discovered claim about a company field.
 *
 * `sourceUrl` is REQUIRED for every non-user, non-synthesis claim. Storing
 * "verified by LinkedIn" without the document is precisely the failure this
 * contract exists to prevent (§11).
 */
export interface EvidenceClaim {
  claimId: string;
  field: string;
  value: string;
  /** Comparison form — case/space/punctuation folded, units normalised. */
  normalizedValue: string;
  sourceType: SourceType;
  sourceName: string;
  /** null ONLY for sourceType 'user' or 'omnivyra_synthesis'. */
  sourceUrl: string | null;
  /** When the document was published, if the source states it. */
  sourcePublishedAt: string | null;
  /** When Omnivyra retrieved it. */
  sourceAccessedAt: string;
  /** Short supporting excerpt. Kept minimal — see retention note in §11. */
  excerpt: string | null;
  verificationMethod: 'crawl' | 'provider_api' | 'user_input' | 'derivation';
  /** Identity signals this source exposed, for entity resolution. */
  entitySignals: EntitySignals;
  /**
   * CPG-007 — present ONLY when the value was extracted from an explicit
   * statement in a retrieved document. Absent for every other source.
   */
  extraction?: ExtractionProvenance;
  /**
   * CPG-007 §19 — how public-web search surfaced the document. Present only for
   * discovered evidence. The rank is recorded for audit and NEVER used as
   * evidence strength.
   */
  discovery?: DiscoveryRef;
}

/** CPG-007 §19 — the search that surfaced a discovered document. */
export interface DiscoveryRef {
  provider: string;
  query: string;
  rank: number;
}

/** CPG-007 — how an extracted value was read, so its meaning survives storage. */
export interface ExtractionProvenance {
  /** The verbatim sentence (or JSON-LD property) that states the value. */
  sourceStatement: string;
  temporalType: 'CURRENT' | 'HISTORICAL' | 'FORECAST' | 'TARGET' | 'UNKNOWN';
  /** Period the STATEMENT establishes ('FY', 'Q4', a round name). Never the page date. */
  period: string | null;
  year: number | null;
  currency: string | null;
  /** True when the source hedged the figure ("approximately", "about", "~"). */
  approximation: boolean;
  moneyKind: string | null;
  method: 'json_ld' | 'explicit_statement';
  acceptedBecause: string;
  /**
   * CPG-008 — the measure the source qualified ('net', 'gross', 'total raised',
   * 'largest round', 'latest round'). Part of comparability: net revenue is not
   * compared with gross revenue, a total is not compared with a single round.
   */
  qualifier?: string | null;
}

/** §5 — stable identifiers usable for entity resolution. */
export interface EntitySignals {
  companyName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  location: string | null;
  leadership: string[];
  registryId: string | null;

  // ── CPG-009 — document side (what the DOCUMENT is and states) ──────────
  /** Host the document was fetched from. Never an identity claim by itself. */
  sourceHost?: string | null;
  /** The publisher's own name (og:site_name). NEVER used as the subject's name. */
  publisher?: string | null;
  /** Deterministic identity statements found in the document. Provenance. */
  identityEvidence?: IdentityEvidence[];

  // ── CPG-009 — known-company side (what we have ESTABLISHED about it) ───
  /** Secondary domains, each with the explicit evidence that associates it. */
  domainAliases?: DomainAlias[];
  /** Former names, each with the evidence establishing the rename. */
  formerNames?: { name: string; evidence: string }[];
  /**
   * CPG-010 — registry identities ESTABLISHED for the company (known side), or
   * the registry identity a registry record itself declares (document side).
   * Each carries the provenance chain that established it.
   */
  registryIdentities?: RegistryIdentity[];
  /** CPG-010 — the legal entity a registry record / filing names (document side). */
  legalEntity?: string | null;
  /**
   * CPG-011 — jurisdictions KNOWN for the company (known side): incorporation,
   * listing, operation — any number, country-qualified ("IN", "US-DE", "GB").
   * They select which registries APPLY; they never trigger a lookup by name.
   */
  jurisdictions?: string[];
}

/** What the user asserted. Never overwritten (§6). */
export interface UserClaim {
  field: string;
  value: string;
  normalizedValue: string;
  assertedAt: string;
  assertedBy: string;
}

export interface EntityMatch {
  status: EntityMatchStatus;
  /** 0..1, deterministic. See `resolveEntity`. */
  score: number;
  /** CPG-009 — the identity class; the verification gate reads THIS, not `status`. */
  identity?: IdentityClass;
  /** CPG-009 — every signal weighed, with its outcome. */
  signals?: IdentitySignal[];
  /** CPG-009 — why the document was (or was not) attributed to the company. */
  reason?: string;
  matchedOn: string[];
  conflictingOn: string[];
}

/** §9 — confidence, with its inputs exposed so the number is inspectable. */
export interface FieldConfidence {
  /** 0..100. */
  score: number;
  band: 'VERIFIED_CANDIDATE' | 'HIGH' | 'NEEDS_REVIEW' | 'UNVERIFIED';
  components: {
    authority: number;
    corroboration: number;
    freshness: number;
    entityMatch: number;
    conflictPenalty: number;
  };
  /** Human-readable statement of what the number means — and does not mean. */
  meaning: string;
}

/** The resolved grounding state for ONE profile field. */
export interface GroundedField {
  companyId: string;
  field: string;
  kind: ClaimKind;
  status: ClaimStatus;
  /** The value the product should use right now. */
  effectiveValue: string | null;
  /** Where the effective value came from. */
  effectiveValueSource: 'user' | 'public_evidence' | 'user_correction' | 'none';
  userClaim: UserClaim | null;
  evidence: EvidenceClaim[];
  /** Evidence that disagrees with the effective value. Never discarded (§7). */
  conflictingEvidence: EvidenceClaim[];
  entityMatch: EntityMatch;
  freshness: EvidenceFreshness;
  confidence: FieldConfidence;
  /** §10 — is this discrepancy worth asking the user about? */
  isMaterialConflict: boolean;
  confirmationStatus: ConfirmationStatus;
  /** §12 — append-only. History is never destroyed. */
  history: GroundingHistoryEntry[];
  firstSeenAt: string;
  lastVerifiedAt: string | null;
  staleAfter: string | null;
  /**
   * CPG-008 — why the field has (or does not have) an effective value. Always
   * set by `resolve()`; optional only so hand-built fixtures stay valid.
   */
  adjudication?: Adjudication;
  /**
   * CPG-009 — each claim's OWN identity assessment, keyed by claimId. Before
   * CPG-009 every stored claim row carried the field's best match instead.
   */
  entityMatches?: Record<string, EntityMatch>;
  /** CPG-010 — each claim's source attribution (id, kind, tier, family, field authority), keyed by claimId. */
  sourceAttribution?: Record<string, SourceAttribution>;
}

// ── CPG-008 evidence-state model ─────────────────────────────────────────────

/**
 * What the product may do with the field:
 *   EFFECTIVE      a value is in use (the user's, or public evidence that met
 *                  the sufficiency rule);
 *   OBSERVED_ONLY  public claims exist but none is sufficiently supported —
 *                  retained for audit, NOT used;
 *   CONFLICTING    comparable claims disagree (user vs public, or public vs
 *                  public with no defensible winner);
 *   UNRESOLVED     nothing usable.
 */
export type EvidenceState = 'EFFECTIVE' | 'OBSERVED_ONLY' | 'CONFLICTING' | 'UNRESOLVED';

export type AdjudicationOutcome =
  | 'USER_VALUE'                  // the user's value is effective (CPG-001 path)
  | 'USER_DECISION'               // a user decision set the effective value
  | 'SUFFICIENT_SINGLE_VALUE'     // one comparable value, sufficiently supported
  | 'WINNER_BY_EVIDENCE'          // values disagree; exactly one is sufficiently supported
  | 'WINNER_BY_AUTHORITY'         // several sufficient; only one has fresh CPG-003-authoritative support
  | 'PUBLIC_CONFLICT_UNRESOLVED'  // values disagree; no defensible winner
  | 'INSUFFICIENT_EVIDENCE'       // observed, below the sufficiency rule
  | 'AMBIGUOUS_MEASURE'           // only differently-qualified measures (e.g. net vs gross) observed
  | 'NO_EVIDENCE'
  | 'NOT_ADJUDICATED';            // synthesis / recommendation

/** One comparable value and the evidence behind it. */
export interface AdjudicationCandidate {
  value: string;
  normalizedValue: string;
  /** Claims in the same class compare; different classes are different facts. */
  comparabilityClass: string;
  claimIds: string[];
  sourceUrls: string[];
  /** Independent CPG-003 provider families, self-contradicting families removed. */
  families: string[];
  bestAuthority: 'authoritative' | 'weak' | 'unrated';
  bestTier: SourceTier;
  freshness: EvidenceFreshness;
  entityMatch: EntityMatchStatus;
  /** The existing CONFIDENCE_FORMULA score for this value alone. NOT a probability. */
  strength: number;
  sufficient: boolean;
  sufficientBecause: string | null;
  role: 'EFFECTIVE' | 'COMPETING' | 'DISSENT' | 'OBSERVED' | 'OTHER_MEASURE';
  /** CPG-009 — strongest identity class among this value's supporting documents. */
  identity?: IdentityClass;
  /** CPG-009 — families whose document DECISIVELY establishes the company's identity. */
  identityFamilies?: string[];
  /**
   * CPG-009 — the value meets the sufficiency rule using ONLY documents with
   * DECISIVE identity: field evidence AND identity, both. Required for
   * PUBLICLY_VERIFIED.
   */
  verified?: boolean;
  verifiedBecause?: string | null;
}

export interface Adjudication {
  evidenceState: EvidenceState;
  outcome: AdjudicationOutcome;
  /** Deterministic, human-readable explanation. */
  reason: string;
  requiresReview: boolean;
  /** The comparability class that decides the field's value. */
  primaryClass: string | null;
  /** Families supporting the effective value (empty when there is none). */
  supportingFamilies: string[];
  /**
   * CPG-009 — of those, families whose documents DECISIVELY establish the
   * company's identity. Identity corroboration, distinct from value
   * corroboration: agreeing on a value never manufactures identity.
   */
  verifiedIdentityFamilies?: string[];
  candidates: AdjudicationCandidate[];
}

export interface GroundingHistoryEntry {
  at: string;
  actor: string;
  action:
    | 'user_asserted' | 'evidence_discovered' | 'conflict_detected'
    | 'user_confirmed_own' | 'user_accepted_public' | 'user_corrected'
    | 'user_marked_source_stale' | 'user_supplied_source' | 'user_deferred'
    // CPG-005 persistence events — already permitted by the DB CHECK on
    // company_grounding_history.action; this union had not been updated.
    | 'value_changed' | 'acquisition_failed';
  fromValue: string | null;
  toValue: string | null;
  note: string;
  /** Evidence ids this transition concerned. */
  evidenceIds: string[];
}

/** What the API/UI needs to ask the user a discrepancy question (§6). */
export interface ConfirmationRequest {
  companyId: string;
  field: string;
  question: string;
  userValue: string | null;
  publicValue: string | null;
  publicSources: { name: string; url: string | null; accessedAt: string; tier: SourceTier }[];
  options: ConfirmationStatus[];
  /** CPG-008 — present when PUBLIC sources disagree with each other. */
  competingValues?: { value: string; sourceUrls: string[]; families: string[] }[];
}
