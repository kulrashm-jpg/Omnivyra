/**
 * Website Technical Intelligence — deterministic (Phase 18, Phase B).
 * Reads ONLY persisted crawl data (canonical_pages incl. crawl_metadata.meta_tags) +
 * website_health_scores. Never crawls / never re-requests. Checks needing rendered DOM,
 * headers, or assets not captured by the crawler are marked not_evaluable (honest).
 */
import { supabase } from '../../db/supabaseClient';
import { CheckResult, Freshness, Provenance, IntelHealth, aggregate, clamp, freshnessFrom, healthFromScore, norm } from './engineCommon';

interface PageRow { id: string; url: string; title: string | null; meta_description: string | null; headings: Array<{ level: number; text: string }> | null; internal_link_count: number | null; http_status: number | null; crawl_depth: number | null; last_crawled_at: string | null; crawl_metadata: { meta_tags?: Record<string, string> } | null }

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
}

export function scoreTechnicalIntelligence(pages: PageRow[], nowMs: number): TechnicalIntelligence {
  const checks: CheckResult[] = [];
  const C = (key: string, label: string, status: CheckResult['status'], score: number | null, detail?: string) => checks.push({ key, label, status, score, detail });
  const pct = (n: number, d: number) => (d > 0 ? clamp((n / d) * 100) : 0);
  const metaTags = (p: PageRow) => p.crawl_metadata?.meta_tags || {};
  const anyMeta = pages.some((p) => Object.keys(metaTags(p)).length > 0);

  if (pages.length === 0) {
    C('crawl', 'Crawl coverage', 'not_evaluable', null, 'No crawled pages — run the website scan');
  } else {
    const n = pages.length;
    C('https', 'HTTPS', 'pass', pct(pages.filter((p) => /^https:\/\//i.test(p.url)).length, n), 'Pages served over HTTPS');
    const broken = pages.filter((p) => (p.http_status ?? 200) >= 400).length;
    C('broken_links', 'Broken pages (4xx/5xx)', 'pass', clamp(100 - (broken / n) * 100), `${broken} pages returned 4xx/5xx`);
    const redirects = pages.filter((p) => { const s = p.http_status ?? 200; return s >= 300 && s < 400; }).length;
    C('redirect_chains', 'Redirects', 'pass', clamp(100 - (redirects / n) * 100), `${redirects} redirecting pages`);
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
    const deep = pages.filter((p) => (p.crawl_depth ?? 0) > 3).length;
    C('page_depth', 'Page depth', 'pass', clamp(100 - (deep / n) * 100), `${deep} pages deeper than 3 clicks`);
    // Meta-tag derived (captured only when the page exposes <meta>)
    C('open_graph', 'Open Graph tags', anyMeta ? 'pass' : 'not_evaluable', anyMeta ? pct(pages.filter((p) => Object.keys(metaTags(p)).some((k) => k.startsWith('og:'))).length, n) : null);
    C('twitter_cards', 'Twitter Cards', anyMeta ? 'pass' : 'not_evaluable', anyMeta ? pct(pages.filter((p) => Object.keys(metaTags(p)).some((k) => k.startsWith('twitter:'))).length, n) : null);
    const noindex = pages.filter((p) => norm(metaTags(p)['robots']).includes('noindex')).length;
    C('indexability', 'Indexability', anyMeta ? 'pass' : 'not_evaluable', anyMeta ? clamp(100 - (noindex / n) * 100) : null, `${noindex} pages marked noindex`);
    // Not captured by the regex crawler — honest gaps (no rendered DOM / headers / assets)
    for (const [k, l] of [['canonical_tags', 'Canonical tags'], ['structured_data', 'Structured data / schema.org'], ['robots_txt', 'robots.txt'], ['sitemap_xml', 'sitemap.xml'], ['security_headers', 'Security headers'], ['compression', 'Compression'], ['image_optimization', 'Image optimization'], ['lazy_loading', 'Lazy loading'], ['javascript_errors', 'JavaScript errors'], ['css_issues', 'CSS issues']] as const) {
      C(k, l, 'not_evaluable', null, 'Not captured by the current crawler');
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
  };
  const recommendations = checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 70).map((c) => ({ key: c.key, recommendation: recMap[c.key] || `Improve ${c.label.toLowerCase()}.` }));

  return {
    technicalScore: agg.score, technicalHealth: healthFromScore(agg.score),
    criticalIssues, warnings, passedChecks, recommendations, checks,
    confidence: agg.confidence,
    freshness: freshnessFrom(pages.map((p) => p.last_crawled_at).filter(Boolean).sort().reverse()[0] ?? null, nowMs),
    provenance: { sources: ['canonical_pages', 'website_health_scores'], checksEvaluated: agg.evaluated, checksTotal: agg.total, deterministic: true },
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
