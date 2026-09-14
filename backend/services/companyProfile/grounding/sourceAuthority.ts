/**
 * CPG-001 — deterministic source-authority model (§3).
 *
 * Tiering is a POLICY, not a measurement. It encodes an editorial judgement
 * about how much weight a class of source should carry; it does not assert that
 * any individual document is correct. A Tier-1 page can be out of date and a
 * Tier-3 article can be right — which is exactly why staleness and conflict are
 * handled separately rather than folded into the tier.
 *
 * EXTENSIBILITY: `classifySource` resolves by explicit registry first, then by
 * host suffix, then by declared source type. Adding a vendor is a registry
 * entry; no branch elsewhere changes.
 *
 * ⚠️ A TIER IS NOT AN INTEGRATION. Listing a provider here says how much weight
 * its evidence WOULD carry. It does NOT mean Omnivyra can currently retrieve
 * from it. Actual retrieval capability is reported by
 * `companyIntelligence/providers/registry.ts#capabilityReadiness()`, and every
 * vendor adapter is dark without its credential. See `PROVIDER_REALITY`.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { DomainAlias, SourceTier, SourceType } from './types';
import { decisiveAliasFor, hostBoundSource, type SourceKind } from './acquisition/sourceRegistry';

/** Tier weight used by the confidence formula. Engineering default. */
export const TIER_WEIGHT: Readonly<Record<SourceTier, number>> = Object.freeze({
  1: 1.0, 2: 0.8, 3: 0.6, 4: 0.3,
});

interface SourceRule {
  /** Host suffix match, e.g. 'linkedin.com' matches 'www.linkedin.com'. */
  hostSuffix: string;
  tier: SourceTier;
  sourceType: SourceType;
  name: string;
  /** CPG-010 — overrides the kind implied by sourceType. */
  kind?: SourceKind;
}

/**
 * Tier 2 — high-quality independent business intelligence.
 * Tier 3 — reputable editorial/industry.
 * Tier 4 — secondary/aggregated.
 * Tier 1 is NOT a fixed list: it is determined relationally (is this host the
 * company's own domain?), which `classifySource` handles via `companyDomain`.
 */
const REGISTRY: readonly SourceRule[] = Object.freeze([
  // Tier 2 — business intelligence
  { hostSuffix: 'linkedin.com', tier: 2, sourceType: 'business_intelligence', name: 'LinkedIn' },
  { hostSuffix: 'crunchbase.com', tier: 2, sourceType: 'business_intelligence', kind: 'financial_database', name: 'Crunchbase' },
  { hostSuffix: 'zoominfo.com', tier: 2, sourceType: 'business_intelligence', name: 'ZoomInfo' },
  { hostSuffix: 'dnb.com', tier: 2, sourceType: 'business_intelligence', name: 'D&B' },
  { hostSuffix: 'hoovers.com', tier: 2, sourceType: 'business_intelligence', name: "Hoover's" },
  { hostSuffix: 'pitchbook.com', tier: 2, sourceType: 'business_intelligence', kind: 'financial_database', name: 'PitchBook' },
  { hostSuffix: 'dealroom.co', tier: 2, sourceType: 'business_intelligence', kind: 'financial_database', name: 'Dealroom' },
  // CPG-010: tracxn.com and wikidata.org are bound in SOURCE_REGISTRY (one
  // representation each); they are no longer duplicated here.
  { hostSuffix: 'cbinsights.com', tier: 2, sourceType: 'business_intelligence', kind: 'financial_database', name: 'CB Insights' },
  // Tier 3 — editorial / industry
  { hostSuffix: 'inc42.com', tier: 3, sourceType: 'editorial', name: 'Inc42' },
  { hostSuffix: 'yourstory.com', tier: 3, sourceType: 'editorial', name: 'YourStory' },
  { hostSuffix: 'economictimes.indiatimes.com', tier: 3, sourceType: 'editorial', name: 'Economic Times' },
  { hostSuffix: 'business-standard.com', tier: 3, sourceType: 'editorial', name: 'Business Standard' },
  { hostSuffix: 'forbes.com', tier: 3, sourceType: 'editorial', name: 'Forbes' },
  { hostSuffix: 'businessindia.co', tier: 3, sourceType: 'editorial', name: 'Business India' },
  { hostSuffix: 'timesofindia.indiatimes.com', tier: 3, sourceType: 'editorial', name: 'Times of India' },
  { hostSuffix: 'ceoinsider.io', tier: 3, sourceType: 'editorial', name: 'CEO Insider' },
  { hostSuffix: 'echai.ventures', tier: 3, sourceType: 'editorial', name: 'eChai Ventures' },
  // Tier 4 — secondary / aggregated
  { hostSuffix: 'wikipedia.org', tier: 4, sourceType: 'aggregator', name: 'Wikipedia' },
  { hostSuffix: 'startuppedia.in', tier: 4, sourceType: 'aggregator', name: 'Startup Pedia' },
  { hostSuffix: 'medium.com', tier: 4, sourceType: 'aggregator', name: 'Medium' },
]);

/**
 * ⚠️ CPG-010 — `REGULATORY_SUFFIXES` is gone. It made EVERY .gov / .gov.in /
 * .gov.uk host a tier-1 "regulatory_filing", so a tourism page outranked
 * Reuters. Registry and filing hosts are now bound to their descriptors in
 * SOURCE_REGISTRY (sec_edgar_registrant, sec_edgar_filing, mca_registry,
 * corporate_registry, fr_sirene, gleif). CPG-011: every other government host —
 * of ANY country — is simply unrecognised (tier 4); no country's government
 * domains carry a tier of their own (CPG-010 briefly gave gov/gov.in/gov.uk/nic.in
 * tier 3, which treated three countries differently from all others).
 */

/** SourceType for a descriptor kind (the persisted `source_type` vocabulary). */
const TYPE_OF_KIND: Readonly<Record<SourceKind, SourceType>> = Object.freeze({
  corporate_registry: 'corporate_registry', regulatory_filing: 'regulatory_filing',
  company_owned: 'company_website', financial_database: 'business_intelligence',
  news_media: 'editorial', knowledge_graph: 'aggregator', other: 'aggregator',
});

/** SourceKind for a host-table rule's SourceType. */
const KIND_OF_TYPE: Readonly<Record<SourceType, SourceKind>> = Object.freeze({
  company_website: 'company_owned', company_press: 'company_owned',
  regulatory_filing: 'regulatory_filing', corporate_registry: 'corporate_registry',
  business_intelligence: 'other', editorial: 'news_media',
  aggregator: 'other', user: 'other', omnivyra_synthesis: 'other',
});

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function suffixMatch(host: string, suffix: string): boolean {
  const s = suffix.toLowerCase().replace(/^www\./, '');
  return host === s || host.endsWith(`.${s}`);
}

export interface SourceClassification {
  tier: SourceTier;
  sourceType: SourceType;
  /** CPG-010 §3 — what kind of document this is. Description, not authority. */
  sourceKind: SourceKind;
  name: string;
  /** Why this tier was assigned — surfaced so the decision is inspectable. */
  reason: string;
}

function pathOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return null; }
}

/**
 * Classify a source. `companyDomain` promotes the company's OWN domain to
 * Tier 1 — first-party authority is relational, not a fixed host list.
 *
 * CPG-010: a host bound to a SOURCE_REGISTRY descriptor takes THAT
 * descriptor's tier and kind (one representation per source), and a DECISIVELY
 * established secondary domain (`domainAliases`, e.g. the IR site) is
 * company-owned like the canonical domain.
 */
export function classifySource(
  url: string | null,
  declaredType: SourceType,
  companyDomain: string | null,
  domainAliases?: readonly DomainAlias[],
): SourceClassification {
  if (declaredType === 'user') {
    return { tier: 1, sourceType: 'user', sourceKind: 'other', name: 'User-provided', reason: 'asserted by the account owner' };
  }
  if (declaredType === 'omnivyra_synthesis') {
    return { tier: 4, sourceType: 'omnivyra_synthesis', sourceKind: 'other', name: 'Omnivyra synthesis', reason: 'derived interpretation, not an external source' };
  }

  const host = hostOf(url);
  if (!host) {
    return { tier: 4, sourceType: declaredType, sourceKind: KIND_OF_TYPE[declaredType] ?? 'other', name: 'Unknown source', reason: 'no resolvable source URL' };
  }

  const domain = companyDomain ? companyDomain.toLowerCase().replace(/^www\./, '') : null;
  if (domain && suffixMatch(host, domain)) {
    return { tier: 1, sourceType: 'company_website', sourceKind: 'company_owned', name: host, reason: "first-party: the company's own domain" };
  }
  const alias = decisiveAliasFor(host, domainAliases);
  if (alias) {
    return { tier: 1, sourceType: 'company_website', sourceKind: 'company_owned', name: host,
      reason: `first-party: established secondary domain ${alias.domain} (${alias.evidence})` };
  }
  const bound = hostBoundSource(host, pathOf(url));
  if (bound) {
    return { tier: bound.tier, sourceType: TYPE_OF_KIND[bound.kind], sourceKind: bound.kind, name: bound.name,
      reason: `bound source ${bound.id} (${bound.kind})` };
  }
  for (const rule of REGISTRY) {
    if (suffixMatch(host, rule.hostSuffix)) {
      return { tier: rule.tier, sourceType: rule.sourceType, sourceKind: rule.kind ?? KIND_OF_TYPE[rule.sourceType], name: rule.name, reason: `registered ${rule.sourceType}` };
    }
  }
  // CPG-011: an unbound host keeps the KIND its declared type describes (a new
  // provider's registry record is still a registry record) but earns no tier:
  // authority comes only from a SOURCE_REGISTRY descriptor, never from a kind.
  // Only a registry / filing declaration carries over: discovery declares every
  // document "editorial", which says nothing about an unknown host.
  const kind: SourceKind = declaredType === 'corporate_registry' || declaredType === 'regulatory_filing' ? KIND_OF_TYPE[declaredType] : 'other';
  return { tier: 4, sourceType: declaredType, sourceKind: kind, name: host, reason: 'unrecognised host — treated as secondary' };
}

/**
 * §15 — HONEST STATEMENT OF RETRIEVAL CAPABILITY.
 *
 * These are repository facts, verified during the CPG-001 audit. They are
 * recorded here so no downstream artifact can imply retrieval that does not
 * exist. Tiering a source does not integrate it.
 */
export const PROVIDER_REALITY = Object.freeze({
  firstPartyCrawl: {
    available: true,
    seam: 'backend/services/crawl/* + websiteIntelligence.getWebsiteSnapshot',
    note: 'Omnivyra can retrieve the company\'s own site today. This is the only routinely-available Tier-1 evidence source.',
  },
  vendorAdapters: {
    implemented: ['clearbit', 'apollo', 'peopledatalabs', 'crunchbase', 'hunter', 'builtwith'],
    seam: 'backend/services/companyIntelligence/providers/adapters',
    credentialGated: true,
    note: 'Each adapter returns unavailable("no_credential") and performs NO network call without its API key. Whether any key is set is an environment fact this repository cannot assert.',
  },
  generalWebSearch: {
    // ⚠️ CPG-010 CORRECTION — stale since CPG-006, which built keyless discovery.
    available: true,
    note: 'Keyless public-web discovery (CPG-006 discovery/keylessWebProvider → acquisition/discoveredSource) retrieves third-party documents. It throttles after ~24 queries; search rank is recorded and never used as evidence strength.',
  },
  secEdgar: {
    available: true,
    note: 'CPG-010 — SEC EDGAR registrant records (data.sec.gov) and filings (www.sec.gov/Archives) are keyless. Reached only through a CIK the company itself states or a first-party ticker statement mapped through SEC company_tickers.json; never by name.',
  },
  frSirene: {
    available: true,
    note: 'CPG-011 — France (SIREN) through the State\'s open-data API Recherche d\'entreprises; identifier-only; the SIREN comes from the company\'s own legal notice.',
  },
  gleif: {
    available: true,
    note: 'CPG-011 — GLEIF (LEI, global, CC0 API); identifier-only; explicit cross-references to national registries and reported parents.',
  },
  mcaRegistry: {
    available: false,
    note: 'CPG-010 — www.mca.gov.in answers HTTP 403 to programmatic GET and gates master data behind CAPTCHA. Not bypassed. CIN normalisation/validation exists; no adapter does.',
  },
  linkedinIngestion: {
    available: false,
    note: 'No LinkedIn company-data ingestion exists for profile grounding. LinkedIn is tiered here for when evidence arrives by another route; it is not a live retrieval path.',
  },
});
