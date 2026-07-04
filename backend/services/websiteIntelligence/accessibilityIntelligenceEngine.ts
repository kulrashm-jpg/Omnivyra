/**
 * Website Accessibility Intelligence — deterministic, honest-coverage (Phase 18, Phase C).
 * Reads ONLY persisted crawl structure (canonical_pages.headings, page_content block
 * types, page_links.anchor_text, crawl_metadata.meta_tags). The regex crawler does NOT
 * capture images/ARIA/CSS/rendered DOM, so alt-text, ARIA, contrast, keyboard and focus
 * checks are reported not_evaluable (confidence reflects this) — never fabricated.
 */
import { supabase } from '../../db/supabaseClient';
import { CheckResult, Freshness, Provenance, aggregate, clamp, freshnessFrom, norm } from './engineCommon';
// BETA-ARCH-001: optional canonical-evidence metadata (read-only mapping of existing output).
import { buildWebsiteEngineEvidence, type Evidence } from '../evidencePlatform';
// BETA-ROADMAP-EXEC-002: static-parser signals recovered into crawl_metadata (type-only import).
import type { PageSignals } from '../crawlerService';

interface PageRow { id: string; url: string; headings: Array<{ level: number; text: string }> | null; last_crawled_at: string | null; crawl_metadata: { meta_tags?: Record<string, string>; signals?: PageSignals } | null }
interface ContentBlock { page_id: string; block_type: string; heading_level: number | null }
interface LinkRow { from_page_id: string; anchor_text: string | null }

export type WcagLevel = 'AA' | 'A' | 'none' | 'insufficient_data';

export interface AccessibilityIntelligence {
  accessibilityScore: number | null;
  wcagLevel: WcagLevel;
  criticalIssues: string[];
  warnings: string[];
  recommendations: Array<{ key: string; recommendation: string }>;
  checks: CheckResult[];
  confidence: number;
  freshness: Freshness;
  provenance: Provenance;
  /** BETA-ARCH-001: optional canonical evidence (additive; unused by existing consumers). */
  platformEvidence?: Evidence[];
}

const GENERIC_LINK = ['click here', 'read more', 'here', 'more', 'link', 'this', 'learn more', 'click'];

export function scoreAccessibilityIntelligence(pages: PageRow[], blocks: ContentBlock[], links: LinkRow[], nowMs: number): AccessibilityIntelligence {
  const checks: CheckResult[] = [];
  const C = (key: string, label: string, status: CheckResult['status'], score: number | null, detail?: string) => checks.push({ key, label, status, score, detail });
  const pct = (n: number, d: number) => (d > 0 ? clamp((n / d) * 100) : 0);
  const metaTags = (p: PageRow) => p.crawl_metadata?.meta_tags || {};
  const anyMeta = pages.some((p) => Object.keys(metaTags(p)).length > 0);
  // BETA-ROADMAP-EXEC-002: recovered static-parser signals (present only on post-upgrade crawls).
  const sig = (p: PageRow) => p.crawl_metadata?.signals;

  if (pages.length === 0) {
    C('crawl', 'Crawl coverage', 'not_evaluable', null, 'No crawled pages — run the website scan');
  } else {
    const n = pages.length;
    // Heading hierarchy: H1 present + no skipped levels.
    const hierOk = pages.filter((p) => {
      const levels = Array.from(new Set((p.headings || []).map((h) => h.level))).sort((a, b) => a - b);
      if (!levels.includes(1)) return false;
      for (let i = 1; i < levels.length; i++) if (levels[i]! - levels[i - 1]! > 1) return false;
      return true;
    }).length;
    C('heading_hierarchy', 'Heading hierarchy', 'pass', pct(hierOk, n), 'H1 present, no skipped levels');
    // Link text quality.
    const anchors = links.map((l) => norm(l.anchor_text)).filter(Boolean);
    const good = anchors.filter((a) => !GENERIC_LINK.includes(a)).length;
    C('link_text', 'Descriptive link text', anchors.length ? 'pass' : 'not_evaluable', anchors.length ? pct(good, anchors.length) : null, `${anchors.length - good} generic link texts`);
    // Semantic HTML — structured blocks present.
    const semanticPages = new Set(blocks.filter((b) => ['heading', 'list', 'paragraph'].includes(b.block_type)).map((b) => b.page_id)).size;
    C('semantic_html', 'Semantic structure', blocks.length ? 'pass' : 'not_evaluable', blocks.length ? pct(semanticPages, n) : null, 'Pages with headings/lists/paragraphs');
    C('lists', 'List markup', blocks.length ? 'pass' : 'not_evaluable', blocks.length ? (blocks.some((b) => b.block_type === 'list') ? 80 : 50) : null);
    // Meta-derived.
    C('viewport', 'Viewport meta', anyMeta ? 'pass' : 'not_evaluable', anyMeta ? pct(pages.filter((p) => 'viewport' in metaTags(p)).length, n) : null);
    // BETA-ROADMAP-EXEC-002: `html lang` is now recovered by the static parser (crawl_metadata.signals.lang),
    // augmenting the meta-derived language check.
    const langPages = pages.filter((p) => sig(p)?.lang || Object.keys(metaTags(p)).some((k) => k === 'lang' || k.includes('language'))).length;
    C('language_declaration', 'Language declaration', langPages > 0 ? 'pass' : 'not_evaluable', langPages > 0 ? pct(langPages, n) : null, langPages > 0 ? undefined : 'No <html lang> or language meta found');
    // BETA-ROADMAP-EXEC-002: image alt-text coverage is now recovered from the static parse (img with alt / total img).
    const imgPages = pages.filter((p) => (sig(p)?.img_count ?? 0) > 0);
    const totalImg = imgPages.reduce((a, p) => a + (sig(p)!.img_count || 0), 0);
    const altImg = imgPages.reduce((a, p) => a + (sig(p)!.img_with_alt || 0), 0);
    C('alt_text', 'Image alt text', imgPages.length ? 'pass' : 'not_evaluable', imgPages.length ? pct(altImg, totalImg) : null, imgPages.length ? `${altImg}/${totalImg} images have alt text` : 'No images found');
    // Genuinely need rendered DOM / CSS / interaction — remain honest not_evaluable (headless only; IMPACT-AUDIT-001).
    for (const [k, l] of [['aria', 'ARIA attributes'], ['label_association', 'Form label association'], ['keyboard_navigation', 'Keyboard navigation'], ['focus_visibility', 'Focus visibility'], ['contrast', 'Colour contrast'], ['button_accessibility', 'Button accessibility'], ['forms', 'Form accessibility'], ['tables', 'Table accessibility']] as const) {
      C(k, l, 'not_evaluable', null, 'Requires rendered DOM / CSS (not captured by a static crawl)');
    }
  }

  const agg = aggregate(checks);
  let wcagLevel: WcagLevel = 'insufficient_data';
  if (agg.score != null && agg.confidence >= 0.3) wcagLevel = agg.score >= 90 ? 'AA' : agg.score >= 70 ? 'A' : 'none';
  const criticalIssues = checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 50).map((c) => c.label);
  const warnings = checks.filter((c) => typeof c.score === 'number' && (c.score as number) >= 50 && (c.score as number) < 80).map((c) => c.label);
  const recMap: Record<string, string> = {
    heading_hierarchy: 'Use a single H1 and avoid skipping heading levels.',
    link_text: 'Replace generic link text (“click here”) with descriptive labels.',
    semantic_html: 'Use semantic headings, lists and paragraphs.',
    viewport: 'Add a responsive viewport meta tag.',
    language_declaration: 'Declare the page language with html lang.',
    alt_text: 'Add descriptive alt text to every meaningful image.',
  };
  const recommendations = checks.filter((c) => typeof c.score === 'number' && (c.score as number) < 70).map((c) => ({ key: c.key, recommendation: recMap[c.key] || `Improve ${c.label.toLowerCase()}.` }));

  const freshness = freshnessFrom(pages.map((p) => p.last_crawled_at).filter(Boolean).sort().reverse()[0] ?? null, nowMs);
  return {
    accessibilityScore: agg.score, wcagLevel, criticalIssues, warnings, recommendations, checks,
    confidence: agg.confidence,
    freshness,
    provenance: { sources: ['canonical_pages', 'page_content', 'page_links'], checksEvaluated: agg.evaluated, checksTotal: agg.total, deterministic: true },
    platformEvidence: buildWebsiteEngineEvidence({
      engineId: 'website.accessibility', version: '1.0.0', sourceSystem: 'website_crawl', origin: 'canonical_pages', collector: 'regex_crawler',
      checks, aggregate: { key: 'accessibility_score', label: 'Accessibility score', score: agg.score, confidence: agg.confidence }, freshness,
    }),
  };
}

export async function evaluateAccessibilityIntelligence(companyId: string, nowMs = Date.now()): Promise<AccessibilityIntelligence> {
  try {
    const { data: pages } = await supabase.from('canonical_pages').select('id, url, headings, last_crawled_at, crawl_metadata').eq('company_id', companyId).order('last_crawled_at', { ascending: false }).limit(500);
    const list = (pages || []) as PageRow[];
    const ids = list.map((p) => p.id);
    let blocks: ContentBlock[] = []; let links: LinkRow[] = [];
    if (ids.length) {
      const [bc, lk] = await Promise.all([
        supabase.from('page_content').select('page_id, block_type, heading_level').eq('company_id', companyId).in('page_id', ids).limit(5000),
        supabase.from('page_links').select('from_page_id, anchor_text').eq('company_id', companyId).in('from_page_id', ids).limit(5000),
      ]);
      blocks = (bc.data || []) as ContentBlock[]; links = (lk.data || []) as LinkRow[];
    }
    return scoreAccessibilityIntelligence(list, blocks, links, nowMs);
  } catch {
    return scoreAccessibilityIntelligence([], [], [], nowMs);
  }
}
