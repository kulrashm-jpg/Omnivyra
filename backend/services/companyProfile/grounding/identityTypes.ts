/**
 * CPG-009 / CPG-010 / CPG-011 — Company Profile Grounding: the identity contracts.
 *
 * Split out of types.ts (CPG-016) along its own section boundaries: WHO the
 * company is — registry identity (country-neutral schemes, relationships, domain
 * associations) and the identity model (identity classes, signals, evidence,
 * domain aliases). Self-contained: nothing here refers to a claim, source or
 * adjudication type. Moved verbatim; types.ts re-exports every type here, so
 * every existing import is unchanged.
 *
 * Types only: no runtime code.
 */

// ── CPG-010 / CPG-011 registry identity (country-neutral) ────────────────────

/**
 * CPG-011 — a scheme is an OPEN code a provider module declares ("CIK",
 * "SIREN", "LEI", …; registry/schemes.ts). The core never enumerates schemes.
 * Normalised identifiers are scheme-qualified: "SIREN:395030844".
 */
export type RegistryScheme = string;

/** An explicit relationship a registry states between two legal entities (§16, §18). Never inferred from names. */
export interface RegistryRelationship {
  /** The related entity's normalised identifier. */
  registryId: string;
  relation: 'direct_parent' | 'ultimate_parent' | 'direct_child';
  legalName: string | null;
  sourceUrl: string;
  detail: string;
}

export interface RegistryIdentity {
  scheme: RegistryScheme;
  /** Normalised, scheme-qualified: "CIK:0001477333", "SIREN:395030844". */
  registryId: string;
  /** Provider id from the provider registry ("sec_edgar", "fr_sirene", "gleif", …) — an open string. */
  provider: string;
  /** Legal name as the REGISTRY (or filing) states it; null when not read. */
  legalName: string | null;
  /** Former legal names, as the registry states them. */
  formerNames?: { name: string; from: string | null; to: string | null }[];
  /**
   * CPG-011 — COUNTRY-QUALIFIED jurisdiction of the legal entity ("US-DE",
   * "FR", "IN"). A bare subdivision is never stored (Delaware ≠ Germany).
   */
  jurisdiction?: string | null;
  /** Only as the registry states it; null when it states none. */
  status?: 'active' | 'inactive' | string | null;
  /**
   * How the identifier came to be associated with the company. Never by name.
   *   first_party_statement    the company's own page states it (registry link,
   *                            "RCS … 395 030 844", "CIN: …");
   *   listing_mapping          a first-party listing statement mapped through the
   *                            registry's OWN listing table (CPG-010 "ticker_mapping");
   *   registry_cross_reference another registry's record names it for the SAME
   *                            legal entity (GLEIF registeredAs);
   *   user_provided            the account owner supplied it.
   */
  establishedBy: 'first_party_statement' | 'listing_mapping' | 'registry_cross_reference' | 'user_provided';
  /**
   * CPG-011 — which legal entity this is FOR THE COMPANY. Only `subject`
   * identities decide the company's identity (DECISIVE / MISMATCH):
   *   subject          the company itself;
   *   site_publisher   the legal entity a first-party legal notice names as the
   *                    site's publisher, NOT shown to be the company (live:
   *                    sanofi.com is published by Sanofi Winthrop Industrie,
   *                    not by Sanofi);
   *   related_entity   a parent / subsidiary by an EXPLICIT registry relationship.
   * Absent = subject (CPG-010 rows).
   */
  role?: 'subject' | 'site_publisher' | 'related_entity';
  /** The chain of evidence, each step with its source URL. */
  chain: { step: string; sourceUrl: string | null; detail: string }[];
  /** True only when the registry's own record was read and matched. */
  registryVerified: boolean;
  /** Domains the registry record or the entity's own filing ties to it (§8). */
  domainAssociations: DomainAssociation[];
  /** CPG-011 — explicit relationships the registry states (parents). */
  relationships?: RegistryRelationship[];
}

/** A domain tied to a legal entity by explicit evidence (§8). Never by hosting platform. */
export interface DomainAssociation {
  legalEntity: string;
  registryId: string;
  domain: string;
  associationReason: 'registry_record' | 'official_filing_statement' | 'first_party_statement';
  associationSource: string;
  detail: string;
}

// ── CPG-009 identity model ───────────────────────────────────────────────────

/**
 * How strongly a document is shown to be about THIS company.
 *   DECISIVE    a near-unique identifier matches (canonical/established domain,
 *               registry id, LinkedIn company id, the document's own statement
 *               of the company's website) and none is contradicted;
 *   SUPPORTING  the name plus a non-trivial supporting signal (leadership, a
 *               link to the company's domain) — still NOT proof;
 *   WEAK        the name (± location) only;
 *   MISMATCH    a decisive identifier is contradicted, or nothing matches;
 *   UNKNOWN     nothing comparable.
 * This is strength of IDENTITY evidence — never a probability, and never the
 * strength of the field's value.
 */
export type IdentityClass = 'DECISIVE' | 'SUPPORTING' | 'WEAK' | 'MISMATCH' | 'UNKNOWN';

/** One identity signal the resolver weighed, and what it found. */
export interface IdentitySignal {
  signal:
    | 'domain' | 'domain_alias' | 'first_party_host' | 'domain_statement' | 'registry_id' | 'linkedin'
    | 'leadership' | 'location' | 'name' | 'former_name' | 'domain_link' | 'relationship'
    // CPG-010: a registry record's legal name — WEAK, like any name.
    | 'legal_name';
  strength: 'DECISIVE' | 'SUPPORTING' | 'WEAK';
  outcome: 'match' | 'conflict' | 'note';
  detail: string;
}

/** A deterministic identity statement found IN a document (immutable provenance). */
export interface IdentityEvidence {
  kind:
    | 'json_ld_org_url'             // JSON-LD Organization (the subject) declares url/sameAs
    | 'labelled_website'            // a "Website:" field whose first link is this domain
    | 'structured_official_website' // a structured source (Wikidata P856) states the website
    | 'registry_id' | 'linkedin_company' | 'domain_link'
    | 'relationship'                // "X is a brand/subsidiary of Y", "Y, which owns X"
    | 'location_statement' | 'former_name_statement';
  /** host / identifier / "brand_of:Name" / location. */
  value: string;
  /** Short verbatim context, so the decision is auditable. */
  detail: string;
}

/** A secondary domain and the explicit evidence tying it to the company (§4). */
export interface DomainAlias {
  domain: string;
  evidence: 'first_party_same_brand_link' | 'first_party_ir_link' | 'first_party_json_ld_sameAs' | 'redirect_from_canonical'
    // CPG-010: the legal entity's own regulatory filing states the domain.
    | 'official_filing_statement';
  sourceUrl: string;
  detail: string;
}
