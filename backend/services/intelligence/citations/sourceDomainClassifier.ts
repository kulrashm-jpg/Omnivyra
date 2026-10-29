/**
 * Source-domain classifier — rules only, no model call, no keyword guessing on paths or titles.
 *
 * Order: (1) relational — the subject's own domain, then a VALIDATED competitor's domain, both as
 * host equality or a true subdomain (the isCitationCorroborated semantics); (2) a host-suffix table
 * matched on the label boundary (`h === d || h.endsWith('.' + d)`, so `notg2.com` is not `g2.com`);
 * (3) search-engine hosts via webDiscovery.isRejectedHost; (4) otherwise `unknown`, explicitly.
 *
 * The table composes lists that already exist in the repo and disagree in places
 * (dossierV2/render.ts domainRole, publicResearch/footprint.ts REVIEW_PLATFORMS and PLATFORMS,
 * companyProfile/grounding/sourceAuthority.ts REGISTRY tier 2/3, productionPrimitives review
 * aggregators). They are not all exported, so the hosts are copied here with this pointer.
 * Bump CLASSIFIER_LIST_VERSION whenever the table changes.
 */
import { isRejectedHost } from '../../companyProfile/grounding/discovery/webDiscovery';
import type { SourceCategory, SourceClassification } from './citationTypes';

export const CLASSIFIER_LIST_VERSION = 'citation-source-classes/2026-10-29.1';

const TABLE: ReadonlyArray<readonly [SourceCategory, readonly string[]]> = [
  ['review_directory', [
    'g2.com', 'capterra.com', 'capterra.in', 'getapp.com', 'softwareadvice.com', 'trustradius.com', 'trustpilot.com',
    'producthunt.com', 'alternativeto.net', 'saasworthy.com', 'softwaresuggest.com', 'crozdesk.com', 'sourceforge.net',
    'techjockey.com', 'goodfirms.co', 'gartner.com', 'clutch.co', 'selecthub.com', 'featuredcustomers.com',
  ]],
  ['forum_community', ['reddit.com', 'quora.com', 'stackoverflow.com', 'stackexchange.com', 'news.ycombinator.com', 'dev.to', 'hashnode.com', 'hashnode.dev']],
  ['knowledge_reference', ['wikipedia.org', 'wikidata.org', 'britannica.com', 'investopedia.com']],
  ['video', ['youtube.com', 'youtu.be', 'vimeo.com']],
  ['social', ['linkedin.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'pinterest.com', 'threads.net']],
  ['business_database', ['crunchbase.com', 'zoominfo.com', 'dnb.com', 'hoovers.com', 'pitchbook.com', 'dealroom.co', 'cbinsights.com', 'tracxn.com', 'builtin.com', 'wellfound.com']],
  ['publishing_platform', ['medium.com', 'substack.com']],
  // sourceAuthority.ts REGISTRY tier 3 (editorial / industry) only — no other host is called editorial.
  ['editorial', ['inc42.com', 'yourstory.com', 'economictimes.indiatimes.com', 'business-standard.com', 'forbes.com', 'businessindia.co', 'timesofindia.indiatimes.com', 'ceoinsider.io', 'echai.ventures']],
  ['ai_vendor_or_search', ['openai.com', 'chatgpt.com', 'perplexity.ai', 'anthropic.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com']],
];

export const normalizeHost = (h: string): string => h.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

const onBoundary = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

function tableMatch(host: string): { category: SourceCategory; domain: string } | null {
  // Longest listed domain wins, so a specific entry (economictimes.indiatimes.com) beats a broader one.
  let best: { category: SourceCategory; domain: string } | null = null;
  for (const [category, domains] of TABLE) {
    for (const d of domains) if (onBoundary(host, d) && (!best || d.length > best.domain.length)) best = { category, domain: d };
  }
  return best;
}

/** A search-engine (or search redirect) host: never a publication target, and not a citation of a page. */
export function isSearchEngineHost(host: string): boolean {
  const h = normalizeHost(host);
  // isRejectedHost also lists social hosts (never-fetch policy); those are real citations, classified by the table.
  return isRejectedHost(h) && !tableMatch(h);
}

export type ClassifierContext = {
  /** The subject's own domain(s). */
  subjectDomains: string[];
  /** Domains of VALIDATED competitors only (classification direct/adjacent/substitute with status observed). */
  competitorDomains: string[];
};

export function classifySourceHost(rawHost: string, ctx: ClassifierContext): SourceClassification {
  const host = normalizeHost(rawHost);
  const v = CLASSIFIER_LIST_VERSION;
  for (const s of ctx.subjectDomains.map(normalizeHost).filter(Boolean)) {
    if (onBoundary(host, s)) return { category: 'subject_owned', rule: `relational:subject:${s}`, list_version: v };
  }
  for (const c of ctx.competitorDomains.map(normalizeHost).filter(Boolean)) {
    if (onBoundary(host, c)) return { category: 'competitor_owned', rule: `relational:validated_competitor:${c}`, list_version: v };
  }
  const m = tableMatch(host);
  if (m) return { category: m.category, rule: `host_suffix:${m.domain}`, list_version: v };
  if (isRejectedHost(host)) return { category: 'ai_vendor_or_search', rule: 'webDiscovery.isRejectedHost', list_version: v };
  return { category: 'unknown', rule: 'none', list_version: v };
}
