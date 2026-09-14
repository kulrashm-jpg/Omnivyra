/**
 * CPG-011 §3/§6 — the country-neutral REGISTRY PROVIDER contract.
 *
 * SEC EDGAR, MCA, the French Sirene registry and GLEIF are implementations of
 * this one contract (registry/providers/*). The core — establishment,
 * selection, entity resolution, persistence, API — consumes the contract and
 * never branches on which provider it is holding.
 *
 * WHAT A PROVIDER MAY DO (lookup modes) — never "search by company name":
 *   by_identifier            read the registry's own record for an identifier
 *                            in one of its schemes;
 *   by_first_party_reference turn a reference the COMPANY states on its own
 *                            pages (a registry link, a listing statement) into
 *                            a candidate identifier;
 *   by_cross_reference       from another registry's record, find the record
 *                            for THE SAME legal entity via an explicit
 *                            identifier cross-reference (GLEIF registeredAs).
 *
 * CAPABILITIES are declared, not assumed. A registry that establishes WHO an
 * entity is does not thereby establish HOW MUCH it earns: field authority
 * stays in acquisition/sourceRegistry.ts, per field.
 */

import type { DomainAlias, DomainAssociation, RegistryRelationship } from '../types';
import type { EvidenceFetcher } from '../acquisition/evidenceSource';
import type { IdentifierScheme } from './schemes';

export type ProviderCapability =
  | 'CAN_RESOLVE_IDENTIFIER'      // read the record for an identifier
  | 'CAN_VERIFY_LEGAL_NAME'       // the record states the legal name
  | 'CAN_VERIFY_DOMAIN'           // the record / the entity's filing states its website
  | 'CAN_VERIFY_STATUS'           // the record states active / ceased
  | 'CAN_VERIFY_JURISDICTION'     // the record states the jurisdiction
  | 'CAN_PROVIDE_FILINGS'         // filings are reachable from the record
  | 'CAN_PROVIDE_FINANCIAL_DATA'  // financial values are read (none implemented)
  | 'CAN_CROSS_REFERENCE'         // explicit same-entity links to other schemes
  | 'CAN_PROVIDE_RELATIONSHIPS';  // explicit parent / child records

export type LookupMode = 'by_identifier' | 'by_first_party_reference' | 'by_cross_reference';

/**
 * LIVE            reachable now, keyless, lawful;
 * INACCESSIBLE    exists, but access is blocked (HTTP 403 / CAPTCHA) — not bypassed;
 * CREDENTIAL_REQUIRED  needs a key this environment does not use;
 * NOT_IMPLEMENTED contract declared, no adapter.
 */
export type ProviderAvailability = 'LIVE' | 'INACCESSIBLE' | 'CREDENTIAL_REQUIRED' | 'NOT_IMPLEMENTED';

/** One legal entity as a registry's OWN record states it. Fields the registry does not state are absent. */
export interface RegistryRecord {
  providerId: string;
  scheme: string;
  /** Normalised, scheme-qualified. */
  registryId: string;
  legalName: string;
  formerNames?: { name: string; from: string | null; to: string | null }[];
  /** Country-qualified jurisdiction code ("US-DE", "FR"). */
  jurisdiction: string | null;
  /** Only when the registry states it explicitly. */
  status?: 'active' | 'inactive' | null;
  /** Registered / principal address, as the registry states it ("Paris, France"). */
  headquarters?: string | null;
  /** Explicit same-entity identifiers in OTHER schemes (never inferred). */
  crossReferences?: { registryId: string; sourceUrl: string; detail: string }[];
  /** Explicit parent / child records (never inferred from names). */
  relationships?: RegistryRelationship[];
  sourceUrl: string;
  retrievedAt: string;
  providerFamily: string;
  /** Provider-specific data — NEVER read by the core. */
  metadata?: Record<string, unknown>;
}

/**
 * CPG-012 §10 — every way a provider can fail, kept DISTINCT: the operator
 * remedy differs (wait / get a key / fix a parser / nothing), and none of them
 * is evidence of anything about the company.
 */
export type ProviderFailureKind =
  | 'inaccessible'        // access blocked (403 / CAPTCHA / connection refused by policy) — not bypassed
  | 'auth_required'       // the registry needs a credential this environment does not use (401)
  | 'rate_limited'        // 429
  | 'retrieval_failed'    // transient: timeout, 5xx, connection reset
  | 'malformed_response'  // answered, but not in the expected shape
  | 'not_found'           // answered: no such identifier / empty record
  | 'ambiguous'           // answered with more than one candidate for one identifier
  | 'invalid_identifier'  // the identifier fails the scheme (never "corrected")
  | 'unsupported'         // the provider cannot do this operation
  | 'provider_error';     // the provider itself threw — isolated by the core
export interface ProviderFailure { failure: ProviderFailureKind; detail: string }

/** Map an HTTP outcome to a failure kind — generic HTTP semantics, not a provider rule. */
export function failureFromStatus(status: number | null | undefined, detail: string): ProviderFailure {
  const f: ProviderFailureKind = !status ? 'retrieval_failed'
    : status === 401 ? 'auth_required'
    : status === 403 ? 'inaccessible'
    : status === 404 ? 'not_found'
    : status === 429 ? 'rate_limited'
    : status >= 500 ? 'retrieval_failed'
    : 'malformed_response';
  return { failure: f, detail: `${detail} → HTTP ${status ?? 'no response'}` };
}
export const isFailure = (x: unknown): x is ProviderFailure => !!x && typeof x === 'object' && 'failure' in (x as object);

/** Something the company states on its OWN pages that points at a registry. */
export interface FirstPartyReference {
  kind: 'identifier_statement' | 'registry_link' | 'listing_statement';
  /** identifier_statement / registry_link: the normalised identifier. listing_statement: the ticker. */
  value: string;
  /** Scheme of `value` when it is an identifier. */
  scheme: string | null;
  /** The provider the reference names explicitly (a registry link), if any. */
  providerId: string | null;
  /** listing_statement only: the exchange as stated. */
  exchange?: string;
  sourceUrl: string;
  detail: string;
}

export interface ProviderContext {
  fetcher: EvidenceFetcher;
  retrievedAt: string;
  canonicalDomain: string;
  /** Hosts already DECISIVELY the company's (canonical + established aliases). */
  ownedHosts: readonly string[];
  /** A provider's fair-access User-Agent, operator-configured. Never a credential. */
  userAgent?: string;
}

export interface CandidateIdentifier {
  registryId: string;
  via: 'registry_link' | 'listing_mapping';
  sourceUrl: string | null;
  detail: string;
  /** listing_mapping only: the listing that was mapped, so the record can be checked against it. */
  listing?: { exchange: string; ticker: string };
}

export interface RegistryProvider {
  providerId: string;
  registryName: string;
  /** Jurisdiction the registry covers ("US", "IN", "FR", "GLOBAL"). */
  jurisdiction: string;
  /** ISO country, null for a non-national registry. */
  country: string | null;
  /** Schemes this provider ISSUES (a scheme has exactly one issuing provider). */
  schemes: readonly IdentifierScheme[];
  capabilities: readonly ProviderCapability[];
  lookupModes: readonly LookupMode[];
  availability: ProviderAvailability;
  availabilityDetail: string;
  providerFamily: string;
  /** Exchanges whose listings this provider's own tables map (by_first_party_reference). */
  listingExchanges?: readonly string[];
  /**
   * Local vocabulary that leads the identity pre-step to the company pages where
   * THIS provider's references are ("SEC filings", "Impressum", "mentions
   * légales"). The pre-step follows same-host links matching any registered
   * provider's hints — the core holds no national vocabulary of its own.
   */
  pageHints?: {
    /** Link text on investor pages leading to filings pages. */
    investorLinks?: RegExp;
    /** Link text leading to the legal notice / imprint. */
    legalNoticeLinks?: RegExp;
    /** URL path of a legal notice / imprint page. */
    legalNoticePaths?: RegExp;
  };

  /** Pure: provider-specific references on first-party pages (registry links, listings). */
  extractReferences?(pages: readonly { url: string; html: string; text: string }[]): FirstPartyReference[];
  /** A first-party reference → candidate identifiers in this provider's schemes. */
  resolveFromFirstPartyReference?(refs: readonly FirstPartyReference[], ctx: ProviderContext): Promise<CandidateIdentifier[]>;
  /** A candidate must agree with the record it led to (null = consistent, else the reason). */
  checkCandidate?(candidate: CandidateIdentifier, record: RegistryRecord): string | null;
  /** The registry's own record for one of its identifiers. */
  resolveFromExplicitIdentifier(registryId: string, ctx: ProviderContext): Promise<RegistryRecord | ProviderFailure>;
  /** Records in THIS provider for the same legal entity as `record` (another registry's), by explicit cross-reference. */
  resolveFromOfficialRegistryRecord?(record: Pick<RegistryRecord, 'scheme' | 'registryId'> & Partial<RegistryRecord>, ctx: ProviderContext): Promise<RegistryRecord[]>;
  /**
   * Does the record — or the entity's own official filing — tie it to one of
   * the company's hosts? `additionalDomains` are OTHER domains the same
   * official source states as the entity's own (exact hosts, §8).
   */
  verifyDomainAssociation?(record: RegistryRecord, ctx: ProviderContext): Promise<{ association: DomainAssociation; additionalDomains: DomainAlias[] } | null>;
}
