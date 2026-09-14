/**
 * CPG-003 — the canonical source registry (§2) and field-specific authority (§3).
 *
 * ─── WHY A UNIVERSAL TIER IS NOT ENOUGH ────────────────────────────────────
 * CPG-001's `sourceAuthority` answers "how much weight does this class of source
 * carry in general?". That is necessary but insufficient, because authority is
 * CLAIM-RELATIVE:
 *
 *   • A company's own /team page is the BEST source for who its CEO is, and a
 *     poor source for its audited revenue.
 *   • A regulatory filing is the BEST source for revenue, and useless for brand
 *     positioning.
 *   • Wikidata is decent for founding year and identity, and weak for ICP.
 *
 * So this registry records, per source, the fields it is genuinely authoritative
 * for and the fields it is weak for. `rankSourcesForField` then orders sources
 * for a SPECIFIC claim rather than in the abstract.
 *
 * ─── AUTHORITY IS NOT TRUTH (§12) ──────────────────────────────────────────
 * Nothing here says Tier 1 is correct or Tier 4 is wrong. A first-party page can
 * be years out of date while a Tier-3 article is current. Ranking only decides
 * which evidence to SEEK and how to WEIGH it; whether a value wins is decided by
 * CPG-001's resolver from authority + freshness + corroboration + entity match +
 * contradiction together.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { DomainAlias } from '../types';
import { ALIAS_STRENGTH } from './aliasStrength';
import { SOURCE_REGISTRY, type SourceDescriptor } from './sourceCatalogue';

// §2 — the catalogue (descriptor vocabulary + SOURCE_REGISTRY) lives in ./sourceCatalogue; re-exported so importers are unchanged.
export {
  SOURCE_REGISTRY, type AvailabilityState, type FreshnessProfile, type HostBinding, type RetrievalMechanism, type SourceCategory,
  type SourceDescriptor, type SourceKind,
} from './sourceCatalogue';

export function describeSource(id: string): SourceDescriptor | null {
  return SOURCE_REGISTRY.find((s) => s.id === id) ?? null;
}

export type FieldAuthority = 'authoritative' | 'weak' | 'never' | 'unrated';

/** How authoritative a source is FOR A SPECIFIC FIELD (§3). */
/**
 * The registry source a piece of evidence belongs to, for field-authority
 * lookup.
 *
 * CPG-007: ONE mapping. It was previously copied into discovery (the pre-fetch
 * gate) and twice into persistence, and was absent from the resolver — so
 * `neverFor` was never applied at resolution time.
 *
 * ⚠️ CPG-007 FIX — a document found by public-web DISCOVERY is
 * `general_web_search`, not `user_supplied_url`. The old mapping gave every
 * discovered publisher the single provider family "user_reference", so
 * Wikipedia and Tracxn agreeing counted as ONE independent family; and it
 * labelled search results as user-supplied. `general_web_search` has no fixed
 * family, so each publisher host is its own family.
 */
/**
 * CPG-010 — the descriptor whose HOST BINDING covers this document, if any.
 * Most specific binding wins (a path-prefixed binding beats a bare host; a
 * longer host beats a shorter suffix), so www.sec.gov/Archives/… is a filing
 * while data.sec.gov is the registrant record. Deterministic.
 */
export function hostBoundSource(host: string | null, path: string | null = null): SourceDescriptor | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  let best: { d: SourceDescriptor; score: number } | null = null;
  for (const d of SOURCE_REGISTRY) {
    for (const b of d.hosts ?? []) {
      const bh = b.host.toLowerCase();
      if (!(h === bh || h.endsWith(`.${bh}`))) continue;
      if (b.pathPrefix && !(path ?? '').startsWith(b.pathPrefix)) continue;
      const score = (b.pathPrefix ? 1000 : 0) + bh.length;
      if (!best || score > best.score) best = { d, score };
    }
  }
  return best?.d ?? null;
}

export interface SourceAttributionContext {
  /** Established secondary domains (CPG-009). Only DECISIVE ones are company-owned. */
  domainAliases?: readonly DomainAlias[];
  /** URL path, for path-scoped bindings (SEC filing vs registrant). */
  path?: string | null;
}

/** The DECISIVE alias whose host covers `host` — an IR / JSON-LD / redirect / filing-stated domain. */
export function decisiveAliasFor(host: string | null, aliases: readonly DomainAlias[] | undefined): DomainAlias | null {
  if (!host || !aliases) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const a of aliases) {
    const d = a.domain.toLowerCase().replace(/^www\./, '');
    if ((h === d || h.endsWith(`.${d}`)) && ALIAS_STRENGTH[a.evidence] === 'DECISIVE') return a;
  }
  return null;
}

export function registrySourceIdFor(
  host: string | null, sourceName: string, companyDomain: string | null, discovered = false,
  ctx: SourceAttributionContext = {},
): string {
  const norm = (s: string | null) => (s ? s.toLowerCase().replace(/^www\./, '') : null);
  const h = norm(host), d = norm(companyDomain);
  if (h && d && h === d) return 'first_party_website';
  // CPG-010 §11 — a DECISIVELY established secondary domain (the IR site) is
  // company-owned. A SUPPORTING same-brand domain (infosys.org, the Foundation)
  // is NOT: affiliation is not ownership.
  if (decisiveAliasFor(h, ctx.domainAliases)) return 'first_party_ir';
  if (sourceName === 'Wikidata') return 'wikidata';
  // CPG-010 — the host binding, the same one `classifySource` reads for tier.
  const bound = hostBoundSource(h, ctx.path ?? null);
  if (bound) return bound.id;
  return discovered ? 'general_web_search' : 'user_supplied_url';
}

/**
 * How authoritative a source is FOR A SPECIFIC FIELD (§3) — and, CPG-010 §10,
 * for a specific MEASURE of it. When the descriptor scopes a field by measure,
 * an unlisted (or unknown) measure is `weak`: a funding database is not
 * authoritative for an unqualified "raised $X" mention.
 */
export function authorityForField(sourceId: string, field: string, measure: string | null = null): FieldAuthority {
  const s = describeSource(sourceId);
  if (!s) return 'unrated';
  if (s.neverFor.includes(field)) return 'never';
  if (s.authoritativeFor.includes(field)) {
    const scoped = s.measureScoped?.[field];
    if (scoped && !(measure !== null && scoped.includes(measure))) return 'weak';
    return 'authoritative';
  }
  if (s.weakFor.includes(field)) return 'weak';
  return 'unrated';
}

const AUTHORITY_RANK: Record<FieldAuthority, number> = { authoritative: 3, weak: 2, unrated: 1, never: 0 };

/**
 * Order sources for a SPECIFIC field: field-authority first, then general tier.
 * Sources marked `never` for the field are excluded entirely — a marketing page
 * is not weak evidence of audited revenue, it is not evidence of it at all.
 */
export function rankSourcesForField(field: string, candidateIds: readonly string[]): SourceDescriptor[] {
  return candidateIds
    .map(describeSource)
    .filter((s): s is SourceDescriptor => s !== null)
    .filter((s) => authorityForField(s.id, field) !== 'never')
    .sort((a, b) => {
      const d = AUTHORITY_RANK[authorityForField(b.id, field)] - AUTHORITY_RANK[authorityForField(a.id, field)];
      if (d !== 0) return d;
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.id.localeCompare(b.id);
    });
}

/**
 * §9 — CORROBORATION INDEPENDENCE.
 *
 * Sources sharing an upstream data origin are ONE source, however many rows they
 * return. Two pages of one website, or three databases resyndicating the same
 * provider, are not independent confirmations.
 */
const PROVIDER_FAMILY: Readonly<Record<string, string>> = Object.freeze({
  first_party_website: 'company_owned',
  first_party_leadership: 'company_owned',
  first_party_newsroom: 'company_owned',
  // CPG-010: the IR site is the company speaking — the same family.
  first_party_ir: 'company_owned',
  clearbit: 'clearbit', apollo: 'apollo', peopledatalabs: 'peopledatalabs',
  crunchbase: 'crunchbase', hunter: 'hunter', builtwith: 'builtwith',
  wikidata: 'wikidata',
  // CPG-010: the registrant record and the registrant's filings both originate
  // in the registrant's own submissions to the SEC — one family.
  sec_edgar_registrant: 'sec_edgar', sec_edgar_filing: 'sec_edgar',
  mca_registry: 'mca',
  tracxn: 'tracxn',
});

/**
 * Multi-label public suffixes seen in this product's markets. An ENGINEERING
 * APPROXIMATION of the Public Suffix List (no dependency, deterministic): a
 * missing entry can only make two families look like one — never manufacture
 * independence.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'com.sg', 'com.br', 'co.za', 'com.cn',
  // CPG-011 — widened beyond a few markets. Still an approximation of the PSL:
  // a missing entry can only MERGE two families, never manufacture independence.
  'gov.au', 'edu.au', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr', 'go.kr', 'com.hk', 'org.hk',
  'com.tw', 'org.tw', 'com.my', 'com.ph', 'com.vn', 'co.id', 'or.id', 'go.id', 'co.th', 'in.th', 'com.pk',
  'com.bd', 'com.lk', 'com.np', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.uy', 'com.ec',
  'com.tr', 'gov.tr', 'co.il', 'org.il', 'com.eg', 'com.ng', 'com.gh', 'co.ke', 'co.tz', 'co.ug',
  'com.sa', 'com.qa', 'com.kw', 'co.ae', 'gouv.fr', 'gv.at', 'co.at', 'or.at', 'com.pl', 'org.pl',
  'com.ua', 'com.ru', 'co.hu', 'com.gr', 'com.cy', 'com.mt', 'gob.mx', 'gob.es', 'gov.br', 'gov.cn',
]);

/** The publisher-level domain: en.wikipedia.org → wikipedia.org, economictimes.indiatimes.com → indiatimes.com. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/**
 * The independent provider family a source belongs to.
 *
 * ⚠️ CPG-008 FIX — `user_supplied_url` no longer maps to one constant family
 * ("user_reference"), which made every user-referenced publisher count as the
 * SAME source; and host-based families are now PUBLISHER-level, so
 * en.wikipedia.org and hi.wikipedia.org — or two subdomains of one media group —
 * cannot pose as independent corroboration.
 */
export function providerFamily(sourceId: string, host: string | null): string {
  // ⚠️ CPG-011 LIVE FIX — a registry source's family is its PROVIDER, from the
  // descriptor: live, French register and GLEIF claims were counted as the
  // host families "api.gouv.fr" / "gleif.org" because only SEC and MCA were
  // listed in PROVIDER_FAMILY.
  return PROVIDER_FAMILY[sourceId] ?? describeSource(sourceId)?.registryProviderId ?? (host ? registrableDomain(host) : sourceId);
}

/** Count genuinely independent corroborating families. */
export function countIndependentFamilies(
  entries: readonly { sourceId: string; host: string | null }[],
): number {
  return new Set(entries.map((e) => providerFamily(e.sourceId, e.host))).size;
}
