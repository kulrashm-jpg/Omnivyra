/**
 * Website Technical Intelligence — deterministic (Phase 18, Phase B).
 * Reads ONLY persisted crawl data (canonical_pages incl. crawl_metadata.meta_tags) +
 * website_health_scores. Never crawls / never re-requests. Checks needing rendered DOM,
 * headers, or assets not captured by the crawler are marked not_evaluable (honest).
 */
import { supabase } from '../../db/supabaseClient';
import { CheckResult, Freshness, Provenance, IntelHealth, aggregate, clamp, freshnessFrom, healthFromScore, norm } from './engineCommon';
// BETA-ARCH-001: optional canonical-evidence metadata (read-only mapping of existing output).
import { buildWebsiteEngineEvidence, type Evidence } from '../evidencePlatform';
// BETA-ROADMAP-EXEC-002: static-parser signals recovered into crawl_metadata (type-only import).
import type { PageSignals } from '../crawlerService';

interface PageRow { id: string; url: string; title: string | null; meta_description: string | null; headings: Array<{ level: number; text: string }> | null; internal_link_count: number | null; http_status: number | null; crawl_depth: number | null; last_crawled_at: string | null; crawl_metadata: { meta_tags?: Record<string, string>; signals?: PageSignals } | null }

export interface TechnicalIntelligence {
  technicalScore: number | null;
  technicalHealth: IntelHealth;
  criticalIssues: string[];
  warnings: string[];
  passedChecks: string[];
  recommendations: Array<{ key: string; recommendation: string }>;
  checks: CheckResult[];
  confidence: number;
  freshness: Freshness;
  provenance: Provenance;
  /** BETA-ARCH-001: optional canonical evidence (additive; unused by existing consumers). */
  platformEvidence?: Evidence[];
}

/**
 * GAP-11A — how many example pages a check may show. Small and fixed: enough to act on, never
 * enough to read as an exhaustive list of everything affected.
 */
const MAX_CHECK_EXAMPLES = 5;

export function scoreTechnicalIntelligence(pages: PageRow[], nowMs: number): TechnicalIntelligence {
  const checks: CheckResult[] = [];
  const C = (
    key: string,
    label: string,
    status: CheckResult['status'],
    score: number | null,
    detail?: string,
    examples?: CheckResult['examples'],
  ) => checks.push({ key, label, status, score, detail, ...(examples && examples.length > 0 ? { examples } : {}) });

  /**
   * GAP-11A — bounded, deterministic example pages taken from rows the check ALREADY filtered.
   *
   * The counts below were computed as `pages.filter(predicate).length`; the only change is that
   * the filtered array is now named so its rows can be shown. Same predicate, same count — the
   * calculation is untouched, the rows simply stop being discarded.
   *
   * Ordering is by URL, not by crawl order, so two runs over the same corpus produce the same
   * examples regardless of when each page happened to be fetched. Deduplicated, capped, and
   * empty when nothing was affected — an observed zero must not acquire examples.
   */
  const examplesFrom = (affected: PageRow[]): CheckResult['examples'] => {
    const urls = [...new Set(affected.map((p) => p.url).filter((u): u is string => Boolean(u)))]
      .sort()
      .slice(0, MAX_CHECK_EXAMPLES);
    return urls.length > 0 ? urls.map((url) => ({ url })) : undefined;
  };
  const pct = (n: number, d: number) => (d > 0 ? clamp((n / d) * 100) : 0);
  const metaTags = (p: PageRow) => p.crawl_metadata?.meta_tags || {};
  const anyMeta = pages.some((p) => Object.keys(metaTags(p)).length > 0);
  // BETA-ROADMAP-EXEC-002: recovered static-parser signals (present only on pages crawled after the upgrade;
  // pages without them keep the honest not_evaluable so there is no backward-compat regression).
  const sig = (p: PageRow) => p.crawl_metadata?.signals;
  const withSig = pages.filter((p) => sig(p));
  const anySig = withSig.length > 0;
  const site = pages.map((p) => sig(p)?.site).find(Boolean); // domain-level (attached to the root page)

  if (pages.length === 0) {
    C('crawl', 'Crawl coverage', 'not_evaluable', null, 'No crawled pages — run the website scan');
  } else {
    const n = pages.length;
    C('https', 'HTTPS', 'pass', pct(pages.filter((p) => /^https:\/\//i.test(p.url)).length, n), 'Pages served over HTTPS');
    // GAP-11A — the predicates and counts are unchanged; the filtered rows are simply named so the
    // affected pages can be shown alongside the count they produced.
    const brokenPages = pages.filter((p) => (p.http_status ?? 200) >= 400);
    const broken = brokenPages.length;
    C('broken_links', 'Broken pages (4xx/5xx)', 'pass', clamp(100 - (broken / n) * 100), `${broken} pages returned 4xx/5xx`, examplesFrom(brokenPages));
    const redirectPages = pages.filter((p) => { const s = p.http_status ?? 200; return s >= 300 && s < 400; });
    const redirects = redirectPages.length;
    C('redirect_chains', 'Redirects', 'pass', clamp(100 - (redirects / n) * 100), `${redirects} redirecting pages`, examplesFrom(redirectPages));
    // GAP-11A — deliberately AGGREGATE-ONLY. This check counts pages that DID return 200, so the
    // only example set matching its population would be pages that worked, which tells a reader
    // nothing. Showing the complement instead would put "Pages returning 200" directly above a list
    // of 3xx/4xx/5xx URLs — a contradiction. The non-200 population is already carried, correctly
    // matched to its own aggregate, by `redirect_chains` (3xx) and `broken_links` (4xx/5xx).
    C('crawlability', 'Crawlability', 'pass', pct(pages.filter((p) => (p.http_status ?? 200) === 200).length, n), 'Pages returning 200');
    C('meta_tags', 'Meta title + description', 'pass', pct(pages.filter((p) => p.title && p.meta_description).length, n), 'Pages with title + description');
    const titles = pages.map((p) => norm(p.title)).filter(Boolean);
    const descs = pages.map((p) => norm(p.meta_description)).filter(Boolean);
    const dup = (arr: string[]) => (arr.length ? (arr.length - new Set(arr).size) : 0);
    C('duplicate_titles', 'Unique titles', titles.length ? 'pass' : 'not_evaluable', titles.length ? clamp(100 - (dup(titles) / n) * 100) : null, `${dup(titles)} duplicate titles`);
    C('duplicate_descriptions', 'Unique descriptions', descs.length ? 'pass' : 'not_evaluable', descs.length ? clamp(100 - (dup(descs) / n) * 100) : null, `${dup(descs)} duplicate descriptions`);
    const oneH1 = pages.filter((p) => (p.headings || []).filter((h) => h.level === 1).length === 1).length;
    C('heading_structure', 'Heading structure (single H1)', 'pass', pct(oneH1, n), 'Pages with exactly one H1');
    const avgLinks = pages.reduce((a, p) => a + (p.internal_link_count || 0), 0) / n;
    C('internal_linking', 'Internal linking', 'pass', clamp((avgLinks / 8) * 100), `${avgLinks.toFixed(1)} avg internal links`);
    const deepPages = pages.filter((p) => (p.crawl_depth ?? 0) > 3);
    const deep = deepPages.length;
    C('page_depth', 'Page depth', 'pass', clamp(100 - (deep / n) * 100), `${deep} pages deeper than 3 clicks`, examplesFrom(deepPages));
    // Meta-tag derived (captured only when the page exposes <meta>)
    C('open_graph', 'Open Graph tags', anyMeta ? 'pass' : 'not_evaluable', anyMeta ? pct(pages.filter((p) => Object.keys(metaTags(p)).some((k) => k.startsWith('og:'))).length, n) : null);
    C('twitter_cards', 'Twitter Cards', anyMeta ? 'pass' : 'not_evaluable', anyMeta ? pct(pages.filter((p) => Object.keys(metaTags(p)).some((k) => k.startsWith('twitter:'))).length, n) : null);
    const noindexPages = pages.filter((p) => norm(metaTags(p)['robots']).includes('noindex'));
    const noindex = noindexPages.length;
    // `anyMeta` false ⇒ the check is not_evaluable, so it carries no examples: a check that could
    // not be evaluated must never look as though it observed pages.
    C('indexability', 'Indexability', anyMeta ? 'pass' : 'not_evaluable', anyMeta ? clamp(100 - (noindex / n) * 100) : null, `${noindex} pages marked noindex`, anyMeta ? examplesFrom(noindexPages) : undefined);
    // BETA-ROADMAP-EXEC-002 — now recovered by the static parser (crawl_metadata.signals). Evaluated when
    // signal data exists for this crawl; otherwise honestly not_evaluable (older crawls, no regression).
    const sn = withSig.length;
    C('canonical_tags', 'Canonical tags', anySig ? 'pass' : 'not_evaluable', anySig ? pct(withSig.filter((p) => sig(p)!.canonical).length, sn) : null, 'Pages exposing <link rel="canonical">');
    // BETA-ROADMAP-EXEC-008 Tier 2: surface the recovered JSON-LD @type list as an INFORMATIONAL enrichment
    // of this existing check's detail — no new score, no entity-scoring impact (the score is still % pages w/ JSON-LD).
    const jsonldTypes = [...new Set(withSig.flatMap((p) => sig(p)!.jsonld_types || []))].slice(0, 8);
    C('structured_data', 'Structured data / schema.org', anySig ? 'pass' : 'not_evaluable', anySig ? pct(withSig.filter((p) => (sig(p)!.jsonld_count || 0) > 0).length, sn) : null, jsonldTypes.length ? `Pages with JSON-LD structured data (types: ${jsonldTypes.join(', ')})` : 'Pages with JSON-LD structured data');
    C('robots_txt', 'robots.txt', site ? 'pass' : 'not_evaluable', site ? (site.robots_txt ? 100 : 0) : null, site?.robots_txt ? 'robots.txt present' : 'robots.txt not found');
    C('sitemap_xml', 'sitemap.xml', site ? 'pass' : 'not_evaluable', site ? (site.sitemap_xml ? 100 : 0) : null, site ? `${site.sitemap_url_count} sitemap URLs` : 'sitemap.xml not found');
    const sec = withSig.filter((p) => sig(p)!.response);
    C('security_headers', 'Security headers', sec.length ? 'pass' : 'not_evaluable', sec.length ? Math.round(sec.reduce((a, p) => a + ((sig(p)!.response!.security_header_count / 4) * 100), 0) / sec.length) : null, 'HSTS / CSP / X-Frame-Options / X-Content-Type-Options coverage');
    // BETA-ROADMAP-EXEC-008 (Tier 1) — hreflang + content feeds. Conditionally-relevant signals: absence is
    // NOT a defect (single-language sites, non-content sites), so absence → not_evaluable (never a false penalty);
    // when present, coverage/presence is measured. Reads crawl_metadata.signals; same pattern as EXEC-002.
    const anyHreflang = withSig.some((p) => (sig(p)!.hreflang_count || 0) > 0);
    C('hreflang', 'International targeting (hreflang)', anyHreflang ? 'pass' : 'not_evaluable', anyHreflang ? pct(withSig.filter((p) => (sig(p)!.hreflang_count || 0) > 0).length, sn) : null, anyHreflang ? 'Pages declaring hreflang alternates' : 'No hreflang detected (not applicable to single-language sites)');
    const anyFeed = withSig.some((p) => (sig(p)!.feed_links || 0) > 0);
    C('content_feeds', 'Content feeds (RSS/Atom)', anyFeed ? 'pass' : 'not_evaluable', anyFeed ? 100 : null, anyFeed ? 'An RSS/Atom feed is exposed for content distribution' : 'No content feed detected');
    // BETA-ROADMAP-EXEC-008 Tier 2 — cache header presence (coverage) + pagination presence. crawl_metadata.signals;
    // presence-oriented (absence → not_evaluable, no false penalty). No SEO-weighting redesign.
    const cacheable = withSig.filter((p) => sig(p)!.response);
    const anyCache = cacheable.some((p) => sig(p)!.response!.cache_control);
    C('cache_headers', 'Caching headers', anyCache ? 'pass' : 'not_evaluable', anyCache ? pct(cacheable.filter((p) => sig(p)!.response!.cache_control).length, cacheable.length) : null, anyCache ? 'Responses served with a Cache-Control header' : 'No Cache-Control header observed');
    const anyPagination = withSig.some((p) => sig(p)!.has_pagination);
    C('pagination', 'Pagination markup', anyPagination ? 'pass' : 'not_evaluable', anyPagination ? 100 : null, anyPagination ? 'rel=prev/next pagination present' : 'No pagination markup detected (not applicable to unpaginated sites)');
    // `compression` stays not_evaluable: the HTTP client auto-decompresses and strips `content-encoding`,
    // so it cannot be observed reliably — reporting it would be a misleading measured 0 (see BETA-ROADMAP-EXEC-001).
    // image/lazy/js/css genuinely require rendered DOM / asset analysis (headless only; IMPACT-AUDIT-001).
    for (const [k, l] of [['compression', 'Compression'], ['image_optimization', 'Image optimization'], ['lazy_loading', 'Lazy loading'], ['javascript_errors', 'JavaScript errors'], ['css_issues', 'CSS issues']] as const) {
      C(k, l, 'not_evaluable', null, 'Not observable from a static crawl (client auto-decompresses / requires rendered DOM)');
    }
  }

  const agg = aggregate(checks);
  const sev = (k: string) => ['https', 'broken_links', 'crawlability', 'indexability'].includes(k);
  const criticalIssues = checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 50 && sev(c.key)).map((c) => c.label);
  const warnings = checks.filter((c) => typeof c.score === 'number' && (c.score as number) >= 50 && (c.score as number) < 80).map((c) => c.label);
  const passedChecks = checks.filter((c) => typeof c.score === 'number' && (c.score as number) >= 80).map((c) => c.label);
  const recMap: Record<string, string> = {
    https: 'Serve every page over HTTPS.', broken_links: 'Fix or redirect pages returning 4xx/5xx.',
    redirect_chains: 'Reduce redirect hops to the canonical URL.', crawlability: 'Ensure key pages return HTTP 200.',
    meta_tags: 'Add a title and meta description to every page.', duplicate_titles: 'Make page titles unique.',
    duplicate_descriptions: 'Make meta descriptions unique.', heading_structure: 'Use exactly one H1 per page.',
    internal_linking: 'Add internal links between related pages.', page_depth: 'Bring deep pages within 3 clicks of the home page.',
    open_graph: 'Add Open Graph tags for social sharing.', twitter_cards: 'Add Twitter Card meta tags.', indexability: 'Remove unintended noindex directives.',
    canonical_tags: 'Add a <link rel="canonical"> to every page to consolidate duplicate URLs.',
    structured_data: 'Add JSON-LD structured data (Organization, Article, Product) so answer engines can parse the page.',
    robots_txt: 'Publish a robots.txt at the site root.', sitemap_xml: 'Publish an XML sitemap and reference it in robots.txt.',
    security_headers: 'Add HSTS, CSP, X-Frame-Options and X-Content-Type-Options response headers.',
    compression: 'Enable gzip/brotli compression on HTML responses.',
    hreflang: 'Add hreflang alternate links across all localized pages so search engines serve the right language/region.',
    content_feeds: 'Expose an RSS/Atom feed to aid content distribution and discovery.',
    cache_headers: 'Add Cache-Control headers to static responses to improve repeat-visit performance.',
  };
  const recommendations = checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 70).map((c) => ({ key: c.key, recommendation: recMap[c.key] || `Improve ${c.label.toLowerCase()}.` }));

  const freshness = freshnessFrom(pages.map((p) => p.last_crawled_at).filter(Boolean).sort().reverse()[0] ?? null, nowMs);
  return {
    technicalScore: agg.score, technicalHealth: healthFromScore(agg.score),
    criticalIssues, warnings, passedChecks, recommendations, checks,
    confidence: agg.confidence,
    freshness,
    provenance: { sources: ['canonical_pages', 'website_health_scores'], checksEvaluated: agg.evaluated, checksTotal: agg.total, deterministic: true },
    platformEvidence: buildWebsiteEngineEvidence({
      engineId: 'website.technical', version: '1.0.0', sourceSystem: 'website_crawl', origin: 'canonical_pages', collector: 'regex_crawler',
      checks, aggregate: { key: 'technical_score', label: 'Technical score', score: agg.score, confidence: agg.confidence }, freshness,
    }),
  };
}

export async function evaluateTechnicalIntelligence(companyId: string, nowMs = Date.now()): Promise<TechnicalIntelligence> {
  try {
    const { data } = await supabase.from('canonical_pages')
      .select('id, url, title, meta_description, headings, internal_link_count, http_status, crawl_depth, last_crawled_at, crawl_metadata')
      .eq('company_id', companyId).order('last_crawled_at', { ascending: false }).limit(500);
    return scoreTechnicalIntelligence((data || []) as PageRow[], nowMs);
  } catch {
    return scoreTechnicalIntelligence([], nowMs);
  }
}
