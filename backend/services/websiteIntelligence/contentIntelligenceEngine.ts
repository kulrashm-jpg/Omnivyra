/**
 * Website Content Intelligence — deterministic (Phase 18, Phase A).
 * Reads ONLY persisted crawl data (canonical_pages, page_content, page_links).
 * Never crawls. No LLM. Checks with no stored signal are marked not_evaluable.
 */
import { supabase } from '../../db/supabaseClient';
import { CheckResult, Freshness, Provenance, IntelHealth, Readiness, aggregate, clamp, fleschReadingEase, freshnessFrom, healthFromScore, matchesPage, norm, readinessFromScore, wordCount } from './engineCommon';

interface PageRow { id: string; url: string; title: string | null; meta_title: string | null; meta_description: string | null; page_type: string | null; headings: Array<{ level: number; text: string }> | null; ctas: Array<{ text: string; href?: string | null }> | null; internal_link_count: number | null; http_status: number | null; last_crawled_at: string | null }
interface ContentBlock { page_id: string; block_type: string; content_text: string | null; heading_level: number | null }

export interface ContentIntelligence {
  contentScore: number | null;
  contentHealth: IntelHealth;
  contentReadiness: Readiness;
  contentStrengths: string[];
  contentWeaknesses: string[];
  missingContent: string[];
  conversionIssues: string[];
  trustIssues: string[];
  recommendations: Array<{ key: string; recommendation: string }>;
  checks: CheckResult[];
  confidence: number;
  freshness: Freshness;
  provenance: Provenance;
}

const ACTION_VERBS = ['get', 'start', 'try', 'book', 'request', 'buy', 'subscribe', 'sign up', 'download', 'contact', 'schedule', 'demo', 'free'];

export function scoreContentIntelligence(pages: PageRow[], blocks: ContentBlock[], nowMs: number): ContentIntelligence {
  const byPage = new Map<string, ContentBlock[]>();
  for (const b of blocks) { const a = byPage.get(b.page_id) || []; a.push(b); byPage.set(b.page_id, a); }
  const pageWords = (id: string) => (byPage.get(id) || []).reduce((a, b) => a + wordCount(b.content_text || ''), 0);
  const hasH1 = (p: PageRow) => (p.headings || []).some((h) => h.level === 1) || (byPage.get(p.id) || []).some((b) => b.block_type === 'heading' && b.heading_level === 1);
  const hasH2 = (p: PageRow) => (p.headings || []).some((h) => h.level === 2) || (byPage.get(p.id) || []).some((b) => b.block_type === 'heading' && b.heading_level === 2);
  const ctaCount = (p: PageRow) => (p.ctas || []).length;
  const home = pages.find((p) => matchesPage(p, ['home']) || p.url?.replace(/https?:\/\/[^/]+/, '').replace(/\/$/, '') === '');

  const pct = (n: number, d: number) => (d > 0 ? clamp((n / d) * 100) : 0);
  const checks: CheckResult[] = [];
  const present = pages.length > 0;
  const C = (key: string, label: string, status: CheckResult['status'], score: number | null, detail?: string) => checks.push({ key, label, status, score, detail });

  if (!present) {
    C('crawl', 'Crawl coverage', 'not_evaluable', null, 'No crawled pages — run the website scan');
  } else {
    const withH1 = pages.filter(hasH1).length;
    C('headline_clarity', 'Headline clarity (H1)', 'pass', pct(withH1, pages.length), `${withH1}/${pages.length} pages have an H1`);
    const withCta = pages.filter((p) => ctaCount(p) > 0).length;
    C('cta_quality', 'CTA presence', 'pass', pct(withCta, pages.length), `${withCta}/${pages.length} pages have a CTA`);
    C('value_proposition', 'Value proposition (hero)', home ? 'pass' : 'not_evaluable', home ? (hasH1(home) && pageWords(home.id) >= 30 ? 90 : 45) : null, home ? undefined : 'No home page identified');
    const hier = pages.filter((p) => hasH1(p) && hasH2(p)).length;
    C('content_hierarchy', 'Content hierarchy', 'pass', pct(hier, pages.length));
    const readScores = pages.map((p) => fleschReadingEase((byPage.get(p.id) || []).map((b) => b.content_text || '').join(' '))).filter((s): s is number => s != null);
    C('readability', 'Readability', readScores.length ? 'pass' : 'not_evaluable', readScores.length ? clamp(readScores.reduce((a, b) => a + b, 0) / readScores.length) : null, 'Flesch reading ease');
    const avgWords = pages.reduce((a, p) => a + pageWords(p.id), 0) / pages.length;
    C('content_depth', 'Content depth', 'pass', clamp((avgWords / 400) * 100), `${Math.round(avgWords)} avg words/page`);
    const blogs = pages.filter((p) => matchesPage(p, ['blog', 'article', 'post', 'insight', 'resource'])).length;
    C('blog_coverage', 'Blog / resource coverage', 'pass', blogs >= 5 ? 100 : clamp((blogs / 5) * 100), `${blogs} content pages`);
    C('resources', 'Resources', present ? 'pass' : 'not_evaluable', pages.some((p) => matchesPage(p, ['resource', 'guide', 'ebook', 'whitepaper', 'library'])) ? 100 : 30);
    C('faq', 'FAQ', 'pass', pages.some((p) => matchesPage(p, ['faq', 'frequently asked', 'help', 'support'])) ? 100 : 30);
    // Duplicate content (titles / meta descriptions)
    const titles = pages.map((p) => norm(p.title)).filter(Boolean);
    const metas = pages.map((p) => norm(p.meta_description)).filter(Boolean);
    const dupRate = (arr: string[]) => (arr.length ? (arr.length - new Set(arr).size) / arr.length : 0);
    C('duplicate_content', 'Duplicate content', 'pass', clamp(100 - Math.max(dupRate(titles), dupRate(metas)) * 100), 'Title / meta uniqueness');
    // Conversion copy — CTA text uses action language
    const ctaTexts = pages.flatMap((p) => (p.ctas || []).map((c) => norm(c.text)));
    const actiony = ctaTexts.filter((t) => ACTION_VERBS.some((v) => t.includes(v))).length;
    C('conversion_copy', 'Conversion copy', ctaTexts.length ? 'pass' : 'not_evaluable', ctaTexts.length ? pct(actiony, ctaTexts.length) : null, `${actiony}/${ctaTexts.length} CTAs use action language`);
    const avgLinks = pages.reduce((a, p) => a + (p.internal_link_count || 0), 0) / pages.length;
    C('internal_linking', 'Internal linking', 'pass', clamp((avgLinks / 8) * 100), `${avgLinks.toFixed(1)} avg internal links/page`);
    // Presence / trust pages (absence is a finding, still evaluable)
    const presence: Array<[string, string, string[]]> = [
      ['contact_info', 'Contact information', ['contact']],
      ['pricing_visibility', 'Pricing visibility', ['pricing', 'plans', 'price']],
      ['company_information', 'Company information', ['about', 'company', 'who we are']],
      ['legal_pages', 'Legal pages', ['privacy', 'terms', 'legal', 'cookie']],
      ['testimonials', 'Testimonials', ['testimonial', 'review', 'customer story']],
      ['social_proof', 'Social proof', ['customers', 'trusted by', 'logos', 'press']],
      ['case_studies', 'Case studies', ['case study', 'case-stud', 'success story']],
    ];
    for (const [key, label, kws] of presence) C(key, label, 'pass', pages.some((p) => matchesPage(p, kws)) ? 100 : 25);
    // ICP / messaging consistency — title coherence across the site
    const tokenSets = titles.map((t) => new Set(t.split(' ')));
    const common = tokenSets.length > 1 ? tokenSets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x)))).size : 0;
    C('messaging_consistency', 'Messaging consistency', titles.length > 1 ? 'pass' : 'not_evaluable', titles.length > 1 ? clamp(common > 0 ? 75 : 45) : null, 'Shared brand terms across page titles');
    C('icp_alignment', 'ICP alignment', 'not_evaluable', null, 'No stored ICP profile to compare against');
  }

  const agg = aggregate(checks);
  const failing = checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 50);
  const strong = checks.filter((c) => typeof c.score === 'number' && (c.score as number) >= 80);
  const missingContent = checks.filter((c) => ['contact_info', 'pricing_visibility', 'company_information', 'legal_pages', 'faq', 'resources'].includes(c.key) && (c.score ?? 100) < 50).map((c) => c.label);
  const trustIssues = checks.filter((c) => ['testimonials', 'social_proof', 'case_studies', 'legal_pages'].includes(c.key) && (c.score ?? 100) < 50).map((c) => c.label);
  const conversionIssues = checks.filter((c) => ['cta_quality', 'conversion_copy', 'pricing_visibility', 'value_proposition'].includes(c.key) && (c.score ?? 100) < 50).map((c) => c.label);
  const recMap: Record<string, string> = {
    headline_clarity: 'Add a clear H1 headline to every page missing one.',
    cta_quality: 'Add a primary call-to-action to pages without one.',
    content_hierarchy: 'Introduce H2 sub-headings to structure long pages.',
    readability: 'Simplify sentences to improve readability.',
    content_depth: 'Expand thin pages toward ~400+ words of substantive content.',
    blog_coverage: 'Publish more blog/resource content to build topical depth.',
    duplicate_content: 'Make page titles and meta descriptions unique.',
    conversion_copy: 'Use action-oriented language in CTAs (Start, Book, Get).',
    internal_linking: 'Add internal links between related pages.',
    contact_info: 'Add a dedicated contact page.', pricing_visibility: 'Publish a pricing or plans page.',
    company_information: 'Add an About / company page.', legal_pages: 'Add privacy policy and terms pages.',
    testimonials: 'Add customer testimonials.', social_proof: 'Add social proof (customer logos / press).',
    case_studies: 'Publish case studies.', faq: 'Add an FAQ / help section.', resources: 'Add a resources / guides section.',
  };
  const recommendations = failing.map((c) => ({ key: c.key, recommendation: recMap[c.key] || `Improve ${c.label.toLowerCase()}.` }));

  return {
    contentScore: agg.score,
    contentHealth: healthFromScore(agg.score),
    contentReadiness: readinessFromScore(agg.score, agg.confidence),
    contentStrengths: strong.map((c) => c.label),
    contentWeaknesses: failing.map((c) => c.label),
    missingContent, conversionIssues, trustIssues, recommendations, checks,
    confidence: agg.confidence,
    freshness: freshnessFrom(pages.map((p) => p.last_crawled_at).filter(Boolean).sort().reverse()[0] ?? null, nowMs),
    provenance: { sources: ['canonical_pages', 'page_content', 'page_links'], checksEvaluated: agg.evaluated, checksTotal: agg.total, deterministic: true },
  };
}

export async function evaluateContentIntelligence(companyId: string, nowMs = Date.now()): Promise<ContentIntelligence> {
  try {
    const { data: pages } = await supabase.from('canonical_pages')
      .select('id, url, title, meta_title, meta_description, page_type, headings, ctas, internal_link_count, http_status, last_crawled_at')
      .eq('company_id', companyId).order('last_crawled_at', { ascending: false }).limit(500);
    const list = (pages || []) as PageRow[];
    const ids = list.map((p) => p.id);
    let blocks: ContentBlock[] = [];
    if (ids.length) {
      const { data } = await supabase.from('page_content').select('page_id, block_type, content_text, heading_level').eq('company_id', companyId).in('page_id', ids).limit(5000);
      blocks = (data || []) as ContentBlock[];
    }
    return scoreContentIntelligence(list, blocks, nowMs);
  } catch {
    return scoreContentIntelligence([], [], nowMs);
  }
}
